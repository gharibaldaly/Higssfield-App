"use client";

import { BadgeCheck, Loader2, MessageSquarePlus, RefreshCw, ScanSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { checkFidelity } from "@/lib/actions/generations";
import type { FidelityReview } from "@/lib/domain/fidelity";
import type { GenerationView } from "@/lib/domain/generation";
import { cn } from "@/lib/utils";

function storedReview(value: unknown): FidelityReview | null {
  if (!value || typeof value !== "object") return null;
  const review = value as Partial<FidelityReview>;
  return review.verdict && typeof review.score === "number" ? (review as FidelityReview) : null;
}

/**
 * The compare view every output goes through before approval: original vs
 * result with a slider, plus Approve / Regenerate / Regenerate with note and
 * an optional AI fidelity check.
 */
export function ReviewDialog({
  open,
  onOpenChange,
  title,
  generation,
  beforeUrl,
  background,
  onApprove,
  onRegenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  generation: GenerationView;
  beforeUrl: string | null;
  background?: string;
  onApprove?: () => Promise<boolean>;
  onRegenerate?: (note: string | null) => Promise<boolean>;
}) {
  const t = useTranslations("review");
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "regenerate" | "fidelity">(null);
  const [review, setReview] = useState<FidelityReview | null>(() =>
    storedReview(generation.review),
  );
  const done = generation.status === "completed";
  const approved = generation.reviewStatus === "approved";

  async function act(kind: "approve" | "regenerate", fn: () => Promise<boolean>) {
    setBusy(kind);
    try {
      const success = await fn();
      if (success) onOpenChange(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
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
            {approved ? (
              <Badge variant="success" className="h-9 justify-center text-sm">
                <BadgeCheck aria-hidden />
                {t("approved")}
              </Badge>
            ) : null}
            {onApprove && !approved ? (
              <Button
                disabled={!done || busy !== null}
                onClick={() => void act("approve", onApprove)}
              >
                {busy === "approve" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <BadgeCheck aria-hidden />
                )}
                {t("approve")}
              </Button>
            ) : null}
            {onRegenerate ? (
              <>
                <Button
                  variant="glass"
                  disabled={
                    busy !== null ||
                    generation.status === "queued" ||
                    generation.status === "in_progress"
                  }
                  onClick={() => void act("regenerate", () => onRegenerate(null))}
                >
                  {busy === "regenerate" && !noteOpen ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <RefreshCw aria-hidden />
                  )}
                  {t("regenerate")}
                </Button>
                <Button
                  variant="glass"
                  disabled={busy !== null}
                  onClick={() => setNoteOpen((value) => !value)}
                >
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
                      disabled={!note.trim() || busy !== null}
                      onClick={() => void act("regenerate", () => onRegenerate(note.trim()))}
                    >
                      {busy === "regenerate" ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw aria-hidden />
                      )}
                      {t("send")}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            <Button
              variant="outline"
              disabled={!done || busy !== null || !generation.mimeType?.startsWith("image/")}
              onClick={async () => {
                setBusy("fidelity");
                const result = await checkFidelity(generation.id);
                setBusy(null);
                if (!result.ok) toast.error(result.error);
                else setReview(result.data);
              }}
            >
              {busy === "fidelity" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <ScanSearch aria-hidden />
              )}
              {t("fidelityCheck")}
            </Button>
            {review ? (
              <div className="rounded-2xl bg-muted p-3 text-sm">
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
      </DialogContent>
    </Dialog>
  );
}
