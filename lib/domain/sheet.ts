import { z } from "zod";

/** A box on a photo as the brain gives it: [ymin, xmin, ymax, xmax], 0–1000. */
const brainBoxSchema = z
  .array(z.number().min(0).max(1000))
  .length(4)
  .describe("[ymin, xmin, ymax, xmax], integers 0–1000 relative to the photo as shown");

const photoNumberSchema = z.number().int().min(1).describe("The photo's number from its caption");

const viewSchema = z.object({
  photo: photoNumberSchema,
  box: brainBoxSchema.describe("Around the whole garment, with a small margin"),
});

/**
 * Plan for the product sheet, written by the director brain. The sheet is
 * built from the owner's photos: the brain only chooses what to show and
 * where it is on which photo; nothing is drawn.
 */
export const sheetPhotoPlanSchema = z.object({
  title: z.string().min(1).max(80),
  overviewBullets: z.array(z.string().min(1).max(120)).min(3).max(5),
  front: viewSchema.describe("The photo that shows the whole front most clearly"),
  back: viewSchema
    .nullable()
    .describe("The photo that shows the whole back most clearly, or null when none does"),
  detailCards: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        description: z.string().min(1).describe("What the crop shows"),
        photo: photoNumberSchema,
        box: brainBoxSchema.describe("Tight around the detail, with a small margin"),
      }),
    )
    .length(6)
    .describe("Six different details for the 3×2 grid"),
  bottomCards: z
    .array(
      z.object({
        kind: z.enum(["pieces", "swatch"]),
        label: z.string().min(1).max(40),
        description: z.string().min(1),
        photo: photoNumberSchema.nullable().describe("null for kind 'pieces'"),
        box: brainBoxSchema
          .nullable()
          .describe("A flat, even area of one fabric; null for kind 'pieces'"),
      }),
    )
    .length(2)
    .describe(
      "Two bottom-row cards. For sets of two or three pieces the first is kind 'pieces'; otherwise two fabric swatches",
    ),
});

export type SheetPhotoPlan = z.infer<typeof sheetPhotoPlanSchema>;

/**
 * What the sheet page shows of any plan, including the plans of sheets the
 * image model drew before sheets were built from photos.
 */
export const sheetPlanViewSchema = z.object({
  title: z.string(),
  overviewBullets: z.array(z.string()),
  detailCards: z.array(z.object({ label: z.string(), description: z.string() })),
  bottomCards: z.array(z.object({ kind: z.string(), label: z.string(), description: z.string() })),
});

export type SheetPlanView = z.infer<typeof sheetPlanViewSchema>;

/** Sheet design tokens from the project rules. */
export const SHEET_DESIGN = {
  background: "#FAF8F5",
  card: "#FFFFFF",
  heading: "#1A1A1A",
  body: "#666666",
  accent: "#C9A66B",
} as const;

type BottomCard = SheetPhotoPlan["bottomCards"][number];

/**
 * Enforces the bottom-row rules whatever the brain answered: sets of two or
 * three pieces always get the "pieces" card first; a single piece never does.
 */
export function enforceSheetRules(plan: SheetPhotoPlan, pieceNames: string[]): SheetPhotoPlan {
  const swatches = plan.bottomCards.filter((card) => card.kind === "swatch");
  if (pieceNames.length < 2) {
    const fallback: BottomCard = {
      kind: "swatch",
      label: "Fabric",
      description: "The main fabric",
      photo: null,
      box: null,
    };
    // A missing swatch is placed by the studio and flagged for the owner to check.
    return { ...plan, bottomCards: [swatches[0] ?? fallback, swatches[1] ?? fallback] };
  }
  const pieces: BottomCard = plan.bottomCards.find((card) => card.kind === "pieces") ?? {
    kind: "pieces",
    label: "The set",
    description: `All ${pieceNames.length} pieces side by side: ${pieceNames.join(", ")}`,
    photo: null,
    box: null,
  };
  return {
    ...plan,
    bottomCards: [
      { ...pieces, photo: null, box: null },
      swatches[0] ?? {
        kind: "swatch",
        label: "Fabric",
        description: "The main fabric",
        photo: null,
        box: null,
      },
    ],
  };
}
