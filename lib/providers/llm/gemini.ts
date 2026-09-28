import "server-only";

import { ApiError, FinishReason, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import {
  cairoTime,
  describeQuota,
  geminiQuota,
  googleMessage,
  nextPacificMidnight,
} from "@/lib/providers/llm/gemini-errors";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { StructuredRequest } from "@/lib/providers/llm/types";

/** Alias documented in the @google/genai README; override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/**
 * Earlier Flash models (free tier, per the Gemini pricing page on 2026-09-28),
 * tried in turn when the chosen model stays overloaded or has used up its
 * quota; free-tier limits apply per project and model. One that no longer
 * exists is skipped.
 */
export const FALLBACK_GEMINI_MODELS = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];

/** The longest per-minute limit worth waiting out before asking the same model again. */
const MAX_QUOTA_WAIT_MS = 45_000;

/** Errors of the chosen model that another Flash model may not have. */
const SWITCHABLE = new Set(["provider_unavailable", "provider_rate_limit"]);

/** JSON Schema for Gemini's responseJsonSchema (inlined, no $schema key). */
export function geminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { reused: "inline", io: "output" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

export function mapGeminiError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof ApiError) {
    // Google's own message says what happened (overloaded, quota, bad schema…).
    const base = { detail: googleMessage(error).slice(0, 300), status: error.status, cause: error };
    if (error.status === 401 || error.status === 403) {
      return new AppError(
        "provider_auth",
        "Google rejected the Gemini API key. Check GEMINI_API_KEY.",
        base,
      );
    }
    if (error.status === 404) {
      return new AppError(
        "not_found",
        "Gemini does not offer this model to this key. Check the Gemini model ID in Settings.",
        base,
      );
    }
    if (error.status === 429) return quotaError(error, base);
    if (error.status >= 500) {
      return new AppError("provider_unavailable", "Gemini is temporarily unavailable. Try again.", {
        ...base,
        retryable: true,
      });
    }
    return new AppError("provider_bad_input", "Gemini rejected the request.", base);
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new AppError("provider_timeout", "Gemini took too long to answer. Try again.", {
      retryable: true,
      cause: error,
    });
  }
  return error;
}

/** A 429 that names its limit: which window, how many requests, and when it lifts. */
function quotaError(
  error: ApiError,
  base: { detail: string; status: number; cause: unknown },
): AppError {
  const quota = geminiQuota(error);
  const detail = (quota && describeQuota(quota)) ?? base.detail;
  const message =
    quota?.window === "day"
      ? `Gemini's daily limit for this model is used up. It resets at midnight Pacific time (${cairoTime(nextPacificMidnight())}).`
      : quota?.window === "minute"
        ? `Gemini's per-minute ${quota.unit === "tokens" ? "token " : ""}limit was reached. Try again in a minute.`
        : "Gemini is rate limiting requests or the daily free quota is used up. Try again later.";
  return new AppError("provider_rate_limit", message, { ...base, detail, retryable: true });
}

export class GeminiBrain extends TemplateBrain {
  readonly provider = "gemini" as const;
  private readonly ai: GoogleGenAI;
  /** The model that wrote the last answer, when a fallback had to step in. */
  private answeredBy: string | null = null;

  constructor(
    apiKey: string,
    private readonly chosenModel: string = DEFAULT_GEMINI_MODEL,
  ) {
    super();
    this.ai = new GoogleGenAI({
      apiKey,
      // Quota errors (429) are handled below, where Google's retry delay is known.
      httpOptions: {
        timeout: 240_000,
        retryOptions: { attempts: 3, httpStatusCodes: [408, 500, 502, 503, 504] },
      },
    });
  }

  /** The model recorded next to what the brain wrote: the one that answered last. */
  get model(): string {
    return this.answeredBy ?? this.chosenModel;
  }

