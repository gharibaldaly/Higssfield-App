import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { DirectorBoard } from "@/components/ads/director-board";
import { PageHeader } from "@/components/common/page-header";
import { requireOwner } from "@/lib/auth/owner";
import { loadDirectorBoard } from "@/lib/director/queries";

// Planning and prompt writing call the director brain.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("director");
  return { title: t("title") };
}

export default async function DirectorBoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { supabase, user } = await requireOwner();
  const t = await getTranslations("director");
  const data = await loadDirectorBoard(supabase, user.id, projectId);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/ads" className="hover:underline">
            {t("eyebrow")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />
      <DirectorBoard data={data} />
    </>
  );
}
