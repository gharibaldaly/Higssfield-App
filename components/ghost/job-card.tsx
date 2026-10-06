"use client";

import { BadgeCheck, Loader2, RotateCcw, X } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { GreaseCircle } from "@/components/fx/grease-circle";
import { GenerationMedia } from "@/components/generation/generation-media";
import { ReviewDialog } from "@/components/generation/review-dialog";
import {
  approveOutput,
  regenerateOutput,
  type OutputDecisions,
} from "@/components/ghost/output-decisions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cancelCatalogueJobAction, retryCatalogueJobAction } from "@/lib/actions/catalogue";
import type { GhostJob, GhostOutput } from "@/lib/catalogue/queries";
import type { GenerationView } from "@/lib/domain/generation";

const STATUS_VARIANT = {
  queued: "muted",
  preparing: "accent",
  generating: "accent",
  review: "warning",
  approved: "success",
  failed: "danger",
  canceled: "muted",
} as const;

export function JobCard({
  job,
  views,
  decisions,
  queuePosition,
  isRunning,
}: {
  job: GhostJob;
  views: Map<string, GenerationView>;
  decisions: OutputDecisions;
  queuePosition: number | null;
  isRunning: boolean;
}) {
  const t = useTranslations("ghost");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [pending, startTransition] = useTransition();
  const [reviewing, setReviewing] = useState<GhostOutput | null>(null);

  function slotTitle(output: GhostOutput): string {
    if (output.slot === "front") return job.fullSet ? t("slots.frontSet") : t("slots.front");
    // A robe set's second front, without its outer layer (the label names it).
    if (output.slot === "front_inner")
      return output.slotLabel
        ? t("slots.frontInner", { label: output.slotLabel })
        : t("slots.frontInnerPlain");
    if (output.slot === "back") return t("slots.back");
    if (output.slot.startsWith("macro"))
      return output.slotLabel
        ? t("slots.macroNamed", { label: output.slotLabel })
        : t("slots.macro");
    return output.slotLabel
      ? t("slots.colorwayNamed", { label: output.slotLabel })
      : t("slots.colorway");
  }

  const reviewingView = reviewing
    ? (views.get(reviewing.generation.id) ?? reviewing.generation)
    : null;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl">{job.productName}</h2>
        <Badge variant="outline">{t(`types.${job.jobType}.short`)}</Badge>
        <Badge variant={STATUS_VARIANT[job.status]}>{t(`jobStatus.${job.status}`)}</Badge>
        {job.status === "queued" && queuePosition ? (
          <Badge variant="muted">{t("queuePosition", { position: queuePosition })}</Badge>
        ) : null}
        {isRunning ? <Badge variant="accent">{t("preparing")}</Badge> : null}
        <span className="ms-auto text-xs text-muted-foreground">
          {format.relativeTime(new Date(job.createdAt), now)}
        </span>
        {job.status === "queued" || job.status === "failed" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await cancelCatalogueJobAction(job.id);
                if (!result.ok) toast.error(result.error);
              })
            }
          >
            <X aria-hidden />
            {t("cancel")}
          </Button>
        ) : null}
        {job.status === "failed" || job.status === "canceled" ? (
          <Button
            size="sm"
            variant="surface"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await retryCatalogueJobAction(job.id);
                if (!result.ok) toast.error(result.error);
              })
            }
          >
            <RotateCcw aria-hidden />
            {t("retry")}
          </Button>
        ) : null}
      </div>
      {job.error && job.outputs.length === 0 ? (
        <p className="mb-3 text-sm text-destructive">{job.error}</p>
      ) : null}
      {job.outputs.length === 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from(
            { length: job.jobType === "colorways" ? 3 : job.innerFront ? 3 : 2 },
            (_, index) => (
              <div key={index} className="aspect-[4/5] shimmer rounded-[14px] stage" />
            ),
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {job.outputs.map((output) => {
            const view = views.get(output.generation.id) ?? output.generation;
            return (
              <li key={output.slot}>
                <button
                  type="button"
                  onClick={() => setReviewing(output)}
                  className="group block w-full text-start focus-visible:outline-none"
                >
                  <div className="relative">
                    <GenerationMedia
                      view={view}
                      alt={slotTitle(output)}
                      className="aspect-[4/5] w-full ring-offset-2 transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring"
                      controls={false}
                    />
                    {view.reviewStatus === "approved" ? (
                      <>
                        <GreaseCircle className="absolute -start-2 -top-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)]" />
                        <span className="absolute end-4 bottom-4 z-[2] grid size-7 place-items-center rounded-full bg-success text-black">
                          <BadgeCheck className="size-4" aria-label={t("approvedOutput")} />
                        </span>
                      </>
                    ) : null}
                    {/* The server marks an output rejected before it writes the new prompt. */}
                    {view.reviewStatus === "rejected" ? (
                      <Badge
                        variant="accent"
                        className="absolute start-4 bottom-4 z-[2] bg-(--surface-solid)"
                      >
                        <Loader2 className="animate-spin" aria-hidden />
                        {t("regeneratingTile")}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{slotTitle(output)}</p>
                  <p className="text-xs text-muted-foreground">
                    {view.status === "completed" && view.reviewStatus === "pending"
                      ? t("clickToReview")
                      : null}
                    {output.attempts > 1 ? ` · ${t("attempts", { count: output.attempts })}` : ""}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {reviewing && reviewingView ? (
        <ReviewDialog
          open
          onOpenChange={(open) => !open && setReviewing(null)}
          title={`${job.productName} · ${slotTitle(reviewing)}`}
          generation={reviewingView}
          beforeUrl={reviewing.beforeUrl}
          background={job.background}
          onApprove={() => {
            void approveOutput(reviewingView, decisions).then((result) => {
              if (!result.ok) toast.error(result.error);
              else toast.success(t("approvedToast"));
            });
          }}
          onRegenerate={(note) => {
            toast.success(t("regenerating"));
            void regenerateOutput(reviewingView, note, decisions).then((result) => {
              if (!result.ok) toast.error(result.error);
            });
          }}
        />
      ) : null}
    </Card>
  );
}
