import { z } from "zod";

/**
 * Director Board controls. Every control is a visual picker with presets plus
 * free text; presets carry the English wording that goes into LLM prompts,
 * while their UI labels live in messages/ (director.options.<control>.<id>).
 */

export type ControlOption = { id: string; prompt: string };

export const SINGLE_CONTROLS = [
  "cameraLens",
  "visualStyle",
  "lighting",
  "timeOfDay",
  "location",
  "colorGrading",
  "hookType",
  "adStructure",
  "moodMusic",
] as const;

export const MULTI_CONTROLS = [
  "decorProps",
  "cameraAngles",
  "cameraMovements",
  "productPlacements",
] as const;

export type SingleControl = (typeof SINGLE_CONTROLS)[number];
export type MultiControl = (typeof MULTI_CONTROLS)[number];
export type PickerControl = SingleControl | MultiControl;

export const CONTROL_OPTIONS: Record<PickerControl, ControlOption[]> = {
  cameraLens: [
    {
      id: "sony-a7-cinema-50",
      prompt:
        "Sony A7-series full-frame cinema look, 50mm prime around f/2, natural shallow depth of field",
    },
    {
      id: "macro-100",
      prompt: "100mm macro lens, razor-thin focus plane that resolves individual threads",
    },
    { id: "portrait-85", prompt: "85mm lens, gentle background compression, creamy bokeh" },
    { id: "wide-35", prompt: "35mm lens, natural perspective that keeps the room readable" },
    {
      id: "anamorphic-40",
      prompt: "40mm anamorphic, subtle oval bokeh and horizontal flare, cinematic feel",
    },
    { id: "wide-24", prompt: "24mm wide lens for an establishing view of the room" },
  ],
  visualStyle: [
    {
      id: "global-tv-commercial",
      prompt:
        "a real global-brand TV commercial: photographic realism, premium restraint, never AI-looking",
    },
    { id: "editorial-luxury", prompt: "luxury fashion editorial, magazine-grade composition" },
    { id: "soft-romantic", prompt: "soft romantic mood, airy and delicate" },
    { id: "minimal-clean", prompt: "minimal and clean with generous negative space" },
    { id: "warm-lifestyle", prompt: "warm lived-in lifestyle, candid and intimate" },
    { id: "moody-cinematic", prompt: "moody cinematic contrast with rich, clean shadows" },
  ],
  lighting: [
    {
      id: "real-daylight-window",
      prompt: "real soft daylight from a large window that reveals true fabric texture",
    },
    {
      id: "sheer-curtain-daylight",
      prompt: "daylight filtered through sheer curtains with gentle falloff",
    },
    { id: "golden-hour", prompt: "warm low golden-hour sun with long soft shadows" },
    { id: "overcast-diffused", prompt: "overcast diffused daylight, no hard shadows" },
    { id: "studio-softbox", prompt: "large softbox key light with a subtle fill" },
    { id: "warm-practicals", prompt: "warm practical lamps and candlelight" },
  ],
  timeOfDay: [
    { id: "morning", prompt: "fresh morning" },
    { id: "midday", prompt: "bright midday" },
    { id: "late-afternoon", prompt: "late afternoon, warm low sun" },
    { id: "blue-hour", prompt: "blue hour just after sunset" },
    { id: "night", prompt: "night, interior practical lights" },
  ],
  location: [
    {
      id: "modern-bedroom",
      prompt: "a modern bedroom with a bed, an upholstered chair and a wardrobe",
    },
    { id: "hotel-suite", prompt: "a luxury hotel suite" },
    {
      id: "parisian-apartment",
      prompt: "a Parisian apartment with herringbone floors and mouldings",
    },
    { id: "bridal-suite", prompt: "a bright bridal suite" },
    { id: "dressing-room", prompt: "an elegant dressing room" },
    { id: "minimal-studio", prompt: "a minimal photo studio with a seamless backdrop" },
  ],
  decorProps: [
    { id: "linen-bedding", prompt: "crisp natural linen bedding" },
    { id: "fresh-flowers", prompt: "a few fresh flowers in a vase" },
    { id: "perfume-bottles", prompt: "perfume bottles on a tray" },
    { id: "silk-ribbons", prompt: "loose silk ribbons" },
    { id: "books-candles", prompt: "books and unlit candles" },
    { id: "vanity-mirror", prompt: "a vanity mirror" },
    { id: "no-props", prompt: "no props — only the garment and the room" },
  ],
  colorGrading: [
    {
      id: "natural-true-to-fabric",
      prompt: "natural grade that keeps the garment colour exactly true",
    },
    { id: "warm-cream", prompt: "warm cream grade, soft highlights" },
    { id: "cool-clean", prompt: "cool clean grade, neutral whites" },
    { id: "rich-wine", prompt: "rich grade with deep wine undertones in the shadows" },
    { id: "film-portra", prompt: "Kodak Portra film emulation, fine grain" },
  ],
  cameraAngles: [
    { id: "eye-level", prompt: "eye level" },
    { id: "top-down", prompt: "top-down overhead" },
    { id: "low-angle", prompt: "low angle" },
    { id: "high-angle", prompt: "high angle" },
    { id: "three-quarter", prompt: "three-quarter angle" },
    { id: "extreme-close", prompt: "extreme close-up on texture" },
  ],
  cameraMovements: [
    { id: "slow-push-in", prompt: "slow push-in" },
    { id: "pull-back-reveal", prompt: "pull-back reveal" },
    { id: "slider-pan", prompt: "smooth lateral slider move" },
    { id: "slow-orbit", prompt: "slow partial orbit" },
    { id: "tilt-reveal", prompt: "tilt reveal from detail to full piece" },
    { id: "rack-focus", prompt: "rack focus between two details" },
    { id: "static-locked", prompt: "locked-off static frame with only fabric motion" },
    { id: "gentle-handheld", prompt: "very gentle handheld drift" },
  ],
  productPlacements: [
    { id: "bed", prompt: "laid on the bed" },
    { id: "chair", prompt: "draped over the chair" },
    { id: "wardrobe", prompt: "hanging in the open wardrobe" },
    { id: "flat-lay", prompt: "flat lay" },
    { id: "hanger", prompt: "on a single hanger against the wall" },
    { id: "window", prompt: "near the window in daylight" },
    { id: "dresser", prompt: "folded on the dresser" },
  ],
  hookType: [
    {
      id: "fabric-macro-reveal",
      prompt: "extreme macro of the signature fabric detail that pulls back to reveal the piece",
    },
    { id: "light-sweep", prompt: "a sweep of daylight travelling across the lace or satin" },
    { id: "fabric-drop", prompt: "the fabric falling and settling in slow motion" },
    { id: "whip-reveal", prompt: "a fast whip pan that lands on the product" },
    { id: "texture-asmr", prompt: "tactile texture close-up with visible fabric movement" },
    {
      id: "silhouette-reveal",
      prompt: "backlit silhouette of the garment that resolves into detail",
    },
  ],
  adStructure: [
    {
      id: "set-three-part",
      prompt: "sets: piece one alone, then piece two alone, then all pieces together",
    },
    { id: "hook-detail-hero", prompt: "hook, detail close-ups, hero shot of the whole product" },
    { id: "detail-montage", prompt: "a rhythmic montage of details" },
    { id: "morning-story", prompt: "a short morning-routine story around the product" },
  ],
  moodMusic: [
    { id: "elegant-modern", prompt: "elegant modern track with a clear beat for cuts" },
    { id: "soft-piano", prompt: "soft piano" },
    { id: "cinematic-strings", prompt: "cinematic strings" },
    { id: "soft-rnb", prompt: "soft R&B groove" },
    { id: "modern-arabic", prompt: "modern Arabic-inspired track with oud accents" },
    { id: "upbeat-chic", prompt: "upbeat chic pop" },
  ],
};

