import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { CollectionView } from "@/components/library/collection-view";
import { requireOwner } from "@/lib/auth/owner";
import { loadProductCollection } from "@/lib/library/collections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("title") };
}

/** A product's results outside batches, and one download for them all. */
export default async function LibraryProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  if (!z.uuid().safeParse(productId).success) notFound();
  const { supabase } = await requireOwner();
  const collection = await loadProductCollection(supabase, productId);
  if (!collection) notFound();
  return <CollectionView collection={collection} />;
}
