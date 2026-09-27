import "server-only";

import { z } from "zod";

import type { LlmGatewayConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fetchWithTimeout, withRetry } from "@/lib/http/retry";
import { shrinkLlmImages } from "@/lib/images/process";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { LlmImage, LlmImageHost, StructuredRequest } from "@/lib/providers/llm/types";
import { createVisionTest, passesVisionTest } from "@/lib/providers/llm/vision-check";

/**
 * Director brain through an OpenAI-compatible gateway: POST
 * {baseUrl}/chat/completions with a Bearer key. The model is whatever id the
 * gateway lists; it must see images, because most brain calls send photos.
 *
 * Gateways differ in what they accept, so the brain adapts and remembers what
 * worked for each model:
 * - photos: a gateway may drop images or pass them to the model as text. So
 *   the photos take the first route through which the model names the colours
 *   of two test images in a row (see vision-check.ts): links or inline data,
 *   through chat completions or the Anthropic messages format
 *   ({baseUrl}/messages), which carries images as image blocks. Inline photos
 *   that overflow are re-encoded smaller to fit the limit the gateway reports;
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

/** The API a request goes through: OpenAI chat completions, or Anthropic messages. */
type ApiFormat = "chat" | "messages";

/** How photos reach a gateway model: through which API, and as links or inline data. */
type ImageRoute = { label: string; format: ApiFormat; images: "url" | "data" };

/** Tried in this order: links keep requests small; inline data is the last resort. */
const IMAGE_ROUTES: ImageRoute[] = [
  { label: "chat links", format: "chat", images: "url" },
  { label: "messages links", format: "messages", images: "url" },
  { label: "messages inline", format: "messages", images: "data" },
  { label: "chat inline", format: "chat", images: "data" },
];

type CheckedRoute = {
  route: ImageRoute;
  at: number;
  /** What happened on the routes tried before this one. */
  failed?: string;
};

/** The route through which each gateway model read the test images. */
const checkedRoutes = new Map<string, CheckedRoute>();
const pendingChecks = new Map<string, Promise<CheckedRoute>>();
/** Re-checked this often, since a pooled gateway may change what serves a model. */
const ROUTE_CHECK_TTL_MS = 30 * 60 * 1000;
/** Test images a route must read in a row; a lucky guess is about 1 in 30. */
const TEST_PASSES = 2;

/** Wording gateways use when a request is longer than the model's context. */
const CONTEXT_OVERFLOW =
  /context length|context window|maximum context|too many tokens|reduce the length|context_length_exceeded|prompt is too long/i;

function isOverflow(error: AppError): boolean {
  return error.status === 413 || CONTEXT_OVERFLOW.test(error.detail ?? "");
}

/**
 * True when an error only rules out one photo route: a refused image or an
 * unusable answer, or on the Anthropic format (which a gateway may not serve
 * for every model or key) a missing endpoint or a refused key. Balance, quota
 * and outages are reported as they are.
 */
function rulesOutRoute(error: AppError, route: ImageRoute): boolean {
  const imageProblem = ["provider_bad_input", "llm_output", "provider_refusal", "content_filter"];
  if (imageProblem.includes(error.code)) return true;
  return route.format === "messages" && ["not_found", "provider_auth"].includes(error.code);
}

/**
 * How much inline photo data a gateway model takes, learned from its overflow
 * errors: its context and the characters it counts per token, or (when the
 * error gives no numbers) a character budget for the photos.
 */
type InlineLimit = { contextTokens: number; charsPerToken: number } | { imageChars: number };
const inlineLimits = new Map<string, InlineLimit>();

/** Share of the context the fitted request may fill. */
const CONTEXT_SHARE = 0.85;

/**
 * The model's context and the tokens counted, from an overflow message such
 * as "maximum context length is 270,000 tokens. However, your request resulted
 * in 1,417,769 tokens" or "prompt is too long: 250000 tokens > 200000 maximum".
 */
export function parseOverflow(detail: string): { context: number; counted: number } | null {
  const number = (text: string) => Number(text.replace(/,/g, ""));
  const over = /(\d[\d,]*)\s*tokens\s*>\s*(\d[\d,]*)/i.exec(detail);
  if (over) return { context: number(over[2]!), counted: number(over[1]!) };
  const [context, counted] = [...detail.matchAll(/(\d[\d,]*)\s*tokens/gi)].map((match) =>
    number(match[1]!),
  );
  return context && counted && counted > context ? { context, counted } : null;
}

const imageChars = (images: LlmImage[]) =>
  images.reduce((sum, image) => sum + image.base64.length, 0);

/** Characters of a request besides its image data, roughly as a gateway counts them. */
function textChars(request: StructuredRequest<unknown>): number {
  const schema = JSON.stringify(gatewayJsonSchema(request.schema)).length;
  const captions = request.images.reduce((sum, image) => sum + image.caption.length + 100, 0);
  return request.system.length + request.user.length + schema + captions;
}

