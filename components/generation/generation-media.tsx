"use client";

import { AlertTriangle, FlaskConical, ImageOff, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useNow, useTranslations } from "next-intl";
import { useState } from "react";

import { Elapsed } from "@/components/generation/elapsed";
import { Progress } from "@/components/ui/controls";
import type { GenerationView } from "@/lib/domain/generation";
import { cn } from "@/lib/utils";

/** Rough expected durations, used only for the progress bar feel. */
const EXPECTED_MS = { image: 60_000, video: 180_000 } as const;

function progressFor(view: GenerationView, now: Date): number {
  if (!view.submittedAt) return 4;
  const elapsed = now.getTime() - Date.parse(view.submittedAt);
  const expected = EXPECTED_MS[view.kind];
  // Ease towards 92% so the bar never claims to be done before it is.
  return Math.min(92, 8 + (elapsed / expected) * 84);
}

export function isStillImage(view: Pick<GenerationView, "mimeType">): boolean {
  return !view.mimeType || view.mimeType.startsWith("image/");
}

/** Plain <img> so the owner sees original pixels (no re-encoding). */
export function StorageImage({
  src,
  alt,
  className,
  fit = "contain",
}: {
  src: string | null;
  alt: string;
  className?: string;
  fit?: "contain" | "cover";
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("grid place-items-center stage text-muted-foreground", className)}>
        <ImageOff className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden", className)}>
      {!loaded ? <div className="absolute inset-0 shimmer stage" /> : null}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "size-full transition-opacity duration-500",
          fit === "contain" ? "object-contain" : "object-cover",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/** A generation result with rich pending / failed states. */
export function GenerationMedia({
  view,
  alt,
  className,
  queuePosition,
  fit = "contain",
  controls = true,
}: {
  view: GenerationView;
  alt: string;
  className?: string;
  queuePosition?: number | null;
  fit?: "contain" | "cover";
  controls?: boolean;
}) {
  const t = useTranslations("generation");
  const now = useNow({ updateInterval: 5_000 });
  const pending = view.status === "queued" || view.status === "in_progress";
  const failed = view.status === "failed" || view.status === "nsfw" || view.status === "canceled";
  return (
    // Results sit on the neutral grey stage so the garment's colour reads true.
    <div
      className={cn(
        "relative overflow-hidden rounded-[14px] stage",
        !pending && !failed && "crop-marks",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.div
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
          >
            <div className="absolute inset-0 shimmer opacity-60" />
            <Loader2 className="relative size-6 animate-spin text-accent-ink" aria-hidden />
            <p className="relative text-sm font-medium">
              {view.status === "queued" ? t("status.queued") : t("status.in_progress")}
            </p>
            <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
              <Elapsed since={view.submittedAt ?? view.createdAt} />
              {typeof queuePosition === "number" && queuePosition > 0 ? (
                <span>· {t("queuePosition", { position: queuePosition })}</span>
              ) : null}
            </div>
            <Progress
              className="relative w-2/3 max-w-40"
              value={progressFor(view, now)}
              aria-label={t("progress")}
            />
          </motion.div>
        ) : failed ? (
          <motion.div
            key="failed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center"
          >
            <AlertTriangle className="size-6 text-destructive" aria-hidden />
            <p className="text-sm font-medium">{t(`status.${view.status}`)}</p>
            {view.error ? (
              <p className="line-clamp-4 text-xs text-muted-foreground">{view.error}</p>
            ) : null}
          </motion.div>
        ) : (
          <motion.div
            key="done"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0"
          >
            {view.kind === "video" && !isStillImage(view) && view.url ? (
              <video
                src={view.url}
                className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover")}
                controls={controls}
                muted
                loop
                playsInline
                preload="metadata"
              />
            ) : (
              <StorageImage src={view.url} alt={alt} fit={fit} className="size-full" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {view.provider === "mock" && view.status === "completed" ? (
        <span className="absolute start-3 bottom-3 z-[2] inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          <FlaskConical className="size-3" aria-hidden />
          {view.kind === "video" ? t("mockVideo") : t("mock")}
        </span>
      ) : null}
    </div>
  );
}
