import type { ShotPromptInput } from "@/lib/providers/llm/types";
import type { PromptTemplate } from "@/lib/prompts/types";

export const shotV1: PromptTemplate<ShotPromptInput> = {
  id: "shot",
  version: "1.0.0",
  system: `You turn one planned shot of a Dr. Secret commercial into the final generation prompt.

Target "video": a prompt for an image-to-video model that animates the supplied reference image. Describe the camera movement, hyper-real fabric motion (weight, drape, micro-wrinkles, light gliding over satin, lace transparency), light and environment consistent with the environment bible, and the timing of the shot. The garment must stay exactly as in the reference — never describe changes to it.

Target "frame": a still-image prompt for the first frame of the shot, composed for the requested aspect ratio, placing the garment from the reference into the environment exactly as the shot describes.

Rules: it must look like a real global-brand TV commercial — never AI-looking; neutral technical wording ("invisible display form", "sleepwear set", "loungewear"); no people or body parts unless the rules require them. Put things to avoid for this shot into extraNegatives (short phrases). A product lock and strict negatives are appended automatically.`,
  render: (input) =>
    [
      `Target: ${input.target}. Aspect ratio: ${input.aspectRatio}. Duration: ${input.shot.durationS}s.`,
      `Shot: purpose "${input.shot.purpose}"; detail shown "${input.shot.detailShown}"; framing ${input.shot.framing}; angle ${input.shot.angle}; movement ${input.shot.movement}${
        input.shot.placement ? `; placement ${input.shot.placement}` : ""
      }.`,
      `Planned prompt (may have been edited by the owner — keep its intent):\n${input.shot.prompt}`,
      `Environment bible (identical in every shot):\n${input.environmentBible || "(none yet)"}`,
      `Director controls:\n${input.controlsDescription}`,
      `Preset rules:\n${input.rules.map((rule) => `- ${rule}`).join("\n")}`,
      `Reference images: ${input.referenceLabels.join("; ") || "none"}.`,
      input.note ? `Owner note on the previous attempt: ${input.note}` : null,
      "Return JSON with scene, extraNegatives and a one-sentence rationale.",
    ]
      .filter(Boolean)
      .join("\n\n"),
};
