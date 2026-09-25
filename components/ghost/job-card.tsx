"use client";

import { BadgeCheck, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { GenerationMedia } from "@/components/generation/generation-media";
import { ReviewDialog } from "@/components/generation/review-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  approveCatalogueOutputAction,
  cancelCatalogueJobAction,
  regenerateCatalogueOutputAction,
  retryCatalogueJobAction,
} from "@/lib/actions/catalogue";
import type { GhostJob, GhostOutput } from "@/lib/catalogue/queries";
import type { GenerationView } from "@/lib/domain/generation";

const STATUS_VARIANT = {
  queued: "muted",
  preparing: "champagne",
  generating: "champagne",
  review: "warning",
  approved: "success",
  failed: "danger",
  canceled: "muted",
} as const;

export function JobCard({
  job,
  views,
  queuePosition,
  isRunning,
}: {
  job: GhostJob;
  views: Map<string, GenerationView>;
  queuePosition: number | null;
  isRunning: boolean;
}) {
  const t = useTranslations("ghost");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reviewing, setReviewing] = useState<GhostOutput | null>(null);

  function slotTitle(output: GhostOutput): string {
    if (output.slot === "front") return t("slots.front");
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
        <h2 className="font-display text-xl font-semibold">{job.productName}</h2>
        <Badge variant="outline">{t(`types.${job.jobType}.short`)}</Badge>
        <Badge variant={STATUS_VARIANT[job.status]}>{t(`jobStatus.${job.status}`)}</Badge>
        {job.status === "queued" && queuePosition ? (
          <Badge variant="muted">{t("queuePosition", { position: queuePosition })}</Badge>
        ) : null}
        {isRunning ? <Badge variant="champagne">{t("preparing")}</Badge> : null}
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
                router.refresh();
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
            variant="glass"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await retryCatalogueJobAction(job.id);
                if (!result.ok) toast.error(result.error);
                router.refresh();
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
          {Array.from({ length: job.jobType === "colorways" ? 3 : 2 }, (_, index) => (
            <div key={index} className="aspect-[4/5] shimmer rounded-2xl bg-muted" />
          ))}
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
                      <span className="absolute end-2 bottom-2 grid size-7 place-items-center rounded-full bg-success text-ink">
                        <BadgeCheck className="size-4" aria-label={t("approvedOutput")} />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{slotTitle(output)}</p>
                  <p className="text-xs text-muted-foreground">
                    {view.status === "completed" && view.reviewStatus !== "approved"
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
          onApprove={async () => {
            const result = await approveCatalogueOutputAction(reviewingView.id);
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            toast.success(t("approvedToast"));
            router.refresh();
            return true;
          }}
          onRegenerate={async (note) => {
            const result = await regenerateCatalogueOutputAction(reviewingView.id, note);
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            toast.success(t("regenerating"));
            router.refresh();
            return true;
          }}
        />
      ) : null}
    </Card>
  );
}
