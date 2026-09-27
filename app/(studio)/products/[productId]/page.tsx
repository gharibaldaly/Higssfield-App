import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { IntakeView } from "@/components/products/intake-view";
import { requireOwner } from "@/lib/auth/owner";
import { loadProductIntake } from "@/lib/products/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products.subnav");
  return { title: t("intake") };
}

export default async function ProductIntakePage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const { supabase, user } = await requireOwner();
  const intake = await loadProductIntake(supabase, productId);
  if (!intake) notFound();
  return (
    <IntakeView
      ownerId={user.id}
      product={{
        id: intake.product.id,
        name: intake.product.name,
        productLine: intake.product.product_line,
        sku: intake.product.sku,
        notes: intake.product.notes,
      }}
      pieces={intake.pieces.map((piece) => ({
        id: piece.id,
        name: piece.name,
        position: piece.position,
      }))}
      photos={intake.photos}
      latestDna={intake.latestDna}
      colorwayCount={intake.colorwayCount}
      sheetStatus={intake.sheetStatus}
      approvedDna={Boolean(intake.product.approved_dna_id)}
      approvedSheet={Boolean(intake.product.approved_sheet_id)}
    />
  );
}
