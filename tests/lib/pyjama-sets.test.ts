import { describe, expect, it } from "vitest";

import { guessBottomsPiece, setLayersOf } from "@/lib/catalogue/layers";
import type { PhotoRef } from "@/lib/catalogue/references";
import { planSlots, type JobContext } from "@/lib/catalogue/service";
import { DEFAULT_CATALOGUE_STYLE } from "@/lib/domain/catalogue-style";
import { bottomsLabelOf } from "@/lib/domain/generation";
import { fidelityContext } from "@/lib/generations/fidelity";
import { bottomsOfName, layerOfName, planIntake } from "@/lib/ghost-batches/intake";
import { bottomsPositionOf } from "@/lib/ghost-batches/plan";
import { batchModelPieces } from "@/lib/ghost-batches/service";
import { composeGhostParagraph, ghostNegatives } from "@/lib/prompts/house-style";
import { ghostV3, layersBrief } from "@/lib/prompts/v3/ghost";
import { classifyPhotosV1 } from "@/lib/prompts/v1/classify-photos";
import { findForbiddenWords } from "@/lib/prompts/wording";
import { MOCK_MODELS } from "@/lib/providers/higgsfield/models";
import { parseModelSpecs } from "@/lib/providers/higgsfield/registry";
import { MockBrain } from "@/lib/providers/llm/mock";
import type { GhostLayers, GhostPiece } from "@/lib/providers/llm/types";
import type { CatalogueJobRow } from "@/lib/supabase/database.types";
import { ROBE_SET_DNA } from "@/tests/fixtures/dna";

const TOP: GhostPiece = { position: 1, name: "Top" };
const SHORTS: GhostPiece = { position: 2, name: "Shorts" };
const ROBE: GhostPiece = { position: 3, name: "Robe" };

/** A pyjama photographed in parts: the top on the form, the shorts flat. */
const PYJAMA: GhostLayers = {
  outerPiece: null,
  innerPieces: [TOP, SHORTS],
  bottomsPiece: SHORTS,
  show: "set",
  fromSetPhotos: false,
};

/** The same pyjama sold with a robe. */
const ROBE_PYJAMA: GhostLayers = { ...PYJAMA, outerPiece: ROBE };

const SCENE = {
  garment: "women's satin pyjama set of a camp-collar shirt and shorts",
  colour: "dusty rose",
  construction: ["camp collar with piped edge", "five pearl buttons", "elastic waistband"],
  cleanUp: ["the hanger"],
  extraNegatives: [],
  rationale: "",
};

const base = {
  scene: SCENE,
  dna: ROBE_SET_DNA,
  style: DEFAULT_CATALOGUE_STYLE,
  productLine: "HOURS" as const,
  referenceMode: "edit" as const,
  detail: null,
  colourway: null,
};

