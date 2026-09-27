"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  onWakeGhostRunner,
  publishRunner,
  useRunnerState,
} from "@/components/ghost-batch/runner-store";
import type { GhostWorkReport } from "@/lib/ghost-batches/schemas";

const ERROR_BACKOFF_MS = 15_000;
const MAX_ERRORS = 3;

function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (signal.stopped || Date.now() - started >= ms) resolve();
      else setTimeout(tick, Math.min(500, ms));
    };
    tick();
  });
}

/**
 * Drives the owner's ghost batches from the browser: while a studio tab is
 * open it asks the server for one unit of work at a time (analyse a model,
 * write a job's prompts, settle results, render colours, check fidelity).
 * Mounted once in the studio layout, so it keeps going across pages.
 */
export function GhostBatchRunner({ active }: { active: boolean }) {
  const t = useTranslations("ghostBatch.runner");
  const pathname = usePathname();
  const loop = useRef<{ stopped: boolean } | null>(null);
  const started = useRef(false);
  const { running, report } = useRunnerState();

  const run = useRef<() => void>(() => undefined);
  useEffect(() => {
    run.current = () => {
      if (loop.current && !loop.current.stopped) return;
      const signal = { stopped: false };
      loop.current = signal;
      started.current = true;
      publishRunner({ running: true });
      void (async () => {
        let errors = 0;
        while (!signal.stopped) {
          try {
            const response = await fetch("/api/ghost-batches/advance", {
              method: "POST",
              cache: "no-store",
            });
            if (response.status === 401) break;
            const payload = (await response.json()) as Partial<GhostWorkReport>;
            if (!response.ok || !payload.step) {
              throw new Error(payload.error ?? `HTTP ${response.status}`);
            }
            const report = payload as GhostWorkReport;
            errors = 0;
            publishRunner({ report, lastStepAt: Date.now() });
            if (report.error) {
              toast.error(report.modelName ?? t("title"), { description: report.error });
            }
            if (report.step === "idle") break;
            if (report.retryInMs > 0) await sleep(report.retryInMs, signal);
          } catch (error) {
            errors += 1;
            if (errors >= MAX_ERRORS) {
              toast.error(t("stopped"), {
                description: error instanceof Error ? error.message : undefined,
              });
              break;
            }
            await sleep(ERROR_BACKOFF_MS, signal);
          }
        }
        signal.stopped = true;
        publishRunner({ running: false });
      })();
    };
  }, [t]);

  // Start when the layout knows a batch is running, and whenever a page asks.
  useEffect(() => {
    if (active) run.current();
    return onWakeGhostRunner(() => run.current());
  }, [active]);

  // What is runnable can change on other pages (a DNA approved, a front approved):
  // once batches have run in this tab, look again after each navigation.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    if (active || started.current) run.current();
  }, [pathname, active]);

  useEffect(
    () => () => {
      if (loop.current) loop.current.stopped = true;
    },
    [],
  );

  if (!running || !report || report.step === "idle" || !report.batchId) return null;
  const label =
    report.step === "waiting"
      ? t("waiting")
      : t(`steps.${report.step}`, { model: report.modelName ?? "" });
  return (
    <Link
      href={`/ghost?batch=${report.batchId}`}
      className="fixed end-4 bottom-4 z-40 flex max-w-[min(26rem,calc(100vw-2rem))] items-center gap-3 rounded-full py-2 ps-3 pe-4 text-sm surface-raised transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Loader2 className="size-4 shrink-0 animate-spin text-accent-ink" aria-hidden />
      <span className="min-w-0 flex-1" aria-live="polite">
        <span className="block truncate font-medium">{report.batchName}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
      <span className="shrink-0 hud text-muted-foreground" dir="ltr">
        {report.done}/{report.total}
      </span>
    </Link>
  );
}
