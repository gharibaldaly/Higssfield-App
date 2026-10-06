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

/**
 * Why a generation is still waiting to be sent to Higgsfield (see
 * lib/generations/waiting.ts): the account's concurrency limit, missing
 * credits, a paused model, or a server error.
 */
export const WAIT_REASONS = ["capacity", "credits", "model", "server"] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

export type WaitingNote = { reason: WaitReason; since: string; message: string | null };

/** Reads the `_waiting` note stored in a generation's params, if any. */
export function waitingNoteOf(params: GenerationRow["params"]): WaitingNote | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const note = params._waiting;
  if (!note || typeof note !== "object" || Array.isArray(note)) return null;
  const reason = WAIT_REASONS.find((candidate) => candidate === note.reason);
  if (!reason) return null;
  return {
    reason,
    since: typeof note.since === "string" ? note.since : new Date(0).toISOString(),
    message: typeof note.message === "string" ? note.message : null,
  };
}

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
  /** The tile-sized copy of an image result when one exists, else `url`. */
  thumbUrl: string | null;
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
  /** Catalogue images: false when the background is not the flat catalogue colour. */
  backgroundOk: boolean | null;
  /** Set while the request waits for Higgsfield to take it. */
  waitingReason: WaitReason | null;
};

/** The slot's label stored with a catalogue output: the detail, the colour, or a robe set's outer piece. */
export function slotLabelOf(params: GenerationRow["params"]): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const meta = params._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return typeof meta.slotLabel === "string" ? meta.slotLabel : null;
}

/** A pyjama set's image: the name of the bottoms piece composed from its flat photo. */
export function bottomsLabelOf(params: GenerationRow["params"]): string | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const meta = params._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return typeof meta.bottoms === "string" && meta.bottoms.trim() ? meta.bottoms : null;
}

/** Reads the finishing report stored with a catalogue result (see finishCatalogueImage). */
export function finishBackgroundOk(params: GenerationRow["params"]): boolean | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const finish = params._finish;
  if (!finish || typeof finish !== "object" || Array.isArray(finish)) return null;
  return typeof finish.backgroundOk === "boolean" ? finish.backgroundOk : null;
}

export function toGenerationView(
  row: GenerationRow,
  url: string | null,
  thumbUrl: string | null = url,
): GenerationView {
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    purpose: row.purpose,
    modelId: row.model_id,
    provider: row.provider,
    slot: row.slot,
    url,
    thumbUrl,
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
    backgroundOk: finishBackgroundOk(row.params),
    waitingReason:
      row.status === "queued" && !row.provider_request_id
        ? (waitingNoteOf(row.params)?.reason ?? null)
        : null,
  };
}

/**
 * Merges views from the server (after a page refresh) into the ones on
 * screen. A stale "pending" from the server never overwrites a view that
 * already settled here, and server data from before a review decision (a
 * refresh already on its way when the owner clicked) never takes the
 * decision back.
 */
export function mergeServerViews(
  current: ReadonlyMap<string, GenerationView>,
  server: readonly GenerationView[],
  decisions: ReadonlyMap<string, GenerationView["reviewStatus"]>,
): Map<string, GenerationView> {
  const next = new Map(current);
  for (const view of server) {
    const existing = next.get(view.id);
    if (existing && !isPendingStatus(existing.status) && isPendingStatus(view.status)) continue;
    const decided = decisions.get(view.id);
    next.set(view.id, decided ? { ...view, reviewStatus: decided } : view);
  }
  return next;
}

/** A finished result that is not being regenerated: what a catalogue holds now. */
export function isFinishedResult(view: Pick<GenerationView, "status" | "reviewStatus">): boolean {
  return view.status === "completed" && view.reviewStatus !== "rejected";
}
