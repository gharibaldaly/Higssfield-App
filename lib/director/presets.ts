import type { DirectorControls, VideoSettings } from "@/lib/domain/director";

export type PresetDefinition = {
  slug: string;
  name: string;
  description: string;
  controls: DirectorControls;
  videoSettings: VideoSettings;
  rules: string[];
};

/**
 * "Dr. Secret Cinematic" — the default, editable director preset. Seeded for
 * the owner on first sign-in (see lib/settings/service.ts ensureOwnerDefaults).
 */
export const DR_SECRET_CINEMATIC: PresetDefinition = {
  slug: "dr-secret-cinematic",
  name: "Dr. Secret Cinematic",
  description:
    "15 s vertical commercial, ≤3 s shots cut to music, real daylight, Sony A7 cinema look, no human model, every shot shows a garment detail.",
  controls: {
    cameraLens: { preset: "sony-a7-cinema-50", custom: "" },
    visualStyle: { preset: "global-tv-commercial", custom: "" },
    lighting: {
      preset: "real-daylight-window",
      custom: "Real daylight that reveals fabric detail",
    },
    timeOfDay: { preset: "morning", custom: "" },
    location: { preset: "modern-bedroom", custom: "" },
    decorProps: { presets: ["linen-bedding", "fresh-flowers"], custom: "" },
    colorGrading: { preset: "natural-true-to-fabric", custom: "" },
    cameraAngles: { presets: ["extreme-close", "top-down", "three-quarter"], custom: "" },
    cameraMovements: { presets: ["slow-push-in", "slider-pan", "rack-focus"], custom: "" },
    productPlacements: { presets: ["bed", "chair", "wardrobe"], custom: "" },
    hookType: {
      preset: "fabric-macro-reveal",
      custom: "Very strong hook in the first shot — this ad runs on paid campaigns",
    },
    adStructure: { preset: "set-three-part", custom: "" },
    shotCount: 5,
    shotDurationS: 3,
    moodMusic: { preset: "elegant-modern", custom: "Cuts land on the beat" },
    humanModel: false,
  },
  videoSettings: {
    modelId: null,
    totalDurationS: 15,
    maxShotDurationS: 3,
    aspectRatio: "9:16",
    resolution: null,
    cutsMatchedToMusic: true,
  },
  rules: [
    "Total length 15 seconds in vertical 9:16. Every shot is 3 seconds or shorter and cuts are matched to the music.",
    "Real daylight that reveals fabric detail, Sony A7 cinema look, hyper-real fabric motion.",
    "It must look like a real global-brand TV commercial — never AI-looking: no plastic sheen, no warped lace, no melting seams, no impossible physics.",
    "No human model and no body parts in frame by default.",
    "Every shot must show an important garment detail; a shot that does not show a detail is not allowed. Use the fewest possible shots.",
    "The first shot is a very strong hook for paid campaigns.",
    "Two- and three-piece sets follow three parts: piece one alone → piece two alone → all pieces together. In the all-together shot the garments lie flat on the bed; a robe is never standing upright.",
    "Environment consistency: the same room look and the same object positions in every shot of the ad (a modern bedroom with bed, chair and wardrobe). The product appears once on the bed, once on the chair and once in the wardrobe.",
  ],
};

export const BUILTIN_PRESETS: PresetDefinition[] = [DR_SECRET_CINEMATIC];
