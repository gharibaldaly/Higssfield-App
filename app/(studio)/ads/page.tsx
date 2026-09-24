import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { AdsOverview } from "@/components/ads/ads-overview";
import { requireOwner } from "@/lib/auth/owner";
import { listPresets } from "@/lib/director/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ads");
  return { title: t("title") };
}

export default async function AdsPage() {
  const { supabase } = await requireOwner();
  const t = await getTranslations("ads");
  const [projects, products, presets, shots] = await Promise.all([
    supabase.from("ad_projects").select("*").order("created_at", { ascending: false }),
    supabase
      .from("products")
      .select("id, name, approved_sheet_id")
      .is("archived_at", null)
      .order("name"),
    listPresets(supabase),
    supabase.from("shots").select("ad_project_id, status"),
  ]);
  const productNames = new Map((products.data ?? []).map((product) => [product.id, product.name]));
  const presetNames = new Map(presets.map((preset) => [preset.id, preset.name]));
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <AdsOverview
        projects={(projects.data ?? []).map((project) => ({
          id: project.id,
          name: project.name,
          productName: productNames.get(project.product_id) ?? "",
          presetName: project.preset_id ? (presetNames.get(project.preset_id) ?? null) : null,
          status: project.status,
          shotCount: (shots.data ?? []).filter((shot) => shot.ad_project_id === project.id).length,
          readyCount: (shots.data ?? []).filter(
            (shot) =>
              shot.ad_project_id === project.id &&
              (shot.status === "ready" || shot.status === "approved"),
          ).length,
          createdAt: project.created_at,
        }))}
        products={(products.data ?? []).map((product) => ({
          id: product.id,
          name: product.name,
          ready: Boolean(product.approved_sheet_id),
        }))}
        presets={presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          isBuiltin: preset.is_builtin,
        }))}
      />
    </>
  );
}
