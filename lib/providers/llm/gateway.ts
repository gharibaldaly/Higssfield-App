import "server-only";

import { z } from "zod";

import type { LlmGatewayConfig } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { fetchWithTimeout, withRetry } from "@/lib/http/retry";
import { shrinkLlmImages } from "@/lib/images/process";
import { answerText, extractJson } from "@/lib/providers/llm/json-answer";
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
 *   for it, halved when the model's limit is lower;
 * - reasoning effort: `reasoning_effort` when configured ("off" also asks the
 *   chat template to skip thinking), each field dropped for a model whose API
 *   refuses it (NVIDIA's hosted APIs refuse unknown fields);
 * - slow answers: an answer still pending comes back as 202 with NVCF-REQID
 *   (NVIDIA), and is polled at {baseUrl}/status/{id} within the call's time.
 */

type JsonMode = "json_schema" | "json_object" | "prompt";
const JSON_MODES: JsonMode[] = ["json_schema", "json_object", "prompt"];

type Learned = {
  mode: JsonMode;
  tokenField: "max_tokens" | "max_completion_tokens";
  maxTokens: number | null;
  /** Whether `reasoning_effort` is sent. */
  reasoning: boolean;
  /** Whether `chat_template_kwargs` (thinking off) is sent. */
  templateKwargs: boolean;
};

/** How long one brain call may take, polling included; a function run has 300 s. */
const CALL_TIMEOUT_MS = 150_000;
/** A test image is answered in seconds by a usable route. */
const TEST_TIMEOUT_MS = 75_000;

/**
 * One call: its time budget, whether it asks for as little thinking as the
 * model allows, and a signal that cancels it (a route test no longer needed).
 */
type CallOptions = { timeoutMs: number; quick: boolean; signal?: AbortSignal };

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

/** Wording of a validation error that refuses a field the API does not know. */
const FIELD_REFUSED =
  /extra (inputs?|fields?)|not permitted|unrecognized|unknown (field|parameter|argument)|additional propert/i;

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
/**
 * A request with no more images than the service takes at once: the first
 * ones, which the callers order by importance (front, back, then details),
 * and for a fidelity review its result, which is always the last image.
 */
export function fitImageCount<T>(
  request: StructuredRequest<T>,
  cap: number | null,
): StructuredRequest<T> {
  if (!cap || cap < 1 || request.images.length <= cap) return request;
  const result = request.images[request.images.length - 1]!;
  const images =
    request.name === "fidelity_review" && cap >= 2
      ? [...request.images.slice(0, cap - 1), result]
      : request.images.slice(0, cap);
  return { ...request, images };
}

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
  /** The model that answered, which a router or a fallback may change. */
  model?: string;
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

/** A FastAPI validation list ("body.response_format: Extra inputs are not permitted; …"). */
function validationText(detail: unknown): string | undefined {
  if (!Array.isArray(detail)) return undefined;
  const lines = detail.flatMap((item: { loc?: unknown; msg?: unknown }) => {
    if (typeof item?.msg !== "string") return [];
    const at = Array.isArray(item.loc) ? item.loc.join(".") : "";
    return [at ? `${at}: ${item.msg}` : item.msg];
  });
  return lines.length > 0 ? lines.join("; ") : undefined;
}

/** A message field: a string, or an object holding one (Mistral puts its validation list in `message`). */
function messageOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const inner = value as { message?: unknown; detail?: unknown };
  if (typeof inner.message === "string") return inner.message;
  return (
    validationText(inner.detail) ?? (typeof inner.detail === "string" ? inner.detail : undefined)
  );
}

