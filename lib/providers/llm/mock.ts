import type { AdPlan, PlannedShot } from "@/lib/domain/ad-plan";
import type { FidelityReview } from "@/lib/domain/fidelity";
import { DEFAULT_CHEST_PANEL, sellingDetails, type GarmentDna } from "@/lib/domain/garment-dna";
import type { SheetPlan } from "@/lib/domain/sheet";
import { TemplateBrain } from "@/lib/providers/llm/template-brain";
import type {
  AnalyzeGarmentInput,
  GhostPromptInput,
  PlanAdInput,
  ReviewFidelityInput,
  ScenePrompt,
  SheetPromptInput,
  ShotPromptInput,
  StructuredRequest,
} from "@/lib/providers/llm/types";

const MOCK_NOTE =
  "Mock director brain — add ANTHROPIC_API_KEY or GEMINI_API_KEY for a real analysis.";

/**
 * Deterministic director brain used when no LLM key is configured. It keeps
 * every screen usable end-to-end; outputs are clearly generic placeholders.
 */
export class MockBrain extends TemplateBrain {
  readonly provider = "mock" as const;
  readonly model = "mock-director";

  protected generate<T>(request: StructuredRequest<T>): Promise<T> {
    return Promise.reject(new Error(`MockBrain has no generic generator for ${request.name}`));
  }

  protected override async askGarmentDna(input: AnalyzeGarmentInput): Promise<GarmentDna> {
    const hasBack = input.photos.some((photo) => /back/i.test(photo.caption));
    return {
      schemaVersion: 1,
      productSummary: `${input.product.name} — placeholder DNA to edit before approval.`,
      setComposition:
        input.product.pieces.length > 1
          ? `${input.product.pieces.map((piece) => piece.name).join(" + ")}, worn together as a set`
          : "single piece",
      pieces: input.product.pieces.map((piece) => ({
        position: piece.position,
        pieceName: piece.name,
        category: piece.name.toLowerCase(),
        silhouette: "to be confirmed from photos",
        lengthAndFit: "to be confirmed",
        frontConstruction: [
          { zone: "neckline", detail: "describe the neckline finish" },
          { zone: "body", detail: "describe seams and panels" },
          { zone: "hem", detail: "describe the hem finish" },
        ],
        backConstruction: [
          { zone: "upper back", detail: "describe the back neckline" },
          { zone: "hem", detail: "describe the hem finish" },
        ],
        fabrics: [
          { name: "main fabric", finish: "to confirm", opacity: "opaque", location: "body" },
        ],
        motif: { type: "none", description: "", scale: "", placement: "" },
        hardware: [],
        colors: [{ name: "main colour", hexRange: ["#C9A66B"], location: "body" }],
        chestPanel: { ...DEFAULT_CHEST_PANEL },
        keyDetails: [
          {
            label: "Signature trim",
            description: "The trim that sells this piece",
            zone: "neckline",
            importance: "critical",
            sellingPoint: true,
          },
          {
            label: "Fabric texture",
            description: "Close view of the main fabric",
            zone: "body",
            importance: "high",
            sellingPoint: true,
          },
        ],
        doNotAlter: ["Keep every seam, trim and closure exactly as photographed"],
      })),
      globalDoNotAlter: ["Keep the exact colour from the photos"],
      photoGaps: [MOCK_NOTE, ...(hasBack ? [] : ["No back photo uploaded yet"])],
    };
  }

  protected override async askSheetPlan(input: SheetPromptInput): Promise<SheetPlan> {
    const details = sellingDetails(input.dna);
    const detailCards = Array.from({ length: 6 }, (_, index) => {
      const detail = details[index % Math.max(1, details.length)];
      return {
        label: detail
          ? `${detail.label}${index >= details.length ? ` ${index + 1}` : ""}`
          : `Detail ${index + 1}`,
        description: detail?.description ?? "Close-up of a construction detail",
        pieceName: detail?.pieceName ?? input.product.pieces[0]?.name ?? "",
      };
    });
    return {
      title: input.product.name,
      overviewBullets: [
        "Exact construction from the Garment DNA",
        "True-to-life colour",
        "Premium finish",
      ],
      detailCards,
      bottomCards: [
        {
          kind: input.product.pieces.length > 1 ? "pieces" : "matching",
          label: "Matching",
          description: "Matching pieces",
        },
        { kind: "swatch", label: "Fabrics", description: "Fabric swatches" },
      ],
      prompt: `Product sheet for ${input.product.name} on invisible display forms, photographic garment imagery.`,
    };
  }

