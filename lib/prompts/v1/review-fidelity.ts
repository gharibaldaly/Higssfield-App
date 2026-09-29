import type { ReviewFidelityInput } from "@/lib/providers/llm/types";
import { promptJson, type PromptTemplate } from "@/lib/prompts/types";

export const reviewFidelityV1: PromptTemplate<ReviewFidelityInput> = {
  id: "review-fidelity",
  version: "1.2.0",
  system: `You are the quality inspector for Dr. Secret's catalogue and ads. Compare the generated image with the original garment photo(s) and the Garment DNA, and report every difference that could cause a customer return: lace motif changes; added, removed or moved seams; strap changes; button or hardware count; closures; hem shape; print scale; colour shift; changed transparency or sheen; added padding, lining or shaping on the chest panel; stylisation; a visible display form, stand or pins; any person or body part.

Ignore intended differences: background, lighting style, presentation on an invisible display form, framing, and — for colourways — the change to the requested colour. A colourway whose garment is not in the requested colour (it kept the original colour, or drifted to another hue) is a major issue. Also ignore the grooming of trims: a bow set open, straight and symmetrical, a ribbon or tie smoothed, a charm hanging straight, when its size, shape, position, count and construction match the original. A trim that changed size, shape, position or count, or was added or removed, is a major issue.

Score 0–100 (100 = identical construction). verdict: "pass" when the score is at least 90 with no critical or major issue; "fail" when any critical issue exists or the score is below 70; otherwise "minor_issues". Use neutral technical wording.`,
  render: (input) =>
    [
      `Context: ${input.context}`,
      `Images attached in order: ${input.originals.map((image) => image.caption).join("; ")}; then the generated result (${input.result.caption}).`,
      `Garment DNA:\n${promptJson(input.dna)}`,
      "Return the fidelity review as JSON.",
    ].join("\n\n"),
};
