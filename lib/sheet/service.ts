import "server-only";

import { randomUUID } from "node:crypto";

import { requireApprovedDna } from "@/lib/dna/service";
import { sheetPlanViewSchema } from "@/lib/domain/sheet";
import { AppError } from "@/lib/errors";
import { approvedCatalogueImage } from "@/lib/generations/queries";
import { cropRegions, toLlmImage } from "@/lib/images/process";
import { getPhotos, getPieces, getProduct, photoCaption } from "@/lib/products/service";
import { PROMPTS, templateVersion } from "@/lib/prompts";
import { getDirectorBrain } from "@/lib/providers/llm";
import { clampRect } from "@/lib/sheet/boxes";
import { composeSheetLayout, fitSourceBox, type SheetPhoto } from "@/lib/sheet/composed";
import {
  anySheetLayoutSchema,
  croppableCards,
  normalizedRectSchema,
  type ComposedLayout,
  type SheetLayout,
} from "@/lib/sheet/layout";
import { orderSheetReferences } from "@/lib/sheet/references";
import {
  BOARD,
  cutCardReference,
  describeSource,
  renderBoard,
  type SourceImage,
} from "@/lib/sheet/render";
import { getOwnerSettings } from "@/lib/settings/service";
import { storageImageHost } from "@/lib/storage/brain-links";
import { downloadObject, removeObjects, uploadObject } from "@/lib/storage/objects";
import { storagePaths } from "@/lib/storage/paths";
import type { Json, ProductSheetRow, ReferenceCropRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

/** Photos the brain looks at when it plans a sheet. */
const MAX_BRAIN_PHOTOS = 12;

/** Shown on a card whose photo is missing (e.g. no back photo was uploaded). */
const MISSING_IMAGE = "No photo";

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

async function getSheet(supabase: TypedSupabaseClient, sheetId: string): Promise<ProductSheetRow> {
  const { data: sheet } = await supabase
    .from("product_sheets")
    .select("*")
    .eq("id", sheetId)
    .maybeSingle();
  if (!sheet) throw new AppError("not_found", "Sheet not found.");
  return sheet;
}

/** Downloads each image once. One that is gone (a deleted photo) is left out. */
async function loadSources(
  supabase: TypedSupabaseClient,
  paths: string[],
  known: Map<string, SourceImage> = new Map(),
): Promise<Map<string, SourceImage>> {
  const sources = new Map(known);
  await Promise.all(
    [...new Set(paths)]
      .filter((path) => !sources.has(path))
      .map(async (path) => {
        try {
          sources.set(path, await describeSource(await downloadObject(supabase, path)));
        } catch (error) {
          console.warn("Sheet source unavailable", path, error);
        }
      }),
  );
  return sources;
}

const sourcePaths = (layout: ComposedLayout) =>
  layout.cards.flatMap((card) => card.sources.map((source) => source.path));

/** Renders the board and stores it under a fresh name. */
async function storeBoard(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheet: { id: string; productId: string },
  layout: ComposedLayout,
  text: { title: string; bullets: string[] },
  sources: Map<string, SourceImage>,
): Promise<string> {
  const board = await renderBoard(layout, { ...text, missingImage: MISSING_IMAGE }, sources);
  const path = storagePaths.sheetImage(ownerId, sheet.productId, sheet.id, randomUUID());
  await uploadObject(supabase, path, board.data, "image/jpeg");
  return path;
}

/**
 * Builds a product sheet from the owner's photos. The director brain chooses
 * the front and back views and six details, and where each one is on which
 * photo; the studio cuts those regions out of the full-resolution photos and
 * lays them out. Nothing is redrawn, so every detail is the real garment.
 * Approved catalogue images stand in for the front and back photos.
 */
export async function buildSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  productId: string,
  options: { note?: string | null } = {},
): Promise<ProductSheetRow> {
  const [product, pieces, photos, settings, approved, frontRow, backRow] = await Promise.all([
    getProduct(supabase, productId),
    getPieces(supabase, productId),
    getPhotos(supabase, productId),
    getOwnerSettings(supabase, ownerId),
    requireApprovedDna(supabase, productId),
    approvedCatalogueImage(supabase, productId, "ghost_front"),
    approvedCatalogueImage(supabase, productId, "ghost_back"),
  ]);
  if (photos.length === 0) throw new AppError("validation", "Upload product photos first.");

  const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
  const photoByPath = new Map(photos.map((photo) => [photo.storage_path, photo]));
  // Main views first, so the brain (and a short photo budget) see them.
  const ordered = orderSheetReferences(
    photos,
    (photo) => photoCaption(photo, pieceById.get(photo.piece_id)),
    { front: null, back: null },
  ).slice(0, MAX_BRAIN_PHOTOS);

  const sources = await loadSources(
    supabase,
    ordered.map((reference) => reference.path),
  );
  const shown = ordered.filter((reference) => sources.has(reference.path));
  if (shown.length === 0) throw new AppError("not_found", "The product photos could not be read.");
  const llmPhotos = await Promise.all(
    shown.map((reference, index) =>
      toLlmImage(sources.get(reference.path)!.data, `Photo ${index + 1}: ${reference.caption}`),
    ),
  );

  const brain = getDirectorBrain(settings, { imageHost: storageImageHost(supabase, ownerId) });
  const plan = await brain.planProductSheet({
    product: {
      name: product.name,
      productLine: product.product_line,
      notes: product.notes,
      pieces: pieces.map((piece) => ({ position: piece.position, name: piece.name })),
    },
    dna: approved.dna,
    photos: llmPhotos,
    note: options.note ?? null,
  });

  const sheetPhotos: SheetPhoto[] = shown.map((reference) => {
    const photo = photoByPath.get(reference.path)!;
    const source = sources.get(reference.path)!;
    return {
      path: reference.path,
      kind: photo.kind,
      pieceId: photo.piece_id,
      aspect: source.width / source.height,
    };
  });
  const pieceFronts =
    pieces.length > 1
      ? pieces.flatMap((piece) => {
          const own = photos.filter((photo) => photo.piece_id === piece.id);
          const front = own.find((photo) => photo.kind === "front") ?? own[0];
          return front ? [front.storage_path] : [];
        })
      : [];
  const { layout, warnings } = composeSheetLayout({
    plan,
    photos: sheetPhotos,
    approved: { front: frontRow?.storage_path ?? null, back: backRow?.storage_path ?? null },
    pieceFronts,
    canvas: BOARD,
  });
  const allSources = await loadSources(supabase, sourcePaths(layout), sources);

  const sheetId = randomUUID();
  const imagePath = await storeBoard(
    supabase,
    ownerId,
    { id: sheetId, productId },
    layout,
    { title: plan.title, bullets: plan.overviewBullets },
    allSources,
  );
  const existing = await listSheets(supabase, productId);
  const { data: sheet, error } = await supabase
    .from("product_sheets")
    .insert({
      id: sheetId,
      product_id: productId,
      dna_id: approved.row.id,
      version: (existing[0]?.version ?? 0) + 1,
      status: "review",
      plan: {
        ...plan,
        warnings,
        promptVersion: templateVersion(PROMPTS.productSheet),
        llm: `${brain.provider}:${brain.model}`,
      } as unknown as Json,
      layout: layout as unknown as Json,
      image_path: imagePath,
    })
    .select("*")
    .single();
  if (error || !sheet) {
    await removeObjects(supabase, [imagePath]);
    throw new AppError("unknown", "Could not save the product sheet.", { detail: error?.message });
  }
  return sheet;
}

