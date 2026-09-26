import type { GenerationRow } from "@/lib/supabase/database.types";

export type GenerationStatus = GenerationRow["status"];
export type GenerationPurpose = GenerationRow["purpose"];
export type GenerationKind = GenerationRow["kind"];

export const TERMINAL_STATUSES: readonly GenerationStatus[] = [
  "completed",
  "failed",
  "nsfw",
  "canceled",
];

export function isTerminalStatus(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isPendingStatus(status: GenerationStatus): boolean {
  return status === "queued" || status === "in_progress";
}

export const PURPOSE_KIND: Record<GenerationPurpose, GenerationKind> = {
  ghost_front: "image",
  ghost_back: "image",
  macro: "image",
  colorway: "image",
  product_sheet: "image",
  shot_preview: "image",
  shot_video: "video",
  other: "image",
};

/** Purposes whose outputs belong to the catalogue and share its canvas. */
export const CATALOGUE_PURPOSES: readonly GenerationPurpose[] = [
  "ghost_front",
  "ghost_back",
  "macro",
  "colorway",
];

/** Serializable view of a generation for client components. */
export type GenerationView = {
  id: string;
  status: GenerationStatus;
  kind: GenerationKind;
  purpose: GenerationPurpose;
  modelId: string;
  provider: GenerationRow["provider"];
  slot: string | null;
  url: string | null;
  mimeType: string | null;
  error: string | null;
  note: string | null;
  reviewStatus: GenerationRow["review_status"];
  isFavorite: boolean;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  review: unknown;
  cost: number | null;
  costUnit: GenerationRow["cost_unit"];
};

export function toGenerationView(row: GenerationRow, url: string | null): GenerationView {
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    purpose: row.purpose,
    modelId: row.model_id,
    provider: row.provider,
    slot: row.slot,
    url,
    mimeType: row.mime_type,
    error: row.error,
    note: row.note,
    reviewStatus: row.review_status,
    isFavorite: row.is_favorite,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    review: row.review,
    cost: row.cost,
    costUnit: row.cost_unit,
  };
}
