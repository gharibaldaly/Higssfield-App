import { z } from "zod";

/** Plan for the product sheet, written by the director brain. */
export const sheetPlanSchema = z.object({
  title: z.string().min(1).max(80),
  overviewBullets: z.array(z.string().min(1).max(120)).min(3).max(5),
  detailCards: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        description: z.string().min(1).describe("Exactly what the macro crop must show"),
        pieceName: z.string(),
      }),
    )
    .length(6)
    .describe("Exactly six macro detail cards for the 3×2 grid"),
  bottomCards: z
    .array(
      z.object({
        kind: z.enum(["pieces", "matching", "swatch"]),
        label: z.string().min(1).max(40),
        description: z.string().min(1),
      }),
    )
    .length(2)
    .describe(
      "Two bottom-row cards. For multi-piece sets the first MUST be kind 'pieces' (all pieces side by side, each labelled)",
    ),
  prompt: z
    .string()
    .min(1)
    .describe("Image prompt describing the whole sheet layout and every card's content"),
});

export type SheetPlan = z.infer<typeof sheetPlanSchema>;

/** Sheet design tokens from the project rules. */
export const SHEET_DESIGN = {
  background: "#FAF8F5",
  card: "#FFFFFF",
  heading: "#1A1A1A",
  body: "#666666",
  accent: "#C9A66B",
} as const;

type BottomCard = SheetPlan["bottomCards"][number];

/**
 * Enforces the bottom-row rules regardless of LLM output: multi-piece sets
 * always get the "pieces" card first; single pieces never get one.
 */
export function enforceSheetRules(plan: SheetPlan, pieceNames: string[]): SheetPlan {
  if (pieceNames.length < 2) {
    return {
      ...plan,
      bottomCards: plan.bottomCards.map((card) =>
        card.kind === "pieces" ? { ...card, kind: "matching" as const } : card,
      ),
    };
  }
  const piecesCard: BottomCard = plan.bottomCards.find((card) => card.kind === "pieces") ?? {
    kind: "pieces",
    label: "The set",
    description: `All ${pieceNames.length} pieces side by side on separate invisible display forms, each labelled: ${pieceNames.join(", ")}`,
  };
  const otherCard: BottomCard = plan.bottomCards.find((card) => card.kind !== "pieces") ?? {
    kind: "swatch",
    label: "Fabrics",
    description: "Flat swatches of every fabric in the set, true colour, fine texture visible",
  };
  return { ...plan, bottomCards: [piecesCard, otherCard] };
}