describe("pyjama sets: which pieces", () => {
  it("guesses the bottoms piece from its name, in English and Arabic", () => {
    expect(guessBottomsPiece([TOP, SHORTS])).toBe(2);
    expect(
      guessBottomsPiece([
        { position: 1, name: "بنطلون" },
        { position: 2, name: "قميص" },
      ]),
    ).toBe(1);
    expect(guessBottomsPiece([TOP, { position: 2, name: "Pyjama trousers" }])).toBe(2);
    // A nightgown has no bottoms, and a single piece has none.
    expect(guessBottomsPiece([TOP, { position: 2, name: "Robe" }])).toBeNull();
    expect(guessBottomsPiece([SHORTS])).toBeNull();
  });

  it("composes the bottoms beneath a top, with or without a robe", () => {
    expect(setLayersOf([TOP, SHORTS], { bottomsPosition: 2 })).toEqual({
      outerPiece: null,
      innerPieces: [TOP, SHORTS],
      bottomsPiece: SHORTS,
    });
    expect(setLayersOf([TOP, SHORTS, ROBE], { outerPosition: 3, bottomsPosition: 2 })).toEqual({
      outerPiece: ROBE,
      innerPieces: [TOP, SHORTS],
      bottomsPiece: SHORTS,
    });
    // Bottoms need a top to be worn with; a robe over shorts alone keeps only the robe.
    expect(setLayersOf([SHORTS], { bottomsPosition: 1 })).toBeNull();
    const robe = { position: 1, name: "Robe" };
    expect(setLayersOf([robe, SHORTS], { outerPosition: 1, bottomsPosition: 2 })).toEqual({
      outerPiece: robe,
      innerPieces: [SHORTS],
      bottomsPiece: null,
    });
    expect(setLayersOf([TOP, SHORTS], {})).toBeNull();
    expect(setLayersOf([TOP, SHORTS], { bottomsPosition: 3 })).toBeNull();
  });

  it("reads the bottoms piece from a job's options only when it is a whole number", () => {
    expect(bottomsPositionOf({ bottomsPosition: 2 })).toBe(2);
    expect(bottomsPositionOf({ bottomsPosition: "2" })).toBeNull();
    expect(bottomsPositionOf({ outerPosition: 2 })).toBeNull();
    expect(bottomsPositionOf(null)).toBeNull();
  });

  it("makes a batch model's pieces: the top, its bottoms, then the robe", () => {
    expect(
      batchModelPieces({ name: "B20124", robe: false, pyjama: false, bottoms: "bottoms" }),
    ).toEqual([{ position: 1, name: "B20124" }]);
    expect(
      batchModelPieces({ name: "B20124", robe: true, pyjama: false, bottoms: "bottoms" }),
    ).toEqual([
      { position: 1, name: "B20124" },
      { position: 2, name: "Robe" },
    ]);
    expect(
      batchModelPieces({ name: "B20124", robe: false, pyjama: true, bottoms: "shorts" }),
    ).toEqual([
      { position: 1, name: "Top" },
      { position: 2, name: "Shorts" },
    ]);
    expect(
      batchModelPieces({ name: "B20124", robe: true, pyjama: true, bottoms: "trousers" }),
    ).toEqual([
      { position: 1, name: "Top" },
      { position: 2, name: "Trousers" },
      { position: 3, name: "Robe" },
    ]);
  });
});

