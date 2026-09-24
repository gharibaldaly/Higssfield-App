import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { LibraryView } from "@/components/library/library-view";
import { requireOwner } from "@/lib/auth/owner";
import { libraryFiltersSchema, listLibrary } from "@/lib/library/queries";
import { listProductCards } from "@/lib/products/queries";
import { signPaths } from "@/lib/storage/objects";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("title") };
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { supabase } = await requireOwner();
  const t = await getTranslations("library");
  const tab = typeof raw.tab === "string" ? raw.tab : "generations";
  const parsed = libraryFiltersSchema.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "string")),
  );
  const filters = parsed.success ? parsed.data : {};

  const [items, products, dna, sheets, colorways] = await Promise.all([
    listLibrary(supabase, filters),
    listProductCards(supabase),
    supabase
      .from("garment_dna")
      .select("id, product_id, version, status, source, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("product_sheets")
      .select("id, product_id, version, status, generation_id, created_at")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("colorways")
      .select("id, product_id, name, hex, swatch_path")
      .order("created_at", { ascending: false }),
  ]);

  const sheetGenerationIds = (sheets.data ?? [])
    .map((sheet) => sheet.generation_id)
    .filter((id): id is string => Boolean(id));
  const { data: sheetGenerations } = sheetGenerationIds.length
    ? await supabase.from("generations").select("id, storage_path").in("id", sheetGenerationIds)
    : { data: [] as { id: string; storage_path: string | null }[] };
  const sheetPaths = new Map((sheetGenerations ?? []).map((row) => [row.id, row.storage_path]));
  const signed = await signPaths(supabase, [
    ...(sheetGenerations ?? []).map((row) => row.storage_path),
    ...(colorways.data ?? []).map((row) => row.swatch_path),
  ]);
  const productName = new Map(products.map((product) => [product.id, product.name]));

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <LibraryView
        tab={tab}
        filters={filters}
        items={items}
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          productLine: product.productLine,
          coverUrl: product.coverUrl,
          stage: product.stage,
        }))}
        dna={(dna.data ?? []).map((row) => ({
          id: row.id,
          productId: row.product_id,
          productName: productName.get(row.product_id) ?? "",
          version: row.version,
          status: row.status,
          source: row.source,
          createdAt: row.created_at,
        }))}
        sheets={(sheets.data ?? []).map((row) => {
          const path = row.generation_id ? sheetPaths.get(row.generation_id) : null;
          return {
            id: row.id,
            productId: row.product_id,
            productName: productName.get(row.product_id) ?? "",
            version: row.version,
            status: row.status,
            url: path ? (signed.get(path) ?? null) : null,
          };
        })}
        colorways={(colorways.data ?? []).map((row) => ({
          id: row.id,
          productId: row.product_id,
          productName: productName.get(row.product_id) ?? "",
          name: row.name,
          hex: row.hex,
          swatchUrl: row.swatch_path ? (signed.get(row.swatch_path) ?? null) : null,
        }))}
      />
    </>
  );
}
