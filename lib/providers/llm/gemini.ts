import "server-only";

import { ApiError, FinishReason, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { StructuredRequest } from "@/lib/providers/llm/types";

/** Alias documented in the @google/genai README; override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/**
 * Earlier Flash models (free tier, per the Gemini pricing page on 2026-09-27),
 * tried in turn when the chosen model stays overloaded or failing. One that no
 * longer exists is skipped.
 */
export const FALLBACK_GEMINI_MODELS = ["gemini-3.7-flash", "gemini-3.5-flash"];

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
    const base = { detail: error.message.slice(0, 300), status: error.status, cause: error };
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
    if (error.status === 429) {
      return new AppError(
        "provider_rate_limit",
        "Gemini is rate limiting requests or the daily free quota is used up. Try again later.",
        { ...base, retryable: true },
      );
    }
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

export class GeminiBrain extends TemplateBrain {
  readonly provider = "gemini" as const;
  private readonly ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_GEMINI_MODEL,
  ) {
    super();
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 240_000, retryOptions: { attempts: 3 } },
    });
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
   * Asks the chosen model; when it stays overloaded or failing (after the
   * SDK's own retries), asks the earlier Flash models in turn. If none
   * answers, the chosen model's error is reported with what the others said.
   */
  protected async generate<T>(request: StructuredRequest<T>): Promise<T> {
    let first: AppError | null = null;
    const others: string[] = [];
    for (const model of [this.model, ...FALLBACK_GEMINI_MODELS.filter((m) => m !== this.model)]) {
      try {
        const result = await this.generateWith(model, request);
        if (first) console.warn(`Gemini ${this.model} was unavailable; ${model} answered instead`);
        return result;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        if (!first) {
          if (error.code !== "provider_unavailable") throw error;
          first = error;
        } else {
          others.push(`${model}: ${error.detail ?? error.message}`.slice(0, 160));
        }
      }
    }
    throw new AppError(first!.code, first!.message, {
      detail: [first!.detail, ...others].filter(Boolean).join(" · "),
      status: first!.status,
      retryable: true,
    });
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