  /** Waits out a per-minute limit (replaced in tests). */
  protected pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async call(
    model: string,
    request: StructuredRequest<unknown>,
    withSchema: boolean,
  ): Promise<string> {
    const parts: Part[] = [];
    for (const image of request.images) {
      parts.push({ text: image.caption });
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
    }
    const schemaHint = withSchema
      ? ""
      : `\n\nRespond with JSON only, matching this JSON Schema:\n${JSON.stringify(geminiJsonSchema(request.schema))}`;
    parts.push({ text: request.user + schemaHint });

    const response = await this.ai.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        ...(withSchema ? { responseJsonSchema: geminiJsonSchema(request.schema) } : {}),
        maxOutputTokens: request.maxTokens,
      },
    });

    if (response.promptFeedback?.blockReason) {
      throw new AppError(
        "content_filter",
        "Gemini blocked this request. Use neutral garment wording and try again.",
        {
          detail: response.promptFeedback.blockReason,
        },
      );
    }
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === FinishReason.SAFETY || finishReason === FinishReason.PROHIBITED_CONTENT) {
      throw new AppError(
        "content_filter",
        "Gemini stopped for safety reasons. Use neutral garment wording and try again.",
      );
    }
    if (finishReason === FinishReason.MAX_TOKENS) {
      throw new AppError("llm_output", "Gemini ran out of output space before finishing.", {
        retryable: true,
      });
    }
    const text = response.text;
    if (!text) throw new AppError("llm_output", "Gemini returned an empty answer.");
    return text;
  }

  /**
   * Asks the chosen model. When it stays overloaded (after the SDK's own
   * retries) or has used up its quota, asks the earlier Flash models in turn,
   * since free-tier limits apply per model. If none answers, the error says
   * what each model reported.
   */
  protected async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const failures: { model: string; error: AppError }[] = [];
    const models = [
      this.chosenModel,
      ...FALLBACK_GEMINI_MODELS.filter((model) => model !== this.chosenModel),
    ];
    for (const model of models) {
      try {
        const result = await this.generateOn(model, request);
        if (failures.length > 0) {
          console.warn(
            `Gemini ${this.chosenModel} could not answer (${failures[0]!.error.code}); ${model} answered instead`,
          );
        }
        this.answeredBy = model;
        return result;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (failures.length === 0 && !SWITCHABLE.has(error.code)) throw error;
        failures.push({ model, error });
      }
    }
    throw noModelAnswered(failures);
  }

  /** One model. A short per-minute limit is waited out once before asking again. */
  private async generateOn<T>(model: string, request: StructuredRequest<T>): Promise<T> {
    try {
      return await this.generateWith(model, request);
    } catch (error) {
      const quota = error instanceof AppError ? geminiQuota(error.cause) : null;
      const wait = quota?.window === "minute" ? (quota.retryAfterMs ?? 30_000) : null;
      if (wait === null || wait > MAX_QUOTA_WAIT_MS) throw error;
      await this.pause(wait + 1000);
      return this.generateWith(model, request);
    }
  }

  private async generateWith<T>(model: string, request: StructuredRequest<T>): Promise<T> {
    let text: string;
    try {
      text = await this.call(model, request, true);
    } catch (error) {
      const mapped = mapGeminiError(error);
      // Some schema features are not accepted by every Gemini model (a 400),
      // and a large schema can make the server fail (a 500): retry once in
      // plain JSON mode with the schema in the prompt.
      const schemaTrouble =
        mapped instanceof AppError &&
        (mapped.code === "provider_bad_input" || mapped.status === 500);
      if (!schemaTrouble) throw mapped;
      try {
        text = await this.call(model, request, false);
      } catch (fallbackError) {
        throw mapGeminiError(fallbackError);
      }
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError("llm_output", "Gemini returned invalid JSON.");
    }
    const parsed = request.schema.safeParse(json);
    if (!parsed.success) {
      throw new AppError("llm_output", "Gemini returned output in an unexpected shape.", {
        detail: parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
    }
    return parsed.data;
  }
}

/**
 * The error once every Flash model failed. When each one had used up its daily
 * limit, it says so and when the limit resets; otherwise the chosen model's
 * error stands, with what the others said. A fallback model that no longer
 * exists is only listed.
 */
function noModelAnswered(failures: { model: string; error: AppError }[]): AppError {
  const first = failures[0]!.error;
  const reasons = failures.map(({ model, error }) => {
    const quota = geminiQuota(error.cause);
    const described = quota ? describeQuota(quota, model) : null;
    return described ?? `${model}: ${error.detail ?? error.message}`.slice(0, 160);
  });
  const detail = reasons.join(" · ");
  const counted = failures.filter(({ error }) => error.code !== "not_found");
  const windows = counted.map(({ error }) => geminiQuota(error.cause)?.window ?? null);
  if (windows.length > 0 && windows.every((window) => window === "day")) {
    return new AppError(
      "provider_rate_limit",
      `Gemini's daily limit is used up for every Flash model the studio tries. It resets at midnight Pacific time (${cairoTime(nextPacificMidnight())}). Turning on billing for the Google project lifts the daily limit.`,
      { detail, status: 429, retryable: true },
    );
  }
  if (counted.length > 0 && counted.every(({ error }) => error.code === "provider_rate_limit")) {
    return new AppError(
      "provider_rate_limit",
      "Gemini is rate limiting every Flash model the studio tries. Try again in a few minutes.",
      { detail, status: 429, retryable: true },
    );
  }
  return new AppError(first.code, first.message, { detail, status: first.status, retryable: true });
}
