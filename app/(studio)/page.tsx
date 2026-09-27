import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { StudioHome } from "@/components/home/studio-home";
import { requireOwner } from "@/lib/auth/owner";
import { keyStatus } from "@/lib/env";
import { toViews } from "@/lib/generations/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: t("title") };
}

export default async function StudioHomePage() {
  const { supabase } = await requireOwner();
  const count = (table: "products" | "garment_dna" | "product_sheets" | "ad_projects") =>
    supabase.from(table).select("*", { count: "exact", head: true });
  const [products, approvedDna, approvedSheets, ads, pending, approvedImages, recent] =
    await Promise.all([
      count("products"),
      supabase
        .from("garment_dna")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved"),
      supabase
        .from("product_sheets")
        .select("*", { count: "exact", head: true })
        .eq("status", "approved"),
      count("ad_projects"),
      supabase
        .from("generations")
        .select("*", { count: "exact", head: true })
        .in("status", ["queued", "in_progress"]),
      supabase
        .from("generations")
        .select("*", { count: "exact", head: true })
        .eq("review_status", "approved"),
      supabase.from("generations").select("*").order("created_at", { ascending: false }).limit(8),
    ]);
  const status = keyStatus();
  return (
    <StudioHome
      stats={{
        products: products.count ?? 0,
        approvedDna: approvedDna.count ?? 0,
        approvedSheets: approvedSheets.count ?? 0,
        ads: ads.count ?? 0,
        pending: pending.count ?? 0,
        approvedImages: approvedImages.count ?? 0,
      }}
      recent={await toViews(supabase, recent.data ?? [])}
      setup={{
        higgsfield: status.higgsfield,
        brain: status.anthropic || status.gemini,
        webhook: status.higgsfieldWebhook,
      }}
    />
  );
}
