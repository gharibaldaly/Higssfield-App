import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { FreeStudio } from "@/components/free/free-studio";
import { requireOwner } from "@/lib/auth/owner";
import { listFreeGenerations } from "@/lib/generations/free";
import { ownerRegistry } from "@/lib/generations/models";
import { toModelOptions } from "@/lib/providers/higgsfield/options";
import { getOwnerSettings } from "@/lib/settings/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("free");
  return { title: t("title") };
}

/**
 * Free generation: the owner's own prompt and references, any image or video
 * model, the size and quality they choose. Nothing is added to the prompt.
 */
export default async function FreeGenerationPage() {
  const { supabase, user } = await requireOwner();
  const [t, locale, settings] = await Promise.all([
    getTranslations("free"),
    getLocale(),
    getOwnerSettings(supabase, user.id),
  ]);
  const [registry, history] = await Promise.all([
    ownerRegistry(settings),
    listFreeGenerations(supabase, settings),
  ]);
  const imageModels = toModelOptions(registry, "image", ["text-to-image", "image-to-image"]);
  const videoModels = toModelOptions(registry, "video", ["text-to-video", "image-to-video"]);
  const usable = (models: typeof imageModels, preferred: string | null) =>
    (
      models.find((model) => model.id === preferred && !model.disabledReason) ??
      models.find((model) => !model.disabledReason)
    )?.id ?? null;

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <FreeStudio
        ownerId={user.id}
        locale={locale === "ar" ? "ar" : "en"}
        imageModels={imageModels}
        videoModels={videoModels}
        defaultImageModelId={usable(imageModels, settings.defaultImageModel)}
        defaultVideoModelId={usable(videoModels, settings.defaultVideoModel)}
        history={history}
      />
    </>
  );
}