describe("pyjama sets: the house prompt", () => {
  it("composes the shorts beneath the top from their flat photo, in the front and the back", () => {
    const front = composeGhostParagraph({ ...base, view: "front", layers: PYJAMA });
    expect(front).toContain(
      "of the exact dusty rose women's satin pyjama set of a camp-collar shirt and shorts, the top worn with the shorts as one complete set, the shorts composed beneath the top exactly as their own reference photo shows them, which shows them lying flat on their own: the same fit (wide or narrow), leg width, length, colour, waistband, hem and every detail, rendered as they hang when worn on the form with the top falling naturally over them, displayed on an invisible display form",
    );
    expect(front).not.toContain("worn over");
    const back = composeGhostParagraph({ ...base, view: "back", layers: PYJAMA });
    expect(back).toContain(
      "with the top falling naturally over them, their back reconstructed from that flat photo with the same length, leg width, colour, waistband and hem and nothing invented shown from the rear",
    );
    expect(ghostNegatives(base.style, "front", PYJAMA)).toContain(
      "the shorts are never left out, never shown lying flat, folded or on their own, and never changed in length, leg width or fit from their reference photo: the set is always complete, the top worn with the shorts",
    );
    expect(findForbiddenWords(front)).toEqual([]);
  });

  it("keeps the robe worn over the top, and the shorts beneath it", () => {
    const front = composeGhostParagraph({ ...base, view: "front", layers: ROBE_PYJAMA });
    expect(front).toContain(
      ", the robe worn over the top exactly as in the reference, the top worn with the shorts as one complete set, the shorts composed beneath the top",
    );
    const negatives = ghostNegatives(base.style, "front", ROBE_PYJAMA);
    expect(negatives).toContain(
      "the robe stays worn over the top and the shorts: never removed, never shown on its own, the top and the shorts never shown without it",
    );
    expect(negatives.some((item) => item.startsWith("the shorts are never left out"))).toBe(true);
  });

  it("shows the top and the shorts without the robe in the inner front", () => {
    const inner: GhostLayers = { ...ROBE_PYJAMA, show: "inner" };
    const text = composeGhostParagraph({ ...base, view: "front", layers: inner });
    expect(text).toContain(
      "shown on its own without the robe, the top worn with the shorts as one complete set",
    );
    expect(text).toContain(
      "framed, scaled and lit like the front image of the full set with the robe",
    );
    expect(ghostNegatives(base.style, "front", inner)).toContain(
      "no robe and no other outer layer over the top and the shorts: the top and the shorts are shown on their own, nothing of the robe anywhere in the image",
    );
  });

  it("says 'as specified' when the image model gets no photos", () => {
    const text = composeGhostParagraph({
      ...base,
      view: "front",
      referenceMode: "text",
      layers: PYJAMA,
    });
    expect(text).toContain("the shorts composed beneath the top exactly as specified:");
    expect(text).not.toContain("lying flat");
    expect(text).not.toContain("Leave out");
  });

  it("briefs the brain on the flat photo, the complete set and the back it must not invent", () => {
    const front = layersBrief(PYJAMA, "front");
    expect(front).toContain(
      'Pyjama set photographed in parts: the top on the display form, and piece 2 "Shorts" lying flat on its own in its one reference photo. This image shows the COMPLETE SET worn together on the invisible display form',
    );
    expect(front).toContain("Never invent anything the flat photo does not show.");
    expect(front).not.toContain("Robe set");
    const back = layersBrief(ROBE_PYJAMA, "back");
    expect(back).toContain(
      'Robe set: piece 3 "Robe" is an outer layer worn over the top and the shorts',
    );
    expect(back).toContain(
      "The shorts have no back photo: describe their back from the flat photo only",
    );
    const inner = layersBrief({ ...ROBE_PYJAMA, show: "inner" }, "front");
    expect(inner).toContain("This image shows the top and the shorts ALONE, WITHOUT the robe.");
    expect(inner).toContain("Pyjama set photographed in parts");
    const rendered = ghostV3.render({
      product: { name: "B20124", productLine: "HOURS", notes: null, pieces: [TOP, SHORTS] },
      dna: ROBE_SET_DNA,
      view: "front",
      style: DEFAULT_CATALOGUE_STYLE,
      detail: null,
      colorway: null,
      layers: PYJAMA,
      references: [],
      referenceMode: "text",
      note: null,
      promptBudget: 6000,
    });
    expect(rendered).toContain("This image shows the COMPLETE SET worn together");
    expect(ghostV3.system).toContain("Pyjama sets photographed in parts");
    expect(findForbiddenWords(rendered)).toEqual([]);
  });

  it("tells the photo sorter which piece is the bottoms", () => {
    const text = classifyPhotosV1.render({
      product: { name: "B20124", productLine: "HOURS", notes: null, pieces: [TOP, SHORTS] },
      photos: [{ mimeType: "image/jpeg", base64: "", caption: "Photo 1" }],
      bottoms: "Shorts",
    });
    expect(text).toContain('piece "Shorts" is photographed on its own, lying flat');
    expect(text).toContain("Outer layer: none");
    expect(classifyPhotosV1.version).toBe("1.2.0");
  });

  it("has the mock brain put the last photo on the bottoms", async () => {
    const result = await new MockBrain().classifyPhotos({
      product: { name: "B20124", productLine: "HOURS", notes: null, pieces: [TOP, SHORTS] },
      photos: [1, 2, 3].map((n) => ({
        mimeType: "image/jpeg" as const,
        base64: "",
        caption: `Photo ${n}`,
      })),
      bottoms: "Shorts",
    });
    expect(result.photos.map((photo) => photo.showsBottoms)).toEqual([false, false, true]);
  });
});

