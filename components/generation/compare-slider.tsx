"use client";

import { MoveHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Side-by-side compare with a draggable divider: original on the reading
 * start side, result on the end side (mirrors for Arabic). Keyboard: ←/→,
 * Home/End. Both images are shown with object-contain so nothing is cropped.
 */
export function CompareSlider({
  before,
  after,
  beforeLabel,
  afterLabel,
  className,
  background = "transparent",
}: {
  before: string | null;
  after: string | null;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
  background?: string;
}) {
  const t = useTranslations("compare");
  const rtl = useLocale() === "ar";
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      let ratio = ((clientX - rect.left) / rect.width) * 100;
      if (rtl) ratio = 100 - ratio;
      setPosition(Math.max(0, Math.min(100, ratio)));
    },
    [rtl],
  );

  // "Before" occupies the start side up to `position`.
  const clip = rtl ? `inset(0 0 0 ${100 - position}%)` : `inset(0 ${100 - position}% 0 0)`;
  const divider = rtl ? { right: `${position}%` } : { left: `${position}%` };

  return (
    <div
      ref={containerRef}
      className={cn(
        "crop-marks relative aspect-[4/5] w-full touch-none overflow-hidden rounded-[14px] select-none",
        className,
      )}
      style={{ background }}
      onPointerDown={(event) => {
        dragging.current = true;
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        update(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) update(event.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {after ? (
        <img
          src={after}
          alt={afterLabel ?? t("result")}
          className="absolute inset-0 size-full object-contain"
          draggable={false}
        />
      ) : null}
      {before ? (
        <img
          src={before}
          alt={beforeLabel ?? t("original")}
          className="absolute inset-0 size-full object-contain"
          style={{ clipPath: clip }}
          draggable={false}
        />
      ) : null}
      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.4)]"
        style={divider}
      >
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("slider")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 2;
            const forward = rtl ? "ArrowLeft" : "ArrowRight";
            const backward = rtl ? "ArrowRight" : "ArrowLeft";
            if (event.key === forward) setPosition((value) => Math.min(100, value + step));
            else if (event.key === backward) setPosition((value) => Math.max(0, value - step));
            else if (event.key === "Home") setPosition(0);
            else if (event.key === "End") setPosition(100);
            else return;
            event.preventDefault();
          }}
          className="pointer-events-auto absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-white text-black shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span
            aria-hidden
            className="absolute inset-1 rounded-full border border-dashed border-black/40"
          />
          <MoveHorizontal className="size-4" aria-hidden />
        </div>
      </div>
      <span className="absolute start-5 top-5 z-[2] rounded-full bg-black/60 px-2.5 py-1 hud text-white backdrop-blur">
        {beforeLabel ?? t("original")}
      </span>
      <span className="absolute end-5 top-5 z-[2] rounded-full bg-black/60 px-2.5 py-1 hud text-white backdrop-blur">
        {afterLabel ?? t("result")}
      </span>
    </div>
  );
}
