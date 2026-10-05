import { z } from "zod";

import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  PHOTO_KINDS,
  PRODUCT_LINES,
} from "@/lib/domain/product";
import {
  MAX_COLOUR_PHOTOS_PER_MODEL,
  MAX_GARMENT_PHOTOS_PER_MODEL,
  MAX_MODELS_PER_BATCH,
} from "@/lib/ghost-batches/intake";

/** How a batch runs: DNA approval and the automatic fidelity check. */
export const batchOptionsSchema = z.object({
  /** "auto": a complete DNA draft is approved by the batch; "review": the owner approves each one. */
  dnaCheck: z.enum(["auto", "review"]).default("auto"),
  /** Compare every finished image with its photos (director brain) before the owner reviews it. */
  fidelityCheck: z.boolean().default(true),
});

export type BatchOptions = z.infer<typeof batchOptionsSchema>;

export const DEFAULT_BATCH_OPTIONS: BatchOptions = { dnaCheck: "auto", fidelityCheck: true };

export function parseBatchOptions(value: unknown): BatchOptions {
  const parsed = batchOptionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_BATCH_OPTIONS;
}

export const createGhostBatchSchema = z.object({
  /** Adds the models to this batch instead of starting a new one. */
  batchId: z.uuid().nullable().optional(),
  name: z.string().trim().min(1).max(160),
  modelId: z.string().trim().min(1).max(200),
  options: batchOptionsSchema,
  models: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        productLine: z.enum(PRODUCT_LINES),
        /**
         * A robe set: the model gets a second piece for the robe, a second
         * front without it, and its colours from the front with it.
         */
        robe: z.boolean().default(false),
        /**
         * A pyjama set photographed in parts: the top on the display form,
         * the bottoms lying flat. The model gets a piece for the bottoms,
         * and every front and back composes them beneath the top.
         */
        pyjama: z.boolean().default(false),
        /** What the bottoms are, so prompts can name them. */
        bottoms: z.enum(["shorts", "trousers", "bottoms"]).default("bottoms"),
      }),
    )
    .min(1)
    .max(MAX_MODELS_PER_BATCH),
});

/** The name of the piece a robe set's outer layer becomes (it appears in prompts and captions). */
export const ROBE_PIECE_NAME = "Robe";
/** The robe piece's position: the garment is piece 1, the robe piece 2. */
export const ROBE_PIECE_POSITION = 2;
/** A pyjama set's top: piece 1, named so prompts can say "the top". */
export const TOP_PIECE_NAME = "Top";
/** A pyjama set's bottoms: piece 2; its robe, if any, is piece 3. */
export const BOTTOMS_PIECE_POSITION = 2;
export const PYJAMA_ROBE_PIECE_POSITION = 3;
export type BottomsKind = CreateGhostBatchInput["models"][number]["bottoms"];
export const BOTTOMS_KINDS = ["shorts", "trousers", "bottoms"] as const;
/** The bottoms piece's name per kind (it appears in prompts and captions). */
export const BOTTOMS_PIECE_NAMES: Record<BottomsKind, string> = {
  shorts: "Shorts",
  trousers: "Trousers",
  bottoms: "Bottoms",
};

/**
 * Which piece of a set a photo shows: the garment without the robe
 * ("inner"), the set with the robe on ("outer"), a pyjama's bottoms on their
 * own ("bottoms"); "auto": the director brain decides after upload.
 */
export const PHOTO_LAYERS = ["inner", "outer", "bottoms", "auto"] as const;
export type PhotoLayer = (typeof PHOTO_LAYERS)[number];

export type CreateGhostBatchInput = z.infer<typeof createGhostBatchSchema>;

const uploadedFile = {
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum(ACCEPTED_PHOTO_TYPES),
  sizeBytes: z.number().int().nonnegative().max(MAX_PHOTO_BYTES).optional(),
};

export const registerItemPhotosSchema = z.object({
  itemId: z.uuid(),
  photos: z
    .array(
      z.object({
        ...uploadedFile,
        kind: z.enum(PHOTO_KINDS),
        tagSource: z.enum(["name", "order", "manual"]),
        /**
         * For a set in parts: the photo shows the set with the robe ("outer"),
         * the garment alone ("inner"), or a pyjama's bottoms on their own ("bottoms").
         */
        layer: z.enum(PHOTO_LAYERS).default("inner"),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      }),
    )
    .max(MAX_GARMENT_PHOTOS_PER_MODEL),
  swatches: z
    .array(z.object({ ...uploadedFile, name: z.string().trim().min(1).max(120) }))
    .max(MAX_COLOUR_PHOTOS_PER_MODEL),
  /** Files that could not be uploaded; the model still runs with the rest. */
  failedUploads: z.number().int().min(0).max(100).default(0),
});

export type RegisterItemPhotosInput = z.infer<typeof registerItemPhotosSchema>;

/** Stored in ghost_batch_items.meta. */
export const itemMetaSchema = z.object({
  /** Photos whose view came from their order; the director brain re-sorts them. */
  autoTagged: z.array(z.string()).default([]),
  classified: z.boolean().default(false),
  attempts: z.number().int().min(0).default(0),
  dnaIssues: z.array(z.string()).default([]),
  failedUploads: z.number().int().min(0).default(0),
  /** A robe set: the position of the robe's piece (the front & back job adds a front without it). */
  outerPosition: z.number().int().min(1).max(3).nullable().default(null),
  /** A pyjama set: the position of the bottoms' piece (photographed flat, composed beneath the top). */
  bottomsPosition: z.number().int().min(1).max(3).nullable().default(null),
  /** Photos nobody said which layer they show; the director brain sorts them onto their piece. */
  autoLayer: z.array(z.string()).default([]),
});

export type ItemMeta = z.infer<typeof itemMetaSchema>;

export function parseItemMeta(value: unknown): ItemMeta {
  const parsed = itemMetaSchema.safeParse(value ?? {});
  return parsed.success
    ? parsed.data
    : {
        autoTagged: [],
        classified: false,
        attempts: 0,
        dnaIssues: [],
        failedUploads: 0,
        outerPosition: null,
        bottomsPosition: null,
        autoLayer: [],
      };
}

/** What the background runner reports after each step (shown in the studio chip). */
export type GhostWorkStep =
  "analyzing" | "generating" | "colours" | "checking" | "waiting" | "idle";

export type GhostWorkReport = {
  step: GhostWorkStep;
  batchId: string | null;
  batchName: string | null;
  modelName: string | null;
  /** Models whose front, back and close-ups are all finished. */
  done: number;
  total: number;
  /** When to call again; 0 = right away. */
  retryInMs: number;
  error: string | null;
};
