"use client";

import {
  AlertTriangle,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  ScanSearch,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/common/post-json";
import { CompareSlider } from "@/components/generation/compare-slider";
import { GenerationMedia } from "@/components/generation/generation-media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import type { FidelityReview } from "@/lib/domain/fidelity";
import type { GenerationView } from "@/lib/domain/generation";
import { cn } from "@/lib/utils";

export function storedReview(value: unknown): FidelityReview | null {
  if (!value || typeof value !== "object") return null;
  const review = value as Partial<FidelityReview>;
  return review.verdict && typeof review.score === "number" ? (review as FidelityReview) : null;
}

/** Moves through a list of outputs without closing (the batch review queue). */
export type ReviewQueue = {
  index: number;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
};

type ReviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  generation: GenerationView;
  beforeUrl: string | null;
  background?: string;
  /** Starts the approval; the dialog moves on at once and the caller reports a failure. */
  onApprove?: () => void;
  /** Starts a regeneration; the dialog moves on at once and the caller reports a failure. */
  onRegenerate?: (note: string | null) => void;
  queue?: ReviewQueue;
};

/** A decision needs the image on screen this long, so a double click never decides the next one. */
const SETTLE_MS = 500;

/**
 * The compare view every output goes through before approval: original vs
 * result with a slider, plus Approve / Regenerate / Regenerate with note and
 * an optional AI fidelity check. A decision moves on at once (to the next
 * output in a queue) while its request runs, so the owner never waits on it.
 */
export function ReviewDialog(props: ReviewDialogProps) {
  const t = useTranslations("review");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        {/* Keyed by output, so notes and checks never leak from one image to the next. */}
        <ReviewBody key={props.generation.id} {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({
  onOpenChange,
  title,
  generation,
  beforeUrl,
  background,
  onApprove,
  onRegenerate,
  queue,
}: ReviewDialogProps) {
  const t = useTranslations("review");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  // A check run here wins; otherwise show the stored one (the batch checks images on its own).
  const [checked, setChecked] = useState<FidelityReview | null>(null);
  const review = checked ?? storedReview(generation.review);
  const done = generation.status === "completed";
  const approved = generation.reviewStatus === "approved";
  // Rejected: a regeneration has started and the new image is on its way.
  const regenerating = generation.reviewStatus === "rejected";

  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, []);

  function decide(start: () => void) {
    if (Date.now() - shownAt.current < SETTLE_MS) return;
    start();
    if (queue) queue.onNext();
    else onOpenChange(false);
  }

  async function checkFidelity() {
    setChecking(true);
    const result = await postJson<FidelityReview>("/api/generations/fidelity", {
      generationId: generation.id,
    });
    setChecking(false);
    if (!result.ok) toast.error(result.error);
    else setChecked(result.data);
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        {done && generation.url && beforeUrl && generation.mimeType?.startsWith("image/") ? (
          <CompareSlider
            before={beforeUrl}
            after={generation.url}
            background={background}
            className="max-h-[70dvh]"
          />
        ) : (
          <GenerationMedia
            view={generation}
            alt={title}
            className="aspect-[4/5] max-h-[70dvh] w-full"
          />
        )}
      </div>
      <div className="flex flex-col gap-3">
        {queue ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={queue.onPrevious}
              disabled={queue.index === 0}
              aria-label={t("previous")}
            >
              <ChevronLeft className="rtl:-scale-x-100" aria-hidden />
            </Button>
            <span className="flex-1 text-center hud text-muted-foreground">
              {t("position", { index: queue.index + 1, total: queue.total })}
            </span>
            <Button variant="ghost" size="sm" onClick={queue.onNext}>
              {t("skip")}
              <ChevronRight className="rtl:-scale-x-100" aria-hidden />
            </Button>
          </div>
        ) : null}
        {generation.backgroundOk === false ? (
          <p className="flex items-start gap-2 rounded-(--radius-control) border border-dashed border-warning/60 p-3 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("backgroundWarning")}
          </p>
        ) : null}
        {approved ? (
          <Badge variant="success" className="h-9 justify-center text-sm">
            <BadgeCheck aria-hidden />
            {t("approved")}
          </Badge>
        ) : null}
        {regenerating ? (
          <Badge variant="accent" className="h-9 justify-center text-sm">
            <Loader2 className="animate-spin" aria-hidden />
            {t("regenerating")}
          </Badge>
        ) : null}
        {onApprove && !approved && !regenerating ? (
          <Button disabled={!done} onClick={() => decide(onApprove)}>
            <BadgeCheck aria-hidden />
            {t("approve")}
          </Button>
        ) : null}
        {onRegenerate ? (
          <>
            <Button
              variant="surface"
              disabled={generation.status === "queued" || generation.status === "in_progress"}
              onClick={() => decide(() => onRegenerate(null))}
            >
              <RefreshCw aria-hidden />
              {t("regenerate")}
            </Button>
            <Button variant="surface" onClick={() => setNoteOpen((value) => !value)}>
              <MessageSquarePlus aria-hidden />
              {t("regenerateWithNote")}
            </Button>
            {noteOpen ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("notePlaceholder")}
                  maxLength={1000}
                  autoFocus
                />
                <Button
                  disabled={!note.trim()}
                  onClick={() => decide(() => onRegenerate(note.trim()))}
                >
                  <RefreshCw aria-hidden />
                  {t("send")}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        <Button
          variant="outline"
          disabled={!done || checking || !generation.mimeType?.startsWith("image/")}
          onClick={() => void checkFidelity()}
        >
          {checking ? <Loader2 className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
          {t("fidelityCheck")}
        </Button>
        {review ? (
          <div className="rounded-(--radius-control) border border-dashed border-border-strong p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <Badge
                variant={
                  review.verdict === "pass"
                    ? "success"
                    : review.verdict === "fail"
                      ? "danger"
                      : "warning"
                }
              >
                {t(`verdict.${review.verdict}`)}
              </Badge>
              <span className="font-semibold" dir="ltr">
                {Math.round(review.score)}/100
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{review.summary}</p>
            {review.issues.length > 0 ? (
              <>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {review.issues.map((issue, index) => (
                    <li key={index} className="text-xs">
                      <span
                        className={cn(
                          "me-1 font-semibold",
                          issue.severity === "critical"
                            ? "text-destructive"
                            : issue.severity === "major"
                              ? "text-warning"
                              : "",
                        )}
                      >
                        {issue.area}:
                      </span>
                      {issue.description}
                    </li>
                  ))}
                </ul>
                {onRegenerate ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2 h-auto"
                    onClick={() => {
                      setNote(
                        review.issues
                          .map((issue) => `Fix ${issue.area}: ${issue.description}`)
                          .join("\n")
                          .slice(0, 1000),
                      );
                      setNoteOpen(true);
                    }}
                  >
                    {t("useIssues")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {generation.note ? (
          <p className="text-xs text-muted-foreground">
            {t("previousNote")}: {generation.note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
