import "server-only";

import { z } from "zod";

import type { LlmGatewayConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fetchWithTimeout, withRetry } from "@/lib/http/retry";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { LlmImageHost, StructuredRequest } from "@/lib/providers/llm/types";
import { createVisionTest, passesVisionTest } from "@/lib/providers/llm/vision-check";

/**
 * Director brain through an OpenAI-compatible gateway: POST
 * {baseUrl}/chat/completions with a Bearer key, the garment photos as
 * `image_url` parts (data URLs). The model is whatever id the gateway lists;
 * it must accept images, because most brain calls send photos.
 *
 * Gateways differ in what they accept, so the brain adapts and remembers what
 * worked for each model:
 * - photos: short-lived links when an image host is given (some gateways count
 *   inline image data as text, so a dozen photos overflow the context), else
 *   inline data URLs. Before its first photos, a model must name two colours
 *   of a test image through the chosen route (see vision-check.ts);
 * - JSON: `response_format` json_schema, else json_object, else the schema in
 *   the prompt (the answer is still validated with Zod either way);
 * - output cap: `max_tokens`, or `max_completion_tokens` when the gateway asks
 *   for it, halved when the model's limit is lower.
 */

type JsonMode = "json_schema" | "json_object" | "prompt";
const JSON_MODES: JsonMode[] = ["json_schema", "json_object", "prompt"];

type Learned = {
  mode: JsonMode;
  tokenField: "max_tokens" | "max_completion_tokens";
  maxTokens: number | null;
};

/** What each gateway model accepted, so later calls skip the failed attempts. */
const learned = new Map<string, Learned>();

type ImageTransport = "url" | "data";

type ImageRoute = {
  transport: ImageTransport;
  at: number;
  /** Why links failed the vision check, when the photos go inline instead. */
  linkProblem?: string;
};

/** The route through which each gateway model read the test image. */
const imageRoutes = new Map<string, ImageRoute>();
const pendingRoutes = new Map<string, Promise<ImageRoute>>();
const VISION_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

/** Wording gateways use when a request is longer than the model's context. */
const CONTEXT_OVERFLOW =
  /context length|context window|maximum context|too many tokens|reduce the length|context_length_exceeded|prompt is too long/i;

function isOverflow(error: AppError): boolean {
  return error.status === 413 || CONTEXT_OVERFLOW.test(error.detail ?? "");
}

type ChatMessageContent = string | { type?: string; text?: string }[] | null | undefined;

type ChatCompletion = {
  choices?: {
    finish_reason?: string | null;
    message?: { content?: ChatMessageContent; refusal?: string | null };
  }[];
};