describe("pyjama sets: the references of each image", () => {
  function photo(id: string, piecePosition: number, kind: PhotoRef["kind"]): PhotoRef {
    return {
      id,
      pieceId: `piece-${piecePosition}`,
      piecePosition,
      kind,
      label: null,
      storagePath: id,
    };
  }
  const PHOTOS = [
    photo("top-front", 1, "front"),
    photo("top-back", 1, "back"),
    photo("top-collar", 1, "detail"),
    photo("shorts-flat", 2, "front"),
    photo("robe-front", 3, "front"),
    photo("robe-back", 3, "back"),
  ];
  const model = parseModelSpecs(MOCK_MODELS).specs.find((spec) => spec.id === "mock-image")!;

  function context(
    options: { outerPosition?: number; bottomsPosition?: number },
    photos: PhotoRef[],
  ): JobContext {
    const pieces = options.outerPosition ? [TOP, SHORTS, ROBE] : [TOP, SHORTS];
    const layers = setLayersOf(pieces, options);
    return {
      job: { id: "job", product_id: "product", job_type: "front_back", options } as CatalogueJobRow,
      product: { name: "B20124", productLine: "HOURS", notes: null, pieces },
      dna: ROBE_SET_DNA,
      photos,
      photoCaptions: new Map(photos.map((entry) => [entry.storagePath, `${entry.id} photo`])),
      colorways: [],
      approvedFront: null,
      layers,
      model,
      mode: "image-to-image",
      brain: new MockBrain(),
    };
  }
  const refs = (plans: ReturnType<typeof planSlots>, slot: string) =>
    plans.find((plan) => plan.slot === slot)!.references.map((reference) => reference.path);

  it("sends the top's photo and the shorts' flat photo for the front, and again for the back", () => {
    const plans = planSlots(context({ bottomsPosition: 2 }, PHOTOS.slice(0, 4)));
    expect(plans.map((plan) => plan.slot)).toEqual(["front", "back"]);
    expect(refs(plans, "front")).toEqual(["top-front", "shorts-flat"]);
    expect(refs(plans, "back")).toEqual(["top-back", "shorts-flat"]);
    expect(plans.every((plan) => plan.missingReason === null)).toBe(true);
    expect(plans[0]!.layers).toEqual({ ...PYJAMA, show: "set", fromSetPhotos: false });
  });

  it("puts the robe's photo first and the shorts last, and keeps the shorts in the inner front", () => {
    const plans = planSlots(context({ outerPosition: 3, bottomsPosition: 2 }, PHOTOS));
    expect(plans.map((plan) => plan.slot)).toEqual(["front", "front_inner", "back"]);
    expect(refs(plans, "front")).toEqual(["robe-front", "top-front", "shorts-flat"]);
    expect(refs(plans, "front_inner")).toEqual(["top-front", "shorts-flat"]);
    expect(refs(plans, "back")).toEqual(["robe-back", "top-back", "shorts-flat"]);
    expect(plans[1]!.layers).toEqual({ ...ROBE_PYJAMA, show: "inner", fromSetPhotos: false });
  });

  it("asks for the missing part instead of rendering half a pyjama", () => {
    const noShorts = planSlots(context({ bottomsPosition: 2 }, PHOTOS.slice(0, 3)));
    expect(noShorts[0]!.references).toEqual([]);
    expect(noShorts[0]!.missingReason).toBe(
      "Upload a photo of the Shorts lying flat, then regenerate.",
    );
    const noTop = planSlots(context({ bottomsPosition: 2 }, [PHOTOS[3]!]));
    expect(noTop[0]!.missingReason).toBe("Upload a front photo of the top, then regenerate.");
    expect(noTop[1]!.missingReason).toBe("Upload a back photo of the top, then regenerate.");
  });
});

