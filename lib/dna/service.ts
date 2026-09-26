import "server-only";

import {
  dnaCompletenessIssues,
  emptyGarmentDna,
  garmentDnaSchema,
  normalizeGarmentDna,
  type GarmentDna,
} from "@/lib/domain/garment-dna";
import { AppError } from "@/lib/errors";
import { toLlmImage } from "@/lib/images/process";
import { getPhotos, getPieces, getProduct, photoCaption } from "@/lib/products/service";
import { PROMPTS, templateVersion } from "@/lib/prompts";
import { getDirectorBrain } from "@/lib/providers/llm";
import type { LlmImage } from "@/lib/providers/llm/types";
import { getOwnerSettings } from "@/lib/settings/service";
import { downloadObject } from "@/lib/storage/objects";
import type { GarmentDnaRow, Json } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

const MAX_ANALYSIS_PHOTOS = 16;

export async function latestDna(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<GarmentDnaRow | null> {
  const { data } = await supabase
    .from("garment_dna")
    .select("*")
    .eq("product_id", productId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function approvedDna(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<{ row: GarmentDnaRow; dna: GarmentDna } | null> {
  const { data } = await supabase
    .from("garment_dna")
    .select("*")
    .eq("product_id", productId)
    .eq("status", "approved")
    .maybeSingle();
  if (!data) return null;
  const parsed = garmentDnaSchema.safeParse(data.data);
  return parsed.success ? { row: data, dna: parsed.data } : null;
}

export async function requireApprovedDna(supabase: TypedSupabaseClient, productId: string) {
  const approved = await approvedDna(supabase, productId);
  if (!approved) throw new AppError("validation", "Approve the Garment DNA first.");
  return approved;
}

async function nextVersion(supabase: TypedSupabaseClient, productId: string): Promise<number> {
  const latest = await latestDna(supabase, productId);
  return (latest?.version ?? 0) + 1;
}

/** Sends the phone photos to the director brain and stores a new DNA draft. */
export async function analyzeProduct(
  supabase: TypedSupabaseClient,
  ownerId: string,
  productId: string,
): Promise<GarmentDnaRow> {
  const [product, pieces, photos, settings] = await Promise.all([
    getProduct(supabase, productId),
    getPieces(supabase, productId),
    getPhotos(supabase, productId),
    getOwnerSettings(supabase, ownerId),
  ]);
  if (photos.length === 0)
    throw new AppError("validation", "Upload photos before analysing the garment.");

  // Front and back first, then details, so the most important views survive the cap.
  const order = { front: 0, back: 1, detail: 2 } as const;
  const selected = [...photos]
    .sort((a, b) => order[a.kind] - order[b.kind])
    .slice(0, MAX_ANALYSIS_PHOTOS);
  const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
  const images: LlmImage[] = await Promise.all(
    selected.map(async (photo) =>
      toLlmImage(
        await downloadObject(supabase, photo.storage_path),
        photoCaption(photo, pieceById.get(photo.piece_id)),
      ),
    ),
  );

  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const dna = await brain.analyzeGarment({
    product: {
      name: product.name,
      productLine: product.product_line,
      notes: product.notes,
      pieces: pieces.map((piece) => ({ position: piece.position, name: piece.name })),
    },
    photos: images,
  });

  const { data, error } = await supabase
    .from("garment_dna")
    .insert({
      product_id: productId,
      version: await nextVersion(supabase, productId),
      data: dna as unknown as Json,
      status: "draft",
      source: "llm",
      llm_provider: brain.provider,
      llm_model: brain.model,
      prompt_version: templateVersion(PROMPTS.analyzeGarment),
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not save the Garment DNA.", { detail: error?.message });
  return data;
}

/** Blank DNA for manual entry (no LLM needed). */
export async function createManualDna(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<GarmentDnaRow> {
  const pieces = await getPieces(supabase, productId);
  const dna = emptyGarmentDna(
    pieces.map((piece) => ({ position: piece.position, name: piece.name })),
  );
  const { data, error } = await supabase
    .from("garment_dna")
    .insert({
      product_id: productId,
      version: await nextVersion(supabase, productId),
      data: dna as unknown as Json,
      status: "draft",
      source: "manual",
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not create the DNA.", { detail: error?.message });
  return data;
}

/**
 * Saves edits. A draft is edited in place; editing an approved version
 * creates a new draft so the approved spec stays intact until re-approval.
 */
export async function saveDna(
  supabase: TypedSupabaseClient,
  productId: string,
  dnaId: string,
  value: unknown,
): Promise<GarmentDnaRow> {
  const parsed = garmentDnaSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError("validation", "Some DNA fields are incomplete.", {
      detail: issue ? `${issue.path.join(".")}: ${issue.message}` : undefined,
    });
  }
  const pieces = await getPieces(supabase, productId);
  const dna = normalizeGarmentDna(
    parsed.data,
    pieces.map((piece) => ({ position: piece.position, name: piece.name })),
  );
  const { data: current } = await supabase
    .from("garment_dna")
    .select("*")
    .eq("id", dnaId)
    .maybeSingle();
  if (!current || current.product_id !== productId)
    throw new AppError("not_found", "DNA version not found.");

  if (current.status === "draft") {
    const { data, error } = await supabase
      .from("garment_dna")
      .update({ data: dna as unknown as Json, source: "manual" })
      .eq("id", dnaId)
      .select("*")
      .single();
    if (error || !data)
      throw new AppError("unknown", "Could not save the DNA.", { detail: error?.message });
    return data;
  }
  const { data, error } = await supabase
    .from("garment_dna")
    .insert({
      product_id: productId,
      version: await nextVersion(supabase, productId),
      data: dna as unknown as Json,
      status: "draft",
      source: "manual",
      llm_provider: current.llm_provider,
      llm_model: current.llm_model,
      prompt_version: current.prompt_version,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new AppError("unknown", "Could not save the DNA.", { detail: error?.message });
  return data;
}

export async function approveDnaVersion(
  supabase: TypedSupabaseClient,
  productId: string,
  dnaId: string,
): Promise<void> {
  const { data: target } = await supabase
    .from("garment_dna")
    .select("*")
    .eq("id", dnaId)
    .maybeSingle();
  if (!target || target.product_id !== productId)
    throw new AppError("not_found", "DNA version not found.");
  const parsed = garmentDnaSchema.safeParse(target.data);
  if (!parsed.success)
    throw new AppError("validation", "Complete every DNA field before approving.");
  const issues = dnaCompletenessIssues(parsed.data);
  if (issues.length > 0) {
    throw new AppError(
      "validation",
      "Every piece needs a category, its front construction, a colour and at least one “do not alter” rule.",
      { detail: issues.map((issue) => `${issue.piece ?? ""} → ${issue.field}`).join(", ") },
    );
  }

  const { error: supersedeError } = await supabase
    .from("garment_dna")
    .update({ status: "superseded" })
    .eq("product_id", productId)
    .eq("status", "approved");
  if (supersedeError)
    throw new AppError("unknown", "Could not approve the DNA.", { detail: supersedeError.message });

  const { error } = await supabase
    .from("garment_dna")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", dnaId);
  if (error) throw new AppError("unknown", "Could not approve the DNA.", { detail: error.message });

  await supabase.from("products").update({ approved_dna_id: dnaId }).eq("id", productId);
}