type ChatMessageContent = string | { type?: string; text?: string }[] | null | undefined;

type ChatCompletion = {
  choices?: {
    finish_reason?: string | null;
    message?: { content?: ChatMessageContent; refusal?: string | null };
  }[];
};

/** An Anthropic messages reply (a gateway may still answer in the chat shape). */
type GatewayReply = ChatCompletion & {
  content?: { type?: string; text?: string }[];
  stop_reason?: string | null;
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

  private async post(body: Record<string, unknown>, format: ApiFormat): Promise<GatewayReply> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (format === "messages") {
      headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
    const path = format === "messages" ? "/messages" : "/chat/completions";
    return withRetry(
      async () => {
        const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          timeoutMs: 150_000,
          cache: "no-store",
        });
        if (!response.ok) throw await gatewayError(response, this.name, this.model);
        return (await response.json()) as GatewayReply;
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
    format: ApiFormat,
  ): Record<string, unknown> {
    const schema = gatewayJsonSchema(request.schema);
    const hint =
      settings.mode === "json_schema"
        ? ""
        : `\n\nRespond with JSON only, matching this JSON Schema:\n${JSON.stringify(schema)}`;
    if (format === "messages") {
      const blocks: unknown[] = [];
      request.images.forEach((image, index) => {
        const url = imageUrls?.[index];
        blocks.push({ type: "text", text: image.caption });
        blocks.push({
          type: "image",
          source: url
            ? { type: "url", url }
            : { type: "base64", media_type: image.mimeType, data: image.base64 },
        });
      });
      blocks.push({ type: "text", text: request.user + hint });
      return {
        model: this.model,
        max_tokens: Math.min(request.maxTokens, settings.maxTokens ?? this.tokenCap),
        system: request.system,
        messages: [{ role: "user", content: blocks }],
      };
    }
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
    format: ApiFormat,
  ): Promise<string> {
    const payload = await this.post(this.body(request, settings, imageUrls, format), format);
    if (Array.isArray(payload.content)) {
      if (payload.stop_reason === "refusal") {
        throw new AppError(
          "provider_refusal",
          "The model declined this request. Use neutral garment wording and try again.",
        );
      }
      if (payload.stop_reason === "max_tokens") {
        throw new AppError("llm_output", "The model ran out of output space before finishing.", {
          retryable: true,
        });
      }
      const text = payload.content
        .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
        .join("")
        .trim();
      if (!text) throw new AppError("llm_output", `${this.name} returned an empty answer.`);
      return text;
    }
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
    const checked = await this.imageRoute();
    try {
      return await this.ask(request, checked.route);
    } catch (error) {
      const inlineOverflow =
        checked.failed &&
        checked.route.images === "data" &&
        error instanceof AppError &&
        isOverflow(error);
      if (!inlineOverflow) throw error;
      // The overflow comes from inline photos; the routes that failed are the real problem.
      throw new AppError(
        error.code,
        `${error.message} The photos went inline because the other routes failed the image test (${checked.failed}).`,
        { detail: error.detail, status: error.status },
      );
    }
  }

  /**
   * How this model gets photos, checked and then remembered for a while.
   * Concurrent first calls share one check.
   */
  private imageRoute(): Promise<CheckedRoute> {
    const key = `${this.key}|${this.imageHost ? "links" : "inline"}`;
    const known = checkedRoutes.get(key);
    if (known && Date.now() - known.at < ROUTE_CHECK_TTL_MS) return Promise.resolve(known);
    let pending = pendingChecks.get(key);
    if (!pending) {
      pending = this.checkImageRoutes()
        .then((checked) => {
          checkedRoutes.set(key, checked);
          return checked;
        })
        .finally(() => pendingChecks.delete(key));
      pendingChecks.set(key, pending);
    }
    return pending;
  }

  /**
   * Tests every route (links need an image host) and keeps the first, in the
   * order of IMAGE_ROUTES, through which the model named the colours of the
   * test images. Routes are tested side by side, because a gateway can take
   * many seconds per answer. When none works, the error lists every route.
   */
  private async checkImageRoutes(): Promise<CheckedRoute> {
    const routes = IMAGE_ROUTES.filter((route) => route.images === "data" || this.imageHost);
    const problems = await Promise.all(routes.map((route) => this.testRoute(route)));
    const chosen = problems.findIndex((problem) => problem === null);
    const failed = routes.flatMap((route, index) =>
      problems[index] && (chosen === -1 || index < chosen)
        ? [`${route.label}: ${problems[index]}`]
        : [],
    );
    for (const line of failed) console.warn(`${this.name} ${this.model}: ${line}`);
    if (chosen === -1) {
      throw new AppError(
        "provider_bad_input",
        `${this.model} at ${this.name} could not read a test image through any route, so it cannot see the garment photos. Choose another model in Settings.`,
        { detail: failed.join("; ").slice(0, 600) },
      );
    }
    return {
      route: routes[chosen]!,
      at: Date.now(),
      failed: failed.length > 0 ? failed.join("; ") : undefined,
    };
  }

  /** Null when the model names the colours of every test image sent this way; else why not. */
  private async testRoute(route: ImageRoute): Promise<string | null> {
    for (let pass = 0; pass < TEST_PASSES; pass += 1) {
      const test = await createVisionTest();
      try {
        const answer = await this.ask(test.request, route);
        if (!passesVisionTest(answer, test.expected)) {
          return `named ${answer.topLeft} / ${answer.bottomRight} for ${test.expected.topLeft} / ${test.expected.bottomRight}`;
        }
      } catch (error) {
        if (!(error instanceof AppError) || !rulesOutRoute(error, route)) throw error;
        return (error.detail ?? error.message).slice(0, 140);
      }
    }
    return null;
  }

  /** One structured call, with the photos sent the given way (links are deleted afterwards). */
  private async ask<T>(request: StructuredRequest<T>, route: ImageRoute | null): Promise<T> {
    if (!route) return this.attempt(request, null, "chat");
    if (route.images === "data") return this.askInline(request, route.format);
    const hosted = this.imageHost ? await this.imageHost(request.images) : null;
    try {
      return await this.attempt(request, hosted?.urls ?? null, route.format);
    } finally {
      await hosted?.release().catch(() => undefined);
    }
  }

  /**
   * Inline photos, fitted to what the gateway counts. After an overflow, the
   * limit it reports is learned and the photos are re-encoded smaller (twice
   * at most); later calls fit them before sending.
   */
  private async askInline<T>(request: StructuredRequest<T>, format: ApiFormat): Promise<T> {
    for (let round = 0; ; round += 1) {
      const sent = { ...request, images: await this.fitInline(request, format) };
      try {
        return await this.attempt(sent, null, format);
      } catch (error) {
        const retry =
          round < 2 && sent.images.length > 0 && error instanceof AppError && isOverflow(error);
        if (!retry) throw error;
        this.learnInlineLimit(sent, error, format);
      }
    }
  }

  /** The request's photos, re-encoded smaller when they would overflow the learned limit. */
  private async fitInline(
    request: StructuredRequest<unknown>,
    format: ApiFormat,
  ): Promise<LlmImage[]> {
    const limit = inlineLimits.get(`${this.key}|${format}`);
    if (!limit || request.images.length === 0) return request.images;
    const budget =
      "imageChars" in limit
        ? limit.imageChars
        : Math.floor(
            (limit.contextTokens * CONTEXT_SHARE - Math.min(request.maxTokens, this.tokenCap)) *
              limit.charsPerToken -
              textChars(request),
          );
    if (imageChars(request.images) <= budget) return request.images;
    const fitted = budget > 0 ? await shrinkLlmImages(request.images, budget) : null;
    if (!fitted) {
      throw new AppError(
        "provider_bad_input",
        `Too many photos for ${this.model} at ${this.name}: they do not fit its limit even at 384 px. Use fewer photos, a model that takes photos by link, or a direct Claude or Gemini key.`,
        { status: 413, detail: `${request.images.length} photos` },
      );
    }
    console.warn(
      `${this.name} ${this.model}: ${request.images.length} photos sent inline at ${fitted.longEdge} px to fit its limit`,
    );
    return fitted.images;
  }

  private learnInlineLimit(
    sent: StructuredRequest<unknown>,
    error: AppError,
    format: ApiFormat,
  ): void {
    const numbers = parseOverflow(error.detail ?? "");
    const photos = imageChars(sent.images);
    inlineLimits.set(
      `${this.key}|${format}`,
      numbers
        ? {
            contextTokens: numbers.context,
            charsPerToken: (photos + textChars(sent)) / numbers.counted,
          }
        : { imageChars: Math.floor(photos / 2) },
    );
  }

  /**
   * Sends one request, adapting the JSON mode and output cap, and validates the
   * answer. The Anthropic format has no response_format, so its JSON schema
   * always goes in the prompt.
   */
  private async attempt<T>(
    request: StructuredRequest<T>,
    imageUrls: string[] | null,
    format: ApiFormat,
  ): Promise<T> {
    const key = `${this.key}|${format}`;
    let settings: Learned = learned.get(key) ?? {
      mode: format === "messages" ? "prompt" : "json_schema",
      tokenField: "max_tokens",
      maxTokens: null,
    };
    let text: string | null = null;
    for (let attempt = 0; attempt < 6 && text === null; attempt += 1) {
      try {
        text = await this.complete(request, settings, imageUrls, format);
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
    learned.set(key, settings);

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
