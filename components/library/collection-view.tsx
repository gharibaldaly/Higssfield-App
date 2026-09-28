"use client";

import { BadgeCheck, Download, ExternalLink, Heart, Images, Loader2 } from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { useRefresh } from "@/components/common/use-refresh";
import { GreaseCircle } from "@/components/fx/grease-circle";
import { GenerationMedia } from "@/components/generation/generation-media";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { CollectionDownload } from "@/components/library/collection-download";
import { ProductLineBadge } from "@/components/products/product-line-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { setGenerationFavorite } from "@/lib/actions/generations";
import { isFinishedResult, type GenerationView } from "@/lib/domain/generation";
import type { CollectionOutput, LibraryCollection } from "@/lib/library/collections";
import { cn } from "@/lib/utils";

/**
 * One collection of the library: a batch (its models one after another) or a
 * product's results outside batches. Every image, an "approved only" switch,
 * and one download for everything shown.
 */
export function CollectionView({ collection }: { collection: LibraryCollection }) {
  const t = useTranslations("library.collection");
  const tLibrary = useTranslations("library");
  const format = useFormatter();
  const refresh = useRefresh();
  const initial = useMemo(
    () => collection.models.flatMap((model) => model.outputs.map((output) => output.view)),
    [collection],
  );
  const { views } = useGenerationPolling(initial, { onSettled: refresh });
  const [approvedOnly, setApprovedOnly] = useState(false);

  const viewOf = (output: CollectionOutput) => views.get(output.view.id) ?? output.view;
  const finished = initial.map((view) => views.get(view.id) ?? view).filter(isFinishedResult);
  const approved = finished.filter((view) => view.reviewStatus === "approved").length;
  const shown = collection.models
    .map((model) => ({
      ...model,
      outputs: model.outputs.filter(
        (output) => !approvedOnly || viewOf(output).reviewStatus === "approved",
      ),
    }))
    .filter((model) => model.outputs.length > 0);
  const date = format.dateTime(new Date(collection.createdAt), { dateStyle: "medium" });

  return (
    <>
      <PageHeader
        eyebrow={
          <p className="flex items-center gap-2 hud">
            <Link href="/library" className="underline-offset-4 hover:underline">
              {tLibrary("title")}
            </Link>
            <span aria-hidden>·</span>
            <span>
              {collection.kind === "batch"
                ? tLibrary("collections.batchEyebrow", { date })
                : tLibrary("collections.productEyebrow")}
            </span>
            {collection.status === "paused" ? (
              <Badge variant="muted">{tLibrary("collections.paused")}</Badge>
            ) : null}
          </p>
        }
        title={collection.name}
        description={
          <>
            {collection.kind === "batch"
              ? t("summary", {
                  models: collection.models.length,
                  images: finished.length,
                  approved,
                })
              : t("productSummary", { images: finished.length, approved })}
            <br />
            {t("includes")}
          </>
        }
        actions={
          <>
            <label className="flex h-10 items-center gap-2.5 rounded-(--radius-control) border border-border px-3 text-sm">
              <Switch checked={approvedOnly} onCheckedChange={setApprovedOnly} />
              {t("approvedOnly")}
            </label>
            <CollectionDownload
              kind={collection.kind}
              id={collection.id}
              name={collection.name}
              scope={approvedOnly ? "approved" : "all"}
              count={approvedOnly ? approved : finished.length}
            />
            <Button variant="surface" asChild>
              <Link href={collection.studioHref}>
                <ExternalLink aria-hidden />
                {collection.kind === "batch" ? t("openStudio") : t("openProduct")}
              </Link>
            </Button>
          </>
        }
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={Images}
          title={approvedOnly ? t("noApproved") : t("noImages")}
          description={approvedOnly ? t("noApprovedHint") : t("noImagesHint")}
        />
      ) : (
        <div className="flex flex-col gap-12">
          {shown.map((model) => {
            const modelViews = model.outputs.map(viewOf);
            const modelFinished = modelViews.filter(isFinishedResult);
            return (
              <section key={model.id} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-heading text-2xl leading-tight tracking-tight">
                    <Link
                      href={`/products/${model.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {model.name}
                    </Link>
                  </h2>
                  {collection.kind === "batch" ? (
                    <ProductLineBadge line={model.productLine} />
                  ) : null}
                  <span className="hud text-muted-foreground">
                    {t("modelSummary", {
                      images: modelFinished.length,
                      approved: modelFinished.filter((view) => view.reviewStatus === "approved")
                        .length,
                    })}
                  </span>
                </div>
                <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {model.outputs.map((output) => (
                    <OutputTile key={output.view.id} output={output} view={viewOf(output)} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function OutputTile({ output, view }: { output: CollectionOutput; view: GenerationView }) {
  const t = useTranslations("library.collection");
  const tPurposes = useTranslations("library.purposes");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [favorite, setFavorite] = useState(view.isFavorite);
  const [, startTransition] = useTransition();

  const label = (() => {
    const { slot, slotLabel } = output;
    if (slot === "front" || slot === "back") return t(`slots.${slot}`);
    const macro = /^macro_(\d+)$/.exec(slot);
    if (macro) {
      return slotLabel
        ? t("slots.closeupNamed", { n: macro[1]!, label: slotLabel })
        : t("slots.closeup", { n: macro[1]! });
    }
    if (slot.startsWith("colorway:")) {
      return slotLabel ? t("slots.colourNamed", { label: slotLabel }) : t("slots.colour");
    }
    return tPurposes(view.purpose);
  })();
  const approved = view.reviewStatus === "approved";
  const aspect =
    view.purpose === "product_sheet"
      ? "aspect-video"
      : view.kind === "video"
        ? "aspect-[9/16]"
        : "aspect-[4/5]";

  return (
    <li>
      <div className="relative">
        <GenerationMedia view={view} alt={label} className={cn("w-full", aspect)} />
        {approved ? (
          <GreaseCircle className="pointer-events-none absolute -start-2 -top-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)]" />
        ) : null}
        {view.reviewStatus === "rejected" ? (
          <Badge variant="accent" className="absolute start-3 bottom-3 z-[2] bg-(--surface-solid)">
            <Loader2 className="animate-spin" aria-hidden />
            {t("regenerating")}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {format.relativeTime(new Date(view.createdAt), now)}
          </p>
          {approved ? (
            <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-success">
              <BadgeCheck className="size-3" aria-hidden />
              {t("approved")}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={favorite}
          aria-label={favorite ? t("unfavorite") : t("favorite")}
          onClick={() =>
            startTransition(async () => {
              setFavorite(!favorite);
              const result = await setGenerationFavorite(view.id, !favorite);
              if (!result.ok) {
                setFavorite(favorite);
                toast.error(result.error);
              }
            })
          }
        >
          <Heart className={cn(favorite && "fill-[#ff6a9a] text-[#ff6a9a]")} aria-hidden />
        </Button>
        {output.downloadUrl && view.status === "completed" ? (
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={output.downloadUrl} aria-label={t("downloadOne")}>
              <Download aria-hidden />
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
