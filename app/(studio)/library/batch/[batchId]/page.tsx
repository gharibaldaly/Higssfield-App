import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { CollectionView } from "@/components/library/collection-view";
import { requireOwner } from "@/lib/auth/owner";
import { loadBatchCollection } from "@/lib/library/collections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("title") };
}

/** A batch in the library: every image of every model, and one download for them all. */
export default async function LibraryBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  if (!z.uuid().safeParse(batchId).success) notFound();
  const { supabase } = await requireOwner();
  const collection = await loadBatchCollection(supabase, batchId);
  if (!collection) notFound();
  return <CollectionView collection={collection} />;
}