async function errorDetail(response: Response): Promise<string | undefined> {
  try {
    const payload = (await response.json()) as {
      error?: unknown;
      message?: unknown;
      detail?: unknown;
      title?: unknown;
    };
    const message =
      messageOf(payload.error) ??
      messageOf(payload.message) ??
      validationText(payload.detail) ??
      payload.detail ??
      payload.title;
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
  readonly name: string;
  /** The model id sent with every request. */
  private readonly requestedModel: string;
  /** The model the service says answered last, when it names one (a router or a fallback). */
  private answeredModel: string | null = null;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tokenCap: number;
  private readonly reasoningEffort: string | null;
  private readonly imageHost: LlmImageHost | null;
  private readonly extraBody: Record<string, unknown>;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxImages: number | null;
  private readonly thinkingFields: boolean;
  private readonly maxConcurrent: number | null;
  private readonly anthropicFormat: boolean;

  constructor(config: LlmGatewayConfig & { model: string }, imageHost?: LlmImageHost) {
    super();
    this.requestedModel = config.model;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.tokenCap = config.maxTokens;
    this.reasoningEffort = config.reasoningEffort ?? null;
    this.imageHost = imageHost ?? null;
    this.extraBody = config.extraBody ?? {};
    this.extraHeaders = config.headers ?? {};
    this.maxImages = config.maxImages ?? null;
    this.thinkingFields = config.thinkingFields ?? true;
    this.maxConcurrent = config.maxConcurrent ?? null;
    this.anthropicFormat = config.anthropicFormat ?? true;
  }

  /** The requested model, or the one that answered last when the service named another. */
  get model(): string {
    return this.answeredModel ?? this.requestedModel;
  }

  private get key(): string {
    return `${this.baseUrl}|${this.requestedModel}`;
  }

  private normalCall(): CallOptions {
    return { timeoutMs: this.callTimeoutMs, quick: false };
  }

  /** How long one call may take; tests shorten it. */
  protected readonly callTimeoutMs: number = CALL_TIMEOUT_MS;
  /** How long a test image may take on one route; tests shorten it. */
  protected readonly testTimeoutMs: number = TEST_TIMEOUT_MS;

  /** Waits between status polls; tests make it instant. */
  protected pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private slowAnswer(timeoutMs: number, cause?: unknown): AppError {
    return new AppError(
      "provider_timeout",
      `${this.name} did not answer within ${Math.round(timeoutMs / 1000)} s. ${this.requestedModel} may be too slow there: choose a faster model in Settings, or less reasoning.`,
      { retryable: true, cause },
    );
  }

  /** The reply, read before the call's time runs out. */
  private async replyOf(response: Response, timeoutMs: number): Promise<GatewayReply> {
    try {
      return (await response.json()) as GatewayReply;
    } catch (error) {
      if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
        throw this.slowAnswer(timeoutMs, error);
      }
      throw new AppError("llm_output", `${this.name} returned an unreadable answer.`, {
        cause: error,
      });
    }
  }

  private async post(
    body: Record<string, unknown>,
    format: ApiFormat,
    call: CallOptions,
  ): Promise<GatewayReply> {
    const { timeoutMs, signal } = call;
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (format === "messages") {
      headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
    const path = format === "messages" ? "/messages" : "/chat/completions";
    const deadline = Date.now() + timeoutMs;
    return withRetry(
      async () => {
        signal?.throwIfAborted();
        const left = deadline - Date.now();
        if (left <= 0) throw this.slowAnswer(timeoutMs);
        let response: Response;
        try {
          response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            timeoutMs: left,
            signal,
            cache: "no-store",
          });
        } catch (error) {
          if (error instanceof AppError && error.code === "provider_timeout") {
            throw this.slowAnswer(timeoutMs, error);
          }
          throw error;
        }
        const pending = response.status === 202 ? response.headers.get("nvcf-reqid") : null;
        if (pending) return this.pollResult(pending, deadline, call);
        if (!response.ok) throw await gatewayError(response, this.name, this.requestedModel);
        return this.replyOf(response, timeoutMs);
      },
      {
        // A service that takes one request at a time answers "busy" to a second call: wait longer.
        retries: this.maxConcurrent === 1 ? 3 : 1,
        baseDelayMs: 2000,
        maxDelayMs: 10_000,
        sleep: (ms) => this.pause(ms),
        shouldRetry: (error) =>
          error instanceof AppError ? error.retryable && error.code !== "provider_timeout" : false,
      },
    );
  }

  /**
   * NVIDIA answers 202 with an NVCF-REQID while the model is still working;
   * GET {baseUrl}/status/{id} then answers 202 until the reply is ready.
   */
  private async pollResult(
    requestId: string,
    deadline: number,
    call: CallOptions,
  ): Promise<GatewayReply> {
    const { timeoutMs, signal } = call;
    const url = `${this.baseUrl}/status/${encodeURIComponent(requestId)}`;
    for (let wait = 1000; ; wait = Math.min(Math.round(wait * 1.5), 5000)) {
      if (deadline - Date.now() <= 0) throw this.slowAnswer(timeoutMs);
      await this.pause(Math.min(wait, Math.max(0, deadline - Date.now())));
      signal?.throwIfAborted();
      const left = deadline - Date.now();
      if (left <= 0) throw this.slowAnswer(timeoutMs);
      let response: Response;
      try {
        response = await fetchWithTimeout(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
          timeoutMs: left,
          signal,
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "provider_timeout") {
          throw this.slowAnswer(timeoutMs, error);
        }
        // A dropped poll leaves the request running; ask again.
        if (error instanceof AppError && error.code === "provider_unavailable") continue;
        throw error;
      }
      if (response.status === 202) continue;
      if (!response.ok) throw await gatewayError(response, this.name, this.requestedModel);
      return this.replyOf(response, timeoutMs);
    }
  }

  /** Fields that set how long the model reasons; "off" asks for as little as it allows. */
  private thinking(settings: Learned, quick: boolean): Record<string, unknown> {
    if (!this.thinkingFields) return {};
    const level = quick ? "off" : this.reasoningEffort;
    if (!level) return {};
    return {
      ...(settings.reasoning ? { reasoning_effort: level === "off" ? "low" : level } : {}),
      // Chat templates read different keys: Kimi K2 "thinking", Gemma and Qwen "enable_thinking".
      ...(level === "off" && settings.templateKwargs
        ? { chat_template_kwargs: { thinking: false, enable_thinking: false } }
        : {}),
    };
  }

  private body(
    request: StructuredRequest<unknown>,
    settings: Learned,
    imageUrls: string[] | null,
    format: ApiFormat,
    call: CallOptions,
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
        model: this.requestedModel,
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
      model: this.requestedModel,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.images.length > 0 ? content : request.user + hint },
      ],
      [settings.tokenField]: cap,
      ...this.thinking(settings, call.quick),
      ...this.extraBody,
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
    call: CallOptions,
  ): Promise<string> {
    const payload = await this.post(
      this.body(request, settings, imageUrls, format, call),
      format,
      call,
    );
    // OpenRouter's router and fallbacks answer with another model than the one asked for.
    if (typeof payload.model === "string" && payload.model) this.answeredModel = payload.model;
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
   * size when the error names it, the fields the API refuses (reasoning
   * effort, response_format), otherwise the next JSON mode. Null when there
   * is nothing left to try, or when no JSON mode can help (a request longer
   * than the context, an image the gateway could not take).
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
    // An API that refuses unknown fields can name several at once.
    const refused = FIELD_REFUSED.test(detail);
    const adjusted = { ...settings };
    if (settings.reasoning && detail.includes("reasoning_effort")) adjusted.reasoning = false;
    if (settings.templateKwargs && detail.includes("chat_template_kwargs")) {
      adjusted.templateKwargs = false;
    }
    if (settings.mode !== "prompt" && refused && detail.includes("response_format")) {
      adjusted.mode = "prompt";
    }
    if (
      adjusted.reasoning !== settings.reasoning ||
      adjusted.templateKwargs !== settings.templateKwargs ||
      adjusted.mode !== settings.mode
    ) {
      return adjusted;
    }
    if (!/response_format|json/.test(detail) && /image|download|fetch|url/.test(detail)) {
      return null;
    }
    const next = JSON_MODES[JSON_MODES.indexOf(settings.mode) + 1];
    return next ? { ...settings, mode: next } : null;
  }

  protected async generate<T>(input: StructuredRequest<T>): Promise<T> {
    const request = fitImageCount(input, this.maxImages);
    if (request.images.length < input.images.length) {
      console.warn(
        `${this.name} ${this.requestedModel}: ${request.name} sends ${request.images.length} of ${input.images.length} images (the service takes ${this.maxImages} per request).`,
      );
    }
    if (request.images.length === 0) return this.ask(request, null, this.normalCall());
    const checked = await this.imageRoute();
    try {
      return await this.ask(request, checked.route, this.normalCall());
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
   * Tests every route (links need an image host; the Anthropic format only
   * where the service serves it) side by side, because a gateway can take
   * many seconds per answer, or one after another for a service that takes
   * one request at a time, and keeps the first, in the
   * order of IMAGE_ROUTES, through which the model named the colours of the
   * test images; it does not wait for the routes after it. A route that does
   * not answer in time is ruled out like one that cannot see. When none works,
   * the error lists every route.
   */
  private async checkImageRoutes(): Promise<CheckedRoute> {
    const routes = IMAGE_ROUTES.filter(
      (route) =>
        (route.images === "data" || this.imageHost) &&
        (route.format === "chat" || this.anthropicFormat),
    );
    const cancel = new AbortController();
    // A second test at a service that takes one request at a time only comes back busy.
    const oneAtATime = this.maxConcurrent === 1;
    const tests = oneAtATime ? [] : routes.map((route) => this.testRoute(route, cancel.signal));
    // Routes after the chosen one are cancelled; their failures must not surface as unhandled.
    for (const test of tests) test.catch(() => undefined);
    const failed: string[] = [];
    // Routes that only ran out of time, and Anthropic-format routes the gateway does not serve.
    let slow = 0;
    let unserved = 0;
    try {
      for (const [index, route] of routes.entries()) {
        const outcome = await (oneAtATime ? this.testRoute(route, cancel.signal) : tests[index]!);
        if (outcome === null) {
          for (const line of failed) console.warn(`${this.name} ${this.requestedModel}: ${line}`);
          return {
            route: routes[index]!,
            at: Date.now(),
            failed: failed.length > 0 ? failed.join("; ") : undefined,
          };
        }
        if (outcome.slow) slow += 1;
        if (outcome.unserved) unserved += 1;
        failed.push(`${routes[index]!.label}: ${outcome.problem}`);
      }
    } finally {
      // A route was chosen, or a key or quota error ended the check: stop the rest.
      cancel.abort();
    }
    for (const line of failed) console.warn(`${this.name} ${this.requestedModel}: ${line}`);
    const detail = failed.join("; ").slice(0, 600);
    if (slow > 0 && slow + unserved === routes.length) {
      throw new AppError(
        "provider_timeout",
        `${this.requestedModel} at ${this.name} did not answer a small test image within ${this.testTimeoutMs / 1000} s, so it is too slow for the garment photos. Choose a faster model in Settings, or less reasoning.`,
        { detail },
      );
    }
    throw new AppError(
      "provider_bad_input",
      `${this.requestedModel} at ${this.name} could not read a test image through any route, so it cannot see the garment photos. Choose another model in Settings.`,
      { detail },
    );
  }

  /**
   * Null when the model names the colours of every test image sent this way;
   * otherwise what went wrong: only too slow, a format the gateway does not
   * serve, or anything else.
   */
  private async testRoute(
    route: ImageRoute,
    signal: AbortSignal,
  ): Promise<{ problem: string; slow?: boolean; unserved?: boolean } | null> {
    for (let pass = 0; pass < TEST_PASSES; pass += 1) {
      // Another route was chosen meanwhile.
      if (signal.aborted) return { problem: "not needed" };
      const test = await createVisionTest();
      try {
        const answer = await this.ask(test.request, route, {
          timeoutMs: this.testTimeoutMs,
          quick: true,
          signal,
        });
        if (!passesVisionTest(answer, test.expected)) {
          return {
            problem: `named ${answer.topLeft} / ${answer.bottomRight} for ${test.expected.topLeft} / ${test.expected.bottomRight}`,
          };
        }
      } catch (error) {
        if (error instanceof AppError && error.code === "provider_timeout") {
          return { problem: `no answer within ${this.testTimeoutMs / 1000} s`, slow: true };
        }
        if (!(error instanceof AppError) || !rulesOutRoute(error, route)) throw error;
        // A 404 or a refused key on the Anthropic format: that endpoint is not there.
        if (route.format === "messages" && ["not_found", "provider_auth"].includes(error.code)) {
          return { problem: "no Anthropic messages endpoint", unserved: true };
        }
        return { problem: (error.detail ?? error.message).slice(0, 140) };
      }
    }
    return null;
  }

  /** One structured call, with the photos sent the given way (links are deleted afterwards). */
  private async ask<T>(
    request: StructuredRequest<T>,
    route: ImageRoute | null,
    call: CallOptions,
  ): Promise<T> {
    call.signal?.throwIfAborted();
    if (!route) return this.attempt(request, null, "chat", call);
    if (route.images === "data") return this.askInline(request, route.format, call);
    const hosted = this.imageHost ? await this.imageHost(request.images) : null;
    try {
      return await this.attempt(request, hosted?.urls ?? null, route.format, call);
    } finally {
      await hosted?.release().catch(() => undefined);
    }
  }

  /**
   * Inline photos, fitted to what the gateway counts. After an overflow, the
   * limit it reports is learned and the photos are re-encoded smaller (twice
   * at most); later calls fit them before sending.
   */
  private async askInline<T>(
    request: StructuredRequest<T>,
    format: ApiFormat,
    call: CallOptions,
  ): Promise<T> {
    for (let round = 0; ; round += 1) {
      const sent = { ...request, images: await this.fitInline(request, format) };
      try {
        return await this.attempt(sent, null, format, call);
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
        `Too many photos for ${this.requestedModel} at ${this.name}: they do not fit its limit even at 384 px. Use fewer photos, a model that takes photos by link, or a direct Claude or Gemini key.`,
        { status: 413, detail: `${request.images.length} photos` },
      );
    }
    console.warn(
      `${this.name} ${this.requestedModel}: ${request.images.length} photos sent inline at ${fitted.longEdge} px to fit its limit`,
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
    call: CallOptions,
  ): Promise<T> {
    const key = `${this.key}|${format}`;
    let settings: Learned = learned.get(key) ?? {
      mode: format === "messages" ? "prompt" : "json_schema",
      tokenField: "max_tokens",
      maxTokens: null,
      reasoning: true,
      templateKwargs: true,
    };
    let text: string | null = null;
    for (let attempt = 0; attempt < 6 && text === null; attempt += 1) {
      try {
        text = await this.complete(request, settings, imageUrls, format, call);
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
      json = extractJson(answerText(text));
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
