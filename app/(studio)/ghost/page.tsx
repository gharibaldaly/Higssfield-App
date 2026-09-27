import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { GhostBatchStudio } from "@/components/ghost-batch/ghost-batch-studio";
import { GhostStudio } from "@/components/ghost/ghost-studio";
import { requireOwner } from "@/lib/auth/owner";
import { loadGhostStudio } from "@/lib/catalogue/queries";
import { ownerRegistry } from "@/lib/generations/models";
import { loadGhostBatches } from "@/lib/ghost-batches/queries";
import { toModelOptions } from "@/lib/providers/higgsfield/options";
import { getOwnerSettings } from "@/lib/settings/service";
import { cn } from "@/lib/utils";

// Each queued job asks the director brain for prompts before submitting.
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ghost");
  return { title: t("title") };
}

export default async function GhostStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; batch?: string }>;
}) {
  const { supabase, user } = await requireOwner();
  const t = await getTranslations("ghost");
  const params = await searchParams;
  const view = params.view === "products" ? "products" : "photos";
  const settings = await getOwnerSettings(supabase, user.id);
  const registry = await ownerRegistry(settings);
  const models = toModelOptions(registry, "image", ["image-to-image", "text-to-image"]);
  const defaultModel =
    models.find((model) => model.id === settings.defaultImageModel && !model.disabledReason) ??
    models.find((model) => model.capabilities.modes.includes("image-to-image")) ??
    models[0];

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <nav
        aria-label={t("views.label")}
        className="mb-6 inline-flex w-fit rounded-full border border-border p-1"
      >
        {(["photos", "products"] as const).map((value) => (
          <Link
            key={value}
            href={value === "photos" ? "/ghost" : "/ghost?view=products"}
            aria-current={view === value ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              view === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`views.${value}`)}
          </Link>
        ))}
      </nav>
      {view === "photos" ? (
        <GhostBatchStudio
          {...await loadGhostBatches(supabase, params.batch ?? null)}
          models={models}
          defaultModelId={defaultModel?.id ?? null}
          style={settings.catalogueStyle}
          ownerId={user.id}
        />
      ) : (
        <GhostStudio
          {...await loadGhostStudio(supabase)}
          models={models}
          defaultModelId={defaultModel?.id ?? null}
          style={settings.catalogueStyle}
        />
      )}
    </>
  );
}
