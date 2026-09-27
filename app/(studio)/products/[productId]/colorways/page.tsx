import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ColorwayManager, type ColorwayView } from "@/components/colorways/colorway-manager";
import { requireOwner } from "@/lib/auth/owner";
import { listColorways } from "@/lib/colorways/service";
import { loadProductIntake } from "@/lib/products/queries";
import { signPaths } from "@/lib/storage/objects";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products.subnav");
  return { title: t("colorways") };
}

export default async function ColorwaysPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const { supabase, user } = await requireOwner();
  const t = await getTranslations("products.photos.kinds");
  const [intake, colorways] = await Promise.all([
    loadProductIntake(supabase, productId),
    listColorways(supabase, productId),
  ]);
  if (!intake) notFound();
  const signed = await signPaths(
    supabase,
    colorways.flatMap((colorway) => [colorway.swatch_path, colorway.sample_image_path]),
  );
  const views: ColorwayView[] = colorways.map((colorway) => ({
    id: colorway.id,
    name: colorway.name,
    hex: colorway.hex,
    source: colorway.source,
    swatchUrl: colorway.swatch_path ? (signed.get(colorway.swatch_path) ?? null) : null,
    sampleUrl: colorway.sample_image_path ? (signed.get(colorway.sample_image_path) ?? null) : null,
  }));
  const pieceNames = new Map(intake.pieces.map((piece) => [piece.id, piece.name]));
  return (
    <ColorwayManager
      ownerId={user.id}
      productId={productId}
      colorways={views}
      photos={intake.photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        storagePath: photo.storagePath,
        label: `${pieceNames.get(photo.pieceId) ?? ""} · ${photo.label ?? t(photo.kind)}`,
      }))}
    />
  );
}
