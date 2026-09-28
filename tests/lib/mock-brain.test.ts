import { describe, expect, it } from "vitest";

import { adPlanSchema } from "@/lib/domain/ad-plan";
import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import { garmentDnaSchema } from "@/lib/domain/garment-dna";
import { sheetPhotoPlanSchema } from "@/lib/domain/sheet";
import { findForbiddenWords } from "@/lib/prompts/wording";
import { MockBrain } from "@/lib/providers/llm/mock";
import type { LlmImage, ProductBrief } from "@/lib/providers/llm/types";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

const PRODUCT: ProductBrief = {
  name: "Blush Lace Robe Set",
  productLine: "SECRET",
  notes: null,
  pieces: [
    { position: 1, name: "Robe" },
    { position: 2, name: "Slip dress" },
  ],
};

const IMAGE: LlmImage = { mimeType: "image/jpeg", base64: "", caption: 'Piece 1 "Robe" — front' };

const brain = new MockBrain();

function expectLockedPrompt(prompt: string) {
  expect(prompt).toContain("PRODUCT LOCK");
  expect(prompt).toContain("STRICT NEGATIVES");
  expect(findForbiddenWords(prompt)).toEqual([]);
}

describe("MockBrain (template guarantees without an LLM key)", () => {
  it("drafts a valid DNA that follows the product's pieces", async () => {
    const dna = await brain.analyzeGarment({ product: PRODUCT, photos: [IMAGE] });
    expect(garmentDnaSchema.safeParse(dna).success).toBe(true);
    expect(dna.pieces.map((piece) => piece.pieceName)).toEqual(["Robe", "Slip dress"]);
    expect(dna.photoGaps).toContain("No back photo uploaded yet");
  });

  it("plans a sheet on the photos: six details, the views and a pieces card", async () => {
    const photo = (caption: string): LlmImage => ({ ...IMAGE, caption });
    const plan = await brain.planProductSheet({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      photos: [
        photo('Photo 1: Piece 1 "Robe" — front'),
        photo('Photo 2: Piece 1 "Robe" — back'),
        photo('Photo 3: Piece 1 "Robe" — detail — lace hem'),
      ],
      note: null,
    });
    expect(sheetPhotoPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.front.photo).toBe(1);
    expect(plan.back?.photo).toBe(2);
    expect(plan.detailCards).toHaveLength(6);
    expect(new Set(plan.detailCards.map((card) => card.label)).size).toBe(6);
    expect(plan.detailCards.every((card) => card.photo === 3)).toBe(true);
    expect(plan.bottomCards[0]).toMatchObject({ kind: "pieces", photo: null, box: null });
  });

  it("refuses to plan a sheet without photos", async () => {
    await expect(
      brain.planProductSheet({ product: PRODUCT, dna: ROBE_SET_DNA, photos: [], note: null }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("locks macro prompts to the detail's own piece", async () => {
    const built = await brain.buildGhostPrompt({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      view: "macro",
      style: { ...DEFAULT_CATALOGUE_STYLE, background: "#F7F3EE" },
      detail: {
        label: "Lace V neckline",
        description: "Lace edging on the V",
        pieceName: "Slip dress",
      },
      colorway: null,
      references: [],
      referenceMode: "text",
      note: "Show the mannequin-free drape",
      promptBudget: 6000,
    });
    expectLockedPrompt(built.prompt);
    expect(built.prompt).toContain('Piece 2 "Slip dress"');
    expect(built.prompt).not.toContain('Piece 1 "Robe"');
    expect(built.prompt).toContain("clean seamless solid #F7F3EE background");
    expect(built.prompt).toContain("macro photograph of the Lace V neckline of the exact");
    expect(built.prompt).toContain("no background colour other than #F7F3EE");
    expect(findForbiddenWords(built.negativePrompt)).toEqual([]);
  });

  it("recolours colourway prompts", async () => {
    const built = await brain.buildGhostPrompt({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      view: "colorway",
      style: DEFAULT_CATALOGUE_STYLE,
      detail: null,
      colorway: { name: "Wine", hex: "#4d0011" },
      references: [],
      referenceMode: "edit",
      note: null,
      promptBudget: 6000,
    });
    expectLockedPrompt(built.prompt);
    expect(built.prompt).toContain("recolour the whole piece to wine red (#4D0011).");
    expect(built.prompt).toContain("no colour other than wine red (#4D0011)");
  });

  it("writes a colourway in plain colour words, never the owner's label", async () => {
    const built = await brain.buildGhostPrompt({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      view: "colorway",
      style: DEFAULT_CATALOGUE_STYLE,
      detail: null,
      colorway: { name: "Cashmir", hex: "#B499A0", swatch: true },
      references: [],
      referenceMode: "edit",
      note: null,
      promptBudget: 6000,
    });
    expect(built.prompt).not.toMatch(/cashmir/i);
    expect(built.prompt).toContain(
      "re-rendered in dusty rose (#B499A0): only the fabric colour changes.",
    );
    expect(built.prompt).toContain(
      "The second reference image is a photo of fabric in this colour",
    );
    expect(built.negativePrompt).not.toContain("colour shift");
  });

  it("plans an ad that only uses the provided crops and respects the shot cap", async () => {
    const crops = [
      { id: "hero", kind: "front" as const, label: "Front" },
      ...[1, 2, 3].map((index) => ({
        id: `detail-${index}`,
        kind: "detail" as const,
        label: `Detail ${index}`,
      })),
      { id: "set", kind: "pieces" as const, label: "The set" },
    ];
    const plan = await brain.planAd({
      brief: "",
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      controlsDescription: "- Hook: macro",
      rules: [],
      crops,
      video: {
        totalDurationS: 15,
        maxShotDurationS: 3,
        aspectRatio: "9:16",
        modelLabel: "Mock",
        durationOptions: null,
      },
      targetShotCount: 5,
      humanModel: false,
    });
    expect(adPlanSchema.safeParse(plan).success).toBe(true);
    const known = new Set(crops.map((crop) => crop.id));
    for (const shot of plan.shots) {
      expect(shot.durationS).toBeLessThanOrEqual(3);
      expect(shot.referenceCropIds.length).toBeGreaterThan(0);
      for (const id of shot.referenceCropIds) expect(known.has(id)).toBe(true);
    }
    expect(plan.shots.at(-1)?.referenceCropIds).toEqual(["set"]);
  });

  it("keeps the environment identical across shot prompts", async () => {
    const shot = {
      purpose: "hook",
      detailShown: "lace hem",
      framing: "macro",
      angle: "three-quarter",
      movement: "slow push-in",
      placement: "bed",
      durationS: 3,
      prompt: "Daylight sweeps across the lace hem.",
    };
    const input = {
      shot,
      environmentBible: "Modern bedroom, bed against the left wall.",
      controlsDescription: "",
      rules: [],
      dna: ROBE_SET_DNA,
      referenceLabels: ["Lace hem"],
      aspectRatio: "9:16",
      note: null,
      promptBudget: 4000,
    };
    const video = await brain.buildShotPrompt({ ...input, target: "video" });
    const frame = await brain.buildShotPrompt({ ...input, target: "frame" });
    for (const built of [video, frame]) {
      expectLockedPrompt(built.prompt);
      expect(built.prompt).toContain(
        "ENVIRONMENT (identical in every shot of this ad): Modern bedroom, bed against the left wall.",
      );
    }
    expect(frame.scene).toContain("Composed for 9:16");
  });
});
