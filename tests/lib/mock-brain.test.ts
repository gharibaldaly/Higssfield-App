import { describe, expect, it } from "vitest";

import { adPlanSchema } from "@/lib/domain/ad-plan";
import { garmentDnaSchema } from "@/lib/domain/garment-dna";
import { sheetPlanSchema } from "@/lib/domain/sheet";
import { findForbiddenWords } from "@/lib/prompts/wording";
import { MockBrain } from "@/lib/providers/llm/mock";
import type { LlmImage, ProductBrief } from "@/lib/providers/llm/types";
import { croppableCards } from "@/lib/sheet/layout";
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

  it("builds a product sheet prompt with six detail cards and a pieces card", async () => {
    const built = await brain.buildProductSheetPrompt({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      references: [],
      note: null,
      promptBudget: 8000,
    });
    expect(sheetPlanSchema.safeParse(built.plan).success).toBe(true);
    expect(built.plan.detailCards).toHaveLength(6);
    expect(new Set(built.plan.detailCards.map((card) => card.label)).size).toBe(6);
    expect(built.plan.bottomCards[0]?.kind).toBe("pieces");
    expect(croppableCards(built.layout)).toHaveLength(10);
    expect(built.prompt).toContain("LAYOUT (keep these positions exactly)");
    expect(built.prompt.length).toBeLessThanOrEqual(8000);
    expectLockedPrompt(built.prompt);
    expect(built.promptVersion).toMatch(/@/);
  });

  it("locks macro prompts to the detail's own piece", async () => {
    const built = await brain.buildGhostPrompt({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      view: "macro",
      styleDescription: "Catalogue background #F7F3EE, soft daylight",
      detail: {
        label: "Lace V neckline",
        description: "Lace edging on the V",
        pieceName: "Slip dress",
      },
      colorway: null,
      referenceCaptions: [],
      note: "Show the mannequin-free drape",
      promptBudget: 4000,
    });
    expectLockedPrompt(built.prompt);
    expect(built.prompt).toContain('Piece 2 "Slip dress"');
    expect(built.prompt).not.toContain('Piece 1 "Robe"');
    expect(built.prompt).toContain("Catalogue background #F7F3EE");
    expect(findForbiddenWords(built.negativePrompt)).toEqual([]);
  });

  it("recolours colourway prompts", async () => {
    const built = await brain.buildGhostPrompt({
      product: PRODUCT,
      dna: ROBE_SET_DNA,
      view: "colorway",
      styleDescription: "",
      detail: null,
      colorway: { name: "Wine", hex: "#4d0011" },
      referenceCaptions: [],
      note: null,
      promptBudget: 4000,
    });
    expectLockedPrompt(built.prompt);
    expect(built.prompt).toContain("recolour the whole piece to Wine #4D0011");
    expect(built.prompt).toContain("no colour other than the requested #4D0011");
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