/** Replaces a sheet's reference crops with new ones (rows and files). */
async function replaceCrops(
  supabase: TypedSupabaseClient,
  sheet: ProductSheetRow,
  crops: {
    kind: ReferenceCropRow["kind"];
    label: string;
    box: Json;
    upload: (cropId: string) => Promise<{ path: string; width: number; height: number }>;
  }[],
): Promise<ReferenceCropRow[]> {
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
  for (let index = 0; index < crops.length; index += 1) {
    const crop = crops[index]!;
    const cropId = randomUUID();
    const stored = await crop.upload(cropId);
    const { data, error } = await supabase
      .from("reference_crops")
      .insert({
        id: cropId,
        product_id: sheet.product_id,
        sheet_id: sheet.id,
        kind: crop.kind,
        label: crop.label,
        box: crop.box,
        storage_path: stored.path,
        width: stored.width,
        height: stored.height,
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

/**
 * References for the ads from a sheet built from photos: each card's region,
 * cut from the full-resolution photo (not from the board).
 */
async function cropComposedSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheet: ProductSheetRow,
  layout: ComposedLayout,
): Promise<ReferenceCropRow[]> {
  const sources = await loadSources(supabase, sourcePaths(layout));
  const cards = croppableCards(layout);
  // One at a time: each cut decodes a full-resolution photo (24 MP from a phone).
  const cut: Awaited<ReturnType<typeof cutCardReference>>[] = [];
  for (const card of cards) cut.push(await cutCardReference(card, sources));
  return replaceCrops(
    supabase,
    sheet,
    cards.flatMap((card, index) => {
      const image = cut[index];
      if (!image) return [];
      return [
        {
          kind: card.cropKind!,
          label: card.label ?? card.id,
          box: { sources: card.sources } as unknown as Json,
          upload: async (cropId: string) => {
            const path = storagePaths.crop(
              ownerId,
              sheet.product_id,
              sheet.id,
              cropId,
              "image/jpeg",
            );
            await uploadObject(supabase, path, image.data, "image/jpeg");
            return { path, width: image.width, height: image.height };
          },
        },
      ];
    }),
  );
}

/** References from a sheet an image model drew: the card areas of that image. */
async function cropDrawnSheet(
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
  return replaceCrops(
    supabase,
    sheet,
    cards.map((card, index) => ({
      kind: card.cropKind!,
      label: card.label ?? card.id,
      box: card.imageRect as unknown as Json,
      upload: async (cropId: string) => {
        const crop = crops[index]!;
        const path = storagePaths.crop(ownerId, sheet.product_id, sheet.id, cropId);
        await uploadObject(supabase, path, crop.data, "image/png");
        return { path, width: crop.width, height: crop.height };
      },
    })),
  );
}

/** Approve the sheet and cut the isolated references the ads use. */
export async function approveSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheetId: string,
): Promise<ReferenceCropRow[]> {
  const sheet = await getSheet(supabase, sheetId);
  const layout = anySheetLayoutSchema.parse(sheet.layout);
  const crops =
    layout.version === 2
      ? await cropComposedSheet(supabase, ownerId, sheet, layout)
      : await cropDrawnSheet(supabase, ownerId, sheet, layout);

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
  if (sheet.generation_id) {
    await supabase
      .from("generations")
      .update({ review_status: "approved", approved_at: new Date().toISOString() })
      .eq("id", sheet.generation_id);
  }
  return crops;
}

/**
 * The owner's corrections to a sheet built from photos: for each card, the
 * photo and the box on it. The board is rendered again, and an approved
 * sheet's references are cut again.
 */
export async function updateSheetSources(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheetId: string,
  changes: { cardId: string; path: string; box: unknown }[],
): Promise<ProductSheetRow> {
  const sheet = await getSheet(supabase, sheetId);
  const parsed = anySheetLayoutSchema.parse(sheet.layout);
  if (parsed.version !== 2) {
    throw new AppError(
      "validation",
      "This sheet was drawn by an image model. Build a new one from the photos.",
    );
  }
  const [photos, frontRow, backRow] = await Promise.all([
    getPhotos(supabase, sheet.product_id),
    approvedCatalogueImage(supabase, sheet.product_id, "ghost_front"),
    approvedCatalogueImage(supabase, sheet.product_id, "ghost_back"),
  ]);
  const allowed = new Set(
    [
      ...photos.map((photo) => photo.storage_path),
      frontRow?.storage_path,
      backRow?.storage_path,
    ].filter((path): path is string => Boolean(path)),
  );
  const byCard = new Map(changes.map((change) => [change.cardId, change]));
  const sources = await loadSources(supabase, [
    ...sourcePaths(parsed),
    ...changes.map((change) => change.path).filter((path) => allowed.has(path)),
  ]);

  const layout: ComposedLayout = {
    ...parsed,
    cards: parsed.cards.map((card) => {
      const change = byCard.get(card.id);
      // Text cards and a set's pieces card keep what they have.
      if (!change || !card.imageRect || card.sources.length > 1) return card;
      if (!allowed.has(change.path)) {
        throw new AppError("validation", "That photo does not belong to this product.");
      }
      const source = sources.get(change.path);
      if (!source) throw new AppError("not_found", "That photo could not be read.");
      const box = fitSourceBox(
        card,
        clampRect(normalizedRectSchema.parse(change.box)),
        source.width / source.height,
        parsed.canvas,
      );
      return { ...card, sources: [{ path: change.path, box }] };
    }),
  };

  const plan = sheetPlanViewSchema.safeParse(sheet.plan);
  const imagePath = await storeBoard(
    supabase,
    ownerId,
    { id: sheet.id, productId: sheet.product_id },
    layout,
    {
      title: plan.success ? plan.data.title : "",
      bullets: plan.success ? plan.data.overviewBullets : [],
    },
    sources,
  );
  const { data: updated, error } = await supabase
    .from("product_sheets")
    .update({ layout: layout as unknown as Json, image_path: imagePath })
    .eq("id", sheet.id)
    .select("*")
    .single();
  if (error || !updated) {
    await removeObjects(supabase, [imagePath]);
    throw new AppError("unknown", "Could not save the sheet.", { detail: error?.message });
  }
  if (sheet.image_path) await removeObjects(supabase, [sheet.image_path]);
  if (updated.status === "approved") await cropComposedSheet(supabase, ownerId, updated, layout);
  return updated;
}

/** Re-cut a drawn sheet's references with owner-adjusted boxes (keyed by card id). */
export async function recropSheet(
  supabase: TypedSupabaseClient,
  ownerId: string,
  sheetId: string,
  boxes: { cardId: string; rect: unknown }[],
): Promise<ReferenceCropRow[]> {
  const sheet = await getSheet(supabase, sheetId);
  const layout = anySheetLayoutSchema.parse(sheet.layout);
  if (layout.version !== 1) {
    throw new AppError("validation", "Adjust this sheet's crops on the photos instead.");
  }
  const overrides = new Map(
    boxes.map((box) => [box.cardId, normalizedRectSchema.parse(box.rect)] as const),
  );
  const updated: SheetLayout = {
    ...layout,
    cards: layout.cards.map((card) => {
      const rect = overrides.get(card.id);
      if (!rect || !card.imageRect) return card;
      return { ...card, imageRect: clampRect(rect) };
    }),
  };
  await supabase
    .from("product_sheets")
    .update({ layout: updated as unknown as Json })
    .eq("id", sheetId);
  return cropDrawnSheet(supabase, ownerId, sheet, updated);
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
