import { describe, expect, it } from "vitest";

import { sanitizeAdPlan, totalDuration, type AdPlan } from "@/lib/domain/ad-plan";
import {
  CONTROL_OPTIONS,
  describeControls,
  directorControlsSchema,
  MULTI_CONTROLS,
  optionPrompt,
  presetRulesSchema,
  SINGLE_CONTROLS,
  videoSettingsSchema,
  type DirectorControls,
} from "@/lib/domain/director";
import { BUILTIN_PRESETS, DR_SECRET_CINEMATIC } from "@/lib/director/presets";

function emptyControls(): DirectorControls {
  return {
    cameraLens: { preset: null, custom: "" },
    visualStyle: { preset: null, custom: "" },
    lighting: { preset: null, custom: "" },
    timeOfDay: { preset: null, custom: "" },
    location: { preset: null, custom: "" },
    decorProps: { presets: [], custom: "" },
    colorGrading: { preset: null, custom: "" },
    cameraAngles: { presets: [], custom: "" },
    cameraMovements: { presets: [], custom: "" },
    productPlacements: { presets: [], custom: "" },
    hookType: { preset: null, custom: "" },
    adStructure: { preset: null, custom: "" },
    shotCount: 3,
    shotDurationS: 2,
    moodMusic: { preset: null, custom: "" },
    humanModel: true,
  };
}

describe("director presets", () => {
  it("are valid against the schemas and only reference existing options", () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(directorControlsSchema.safeParse(preset.controls).success).toBe(true);
      expect(videoSettingsSchema.safeParse(preset.videoSettings).success).toBe(true);
      expect(presetRulesSchema.safeParse(preset.rules).success).toBe(true);
      for (const control of SINGLE_CONTROLS) {
        const id = preset.controls[control].preset;
        if (id) expect(optionPrompt(control, id), `${control}.${id}`).not.toBeNull();
      }
      for (const control of MULTI_CONTROLS) {
        for (const id of preset.controls[control].presets) {
          expect(optionPrompt(control, id), `${control}.${id}`).not.toBeNull();
        }
      }
    }
  });

  it("encodes the Dr. Secret Cinematic rules", () => {
    const { controls, videoSettings, rules } = DR_SECRET_CINEMATIC;
    expect(videoSettings).toMatchObject({
      totalDurationS: 15,
      maxShotDurationS: 3,
      aspectRatio: "9:16",
      cutsMatchedToMusic: true,
    });
    expect(controls.humanModel).toBe(false);
    expect(controls.shotDurationS).toBeLessThanOrEqual(videoSettings.maxShotDurationS);
    expect(controls.productPlacements.presets).toEqual(["bed", "chair", "wardrobe"]);
    expect(rules.join(" ")).toContain("piece one alone → piece two alone → all pieces together");
    expect(rules.join(" ")).toContain("a robe is never standing upright");
  });

  it("uses unique option ids per control", () => {
    for (const [control, options] of Object.entries(CONTROL_OPTIONS)) {
      const ids = options.map((option) => option.id);
      expect(new Set(ids).size, control).toBe(ids.length);
    }
  });
});

describe("describeControls", () => {
  it("writes an English brief from presets and free text", () => {
    const brief = describeControls(DR_SECRET_CINEMATIC.controls);
    const lines = brief.split("\n");
    expect(lines.every((line) => line.startsWith("- "))).toBe(true);
    expect(brief).toContain("Camera & lens: Sony A7-series full-frame cinema look");
    expect(brief).toContain(
      "Lighting: real soft daylight from a large window that reveals true fabric texture; Real daylight that reveals fabric detail",
    );
    expect(brief).toContain(
      "Where the product appears: laid on the bed; draped over the chair; hanging in the open wardrobe",
    );
    expect(brief).toContain("Human model in frame: no — garments only, no people, no body parts");
  });

  it("skips empty controls", () => {
    const brief = describeControls(emptyControls());
    expect(brief).toBe("- Number of shots: about 3, around 2s each\n- Human model in frame: yes");
  });

  it("ignores unknown preset ids", () => {
    expect(optionPrompt("lighting", "does-not-exist")).toBeNull();
    const controls = emptyControls();
    controls.lighting = { preset: "does-not-exist", custom: "" };
    expect(describeControls(controls)).not.toContain("Lighting");
  });
});

describe("sanitizeAdPlan", () => {
  const plan: AdPlan = {
    concept: "Morning light",
    hook: "Macro sweep",
    environmentBible: "Modern bedroom",
    musicCue: "Elegant",
    shots: [
      {
        purpose: "hook",
        detailShown: "lace hem",
        pieceFocus: "Robe",
        framing: "macro",
        angle: "three-quarter",
        movement: "push-in",
        placement: "bed",
        durationS: 4.26,
        referenceCropIds: ["crop-lace", "made-up"],
        prompt: "Light sweeps across the lace",
      },
      {
        purpose: "set",
        detailShown: "both pieces",
        pieceFocus: "all",
        framing: "wide",
        angle: "top-down",
        movement: "static",
        placement: "bed",
        durationS: 2.5,
        referenceCropIds: ["hallucinated"],
        prompt: "Pieces flat on the bed",
      },
    ],
  };

  it("caps shot length and replaces unknown reference crops", () => {
    const { plan: fixed, issues } = sanitizeAdPlan(plan, {
      maxShotDurationS: 3,
      knownCropIds: ["crop-lace", "crop-hero"],
      fallbackCropId: "crop-hero",
    });
    expect(fixed.shots.map((shot) => shot.durationS)).toEqual([3, 2.5]);
    expect(fixed.shots.map((shot) => shot.referenceCropIds)).toEqual([
      ["crop-lace"],
      ["crop-hero"],
    ]);
    expect(issues).toEqual([
      { shot: 1, message: "Shortened to 3s" },
      { shot: 2, message: "Unknown references replaced with the hero crop" },
    ]);
    expect(totalDuration(fixed.shots)).toBe(5.5);
  });
});
