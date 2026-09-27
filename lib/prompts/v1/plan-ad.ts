import { PRODUCT_LINE_PROMPT } from "@/lib/domain/product";
import type { PlanAdInput } from "@/lib/providers/llm/types";
import { promptJson, type PromptTemplate } from "@/lib/prompts/types";

export const planAdV1: PromptTemplate<PlanAdInput> = {
  id: "plan-ad",
  version: "1.0.0",
  system: `You are the commercial director of Dr. Secret's video ads. You plan short, premium product commercials that are generated shot by shot with an image-to-video model, each shot animated from isolated reference crops of the approved product sheet.

Plan the fewest shots that satisfy the brief, the preset rules and the director controls. For every shot give: purpose; the garment detail it shows (mandatory — a shot that does not show a garment detail is not allowed); the piece(s) on screen; framing; camera angle; camera movement; where the product is placed; duration in seconds; the reference crop IDs to animate (only IDs from the provided list — pick the crops that show exactly that shot's detail); and a video prompt describing scene, light, camera motion and fabric motion.

Also write: the concept; the hook (the first shot must be a very strong hook); an environment bible — one fixed description of the room, its furniture and props with their positions, light direction and colour grade — reused verbatim by every shot so the ad feels like one continuous shoot; and a music cue describing the rhythm the cuts follow.

Hard constraints:
- Respect the maximum shot duration and the total duration.
- Follow the preset rules exactly, including the structure for multi-piece sets.
- Keep garments truthful to the Garment DNA — never invent or change details.
- Neutral technical wording; no people and no body parts unless the controls explicitly ask for a human model.`,
  render: (input) =>
    [
      `Product: "${input.product.name}" — ${PRODUCT_LINE_PROMPT[input.product.productLine]}; pieces: ${input.product.pieces
        .map((piece) => `"${piece.name}"`)
        .join(", ")}.`,
      `Brief from the owner:\n${input.brief.trim() || "(no extra brief — follow the preset)"}`,
      `Preset rules:\n${input.rules.map((rule) => `- ${rule}`).join("\n")}`,
      `Director controls:\n${input.controlsDescription}`,
      `Video constraints: total ≈ ${input.video.totalDurationS}s; every shot ≤ ${input.video.maxShotDurationS}s; aspect ratio ${input.video.aspectRatio}; model ${input.video.modelLabel}${
        input.video.durationOptions
          ? `; the model only renders ${input.video.durationOptions.join("/")}s clips (clips are trimmed in the edit)`
          : ""
      }. Aim for about ${input.targetShotCount} shots.`,
      `Human model in frame: ${input.humanModel ? "allowed" : "not allowed"}.`,
      `Reference crops available (id — kind — label):\n${input.crops
        .map((crop) => `${crop.id} — ${crop.kind} — ${crop.label}`)
        .join("\n")}`,
      `Garment DNA:\n${promptJson(input.dna)}`,
      "Return the ad plan as JSON.",
    ].join("\n\n"),
};
