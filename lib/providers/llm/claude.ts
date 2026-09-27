import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { AppError } from "@/lib/errors";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type { StructuredRequest } from "@/lib/providers/llm/types";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
function supportsServerFallback(model: string): boolean {
  return model.startsWith("claude-opus-5") || model.startsWith("claude-fable-5");
}

export function mapAnthropicError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AppError(
      "provider_auth",
      "Anthropic rejected the API key. Check ANTHROPIC_API_KEY.",
      { cause: error },
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError(
      "provider_rate_limit",
      "Claude is rate limiting requests. Try again in a minute.",
      {
        retryable: true,
        cause: error,
      },
    );
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new AppError("provider_bad_input", "Claude rejected the request.", {
      detail: error.message.slice(0, 300),
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError("provider_timeout", "Claude took too long to answer. Try again.", {
      retryable: true,
      cause: error,
    });
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AppError("provider_unavailable", "Claude is temporarily unavailable. Try again.", {
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new AppError(
      "provider_unavailable",
      `Claude returned an error (${error.status ?? "unknown"}).`,
      {
        retryable: true,
        cause: error,
      },
    );
  }
  if (error instanceof Anthropic.AnthropicError) {
    // Raised by the output parser when the JSON does not satisfy the Zod schema.
    return new AppError("llm_output", "Claude returned output in an unexpected shape.", {
      detail: error.message.slice(0, 300),
      cause: error,
    });
  }
  return error;
}

export class ClaudeBrain extends TemplateBrain {
  readonly provider = "claude" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_CLAUDE_MODEL,
  ) {
    super();
    // The SDK retries 408/409/429/5xx and connection errors itself. Requests
    // stream, so the timeout only bounds the wait for the first byte.
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  protected async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const image of request.images) {
      content.push({ type: "text", text: image.caption });
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mimeType, data: image.base64 },
      });
    }
    content.push({ type: "text", text: request.user });

    try {
      // Streaming keeps long, image-heavy requests alive; finalMessage() still
      // returns the Zod-parsed output.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content }],
        output_config: { format: betaZodOutputFormat(request.schema) },
        ...(supportsServerFallback(this.model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
      const response = await stream.finalMessage();

      if (response.stop_reason === "refusal") {
        throw new AppError(
          "provider_refusal",
          "Claude declined this request. Rephrase the notes with neutral garment wording and try again.",
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new AppError("llm_output", "Claude ran out of output space before finishing.", {
          retryable: true,
        });
      }
      if (!response.parsed_output) {
        throw new AppError("llm_output", "Claude returned no structured output.");
      }
      return response.parsed_output as T;
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}
