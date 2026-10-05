import type { PolishPromptInput } from "@/lib/providers/llm/types";
import type { PromptTemplate } from "@/lib/prompts/types";

/**
 * Free generation: the owner wrote a prompt of their own and asked the
 * director brain to polish it. The brain keeps what they asked for and adds
 * only the photographic specifics an image or video model needs.
 */
export const polishPromptV1: PromptTemplate<PolishPromptInput> = {
  id: "polish-prompt",
  version: "1.0.0",
  system: `You are a senior prompt writer for professional AI image and video generation (Higgsfield models such as Grok Imagine, Kling, Seedance, Marketing Studio).

The owner of a lingerie, sleepwear and homewear brand wrote a prompt of their own. Rewrite it into one strong, generation-ready prompt in English.

Rules:
- Keep exactly what the owner asked for: the subject, the scene, the mood, every detail they named. Never replace their idea with yours, never add objects, people or text they did not ask for.
- Add only what a model needs to render it well: subject first, then composition and framing, camera and lens, light, materials and textures, colours, environment, atmosphere, and the finish (photorealistic, resolution, catalogue or commercial look). For video, add the camera movement, the motion in the scene and the pacing, and keep it to one continuous shot.
- If reference images are attached, the prompt should say what to take from them ("the exact garment in the reference", "the same room") and never describe them differently from what they show.
- Garments: describe cut, fabric, trim and colour precisely; the garment must stay exactly as described or shown. Use neutral technical wording ("invisible display form", "sleepwear set", "loungewear") rather than anatomical wording.
- Write in English (image models read it best), in flowing sentences or clear comma-separated phrases, 60 to 180 words, with no headings, no lists, no quotation marks.
- negativePrompt: a short comma-separated list of what to avoid for this exact prompt (artefacts, unwanted objects, wrong styles). Empty when nothing is needed.
- notes: one sentence, in the owner's language, saying what you added or changed.`,
  render: (input) =>
    [
      `Target: ${input.kind} model "${input.modelLabel}".`,
      `Owner's prompt:\n${input.prompt}`,
      input.references.length > 0
        ? `Reference images attached: ${input.references.length}. The model will receive them with the prompt.`
        : "No reference images.",
      `Write the notes in ${input.locale === "ar" ? "Arabic" : "English"}.`,
      "Return JSON with prompt, negativePrompt and notes.",
    ].join("\n\n"),
};