export const singleChoiceSchema = z.object({
  preset: z.string().max(80).nullable(),
  custom: z.string().max(600),
});

export const multiChoiceSchema = z.object({
  presets: z.array(z.string().max(80)).max(12),
  custom: z.string().max(600),
});

export const directorControlsSchema = z.object({
  cameraLens: singleChoiceSchema,
  visualStyle: singleChoiceSchema,
  lighting: singleChoiceSchema,
  timeOfDay: singleChoiceSchema,
  location: singleChoiceSchema,
  decorProps: multiChoiceSchema,
  colorGrading: singleChoiceSchema,
  cameraAngles: multiChoiceSchema,
  cameraMovements: multiChoiceSchema,
  productPlacements: multiChoiceSchema,
  hookType: singleChoiceSchema,
  adStructure: singleChoiceSchema,
  shotCount: z.number().int().min(1).max(12),
  shotDurationS: z.number().min(1).max(15),
  moodMusic: singleChoiceSchema,
  humanModel: z.boolean(),
});

export type SingleChoice = z.infer<typeof singleChoiceSchema>;
export type MultiChoice = z.infer<typeof multiChoiceSchema>;
export type DirectorControls = z.infer<typeof directorControlsSchema>;

export const videoSettingsSchema = z.object({
  /** null = use the default video model from Settings. */
  modelId: z.string().max(200).nullable(),
  totalDurationS: z.number().min(2).max(120),
  maxShotDurationS: z.number().min(1).max(30),
  aspectRatio: z.string().min(3).max(10),
  resolution: z.string().max(40).nullable(),
  cutsMatchedToMusic: z.boolean(),
});

