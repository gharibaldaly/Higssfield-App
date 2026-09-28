/**
 * Reading JSON from a model's answer when the API does not enforce the format
 * (a gateway, or a Gemma model that answers in plain text). The answer is
 * still validated with Zod afterwards.
 */

/**
 * The answer after any reasoning written before it: <think>…</think> blocks
 * (DeepSeek, Qwen, Kimi through some gateways) and Gemma 4's thought channel
 * (`<|channel>thought … <channel|>`), which the model writes even with
 * thinking off.
 */
export function answerText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/g, "")
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
