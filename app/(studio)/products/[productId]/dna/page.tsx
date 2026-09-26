import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DnaWorkbench, type DnaVersionView } from "@/components/dna/dna-workbench";
import { requireOwner } from "@/lib/auth/owner";
import { garmentDnaSchema } from "@/lib/domain/garment-dna";
import { loadProductIntake } from "@/lib/products/queries";
import { getDirectorBrain } from "@/lib/providers/llm";
import { getOwnerSettings } from "@/lib/settings/service";

// Garment analysis sends several photos to the LLM.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products.subnav");
  return { title: t("dna") };
}

export default async function DnaPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { productId } = await params;
  const { v } = await searchParams;
  const { supabase, user } = await requireOwner();
  const [intake, versions, settings] = await Promise.all([
    loadProductIntake(supabase, productId),
    supabase
      .from("garment_dna")
      .select("*")
      .eq("product_id", productId)
      .order("version", { ascending: false }),
    getOwnerSettings(supabase, user.id),
  ]);
  if (!intake) notFound();
  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  const views: DnaVersionView[] = (versions.data ?? []).map((row) => {
    const parsed = garmentDnaSchema.safeParse(row.data);
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      source: row.source,
      llmProvider: row.llm_provider,
      llmModel: row.llm_model,
      data: parsed.success ? parsed.data : null,
      createdAt: row.created_at,
    };
  });
  return (
    <DnaWorkbench
      productId={productId}
      pieces={intake.pieces.map((piece) => ({
        id: piece.id,
        name: piece.name,
        position: piece.position,
      }))}
      photos={intake.photos}
      versions={views}
      selectedId={v ?? null}
      brain={{ provider: brain.provider, model: brain.model, mock: brain.provider === "mock" }}
    />
  );
}
