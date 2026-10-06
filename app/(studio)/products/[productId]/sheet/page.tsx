import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  SheetStudio,
  type CropView,
  type SheetCardView,
  type SheetView,
} from "@/components/sheet/sheet-studio";
import { requireOwner } from "@/lib/auth/owner";
import { sheetPlanViewSchema } from "@/lib/domain/sheet";
import { approvedCatalogueImage, toViews } from "@/lib/generations/queries";
import { loadProductIntake } from "@/lib/products/queries";
import { anySheetLayoutSchema } from "@/lib/sheet/layout";
import { listCrops, listSheets } from "@/lib/sheet/service";
import { thumbUrls } from "@/lib/storage/derivatives";
import { signPaths } from "@/lib/storage/objects";

// Building a sheet sends the photos to the director brain, then cuts and renders them.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products.subnav");
  return { title: t("sheet") };
}

const warningsSchema = z.object({ warnings: z.array(z.string()) });

export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { productId } = await params;
  const { s } = await searchParams;
  const { supabase } = await requireOwner();
  const tk = await getTranslations("products.photos.kinds");
  const te = await getTranslations("sheet.editor");
  const [intake, sheets, frontRow, backRow] = await Promise.all([
    loadProductIntake(supabase, productId),
    listSheets(supabase, productId),
    approvedCatalogueImage(supabase, productId, "ghost_front"),
    approvedCatalogueImage(supabase, productId, "ghost_back"),
  ]);
  if (!intake) notFound();

  // Sheets an image model drew (before sheets were built from photos) show their generation.
  const generationIds = sheets
    .map((sheet) => sheet.generation_id)
    .filter((id): id is string => Boolean(id));
  const { data: generations } = generationIds.length
    ? await supabase.from("generations").select("*").in("id", generationIds)
    : { data: [] };
  const generationViews = new Map(
    (await toViews(supabase, generations ?? [])).map((view) => [view.id, view]),
  );
  const approvedImages = [
    frontRow?.storage_path ? { path: frontRow.storage_path, label: te("approvedFront") } : null,
    backRow?.storage_path ? { path: backRow.storage_path, label: te("approvedBack") } : null,
  ].filter((image): image is { path: string; label: string } => image !== null);
  const signed = await signPaths(supabase, [
    ...sheets.map((sheet) => sheet.image_path),
    ...approvedImages.map((image) => image.path),
  ]);

  const sheetViews: SheetView[] = sheets.map((sheet) => {
    const plan = sheetPlanViewSchema.safeParse(sheet.plan);
    const warnings = warningsSchema.safeParse(sheet.plan);
    const layout = anySheetLayoutSchema.safeParse(sheet.layout);
    const cards: SheetCardView[] = layout.success
      ? layout.data.version === 2
        ? layout.data.cards
        : layout.data.cards.map((card) => ({ ...card, sources: [] }))
      : [];
    return {
      id: sheet.id,
      version: sheet.version,
      status: sheet.status,
      source: layout.success && layout.data.version === 2 ? "photos" : "drawn",
      plan: plan.success ? plan.data : null,
      warnings: warnings.success ? warnings.data.warnings : [],
      cards,
      imageUrl: sheet.image_path ? (signed.get(sheet.image_path) ?? null) : null,
      generation: sheet.generation_id ? (generationViews.get(sheet.generation_id) ?? null) : null,
      approvedAt: sheet.approved_at,
    };
  });

  const selected = sheetViews.find((sheet) => sheet.id === s) ?? sheetViews[0] ?? null;
  let crops: CropView[] = [];
  if (selected?.status === "approved") {
    const rows = await listCrops(supabase, selected.id);
    const signedCrops = await thumbUrls(
      supabase,
      rows.map((row) => row.storage_path),
    );
    crops = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      url: signedCrops.get(row.storage_path) ?? null,
    }));
  }

  const pieceNames = new Map(intake.pieces.map((piece) => [piece.id, piece.name]));
  const photoLabel = (photo: (typeof intake.photos)[number]) =>
    `${pieceNames.get(photo.pieceId) ?? ""} · ${photo.label ?? tk(photo.kind)}`;

  return (
    <SheetStudio
      productId={productId}
      dnaApproved={Boolean(intake.product.approved_dna_id)}
      sheets={sheetViews}
      selectedId={selected?.id ?? null}
      crops={crops}
      references={intake.photos.map((photo) => ({
        id: photo.id,
        url: photo.thumbUrl ?? photo.url,
        label: photoLabel(photo),
      }))}
      photos={[
        ...intake.photos.map((photo) => ({
          path: photo.storagePath,
          url: photo.url,
          label: photoLabel(photo),
        })),
        ...approvedImages.map((image) => ({
          path: image.path,
          url: signed.get(image.path) ?? null,
          label: image.label,
        })),
      ]}
    />
  );
}
