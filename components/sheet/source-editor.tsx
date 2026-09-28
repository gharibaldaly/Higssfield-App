"use client";

import { Loader2, Save } from "lucide-react";
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
import type { NormalizedRect } from "@/lib/sheet/layout";
import { clamp, cn } from "@/lib/utils";

export type EditorCard = {
  id: string;
  label: string;
  /** Detail and fabric cards look closely; the others show a whole view. */
  closeUp: boolean;
  /** A set's pieces card is built from each piece's front photo and is not edited here. */
  editable: boolean;
  source: { path: string; box: NormalizedRect } | null;
};

export type EditorPhoto = { path: string; url: string | null; label: string };

type Draft = Record<string, { path: string; box: NormalizedRect }>;

const WHOLE: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };
const MIDDLE: NormalizedRect = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

/**
 * For each card of a sheet built from photos: which photo it shows and the
 * box on it. Drag the box to move it, drag its round handle to resize it.
 * Boxes stay normalised to the photo, so the server cuts at full resolution.
 */
export function SourceEditor({
  open,
  onOpenChange,
  cards,
  photos,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: EditorCard[];
  photos: EditorPhoto[];
  onSave: (changes: { cardId: string; path: string; box: NormalizedRect }[]) => Promise<void>;
}) {
  const t = useTranslations("sheet.editor");
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      cards.flatMap((card) => (card.editable && card.source ? [[card.id, card.source]] : [])),
    ),
  );
  const [activeId, setActiveId] = useState(
    () => cards.find((card) => card.editable)?.id ?? cards[0]?.id ?? "",
  );
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: NormalizedRect;
  } | null>(null);

  const active = cards.find((card) => card.id === activeId) ?? null;
  const current = active ? draft[active.id] : undefined;
  const photoUrl = current
    ? (photos.find((photo) => photo.path === current.path)?.url ?? null)
    : null;

  function setBox(box: NormalizedRect) {
    if (!active || !current) return;
    setDraft((previous) => ({ ...previous, [active.id]: { path: current.path, box } }));
  }

  function choosePhoto(path: string) {
    if (!active?.editable) return;
    setDraft((previous) => ({
      ...previous,
      [active.id]: {
        path,
        box: previous[active.id]?.box ?? (active.closeUp ? MIDDLE : WHOLE),
      },
    }));
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const dx = (event.clientX - state.startX) / rect.width;
    const dy = (event.clientY - state.startY) / rect.height;
    if (state.mode === "move") {
      setBox({
        ...state.start,
        x: clamp(state.start.x + dx, 0, 1 - state.start.w),
        y: clamp(state.start.y + dy, 0, 1 - state.start.h),
      });
    } else {
      setBox({
        ...state.start,
        w: clamp(state.start.w + dx, 0.02, 1 - state.start.x),
        h: clamp(state.start.h + dy, 0.02, 1 - state.start.y),
      });
    }
  }

  function start(event: React.PointerEvent, mode: "move" | "resize") {
    if (!current) return;
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, start: current.box };
  }

  const changes = cards.flatMap((card) => {
    const edited = draft[card.id];
    if (!card.editable || !edited) return [];
    const same =
      card.source?.path === edited.path &&
      JSON.stringify(card.source.box) === JSON.stringify(edited.box);
    return same ? [] : [{ cardId: card.id, path: edited.path, box: edited.box }];
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label={t("cards")} className="flex flex-wrap gap-2 md:flex-col">
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setActiveId(card.id)}
                aria-pressed={card.id === activeId}
                className={cn(
                  "rounded-(--radius-control) border px-3 py-2 text-start text-sm transition-colors",
                  card.id === activeId
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                {card.label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-col gap-3">
            {active && !active.editable ? (
              <p className="text-sm text-muted-foreground">{t("setCard")}</p>
            ) : current && photoUrl ? (
              <div className="flex justify-center rounded-(--radius-control) stage p-2">
                <div
                  ref={containerRef}
                  dir="ltr"
                  className="relative inline-block touch-none select-none"
                  onPointerMove={onPointerMove}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                >
                  <img
                    src={photoUrl}
                    alt=""
                    className="block max-h-[60vh] w-auto max-w-full"
                    draggable={false}
                  />
                  <div
                    onPointerDown={(event) => start(event, "move")}
                    className="absolute cursor-move border-2 border-veil bg-[color-mix(in_srgb,var(--veil)_14%,transparent)]"
                    style={{
                      left: `${current.box.x * 100}%`,
                      top: `${current.box.y * 100}%`,
                      width: `${current.box.w * 100}%`,
                      height: `${current.box.h * 100}%`,
                    }}
                  >
                    <span
                      onPointerDown={(event) => start(event, "resize")}
                      className="absolute -right-1.5 -bottom-1.5 size-4 cursor-nwse-resize rounded-full border-2 border-black bg-white"
                      aria-hidden
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noPhoto")}</p>
            )}
            {active?.editable ? (
              <div>
                <p className="mb-2 hud text-muted-foreground">{t("photos")}</p>
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((photo) => (
                    <li key={photo.path} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => choosePhoto(photo.path)}
                        aria-pressed={current?.path === photo.path}
                        title={photo.label}
                        className={cn(
                          "block overflow-hidden rounded-(--radius-control) border-2 stage",
                          current?.path === photo.path ? "border-veil" : "border-transparent",
                        )}
                      >
                        {photo.url ? (
                          <img
                            src={photo.url}
                            alt={photo.label}
                            className="size-16 object-cover"
                            draggable={false}
                          />
                        ) : (
                          <span className="block size-16" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={saving || changes.length === 0}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(changes);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
