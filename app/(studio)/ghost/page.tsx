import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { GhostStudio } from "@/components/ghost/ghost-studio";
import { requireOwner } from "@/lib/auth/owner";
import { loadGhostStudio } from "@/lib/catalogue/queries";
import { ownerRegistry } from "@/lib/generations/models";
import { toModelOptions } from "@/lib/providers/higgsfield/options";
import { getOwnerSettings } from "@/lib/settings/service";

// Each queued job asks the director brain for prompts before submitting.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ghost");
  return { title: t("title") };
}

export default async function GhostStudioPage() {
  const { supabase, user } = await requireOwner();
  const t = await getTranslations("ghost");
  const [studio, settings] = await Promise.all([
    loadGhostStudio(supabase),
    getOwnerSettings(supabase, user.id),
  ]);
  const registry = await ownerRegistry(settings);
  const models = toModelOptions(registry, "image", ["image-to-image", "text-to-image"]);
  const defaultModel =
    models.find((model) => model.id === settings.defaultImageModel && !model.disabledReason) ??
    models.find((model) => model.capabilities.modes.includes("image-to-image")) ??
    models[0];
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <GhostStudio
        products={studio.products}
        jobs={studio.jobs}
        models={models}
        defaultModelId={defaultModel?.id ?? null}
        style={settings.catalogueStyle}
      />
    </>
  );
}
