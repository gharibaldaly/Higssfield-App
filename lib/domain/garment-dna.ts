import { z } from "zod";

/**
 * Garment DNA — the structured construction spec that every prompt is locked
 * to. Produced by the director brain from phone photos, then reviewed and
 * edited by the owner before anything is generated.
 *
 * LLM-facing schema rules: every field is required (use null instead of
 * optional) so structured-output JSON schemas stay strict on both providers.
 * Strings may be empty so drafts can be saved mid-edit; completeness is
 * enforced when the owner approves (see dnaCompletenessIssues).
 */

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a #RRGGBB colour");

export const constructionStepSchema = z.object({
  zone: z.string().describe("Area of the garment, e.g. neckline, chest panel, waistband, hem"),
  detail: z
    .string()
    .describe("Exact construction at this zone: seams, trims, closures, counts, measurements"),
});

export const fabricSchema = z.object({
  name: z.string().describe("Fabric name, e.g. stretch satin, Chantilly-style lace, cotton jersey"),
  finish: z.string().describe("Surface finish: matte, high sheen, brushed, crinkled…"),
  opacity: z.enum(["opaque", "semi-sheer", "sheer"]),
  location: z.string().describe("Where this fabric is used on the piece"),
});

export const motifSchema = z.object({
  type: z.enum(["lace", "print", "embroidery", "jacquard", "none", "other"]),
  description: z.string().describe("Motif shapes and arrangement, precise enough to redraw it"),
  scale: z.string().describe("Motif scale, e.g. 'florals ~3 cm wide, repeat every ~8 cm'"),
  placement: z.string().describe("Where the motif appears and how it is oriented"),
});

export const hardwareSchema = z.object({
  item: z.string().describe("Button, hook-and-eye, slider, ring, bow, snap…"),
  count: z.number().int().min(0).nullable().describe("Exact count when visible, else null"),
  finish: z.string().describe("Material / colour of the hardware"),
  location: z.string(),
});

export const colorSchema = z.object({
  name: z.string(),
  hexRange: z
    .array(hexColor)
    .min(1)
    .max(3)
    .describe("1–3 hex values spanning the colour under daylight"),
  location: z.string(),
});

export const chestPanelSchema = z.object({
  structure: z
    .enum(["unstructured", "soft-shaped", "structured"])
    .describe("Default 'unstructured' unless the photos clearly show shaping"),
  lined: z.boolean(),
  padded: z.boolean(),
  projection: z.enum(["zero", "soft", "moulded"]).describe("Default 'zero' (flat)"),
  notes: z.string(),
});

export const keyDetailSchema = z.object({
  label: z.string().describe("Short label, e.g. 'Scalloped lace hem'"),
  description: z.string(),
  zone: z.string(),
  importance: z.enum(["critical", "high", "medium"]),
  sellingPoint: z.boolean().describe("True when this detail sells the product in a close-up"),
});

export const pieceDnaSchema = z.object({
  position: z.number().int().min(1).max(3),
  pieceName: z.string(),
  category: z.string().describe("e.g. robe, slip dress, camisole, pyjama shirt, short"),
  silhouette: z.string(),
  lengthAndFit: z.string(),
  frontConstruction: z.array(constructionStepSchema).describe("Front view, ordered top to bottom"),
  backConstruction: z.array(constructionStepSchema).describe("Back view, ordered top to bottom"),
  fabrics: z.array(fabricSchema),
  motif: motifSchema,
  hardware: z.array(hardwareSchema),
  colors: z.array(colorSchema),
  chestPanel: chestPanelSchema
    .nullable()
    .describe("null when the piece has no chest area (e.g. shorts)"),
  keyDetails: z.array(keyDetailSchema),
  doNotAlter: z.array(z.string()).describe("Details that must never change"),
});

export const garmentDnaSchema = z.object({
  schemaVersion: z.literal(1),
  productSummary: z.string(),
  setComposition: z
    .string()
    .describe("How the pieces relate / layer; 'single piece' for one piece"),
  pieces: z.array(pieceDnaSchema).min(1).max(3),
  globalDoNotAlter: z.array(z.string()),
  photoGaps: z
    .array(z.string())
    .describe("Anything the photos did not show clearly and the owner should confirm"),
});

