import "server-only";

import { requireApprovedDna } from "@/lib/dna/service";
import { AppError } from "@/lib/errors";
import {
  ownerRegistry,
  promptBudget,
  referenceBudget,
  resolveModel,
} from "@/lib/generations/models";
import { approvedCatalogueImage } from "@/lib/generations/queries";
import { submitGeneration } from "@/lib/generations/service";
import { cropRegions, toLlmImage } from "@/lib/images/process";
import { getPhotos, getPieces, getProduct, photoCaption } from "@/lib/products/service";
import { NEGATIVE_PROMPT_TERMS } from "@/lib/prompts/blocks";
import { highestResolution } from "@/lib/providers/higgsfield/registry";
import { getDirectorBrain } from "@/lib/providers/llm";
import {
  croppableCards,
  normalizedRectSchema,
  sheetLayoutSchema,
  type SheetLayout,
} from "@/lib/sheet/layout";
import { getOwnerSettings } from "@/lib/settings/service";
import { downloadObject, removeObjects, uploadObject } from "@/lib/storage/objects";
import { storagePaths } from "@/lib/storage/paths";
import type { Json, ProductSheetRow, ReferenceCropRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

type Reference = { path: string; caption: string };

/**
 * Isolated references for the sheet, most important first: front view,
 * back view, then detail photos. Approved ghost images are preferred over
 * raw phone photos for the front/back views.
 */
async function sheetReferences(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<Reference[]> {
  const [pieces, photos, frontRow, backRow] = await Promise.all([
    getPieces(supabase, productId),
    getPhotos(supabase, productId),
    approvedCatalogueImage(supabase, productId, "ghost_front"),
    approvedCatalogueImage(supabase, productId, "ghost_back"),
  ]);
  const ghostFront = frontRow?.storage_path ?? null;
  const ghostBack = backRow?.storage_path ?? null;
  const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
  const references: Reference[] = [];
  const add = (path: string, caption: string) => {
    if (!references.some((reference) => reference.path === path))
      references.push({ path, caption });
  };
  if (ghostFront) add(ghostFront, "Approved catalogue front view");
  for (const photo of photos.filter((item) => item.kind === "front")) {
    if (!ghostFront) add(photo.storage_path, photoCaption(photo, pieceById.get(photo.piece_id)));
  }
  if (ghostBack) add(ghostBack, "Approved catalogue back view");
  for (const photo of photos.filter((item) => item.kind === "back")) {
    if (!ghostBack) add(photo.storage_path, photoCaption(photo, pieceById.get(photo.piece_id)));
  }
  for (const photo of photos.filter((item) => item.kind === "detail")) {
    add(photo.storage_path, photoCaption(photo, pieceById.get(photo.piece_id)));
  }
  return references;
}

export async function listSheets(
  supabase: TypedSupabaseClient,
  productId: string,
): Promise<ProductSheetRow[]> {
  const { data, error } = await supabase
    .from("product_sheets")
    .select("*")
    .eq("product_id", productId)
    .order("version", { ascending: false });
  if (error)
    throw new AppError("unknown", "Could not load product sheets.", { detail: error.message });
  return data ?? [];
}

export async function generateSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  productId: string,
  options: { modelId?: string | null; note?: string | null } = {},
): Promise<ProductSheetRow> {
  const [product, pieces, settings, approved] = await Promise.all([
    getProduct(supabase, productId),
    getPieces(supabase, productId),
    getOwnerSettings(supabase, ownerId),
    requireApprovedDna(supabase, productId),
  ]);
  const registry = await ownerRegistry(settings);
  const { model, mode } = resolveModel(registry, {
    kind: "image",
    preferredModes: ["image-to-image", "text-to-image"],
    requestedId: options.modelId,
    defaultId: settings.defaultImageModel,
  });

  const references = await sheetReferences(supabase, productId);
  if (references.length === 0) throw new AppError("validation", "Upload product photos first.");
  const generationRefs = references.slice(0, referenceBudget(model, mode));
  const llmRefs = await Promise.all(
    references
      .slice(0, 8)
      .map(async (reference) =>
        toLlmImage(await downloadObject(supabase, reference.path), reference.caption),
      ),
  );

  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const built = await brain.buildProductSheetPrompt({
    product: {
      name: product.name,
      productLine: product.product_line,
      notes: product.notes,
      pieces: pieces.map((piece) => ({ position: piece.position, name: piece.name })),
    },
    dna: approved.dna,
    references: llmRefs,
    note: options.note ?? null,
    promptBudget: promptBudget(model),
  });

  const existing = await listSheets(supabase, productId);
  const { data: sheet, error } = await supabase
    .from("product_sheets")
    .insert({
      product_id: productId,
      dna_id: approved.row.id,
      version: (existing[0]?.version ?? 0) + 1,
      status: "generating",
      plan: {
        ...built.plan,
        promptVersion: built.promptVersion,
        llm: `${brain.provider}:${brain.model}`,
      } as unknown as Json,
      prompt: built.prompt,
      layout: built.layout as unknown as Json,
    })
    .select("*")
    .single();
  if (error || !sheet)
    throw new AppError("unknown", "Could not create the product sheet.", {
      detail: error?.message,
    });

  const generation = await submitGeneration(supabase, {
    purpose: "product_sheet",
    model,
    mode,
    prompt: built.prompt,
    negativePrompt: NEGATIVE_PROMPT_TERMS,
    referencePaths: generationRefs.map((reference) => reference.path),
    aspectRatio: "16:9",
    resolution: highestResolution(model),
    links: { productId, sheetId: sheet.id },
    note: options.note ?? null,
  });

  const { data: updated } = await supabase
    .from("product_sheets")
    .update({
      generation_id: generation.id,
      status: generation.status === "failed" ? "failed" : "generating",
    })
    .eq("id", sheet.id)
    .select("*")
    .single();
  return updated ?? sheet;
}

async function cropSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheet: ProductSheetRow,
  layout: SheetLayout,
): Promise<ReferenceCropRow[]> {
  if (!sheet.generation_id) throw new AppError("validation", "This sheet has no image yet.");
  const { data: generation } = await supabase
    .from("generations")
    .select("status, storage_path")
    .eq("id", sheet.generation_id)
    .maybeSingle();
  if (!generation?.storage_path || generation.status !== "completed") {
    throw new AppError("validation", "Wait for the sheet image to finish before cropping.");
  }
  const image = await downloadObject(supabase, generation.storage_path);
  const cards = croppableCards(layout);
  const crops = await cropRegions(
    image,
    cards.map((card) => card.imageRect),
  );

  const { data: previous } = await supabase
    .from("reference_crops")
    .select("storage_path")
    .eq("sheet_id", sheet.id);
  await supabase.from("reference_crops").delete().eq("sheet_id", sheet.id);
  await removeObjects(
    supabase,
    (previous ?? []).map((row) => row.storage_path),
  );

  const rows: ReferenceCropRow[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]!;
    const crop = crops[index]!;
    const cropId = crypto.randomUUID();
    const path = storagePaths.crop(ownerId, sheet.product_id, sheet.id, cropId);
    await uploadObject(supabase, path, crop.data, "image/png");
    const { data, error } = await supabase
      .from("reference_crops")
      .insert({
        id: cropId,
        product_id: sheet.product_id,
        sheet_id: sheet.id,
        kind: card.cropKind!,
        label: card.label ?? card.id,
        box: card.imageRect as unknown as Json,
        storage_path: path,
        width: crop.width,
        height: crop.height,
        position: index,
      })
      .select("*")
      .single();
    if (error || !data)
      throw new AppError("unknown", "Could not save a reference crop.", { detail: error?.message });
    rows.push(data);
  }
  return rows;
}

