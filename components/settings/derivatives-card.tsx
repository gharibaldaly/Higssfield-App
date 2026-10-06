"use client";

import { Images, Loader2, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/common/post-json";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActionResult } from "@/lib/errors";
import type { BackfillCursor, BackfillStep } from "@/lib/storage/backfill";

type StepAnswer = BackfillStep & { total: number | null };

type Progress = {
  processed: number;
  made: number;
  skipped: number;
  failed: number;
  total: number | null;
};

/**
 * Makes the small copies (tiles, references) for the files stored before the
 * studio made them on its own. The browser calls the route page after page
 * with the cursor it returns, so the owner can watch and stop it.
 */
export function DerivativesCard() {
  const t = useTranslations("settings.derivatives");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [done, setDone] = useState(false);
  const stopped = useRef(false);

  async function run() {
    setRunning(true);
    setDone(false);
    stopped.current = false;
    const sum: Progress = { processed: 0, made: 0, skipped: 0, failed: 0, total: null };
    setProgress({ ...sum });
    try {
      let cursor: BackfillCursor | null = null;
      do {
        const result: ActionResult<StepAnswer> = await postJson("/api/storage/derivatives", {
          cursor,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        sum.processed += result.data.processed;
        sum.made += result.data.made;
        sum.skipped += result.data.skipped;
        sum.failed += result.data.failed;
        if (result.data.total !== null) sum.total = result.data.total;
        setProgress({ ...sum });
        cursor = result.data.next;
      } while (cursor && !stopped.current);
      if (!cursor) {
        setDone(true);
        toast.success(t("doneTitle"));
      }
    } finally {
      setRunning(false);
    }
  }

  const line = progress
    ? progress.total === null
      ? t("progressNoTotal", {
          processed: progress.processed,
          made: progress.made,
          skipped: progress.skipped,
          failed: progress.failed,
        })
      : t("progress", {
          processed: progress.processed,
          total: progress.total,
          made: progress.made,
          skipped: progress.skipped,
          failed: progress.failed,
        })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Images className="size-5 text-accent-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="animate-spin" aria-hidden /> : <Images aria-hidden />}
            {running ? t("running") : t("run")}
          </Button>
          {running ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                stopped.current = true;
              }}
            >
              <Square aria-hidden />
              {t("stop")}
            </Button>
          ) : null}
        </div>
        {line ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {line}
            {done ? ` ${t("done")}` : ""}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("egressNote")}</p>
      </CardContent>
    </Card>
  );
}
