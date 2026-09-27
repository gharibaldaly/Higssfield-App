"use client";

import { Pipette } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { sampleAt } from "@/lib/client/color";

/**
 * Click anywhere on the photo to sample its colour (averaged over a few
 * pixels). Returns the hex and the normalised point that was sampled.
 */
export function Eyedropper({
  src,
  onPick,
  value,
}: {
  src: string;
  onPick: (hex: string, point: { x: number; y: number }) => void;
  value: { hex: string; point: { x: number; y: number } } | null;
}) {
  const t = useTranslations("colorways.eyedropper");
  const [busy, setBusy] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="relative block w-full cursor-crosshair overflow-hidden rounded-(--radius-control) stage"
        disabled={busy}
        onClick={async (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const image = event.currentTarget.querySelector("img");
          if (!image) return;
          // Map the click to the displayed image area (object-contain letterbox).
          const ratio = image.naturalWidth / image.naturalHeight;
          const boxRatio = rect.width / rect.height;
          const shownWidth = ratio > boxRatio ? rect.width : rect.height * ratio;
          const shownHeight = ratio > boxRatio ? rect.width / ratio : rect.height;
          const offsetX = (rect.width - shownWidth) / 2;
          const offsetY = (rect.height - shownHeight) / 2;
          const x = (event.clientX - rect.left - offsetX) / shownWidth;
          const y = (event.clientY - rect.top - offsetY) / shownHeight;
          if (x < 0 || x > 1 || y < 0 || y > 1) return;
          setBusy(true);
          try {
            const hex = await sampleAt(src, { x, y });
            onPick(hex, { x, y });
          } catch {
            toast.error(t("failed"));
          } finally {
            setBusy(false);
          }
        }}
        aria-label={t("instruction")}
      >
        <img
          src={src}
          alt=""
          crossOrigin="anonymous"
          className="max-h-[50dvh] w-full object-contain"
          draggable={false}
        />
        {value ? (
          <span
            className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg"
            style={{
              left: `${value.point.x * 100}%`,
              top: `${value.point.y * 100}%`,
              background: value.hex,
            }}
          />
        ) : null}
      </button>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Pipette className="size-3.5" aria-hidden />
        {t("instruction")}
      </p>
    </div>
  );
}
