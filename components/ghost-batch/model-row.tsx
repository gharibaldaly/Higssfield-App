"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Dna,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AddColorwayDialog } from "@/components/colorways/colorway-manager";
import { useConfirm } from "@/components/common/confirm-dialog";
import { GreaseCircle } from "@/components/fx/grease-circle";
import { wakeGhostRunner } from "@/components/ghost-batch/runner-store";
import { GenerationMedia } from "@/components/generation/generation-media";
import { storedReview } from "@/components/generation/review-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import {
  batchItemPhotosAction,
  removeBatchItemAction,
  retryBatchItemAction,
} from "@/lib/actions/ghost-batches";
import type { GhostOutput } from "@/lib/catalogue/queries";
import type { GenerationView } from "@/lib/domain/generation";
import type { BatchItemView, BatchPhase } from "@/lib/ghost-batches/queries";
import { cn } from "@/lib/utils";

const STAGE_SLOTS = ["front", "back", "macro_1", "macro_2"] as const;
/** A robe set adds the front without the robe between the two fronts and the back. */
const ROBE_STAGE_SLOTS = ["front", "front_inner", "back", "macro_1", "macro_2"] as const;

const PHASE_VARIANT: Record<BatchPhase, "muted" | "accent" | "warning" | "success" | "danger"> = {
  uploading: "muted",
  pending: "muted",
  analyzing: "accent",
  dna_review: "warning",
  generating: "accent",
  review: "success",
  failed: "danger",
};

const LINE_DOT = {
  SECRET: "bg-[#ffb8cb]",
  HOURS: "bg-[#86e7c0]",
  VOWS: "bg-[#f3efe8]",
} as const;

export type OpenOutput = (output: GhostOutput, item: BatchItemView) => void;

