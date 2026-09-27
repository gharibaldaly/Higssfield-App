import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SheetStudio, type CropView, type SheetView } from "@/components/sheet/sheet-studio";
import { requireOwner } from "@/lib/auth/owner";
import { sheetPlanSchema } from "@/lib/domain/sheet";
import { ownerRegistry } from "@/lib/generations/models";
import { toViews } from "@/lib/generations/queries";
import { loadProductIntake } from "@/lib/products/queries";
import { toModelOptions } from "@/lib/providers/higgsfield/options";
import { getOwnerSettings } from "@/lib/settings/service";
import { listCrops, listSheets } from "@/lib/sheet/service";
import { sheetLayoutSchema } from "@/lib/sheet/layout";
import { signPaths } from "@/lib/storage/objects";

// Sheet planning sends reference photos to the LLM before submitting.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products.subnav");
  return { title: t("sheet") };
}

export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { productId } = await params;
  const { s } = await searchParams;
  const { supabase, user } = await requireOwner();
  const tk = await getTranslations("products.photos.kinds");
  const [intake, sheets, settings] = await Promise.all([
    loadProductIntake(supabase, productId),
    listSheets(supabase, productId),
    getOwnerSettings(supabase, user.id),
  ]);
  if (!intake) notFound();

  const generationIds = sheets
    .map((sheet) => sheet.generation_id)
    .filter((id): id is string => Boolean(id));
  const { data: generations } = generationIds.length
    ? await supabase.from("generations").select("*").in("id", generationIds)
    : { data: [] };
  const generationViews = new Map(
    (await toViews(supabase, generations ?? [])).map((view) => [view.id, view]),
  );

  const sheetViews: SheetView[] = sheets.map((sheet) => {
    const plan = sheetPlanSchema.safeParse(sheet.plan);
    const layout = sheetLayoutSchema.safeParse(sheet.layout);
    return {
      id: sheet.id,
      version: sheet.version,
      status: sheet.status,
      plan: plan.success ? plan.data : null,
      layout: layout.success
        ? layout.data
        : { version: 1, aspectRatio: "16:9", canvas: { width: 1600, height: 900 }, cards: [] },
      generation: sheet.generation_id ? (generationViews.get(sheet.generation_id) ?? null) : null,
      approvedAt: sheet.approved_at,
    };
  });

  const selected = sheetViews.find((sheet) => sheet.id === s) ?? sheetViews[0] ?? null;
  let crops: CropView[] = [];
  if (selected?.status === "approved") {
    const rows = await listCrops(supabase, selected.id);
    const signed = await signPaths(
      supabase,
      rows.map((row) => row.storage_path),
    );
    crops = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      url: signed.get(row.storage_path) ?? null,
    }));
  }

  const registry = await ownerRegistry(settings);
  const models = toModelOptions(registry, "image", ["image-to-image", "text-to-image"]);
  const defaultModel =
    models.find((model) => model.id === settings.defaultImageModel && !model.disabledReason) ??
    models.find((model) => model.capabilities.modes.includes("image-to-image")) ??
    models[0];
  const pieceNames = new Map(intake.pieces.map((piece) => [piece.id, piece.name]));

  return (
    <SheetStudio
      productId={productId}
      dnaApproved={Boolean(intake.product.approved_dna_id)}
      sheets={sheetViews}
      selectedId={selected?.id ?? null}
      crops={crops}
      models={models}
      defaultModelId={defaultModel?.id ?? null}
      references={intake.photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        label: `${pieceNames.get(photo.pieceId) ?? ""} · ${photo.label ?? tk(photo.kind)}`,
      }))}
    />
  );
}
