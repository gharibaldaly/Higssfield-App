"use client";

import { Loader2, Scissors } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NormalizedRect, SheetCard } from "@/lib/sheet/layout";
import { clamp, cn } from "@/lib/utils";

type Box = { cardId: string; label: string; rect: NormalizedRect };

/**
 * Drag a box to move it, drag its corner handle to resize. Coordinates stay
 * normalised to the sheet image, so the server can re-crop at full resolution.
 */
export function CropEditor({
  open,
  onOpenChange,
  imageUrl,
  cards,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  cards: SheetCard[];
  onSave: (boxes: Box[]) => Promise<void>;
}) {
  const t = useTranslations("sheet.crops");
  const containerRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>(() =>
    cards
      .filter((card) => card.imageRect && card.cropKind)
      .map((card) => ({ cardId: card.id, label: card.label ?? card.id, rect: card.imageRect! })),
  );
  const [active, setActive] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{
    cardId: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: NormalizedRect;
  } | null>(null);

  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const dx = (event.clientX - state.startX) / rect.width;
    const dy = (event.clientY - state.startY) / rect.height;
    setBoxes((current) =>
      current.map((box) => {
        if (box.cardId !== state.cardId) return box;
        if (state.mode === "move") {
          return {
            ...box,
            rect: {
              ...state.start,
              x: clamp(state.start.x + dx, 0, 1 - state.start.w),
              y: clamp(state.start.y + dy, 0, 1 - state.start.h),
            },
          };
        }
        return {
          ...box,
          rect: {
            ...state.start,
            w: clamp(state.start.w + dx, 0.02, 1 - state.start.x),
            h: clamp(state.start.h + dy, 0.02, 1 - state.start.y),
          },
        };
      }),
    );
  }

  function start(event: React.PointerEvent, box: Box, mode: "move" | "resize") {
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = {
      cardId: box.cardId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      start: box.rect,
    };
    setActive(box.cardId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("adjust")}</DialogTitle>
          <DialogDescription>{t("adjustHint")}</DialogDescription>
        </DialogHeader>
        <div
          ref={containerRef}
          dir="ltr"
          className="relative w-full touch-none overflow-hidden rounded-(--radius-control) select-none"
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <img src={imageUrl} alt="" className="block w-full" draggable={false} />
          {boxes.map((box) => (
            <div
              key={box.cardId}
              onPointerDown={(event) => start(event, box, "move")}
              className={cn(
                "absolute cursor-move border-2 bg-[color-mix(in_srgb,var(--veil)_14%,transparent)]",
                active === box.cardId ? "border-veil" : "border-white/80",
              )}
              style={{
                left: `${box.rect.x * 100}%`,
                top: `${box.rect.y * 100}%`,
                width: `${box.rect.w * 100}%`,
                height: `${box.rect.h * 100}%`,
              }}
            >
              <span className="absolute top-0 left-0 max-w-full truncate bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                {box.label}
              </span>
              <span
                onPointerDown={(event) => start(event, box, "resize")}
                className="absolute -right-1.5 -bottom-1.5 size-4 cursor-nwse-resize rounded-full border-2 border-black bg-white"
                aria-hidden
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(boxes);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Scissors aria-hidden />}
            {t("recrop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