function OutputTile({
  label,
  output,
  view,
  placeholder,
  onOpen,
}: {
  label: string;
  output: GhostOutput | null;
  view: GenerationView | null;
  placeholder: string;
  onOpen: () => void;
}) {
  const t = useTranslations("ghostBatch.model");
  const review = view ? storedReview(view.review) : null;
  const approved = view?.reviewStatus === "approved";
  return (
    <li className="min-w-0">
      {view && output ? (
        <button
          type="button"
          onClick={onOpen}
          className="group block w-full text-start focus-visible:outline-none"
        >
          <div className="relative">
            <GenerationMedia
              view={view}
              alt={label}
              controls={false}
              className="aspect-[4/5] w-full ring-offset-2 transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring"
            />
            {approved ? (
              <>
                <GreaseCircle className="absolute -start-1.5 -top-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)]" />
                <span className="absolute end-2 bottom-2 z-[2] grid size-6 place-items-center rounded-full bg-success text-black">
                  <BadgeCheck className="size-3.5" aria-label={t("approved")} />
                </span>
              </>
            ) : null}
            {/* The server marks an output rejected before it writes the new prompt. */}
            {view.reviewStatus === "rejected" ? (
              <Badge
                variant="accent"
                className="absolute start-2 bottom-2 z-[2] bg-(--surface-solid)"
              >
                <Loader2 className="animate-spin" aria-hidden />
                {t("regenerating")}
              </Badge>
            ) : null}
            {!approved && (view.backgroundOk === false || review) ? (
              <span className="absolute end-2 top-2 z-[2] flex flex-col items-end gap-1">
                {review ? (
                  <Badge
                    variant={
                      review.verdict === "pass"
                        ? "success"
                        : review.verdict === "fail"
                          ? "danger"
                          : "warning"
                    }
                    className="bg-(--surface-solid)"
                  >
                    <span dir="ltr">{t("fidelity", { score: Math.round(review.score) })}</span>
                  </Badge>
                ) : null}
                {view.backgroundOk === false ? (
                  <span
                    className="grid size-6 place-items-center rounded-full bg-warning text-black"
                    title={t("background")}
                  >
                    <AlertTriangle className="size-3.5" aria-label={t("background")} />
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-xs font-medium">{label}</p>
        </button>
      ) : (
        <div>
          <div className="grid aspect-[4/5] w-full place-items-center rounded-[14px] border border-dashed border-border-strong p-2 text-center text-[11px] text-muted-foreground">
            {placeholder}
          </div>
          <p className="mt-1.5 truncate text-xs font-medium text-muted-foreground">{label}</p>
        </div>
      )}
    </li>
  );
}

/** One garment model in a batch: its photo, phase, four catalogue images and its colours. */
export function ModelRow({
  item,
  index,
  views,
  ownerId,
  onOpen,
}: {
  item: BatchItemView;
  index: number;
  views: Map<string, GenerationView>;
  ownerId: string;
  onOpen: OpenOutput;
}) {
  const t = useTranslations("ghostBatch.model");
  const tPhase = useTranslations("ghostBatch.phase");
  const tLines = useTranslations("products.lines");
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [colourPhotos, setColourPhotos] = useState<
    { id: string; url: string | null; storagePath: string; label: string }[] | null
  >(null);

  const viewOf = (output: GhostOutput) => views.get(output.generation.id) ?? output.generation;
  const working = item.phase === "analyzing" || item.phase === "generating";
  const waitingLabel =
    item.phase === "failed" || item.phase === "dna_review" ? t("notStarted") : t("waitingSlot");

  function retry() {
    startTransition(async () => {
      const result = await retryBatchItemAction(item.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      wakeGhostRunner();
    });
  }

  async function remove() {
    const ok = await confirm({
      title: t("removeTitle", { name: item.name }),
      description: t("removeBody"),
      confirmLabel: t("remove"),
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await removeBatchItemAction(item.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("removed"));
    });
  }

  function addColour() {
    startTransition(async () => {
      const result = await batchItemPhotosAction(item.productId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setColourPhotos(result.data);
    });
  }

  return (
    <li className="rounded-(--radius-panel) p-4 surface sm:p-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[112px_minmax(0,1fr)] xl:grid-cols-[112px_minmax(0,44rem)_minmax(0,1fr)]">
        {/* The original photo and the model's work ticket. */}
        <div className="flex gap-4 lg:flex-col lg:gap-3">
          <div className="crop-marks relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-[12px] stage lg:w-full">
            {item.thumbUrl ? (
              // Signed Storage URL of the owner's own photo; shown as is.
              <img
                src={item.thumbUrl}
                alt={item.name}
                className="size-full object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="hud text-muted-foreground" dir="ltr">
              {String(index + 1).padStart(2, "0")}
            </p>
            <p className="font-heading text-lg leading-tight break-words">{item.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className={cn("size-2 rounded-full", LINE_DOT[item.productLine])} />
              {item.productLine} · {tLines(item.productLine)}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={PHASE_VARIANT[item.phase]}>
                {working ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {tPhase(item.phase)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t("photos", { count: item.photoCount })}
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit px-2"
                  disabled={pending}
                  aria-label={`${t("menu")}: ${item.name}`}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <Link href={`/products/${item.productId}/dna`}>
                    <Dna aria-hidden />
                    {t("openDna")}
                  </Link>
                </DropdownMenuItem>
                {item.phase === "failed" ? (
                  <DropdownMenuItem onSelect={retry}>
                    <RotateCcw aria-hidden />
                    {t("retry")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                  <Trash2 aria-hidden />
                  {t("remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Stage one: front, back and the two close-ups. */}
        <div className="flex min-w-0 flex-col gap-3">
          {item.phase === "dna_review" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-control) border border-dashed border-warning/60 p-3 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t("dnaReviewTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {item.dnaIssues.length > 0 ? t("dnaIncomplete") : t("dnaReviewBody")}
                </p>
              </div>
              <Button asChild size="sm" variant="surface">
                <Link href={`/products/${item.productId}/dna`}>{t("openDna")}</Link>
              </Button>
            </div>
          ) : null}
          {item.phase === "failed" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-control) border border-dashed border-destructive/50 p-3 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              <p className="min-w-0 flex-1 text-xs">{item.error ?? t("failed")}</p>
              <Button size="sm" variant="surface" onClick={retry} disabled={pending}>
                <RotateCcw aria-hidden />
                {t("retry")}
              </Button>
            </div>
          ) : item.phase === "uploading" ? (
            <p className="rounded-(--radius-control) border border-dashed border-border-strong p-3 text-xs text-muted-foreground">
              {t("uploadInterrupted")}
            </p>
          ) : null}
          {item.failedUploads > 0 ? (
            <p className="text-xs text-warning">{t("uploadGap", { count: item.failedUploads })}</p>
          ) : null}
          <ul
            className={cn(
              "grid max-w-[44rem] grid-cols-2 gap-3",
              item.outerPosition ? "sm:grid-cols-5" : "sm:grid-cols-4",
            )}
          >
            {(item.outerPosition ? ROBE_STAGE_SLOTS : STAGE_SLOTS).map((slot) => {
              const output = item.outputs.find((candidate) => candidate.slot === slot) ?? null;
              const label =
                slot.startsWith("macro") && output?.slotLabel
                  ? t("macroNamed", { label: output.slotLabel })
                  : slot === "front" && item.outerPosition
                    ? t("slots.frontSet")
                    : slot === "front" && item.bottomsPosition
                      ? t("slots.frontFull")
                      : t(`slots.${slot}`);
              return (
                <OutputTile
                  key={slot}
                  label={label}
                  output={output}
                  view={output ? viewOf(output) : null}
                  placeholder={working ? t("working") : waitingLabel}
                  onOpen={() => output && onOpen(output, item)}
                />
              );
            })}
          </ul>
        </div>

        {/* Colours: swatches first, then their renders once the front is approved. */}
        <div className="flex min-w-0 flex-col gap-3 lg:col-start-2 xl:col-start-auto xl:border-s xl:border-dashed xl:border-border xl:ps-5">
          <div className="flex items-center justify-between gap-2">
            <p className="hud text-muted-foreground">{t("colours")}</p>
            <Button
              variant="ghost"
              size="sm"
              className="px-2"
              onClick={addColour}
              disabled={pending}
            >
              <Plus aria-hidden />
              {t("addColour")}
            </Button>
          </div>
          {item.colours.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noColours")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {item.colours.map((colour) => (
                <li
                  key={colour.id}
                  className="flex items-center gap-1.5 rounded-full border border-border py-0.5 ps-0.5 pe-2.5 text-xs"
                >
                  <span
                    aria-hidden
                    className="size-5 rounded-full border border-border-strong"
                    style={{ background: colour.hex }}
                  />
                  <span className="max-w-28 truncate">{colour.name}</span>
                </li>
              ))}
            </ul>
          )}
          {item.colours.length > 0 && !item.frontApproved ? (
            <p className="text-xs text-muted-foreground">{t("needsFront")}</p>
          ) : null}
          {item.colourOutputs.length > 0 ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
              {item.colourOutputs.map((output) => (
                <OutputTile
                  key={output.slot}
                  label={output.slotLabel ?? t("colour")}
                  output={output}
                  view={viewOf(output)}
                  placeholder=""
                  onOpen={() => onOpen(output, item)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {colourPhotos ? (
        <AddColorwayDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setColourPhotos(null);
            // A new colour on an approved front renders right away once colours are on.
            wakeGhostRunner();
          }}
          ownerId={ownerId}
          productId={item.productId}
          photos={colourPhotos}
        />
      ) : null}
    </li>
  );
}
