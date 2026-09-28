"use client";

import {
  Loader2,
  MoreHorizontal,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  ScanEye,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { useRefresh } from "@/components/common/use-refresh";
import { ModelRow, type OpenOutput } from "@/components/ghost-batch/model-row";
import { useRunnerState, wakeGhostRunner } from "@/components/ghost-batch/runner-store";
import { approveOutput, regenerateOutput } from "@/components/ghost/output-decisions";
import { ReviewDialog, storedReview } from "@/components/generation/review-dialog";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import {
  deleteGhostBatchAction,
  renameBatchAction,
  requestBatchColoursAction,
  setBatchStatusAction,
} from "@/lib/actions/ghost-batches";
import type { GhostOutput } from "@/lib/catalogue/queries";
import type { GenerationView } from "@/lib/domain/generation";
import type { BatchItemView, GhostBatchDetail } from "@/lib/ghost-batches/queries";
import { cn } from "@/lib/utils";

type Filter = "all" | "review" | "working" | "attention";
const FILTERS: Filter[] = ["all", "review", "working", "attention"];

type QueueEntry = { output: GhostOutput; item: BatchItemView };

const PENDING = new Set(["queued", "in_progress"]);
const FAILED = new Set(["failed", "nsfw", "canceled"]);

function outputsOf(item: BatchItemView): GhostOutput[] {
  return [...item.outputs, ...item.colourOutputs];
}

function itemState(item: BatchItemView, views: Map<string, GenerationView>) {
  const current = outputsOf(item).map(
    (output) => views.get(output.generation.id) ?? output.generation,
  );
  const toReview = current.filter(
    (view) => view.status === "completed" && view.reviewStatus === "pending",
  ).length;
  const working =
    ["uploading", "pending", "analyzing", "generating"].includes(item.phase) ||
    current.some((view) => PENDING.has(view.status));
  const attention =
    item.phase === "failed" ||
    item.phase === "dna_review" ||
    current.some(
      (view) =>
        FAILED.has(view.status) ||
        (view.reviewStatus !== "approved" &&
          (view.backgroundOk === false || storedReview(view.review)?.verdict === "fail")),
    );
  return { toReview, working, attention };
}

const STAGES = ["upload", "dna", "stageOne", "approval", "colours"] as const;

/** The batch's work ticket and its models, with a review queue that walks every finished image. */
export function BatchBoard({
  detail,
  ownerId,
  onAddModels,
}: {
  detail: GhostBatchDetail;
  ownerId: string;
  onAddModels: () => void;
}) {
  const t = useTranslations("ghostBatch.board");
  const tSlots = useTranslations("ghostBatch.model");
  const format = useFormatter();
  const router = useRouter();
  const refresh = useRefresh();
  const runner = useRunnerState();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [reviewing, setReviewing] = useState<{ entries: QueueEntry[]; index: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ models: boolean } | null>(null);

  const { views, decide, undecide } = useGenerationPolling(
    detail.items.flatMap((item) => outputsOf(item).map((output) => output.generation)),
    { onSettled: refresh },
  );
  const decisions = { decide, undecide, refresh };

  // A running batch wakes the runner (it stops when it runs out of work).
  useEffect(() => {
    if (detail.status === "running") wakeGhostRunner();
  }, [detail.id, detail.status]);

  // Fresh data after each step of work on this batch (not while it only waits).
  const lastRefresh = useRef(0);
  useEffect(() => {
    const report = runner.report;
    if (!report || report.batchId !== detail.id || report.step === "waiting") return;
    if (runner.lastStepAt <= lastRefresh.current) return;
    lastRefresh.current = runner.lastStepAt;
    refresh();
  }, [runner.lastStepAt, runner.report, detail.id, refresh]);

  const states = useMemo(
    () => new Map(detail.items.map((item) => [item.id, itemState(item, views)])),
    [detail.items, views],
  );
  const counts = useMemo(() => {
    const list = [...states.values()];
    return {
      ready: detail.items.filter((item) => item.phase === "review").length,
      toReview: list.reduce((sum, state) => sum + state.toReview, 0),
      attention: list.filter((state) => state.attention).length,
      working: list.filter((state) => state.working).length,
      coloursReady: detail.items.filter((item) => item.frontApproved && item.colours.length > 0)
        .length,
    };
  }, [states, detail.items]);

  const stageDone: Record<(typeof STAGES)[number], boolean> = {
    upload: detail.items.every((item) => item.phase !== "uploading"),
    dna: detail.items.every(
      (item) => !["uploading", "pending", "analyzing", "dna_review"].includes(item.phase),
    ),
    stageOne: detail.items.every((item) => item.phase === "review" || item.phase === "failed"),
    approval:
      detail.items.length > 0 &&
      detail.items.every((item) =>
        item.outputs.every((output) => {
          const view = views.get(output.generation.id) ?? output.generation;
          return view.reviewStatus === "approved";
        }),
      ),
    colours:
      detail.coloursRequested &&
      detail.items.every((item) =>
        item.colourOutputs.every((output) => {
          const view = views.get(output.generation.id) ?? output.generation;
          return view.reviewStatus === "approved";
        }),
      ),
  };
  const currentStage = STAGES.find((stage) => !stageDone[stage]) ?? null;

  const visible = detail.items.filter((item) => {
    const state = states.get(item.id)!;
    if (filter === "review") return state.toReview > 0;
    if (filter === "working") return state.working;
    if (filter === "attention") return state.attention;
    return true;
  });

  function reviewQueue(): QueueEntry[] {
    return detail.items.flatMap((item) =>
      outputsOf(item)
        .filter((output) => {
          const view = views.get(output.generation.id) ?? output.generation;
          return view.status === "completed" && view.reviewStatus === "pending";
        })
        .map((output) => ({ output, item })),
    );
  }

  const openOutput: OpenOutput = (output, item) => {
    setReviewing({ entries: [{ output, item }], index: 0 });
  };

  function slotTitle(entry: QueueEntry): string {
    const { slot, slotLabel } = entry.output;
    if (slot === "front" || slot === "back") return tSlots(`slots.${slot}`);
    if (slot.startsWith("macro")) {
      return slotLabel ? tSlots("macroNamed", { label: slotLabel }) : tSlots(`slots.macro_1`);
    }
    return slotLabel ?? tSlots("colour");
  }

  // The batch actions revalidate the page, so their answer already brings it up to date.
  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      done?.();
    });
  }

  const current = reviewing ? reviewing.entries[reviewing.index] : null;
  const currentView = current
    ? (views.get(current.output.generation.id) ?? current.output.generation)
    : null;
  const inThisBatch = runner.running && runner.report?.batchId === detail.id ? runner.report : null;

  return (
    <div className="flex flex-col gap-6">
      {/* The batch's work ticket. */}
      <section className="rounded-(--radius-panel) p-5 surface sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="hud text-muted-foreground">
              {t("eyebrow", {
                date: format.dateTime(new Date(detail.createdAt), {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              })}
            </p>
            <h2 className="mt-1 font-heading text-3xl break-words sm:text-4xl">{detail.name}</h2>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{t("models", { count: detail.items.length })}</span>
              <span>{t("ready", { count: counts.ready })}</span>
              {counts.attention > 0 ? (
                <span className="text-warning">{t("attention", { count: counts.attention })}</span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {detail.status === "running" ? (
              <Button
                variant="surface"
                size="sm"
                disabled={pending}
                onClick={() => run(() => setBatchStatusAction(detail.id, "paused"))}
              >
                <Pause aria-hidden />
                {t("pause")}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() => setBatchStatusAction(detail.id, "running"), wakeGhostRunner)
                }
              >
                <Play aria-hidden />
                {t("resume")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("menu")}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onAddModels}>
                  <Plus aria-hidden />
                  {t("addModels")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenaming(detail.name)}>
                  <Pencil aria-hidden />
                  {t("rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting({ models: false })}
                >
                  <Trash2 aria-hidden />
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Where the batch stands: knots on a thread, one per stage. */}
        <ol
          className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2"
          aria-label={t("stagesLabel")}
        >
          {STAGES.map((stage, index) => {
            const done = stageDone[stage];
            const active = stage === currentStage;
            return (
              <Fragment key={stage}>
                {index > 0 ? (
                  <li
                    aria-hidden
                    className={cn("w-6", done ? "h-px bg-primary" : "stitch text-border-strong")}
                  />
                ) : null}
                <li
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    done
                      ? "text-foreground"
                      : active
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 rounded-full border",
                      done
                        ? "border-primary bg-primary"
                        : active
                          ? "border-primary bg-[color-mix(in_srgb,var(--primary)_30%,transparent)] motion-safe:animate-pulse"
                          : "border-border-strong",
                    )}
                  />
                  {t(`stages.${stage}`)}
                </li>
              </Fragment>
            );
          })}
        </ol>

        {inThisBatch && inThisBatch.step !== "idle" ? (
          <p
            className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin text-accent-ink" aria-hidden />
            {inThisBatch.step === "waiting"
              ? t("runnerWaiting")
              : t(`runner.${inThisBatch.step}`, { model: inThisBatch.modelName ?? "" })}
          </p>
        ) : detail.status === "paused" ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("paused")}</p>
        ) : counts.working > 0 && !runner.running ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("keepOpen")}</p>
        ) : null}

        {/* Below the tear line: the two decisions that belong to the owner. */}
        <div className="-mx-5 mt-5 flex flex-wrap items-center gap-3 border-t border-dashed border-border-strong px-5 pt-4 sm:-mx-6 sm:px-6">
          <Button
            size="sm"
            disabled={counts.toReview === 0}
            onClick={() => {
              const entries = reviewQueue();
              if (entries.length > 0) setReviewing({ entries, index: 0 });
            }}
          >
            <ScanEye aria-hidden />
            {counts.toReview > 0 ? t("review", { count: counts.toReview }) : t("nothingToReview")}
          </Button>
          {detail.coloursRequested ? (
            <Badge variant="accent" className="h-8">
              <Palette aria-hidden />
              {t("coloursOn")}
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="surface"
              disabled={pending}
              onClick={() => run(() => requestBatchColoursAction(detail.id), wakeGhostRunner)}
            >
              <Palette aria-hidden />
              {t("startColours")}
            </Button>
          )}
          <span className="hidden text-xs text-muted-foreground md:inline">
            {detail.coloursRequested
              ? t("coloursOnHint")
              : t("coloursHint", { count: counts.coloursReady })}
          </span>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("filterLabel")}>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "h-8 rounded-full border px-4 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              filter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`filters.${value}`)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-(--radius-panel) border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {visible.map((item) => (
            <ModelRow
              key={item.id}
              item={item}
              index={detail.items.indexOf(item)}
              views={views}
              ownerId={ownerId}
              onOpen={openOutput}
            />
          ))}
        </ol>
      )}

      {reviewing && current && currentView ? (
        <ReviewDialog
          open
          onOpenChange={(open) => !open && setReviewing(null)}
          title={`${current.item.name} · ${slotTitle(current)}`}
          generation={currentView}
          beforeUrl={current.output.beforeUrl}
          background={detail.style.background}
          queue={
            reviewing.entries.length > 1
              ? {
                  index: reviewing.index,
                  total: reviewing.entries.length,
                  onNext: () =>
                    setReviewing((state) => {
                      if (!state) return state;
                      if (state.index + 1 >= state.entries.length) {
                        toast.success(t("queueDone"));
                        return null;
                      }
                      return { ...state, index: state.index + 1 };
                    }),
                  onPrevious: () =>
                    setReviewing((state) =>
                      state ? { ...state, index: Math.max(0, state.index - 1) } : state,
                    ),
                }
              : undefined
          }
          onApprove={() => {
            const startsColours = current.output.slot === "front" && detail.coloursRequested;
            void approveOutput(currentView, decisions).then((result) => {
              if (!result.ok) toast.error(result.error);
              // An approved front can start its colours.
              else if (startsColours) wakeGhostRunner();
            });
          }}
          onRegenerate={(note) => {
            toast.success(t("regenerating"));
            void regenerateOutput(currentView, note, decisions).then((result) => {
              if (!result.ok) toast.error(result.error);
            });
          }}
        />
      ) : null}

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rename")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renaming ?? ""}
            onChange={(event) => setRenaming(event.target.value)}
            maxLength={160}
            aria-label={t("rename")}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={!renaming?.trim() || pending}
              onClick={() =>
                run(
                  () => renameBatchAction(detail.id, renaming ?? ""),
                  () => setRenaming(null),
                )
              }
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={deleting?.models ?? false}
              onCheckedChange={(checked) => setDeleting({ models: checked === true })}
              className="mt-0.5"
            />
            {t("deleteModels", { count: detail.items.length })}
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)} autoFocus>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(
                  () => deleteGhostBatchAction(detail.id, deleting?.models ?? false),
                  () => {
                    setDeleting(null);
                    toast.success(t("deleted"));
                    router.push("/ghost");
                  },
                )
              }
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