export type ConstructionStep = z.infer<typeof constructionStepSchema>;
export type PieceDna = z.infer<typeof pieceDnaSchema>;
export type GarmentDna = z.infer<typeof garmentDnaSchema>;
export type KeyDetail = z.infer<typeof keyDetailSchema>;
export type ChestPanel = z.infer<typeof chestPanelSchema>;

export const DEFAULT_CHEST_PANEL: ChestPanel = {
  structure: "unstructured",
  lined: false,
  padded: false,
  projection: "zero",
  notes: "",
};

/** Blank DNA used for manual entry when no director brain is configured. */
export function emptyGarmentDna(pieces: { position: number; name: string }[]): GarmentDna {
  return {
    schemaVersion: 1,
    productSummary: "",
    setComposition: pieces.length > 1 ? "" : "single piece",
    pieces: pieces.map((piece) => ({
      position: piece.position,
      pieceName: piece.name,
      category: "",
      silhouette: "",
      lengthAndFit: "",
      frontConstruction: [{ zone: "", detail: "" }],
      backConstruction: [{ zone: "", detail: "" }],
      fabrics: [{ name: "", finish: "", opacity: "opaque", location: "" }],
      motif: { type: "none", description: "", scale: "", placement: "" },
      hardware: [],
      colors: [{ name: "", hexRange: ["#000000"], location: "" }],
      chestPanel: { ...DEFAULT_CHEST_PANEL },
      keyDetails: [
        { label: "", description: "", zone: "", importance: "high", sellingPoint: true },
      ],
      doNotAlter: [""],
    })),
    globalDoNotAlter: [],
    photoGaps: [],
  };
}

/**
 * Makes LLM output consistent with the product: piece positions follow the
 * product's pieces, names come from the owner, lists are de-duplicated.
 */
export function normalizeGarmentDna(
  dna: GarmentDna,
  pieces: { position: number; name: string }[],
): GarmentDna {
  const byPosition = new Map(dna.pieces.map((piece) => [piece.position, piece]));
  const normalizedPieces = pieces.map((piece, index) => {
    const source = byPosition.get(piece.position) ?? dna.pieces[index] ?? dna.pieces[0]!;
    return {
      ...source,
      position: piece.position,
      pieceName: piece.name,
      doNotAlter: unique(source.doNotAlter),
    };
  });
  return {
    ...dna,
    pieces: normalizedPieces,
    globalDoNotAlter: unique(dna.globalDoNotAlter),
    photoGaps: unique(dna.photoGaps),
  };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (value.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export type DnaIssue = { piece: string | null; field: string };

/** What still blocks approval: every piece needs identity, construction and rules. */
export function dnaCompletenessIssues(dna: GarmentDna): DnaIssue[] {
  const issues: DnaIssue[] = [];
  for (const piece of dna.pieces) {
    const name = piece.pieceName;
    if (!piece.category.trim()) issues.push({ piece: name, field: "category" });
    if (!piece.frontConstruction.some((step) => step.detail.trim()))
      issues.push({ piece: name, field: "frontConstruction" });
    if (!piece.colors.some((colour) => colour.name.trim()))
      issues.push({ piece: name, field: "colors" });
    if (!piece.doNotAlter.some((rule) => rule.trim()))
      issues.push({ piece: name, field: "doNotAlter" });
  }
  return issues;
}

/** All selling details ordered by importance — candidates for macro shots. */
export function sellingDetails(dna: GarmentDna): (KeyDetail & { pieceName: string })[] {
  const rank = { critical: 0, high: 1, medium: 2 } as const;
  return dna.pieces
    .flatMap((piece) =>
      piece.keyDetails.map((detail) => ({ ...detail, pieceName: piece.pieceName })),
    )
    .filter((detail) => detail.label.trim())
    .sort((a, b) => {
      if (a.sellingPoint !== b.sellingPoint) return a.sellingPoint ? -1 : 1;
      return rank[a.importance] - rank[b.importance];
    });
}
