import { z } from "zod";

export const PRODUCT_LINES = ["SECRET", "HOURS", "VOWS"] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

/** English descriptions used inside LLM prompts (UI labels live in messages/). */
export const PRODUCT_LINE_PROMPT: Record<ProductLine, string> = {
  SECRET: "SECRET line — lace and satin sleepwear",
  HOURS: "HOURS line — homewear and pyjamas",
  VOWS: "VOWS line — bridal sleepwear and robes",
};

export const PHOTO_KINDS = ["front", "back", "detail"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

const pieceName = z.string().trim().min(1).max(120);

export const createProductSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    productLine: z.enum(PRODUCT_LINES),
    pieceCount: z.number().int().min(1).max(3),
    pieceNames: z.array(pieceName).min(1).max(3),
    sku: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .refine((value) => value.pieceNames.length === value.pieceCount, {
    message: "Give every piece a name.",
    path: ["pieceNames"],
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  productLine: z.enum(PRODUCT_LINES),
  sku: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(4000).optional(),
  pieces: z
    .array(z.object({ id: z.uuid(), name: pieceName }))
    .min(1)
    .max(3),
});

export const registerPhotoSchema = z.object({
  productId: z.uuid(),
  pieceId: z.uuid(),
  kind: z.enum(PHOTO_KINDS),
  label: z.string().trim().max(200).optional(),
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum(ACCEPTED_PHOTO_TYPES),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sizeBytes: z.number().int().nonnegative().max(MAX_PHOTO_BYTES).optional(),
});

export type RegisterPhotoInput = z.infer<typeof registerPhotoSchema>;

/** Readiness milestones shown on product cards and used to gate modules. */
export type ProductStage = "photos" | "dna" | "dna_approved" | "sheet_approved";

export function productStage(input: {
  photoCount: number;
  hasDna: boolean;
  approvedDnaId: string | null;
  approvedSheetId: string | null;
}): ProductStage {
  if (input.approvedSheetId) return "sheet_approved";
  if (input.approvedDnaId) return "dna_approved";
  if (input.hasDna) return "dna";
  return "photos";
}