/** Approve the sheet and auto-crop isolated references for shot-level use. */
export async function approveSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheetId: string,
): Promise<ReferenceCropRow[]> {
  const { data: sheet } = await supabase
    .from("product_sheets")
    .select("*")
    .eq("id", sheetId)
    .maybeSingle();
  if (!sheet) throw new AppError("not_found", "Sheet not found.");
  const layout = sheetLayoutSchema.parse(sheet.layout);
  const crops = await cropSheet(supabase, ownerId, sheet, layout);

  await supabase
    .from("product_sheets")
    .update({ status: "review", approved_at: null })
    .eq("product_id", sheet.product_id)
    .eq("status", "approved")
    .neq("id", sheetId);
  await supabase
    .from("product_sheets")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", sheetId);
  await supabase.from("products").update({ approved_sheet_id: sheetId }).eq("id", sheet.product_id);
  await supabase
    .from("generations")
    .update({ review_status: "approved", approved_at: new Date().toISOString() })
    .eq("id", sheet.generation_id!);
  return crops;
}

/** Re-cut the references with owner-adjusted boxes (keyed by card id). */
export async function recropSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheetId: string,
  boxes: { cardId: string; rect: unknown }[],
): Promise<ReferenceCropRow[]> {
  const { data: sheet } = await supabase
    .from("product_sheets")
    .select("*")
    .eq("id", sheetId)
    .maybeSingle();
  if (!sheet) throw new AppError("not_found", "Sheet not found.");
  const layout = sheetLayoutSchema.parse(sheet.layout);
  const overrides = new Map(
    boxes.map((box) => [box.cardId, normalizedRectSchema.parse(box.rect)] as const),
  );
  const updated: SheetLayout = {
    ...layout,
    cards: layout.cards.map((card) => {
      const rect = overrides.get(card.id);
      if (!rect || !card.imageRect) return card;
      const clamped = {
        x: Math.min(rect.x, 0.99),
        y: Math.min(rect.y, 0.99),
        w: Math.min(rect.w, 1 - Math.min(rect.x, 0.99)),
        h: Math.min(rect.h, 1 - Math.min(rect.y, 0.99)),
      };
      return { ...card, imageRect: clamped };
    }),
  };
  await supabase
    .from("product_sheets")
    .update({ layout: updated as unknown as Json })
    .eq("id", sheetId);
  return cropSheet(supabase, ownerId, sheet, updated);
}

export async function listCrops(
  supabase: TypedSupabaseClient,
  sheetId: string,
): Promise<ReferenceCropRow[]> {
  const { data, error } = await supabase
    .from("reference_crops")
    .select("*")
    .eq("sheet_id", sheetId)
    .order("position");
  if (error)
    throw new AppError("unknown", "Could not load reference crops.", { detail: error.message });
  return data ?? [];
}
