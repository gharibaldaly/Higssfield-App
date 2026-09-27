import "server-only";

import { z } from "zod";

import type { GenerationView } from "@/lib/domain/generation";
import { toViews } from "@/lib/generations/queries";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

export const libraryFiltersSchema = z.object({
  kind: z.enum(["image", "video"]).optional(),
  purpose: z
    .enum([
      "ghost_front",
      "ghost_back",
      "macro",
      "colorway",
      "product_sheet",
      "shot_preview",
      "shot_video",
      "other",
    ])
    .optional(),
  status: z.enum(["completed", "pending", "failed"]).optional(),
  product: z.uuid().optional(),
  favorites: z.enum(["1"]).optional(),
  approved: z.enum(["1"]).optional(),
});

export type LibraryFilters = z.infer<typeof libraryFiltersSchema>;

export type LibraryItem = GenerationView & {
  productId: string | null;
  productName: string | null;
  downloadUrl: string | null;
};

const PAGE_SIZE = 60;

export async function listLibrary(
  supabase: TypedSupabaseClient,
  filters: LibraryFilters,
): Promise<LibraryItem[]> {
  let query = supabase
    .from("generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.purpose) query = query.eq("purpose", filters.purpose);
  if (filters.status === "completed") query = query.eq("status", "completed");
  if (filters.status === "pending") query = query.in("status", ["queued", "in_progress"]);
  if (filters.status === "failed") query = query.in("status", ["failed", "nsfw", "canceled"]);
  if (filters.product) query = query.eq("product_id", filters.product);
  if (filters.favorites) query = query.eq("is_favorite", true);
  if (filters.approved) query = query.eq("review_status", "approved");
  const { data } = await query;
  const rows = data ?? [];
  const productIds = [
    ...new Set(rows.map((row) => row.product_id).filter((id): id is string => Boolean(id))),
  ];
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [] as { id: string; name: string }[] };
  const names = new Map((products ?? []).map((product) => [product.id, product.name]));
  const views = await toViews(supabase, rows);
  const paths = rows.map((row) => row.storage_path).filter((path): path is string => Boolean(path));
  const downloads = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("studio")
      .createSignedUrls(paths, 3600, { download: true });
    for (const item of signed ?? [])
      if (item.path && item.signedUrl) downloads.set(item.path, item.signedUrl);
  }
  return views.map((view, index) => {
    const row = rows[index]!;
    return {
      ...view,
      productId: row.product_id,
      productName: row.product_id ? (names.get(row.product_id) ?? null) : null,
      downloadUrl: row.storage_path ? (downloads.get(row.storage_path) ?? null) : null,
    };
  });
}