/** JSON Schema for response_format / the prompt (inlined, no $schema key). */
export function gatewayJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { reused: "inline", io: "output" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

/** Text of a chat completion message (plain string or an array of parts). */
export function messageText(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/** Reads JSON from a model answer that may be fenced or wrapped in prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1] ?? trimmed;
  try {
    return JSON.parse(fenced);
  } catch {
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object");
    return JSON.parse(fenced.slice(start, end + 1));
  }
}

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown } | string;
      message?: unknown;
      detail?: unknown;
    };
    const message =
      typeof payload.error === "string"
        ? payload.error
        : (payload.error?.message ?? payload.message ?? payload.detail);
    return typeof message === "string" ? message.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

/** Maps a gateway error response to a user-facing error. */
export async function gatewayError(
  response: Response,
  name: string,
  model: string,
): Promise<AppError> {
  const detail = await errorDetail(response);
  const status = response.status;
  const base = { detail, status };
  if (status === 401) {
    return new AppError(
      "provider_auth",
      `${name} rejected the API key. Check LLM_GATEWAY_API_KEY.`,
      base,
    );
  }
  if (status === 402) {
    return new AppError("provider_credits", `Not enough balance at ${name}.`, base);
  }
  if (status === 403) {
    return new AppError(
      "provider_auth",
      `${name} refused the request (key, plan or account verification).`,
      base,
    );
  }
  if (status === 404) {
    return new AppError(
      "not_found",
      `${name} has no model "${model}". Check the model ID in Settings.`,
      base,
    );
  }
  if (status === 408 || status === 429) {
    return new AppError(
      "provider_rate_limit",
      `${name} is rate limiting this model or its daily quota is used up.`,
      { ...base, retryable: true },
    );
  }
  if (status >= 500) {
    return new AppError("provider_unavailable", `${name} is temporarily unavailable.`, {
      ...base,
      retryable: true,
    });
  }
  if (status === 413 || CONTEXT_OVERFLOW.test(detail ?? "")) {
    return new AppError(
      "provider_bad_input",
      `The request is longer than ${model} at ${name} accepts. Choose a model with a larger context in Settings.`,
      base,
    );
  }
  return new AppError("provider_bad_input", `${name} rejected the request.`, base);
}

export class GatewayBrain extends TemplateBrain {
  readonly provider = "gateway" as const;
  readonly model: string;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tokenCap: number;
  private readonly imageHost: LlmImageHost | null;

  constructor(config: LlmGatewayConfig & { model: string }, imageHost?: LlmImageHost) {
    super();
    this.model = config.model;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.tokenCap = config.maxTokens;
    this.imageHost = imageHost ?? null;
  }

  private get key(): string {
    return `${this.baseUrl}|${this.model}`;
  }

  private async post(body: Record<string, unknown>): Promise<ChatCompletion> {
    return withRetry(
      async () => {
        const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          timeoutMs: 150_000,
          cache: "no-store",
        });
        if (!response.ok) throw await gatewayError(response, this.name, this.model);
        return (await response.json()) as ChatCompletion;
      },
      {
        retries: 1,
        baseDelayMs: 2000,
        maxDelayMs: 10_000,
        shouldRetry: (error) =>
          error instanceof AppError ? error.retryable && error.code !== "provider_timeout" : false,
      },
    );
  }

  private body(
    request: StructuredRequest<unknown>,
    settings: Learned,
    imageUrls: string[] | null,
  ): Record<string, unknown> {
    const schema = gatewayJsonSchema(request.schema);
    const hint =
      settings.mode === "json_schema"
        ? ""
        : `\n\nRespond with JSON only, matching this JSON Schema:\n${JSON.stringify(schema)}`;
    const content: unknown[] = [];
    request.images.forEach((image, index) => {
      content.push({ type: "text", text: image.caption });
      content.push({
        type: "image_url",
        image_url: { url: imageUrls?.[index] ?? `data:${image.mimeType};base64,${image.base64}` },
      });
    });
    content.push({ type: "text", text: request.user + hint });
    const cap = Math.min(request.maxTokens, settings.maxTokens ?? this.tokenCap);
    return {
      model: this.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.images.length > 0 ? content : request.user + hint },
      ],
      [settings.tokenField]: cap,
      ...(settings.mode === "json_schema"
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: request.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "answer",
                schema,
                strict: false,
              },
            },
          }
        : settings.mode === "json_object"
          ? { response_format: { type: "json_object" } }
          : {}),
    };
  }

  private async complete(
    request: StructuredRequest<unknown>,
    settings: Learned,
    imageUrls: string[] | null,
  ): Promise<string> {
    const payload = await this.post(this.body(request, settings, imageUrls));
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new AppError("llm_output", `${this.name} returned no answer.`);
    if (choice.message.refusal) {
      throw new AppError(
        "provider_refusal",
        "The model declined this request. Use neutral garment wording and try again.",
        { detail: String(choice.message.refusal).slice(0, 200) },
      );
    }
    if (choice.finish_reason === "content_filter") {
      throw new AppError(
        "content_filter",
        `${this.name} filtered this request. Use neutral garment wording and try again.`,
      );
    }
    if (choice.finish_reason === "length") {
      throw new AppError("llm_output", "The model ran out of output space before finishing.", {
        retryable: true,
      });
    }
    const text = messageText(choice.message.content);
    if (!text) throw new AppError("llm_output", `${this.name} returned an empty answer.`);
    return text;
  }

  /**
   * Adjusts what is sent after a rejected request: the output cap field or
   * size when the error names it, otherwise the next JSON mode. Null when
   * there is nothing left to try, or when no JSON mode can help (a request
   * longer than the context, an image the gateway could not take).
   */
  private adapt(settings: Learned, error: AppError): Learned | null {
    if (isOverflow(error)) return null;
    const detail = (error.detail ?? "").toLowerCase();
    if (settings.tokenField === "max_tokens" && detail.includes("max_completion_tokens")) {
      return { ...settings, tokenField: "max_completion_tokens" };
    }
    const cap = settings.maxTokens ?? this.tokenCap;
    if (/max_(completion_)?tokens/.test(detail) && cap > 4096) {
      return { ...settings, maxTokens: Math.max(4096, Math.floor(cap / 2)) };
    }
    if (!/response_format|json/.test(detail) && /image|download|fetch|url/.test(detail)) {
      return null;
    }
    const next = JSON_MODES[JSON_MODES.indexOf(settings.mode) + 1];
    return next ? { ...settings, mode: next } : null;
  }

  protected async generate<T>(request: StructuredRequest<T>): Promise<T> {
    if (request.images.length === 0) return this.ask(request, null);
    const route = await this.imageRoute();
    try {
      return await this.ask(request, route.transport);
    } catch (error) {
      if (!route.linkProblem || !(error instanceof AppError) || !isOverflow(error)) throw error;
      // The overflow comes from inline photos; the links are the real problem.
      throw new AppError(
        error.code,
        `${error.message} The photos went inline because ${this.name} could not use links: ${route.linkProblem}`,
        { detail: error.detail, status: error.status },
      );
    }
  }

  /**
   * How this model gets photos, checked once and remembered for a few hours.
   * Concurrent first calls share one check.
   */
  private imageRoute(): Promise<ImageRoute> {
    const key = `${this.key}|${this.imageHost ? "links" : "inline"}`;
    const known = imageRoutes.get(key);
    if (known && Date.now() - known.at < VISION_CHECK_TTL_MS) return Promise.resolve(known);
    let pending = pendingRoutes.get(key);
    if (!pending) {
      pending = this.checkImageRoutes()
        .then((route) => {
          imageRoutes.set(key, route);
          return route;
        })
        .finally(() => pendingRoutes.delete(key));
      pendingRoutes.set(key, pending);
    }
    return pending;
  }

  /**
   * Sends a test image by link (when an image host is available), then
   * inline, and keeps the first route through which the model names its
   * colours (see vision-check.ts).
   */
  private async checkImageRoutes(): Promise<ImageRoute> {
    const routes: ImageTransport[] = this.imageHost ? ["url", "data"] : ["data"];
    let problem: string | undefined;
    for (const transport of routes) {
      const test = await createVisionTest();
      try {
        const answer = await this.ask(test.request, transport);
        if (passesVisionTest(answer, test.expected)) {
          return { transport, at: Date.now(), linkProblem: problem };
        }
        problem = `the model named ${answer.topLeft} / ${answer.bottomRight} for ${test.expected.topLeft} / ${test.expected.bottomRight}`;
      } catch (error) {
        // Only a refused image or a garbled answer says something about images;
        // a key, balance, quota or outage problem is reported as it is.
        if (
          !(error instanceof AppError) ||
          !["provider_bad_input", "llm_output"].includes(error.code)
        ) {
          throw error;
        }
        problem = error.detail ?? error.message;
      }
      if (transport === "url") {
        console.warn(
          `${this.name} ${this.model}: photo links failed the vision check (${problem})`,
        );
      }
    }
    throw new AppError(
      "provider_bad_input",
      `${this.model} at ${this.name} could not read a test image, so it cannot see the garment photos. Choose a model marked Vision in Settings.`,
      { detail: problem?.slice(0, 200) },
    );
  }

  /** One structured call, with the photos sent the given way (links are deleted afterwards). */
  private async ask<T>(
    request: StructuredRequest<T>,
    transport: ImageTransport | null,
  ): Promise<T> {
    const hosted =
      transport === "url" && this.imageHost ? await this.imageHost(request.images) : null;
    try {
      let settings: Learned = learned.get(this.key) ?? {
        mode: "json_schema",
        tokenField: "max_tokens",
        maxTokens: null,
      };
      let text: string | null = null;
      for (let attempt = 0; attempt < 6 && text === null; attempt += 1) {
        try {
          text = await this.complete(request, settings, hosted?.urls ?? null);
        } catch (error) {
          const next =
            error instanceof AppError && error.code === "provider_bad_input"
              ? this.adapt(settings, error)
              : null;
          if (!next) throw error;
          settings = next;
        }
      }
      if (text === null) throw new AppError("llm_output", `${this.name} returned no answer.`);
      learned.set(this.key, settings);

      let json: unknown;
      try {
        json = extractJson(text);
      } catch {
        throw new AppError("llm_output", `${this.name} returned invalid JSON.`);
      }
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        throw new AppError("llm_output", "The model returned output in an unexpected shape.", {
          detail: parsed.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });
      }
      return parsed.data;
    } finally {
      await hosted?.release().catch(() => undefined);
    }
  }
}

let modelsCache: { at: number; key: string; ids: string[] } | null = null;

/** Model ids the gateway lists (GET {baseUrl}/models), for Settings; [] on any failure. */
export async function listGatewayModels(config: LlmGatewayConfig): Promise<string[]> {
  const key = config.baseUrl;
  if (modelsCache && modelsCache.key === key && Date.now() - modelsCache.at < 10 * 60 * 1000) {
    return modelsCache.ids;
  }
  try {
    const response = await fetchWithTimeout(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
      timeoutMs: 8000,
      cache: "no-store",
    });
    const payload = response.ok ? ((await response.json()) as { data?: { id?: unknown }[] }) : {};
    const ids = (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    modelsCache = { at: Date.now(), key, ids };
    return ids;
  } catch {
    return [];
  }
}