  protected override async askGhostScene(input: GhostPromptInput): Promise<ScenePrompt> {
    const scenes: Record<GhostPromptInput["view"], string> = {
      front:
        "Straight-on front view of the garment on an invisible display form, centred, full length visible, natural drape.",
      back: "Straight-on back view on the same invisible display form, identical framing to the front image.",
      macro: `Advertising macro close-up of ${input.detail?.label ?? "the signature detail"}, crisp micro-texture, gentle fall-off.`,
      colorway: `Same front image re-rendered in ${input.colorway?.name ?? "the new colour"}, identical in every construction detail.`,
    };
    return {
      scene: [scenes[input.view], input.note ? `Owner note: ${input.note}` : ""]
        .filter(Boolean)
        .join(" "),
      extraNegatives: [],
      rationale: MOCK_NOTE,
    };
  }

  protected override async askAdPlan(input: PlanAdInput): Promise<AdPlan> {
    const cropFor = (kind: string, fallbackIndex = 0) =>
      input.crops.find((crop) => crop.kind === kind)?.id ?? input.crops[fallbackIndex]?.id ?? "";
    const details = input.crops.filter((crop) => crop.kind === "detail");
    const duration = Math.min(input.video.maxShotDurationS, 3);
    const placements = ["bed", "chair", "wardrobe"];
    const shots: PlannedShot[] = [];
    shots.push({
      purpose: "hook",
      detailShown: details[0]?.label ?? "signature detail",
      pieceFocus: input.product.pieces[0]?.name ?? "",
      framing: "extreme close-up",
      angle: "three-quarter",
      movement: "slow push-in",
      placement: "bed",
      durationS: duration,
      referenceCropIds: [details[0]?.id ?? cropFor("front")],
      prompt:
        "Daylight sweeps across the fabric while the camera pushes in on the signature detail.",
    });
    input.product.pieces.forEach((piece, index) => {
      shots.push({
        purpose: `${piece.name} alone`,
        detailShown: details[index + 1]?.label ?? "construction detail",
        pieceFocus: piece.name,
        framing: "medium close-up",
        angle: "eye level",
        movement: "slider pan",
        placement: placements[(index + 1) % placements.length]!,
        durationS: duration,
        referenceCropIds: [details[index + 1]?.id ?? cropFor("front")],
        prompt: `${piece.name} ${placements[(index + 1) % placements.length]}, gentle fabric motion in daylight.`,
      });
    });
    if (input.product.pieces.length > 1) {
      shots.push({
        purpose: "set together",
        detailShown: "all pieces laid flat",
        pieceFocus: "all pieces",
        framing: "top-down wide",
        angle: "top-down",
        movement: "slow push-in",
        placement: "flat on the bed",
        durationS: duration,
        referenceCropIds: [cropFor("pieces")],
        prompt: "All pieces lie flat on the bed, top-down, soft daylight.",
      });
    }
    return {
      concept: `${input.product.name} in morning daylight (mock plan).`,
      hook: "Macro light sweep over the signature detail.",
      environmentBible:
        "Modern bedroom: bed with natural linen against the left wall, upholstered chair by the window, open wardrobe on the right; soft daylight from the window on the left.",
      musicCue: "Elegant modern track, cut on every beat.",
      shots: shots.slice(0, Math.max(1, input.targetShotCount + 1)),
    };
  }

  protected override async askShotScene(input: ShotPromptInput): Promise<ScenePrompt> {
    return {
      scene:
        input.target === "video"
          ? `${input.shot.prompt} Camera: ${input.shot.movement}, ${input.shot.angle}. Hyper-real fabric motion. ${input.shot.durationS}s.`
          : `First frame: ${input.shot.prompt} Composed for ${input.aspectRatio}.`,
      extraNegatives: [],
      rationale: MOCK_NOTE,
    };
  }

  protected override async askFidelityReview(_input: ReviewFidelityInput): Promise<FidelityReview> {
    return {
      verdict: "minor_issues",
      score: 80,
      issues: [{ area: "review", severity: "minor", description: MOCK_NOTE }],
      summary: "Placeholder review — compare the images yourself before approving.",
    };
  }
}
