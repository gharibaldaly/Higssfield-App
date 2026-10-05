"use client";

import { Download, Heart, ImagePlus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { GenerationMedia } from "@/components/generation/generation-media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setGenerationFavorite } from "@/lib/actions/generations";
import type { GenerationView } from "@/lib/domain/generation";
import type { FreeItem } from "@/lib/generations/free";
import { cn } from "@/lib/utils";

function aspectStyle(aspectRatio: string | null, kind: "image" | "video"): React.CSSProperties {
  const match = aspectRatio ? /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(aspectRatio) : null;
  if (match) return { aspectRatio: `${match[1]} / ${match[2]}` };
  return { aspectRatio: kind === "video" ? "16 / 9" : "1 / 1" };
}

/** One free generation: the result on the grey stage, what was asked for, and what to do next. */
export function FreeResultCard({
  item,
  view,
  onReuse,
  onUseAsReference,
}: {
  item: FreeItem;
  /** The live view (polled), which may be newer than the item's own. */
  view: GenerationView;
  onReuse: (item: FreeItem) => void;
  onUseAsReference: ((item: FreeItem, view: GenerationView) => void) | null;
}) {
  const t = useTranslations("free.result");
  const [favorite, setFavorite] = useState(view.isFavorite);
  const [expanded, setExpanded] = useState(false);
  const completed = view.status === "completed";

  async function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    const result = await setGenerationFavorite(view.id, next);
    if (!result.ok) {
      setFavorite(!next);
      toast.error(result.error);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-(--radius-panel) p-3 surface">
      <div className="relative w-full" style={aspectStyle(item.aspectRatio, view.kind)}>
        <GenerationMedia view={view} alt={item.prompt.slice(0, 120)} className="size-full" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="muted">{item.modelLabel}</Badge>
        {item.aspectRatio ? (
          <Badge variant="outline" dir="ltr">
            {item.aspectRatio}
          </Badge>
        ) : null}
        {item.resolution ? (
          <Badge variant="outline" dir="ltr">
            {item.resolution}
          </Badge>
        ) : null}
        {item.durationS ? (
          <Badge variant="outline" dir="ltr">
            {item.durationS}s
          </Badge>
        ) : null}
        {view.cost !== null ? (
          <Badge variant="outline" dir="ltr">
            {view.costUnit === "usd" ? `$${view.cost.toFixed(2)}` : `${view.cost} cr`}
          </Badge>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "text-start text-xs leading-relaxed text-muted-foreground",
          !expanded && "line-clamp-2",
        )}
        aria-expanded={expanded}
        title={t("togglePrompt")}
      >
        {item.prompt}
      </button>
      {item.negativePrompt && expanded ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{t("negative")}:</span> {item.negativePrompt}
        </p>
      ) : null}
      {item.referenceUrls.length > 0 ? (
        <ul className="flex gap-1" aria-label={t("references")}>
          {item.referenceUrls.map((url, index) => (
            <li key={url} className="size-9 overflow-hidden rounded-md stage">
              <img
                src={url}
                alt={t("reference", { number: index + 1 })}
                className="size-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => onReuse(item)}>
          <RotateCcw aria-hidden />
          {t("reuse")}
        </Button>
        {onUseAsReference && completed && view.kind === "image" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onUseAsReference(item, view)}
          >
            <ImagePlus aria-hidden />
            {t("useAsReference")}
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void toggleFavorite()}
          aria-pressed={favorite}
          aria-label={favorite ? t("unfavorite") : t("favorite")}
        >
          <Heart className={cn(favorite && "fill-[#ff6a9a] text-[#ff6a9a]")} aria-hidden />
        </Button>
        {completed && item.downloadUrl ? (
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={item.downloadUrl} aria-label={t("download")}>
              <Download aria-hidden />
            </a>
          </Button>
        ) : completed && view.url ? (
          <Button variant="ghost" size="icon-sm" asChild>
            <a href={view.url} target="_blank" rel="noreferrer" aria-label={t("open")}>
              <Download aria-hidden />
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