export type VideoSettings = z.infer<typeof videoSettingsSchema>;

export const shotOverridesSchema = z.object({
  modelId: z.string().max(200).nullable().optional(),
  durationS: z.number().min(1).max(30).nullable().optional(),
  aspectRatio: z.string().max(10).nullable().optional(),
  resolution: z.string().max(40).nullable().optional(),
});

export type ShotOverrides = z.infer<typeof shotOverridesSchema>;

export const presetRulesSchema = z.array(z.string().trim().min(1).max(600)).max(30);

const CONTROL_TITLES: Record<PickerControl, string> = {
  cameraLens: "Camera & lens",
  visualStyle: "Visual style",
  lighting: "Lighting",
  timeOfDay: "Time of day",
  location: "Room / location",
  decorProps: "Décor & props",
  colorGrading: "Colour grading",
  cameraAngles: "Camera angles",
  cameraMovements: "Camera movements",
  productPlacements: "Where the product appears",
  hookType: "Hook",
  adStructure: "Ad structure",
  moodMusic: "Mood & music",
};

export function optionPrompt(control: PickerControl, id: string | null): string | null {
  if (!id) return null;
  return CONTROL_OPTIONS[control].find((option) => option.id === id)?.prompt ?? null;
}

function describeSingle(control: SingleControl, choice: SingleChoice): string | null {
  const parts = [optionPrompt(control, choice.preset), choice.custom.trim() || null].filter(
    Boolean,
  );
  return parts.length > 0 ? `${CONTROL_TITLES[control]}: ${parts.join("; ")}` : null;
}

function describeMulti(control: MultiControl, choice: MultiChoice): string | null {
  const parts = [
    ...choice.presets.map((id) => optionPrompt(control, id)).filter(Boolean),
    choice.custom.trim() || null,
  ].filter(Boolean);
  return parts.length > 0 ? `${CONTROL_TITLES[control]}: ${parts.join("; ")}` : null;
}

/** English brief of the director controls for the LLM. */
export function describeControls(controls: DirectorControls): string {
  const lines = [
    ...SINGLE_CONTROLS.map((control) => describeSingle(control, controls[control])),
    ...MULTI_CONTROLS.map((control) => describeMulti(control, controls[control])),
    `Number of shots: about ${controls.shotCount}, around ${controls.shotDurationS}s each`,
    `Human model in frame: ${controls.humanModel ? "yes" : "no — garments only, no people, no body parts"}`,
  ].filter((line): line is string => Boolean(line));
  return lines.map((line) => `- ${line}`).join("\n");
}