describe("pyjama sets: the fidelity check", () => {
  it("judges the shorts against their flat photo and never the flat pose", () => {
    const params = { _meta: { bottoms: "Shorts" } };
    expect(bottomsLabelOf(params)).toBe("Shorts");
    expect(bottomsLabelOf({ _meta: { slotLabel: "Robe" } })).toBeNull();
    const context = fidelityContext({ purpose: "ghost_front", slot: "front", params });
    expect(context).toContain("Ghost-mannequin FRONT view");
    expect(context).toContain('the shorts (the "Shorts") lying flat on their own');
    expect(context).toContain("ignore the flat pose itself");
    expect(context).toContain("changed in length, width or fit is a major issue");
    // The inner front of a robe pyjama: both notes.
    const inner = fidelityContext({
      purpose: "ghost_front",
      slot: "front_inner",
      params: { _meta: { slotLabel: "Robe", bottoms: "Shorts" } },
    });
    expect(inner).toContain("without its outer layer");
    expect(inner).toContain("pyjama set photographed in parts");
    // A close-up is judged as before.
    expect(fidelityContext({ purpose: "macro", slot: "macro_1", params })).not.toContain("pyjama");
  });
});

describe("pyjama sets: the intake", () => {
  function files(paths: string[]) {
    return paths.map((path, index) => ({ id: `f${index}`, name: path.split("/").pop()!, path }));
  }

  it("reads the bottoms from a name, in English and Arabic", () => {
    expect(layerOfName("B20124 shorts.jpg")).toBe("bottoms");
    expect(layerOfName("بنطلون.jpg")).toBe("bottoms");
    expect(layerOfName("DS1 pants 2.jpg")).toBe("bottoms");
    expect(bottomsOfName("B20124 shorts.jpg")).toBe("shorts");
    expect(bottomsOfName("شورت.jpg")).toBe("shorts");
    expect(bottomsOfName("بنطلون.jpg")).toBe("trousers");
    expect(bottomsOfName("trousers front.jpg")).toBe("trousers");
    expect(bottomsOfName("IMG_2231.jpg")).toBeNull();
    expect(layerOfName("B20124 robe front.jpg")).toBe("outer");
  });

  it("offers a drop as a pyjama in parts when a name mentions the shorts", () => {
    const plan = planIntake(
      files(["B20124 front.jpg", "B20124 back.jpg", "B20124 shorts.jpg", "B20124 lace detail.jpg"]),
    );
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.pyjama).toBe(true);
    expect(plan.models[0]!.robe).toBe(false);
    expect(plan.models[0]!.bottoms).toBe("shorts");
    expect(plan.models[0]!.photos.map((photo) => `${photo.tag}:${photo.layer ?? "-"}`)).toEqual([
      "back:-",
      "front:-",
      "detail:-",
      "detail:bottoms",
    ]);
    const plain = planIntake(files(["IMG_1.jpg", "IMG_2.jpg"]));
    expect(plain.models[0]!.pyjama).toBe(false);
    expect(plain.models[0]!.bottoms).toBeNull();
  });

  it("reads a bottoms folder inside a model folder, next to the robe folders", () => {
    const plan = planIntake(
      files([
        "Batch/DS-1024/بالروب/IMG_1.jpg",
        "Batch/DS-1024/بدون روب/IMG_2.jpg",
        "Batch/DS-1024/بنطلون/IMG_3.jpg",
      ]),
    );
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.robe).toBe(true);
    expect(plan.models[0]!.pyjama).toBe(true);
    expect(plan.models[0]!.bottoms).toBe("trousers");
    expect(plan.models[0]!.photos.map((photo) => photo.layer)).toEqual([
      "outer",
      "inner",
      "bottoms",
    ]);
  });
});
