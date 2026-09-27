import "server-only";

import { ApiError, FinishReason, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { StructuredRequest } from "@/lib/providers/llm/types";

/** Alias documented in the @google/genai README; override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

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
    if (error.status === 401 || error.status === 403) {
      return new AppError(
        "provider_auth",
        "Google rejected the Gemini API key. Check GEMINI_API_KEY.",
        { cause: error },
      );
    }
    if (error.status === 429) {
      return new AppError(
        "provider_rate_limit",
        "Gemini is rate limiting requests. Try again in a minute.",
        {
          retryable: true,
          cause: error,
        },
      );
    }
    if (error.status >= 500) {
      return new AppError("provider_unavailable", "Gemini is temporarily unavailable. Try again.", {
        retryable: true,
        cause: error,
      });
    }
    return new AppError("provider_bad_input", "Gemini rejected the request.", {
      detail: error.message.slice(0, 300),
      cause: error,
    });
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

  private async call(request: StructuredRequest<unknown>, withSchema: boolean): Promise<string> {
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
      model: this.model,
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

  protected async generate<T>(request: StructuredRequest<T>): Promise<T> {
    let text: string;
    try {
      text = await this.call(request, true);
    } catch (error) {
      const mapped = mapGeminiError(error);
      // Some schema features are not accepted by every Gemini model; retry
      // once in plain JSON mode with the schema in the prompt.
      if (mapped instanceof AppError && mapped.code === "provider_bad_input") {
        try {
          text = await this.call(request, false);
        } catch (fallbackError) {
          throw mapGeminiError(fallbackError);
        }
      } else {
        throw mapped;
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
