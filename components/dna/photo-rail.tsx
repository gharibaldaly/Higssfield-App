"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { StorageImage } from "@/components/generation/generation-media";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PhotoView } from "@/lib/products/queries";

/** Original photos beside the editor, so every field is checked against reality. */
export function PhotoRail({
  photos,
  pieces,
}: {
  photos: PhotoView[];
  pieces: { id: string; name: string }[];
}) {
  const t = useTranslations("dna.rail");
  const tk = useTranslations("products.photos.kinds");
  const [open, setOpen] = useState<PhotoView | null>(null);
  return (
    <div className="flex flex-col gap-5">
      {pieces.map((piece) => {
        const list = photos.filter((photo) => photo.pieceId === piece.id);
        return (
          <div key={piece.id}>
            <p className="mb-2 hud text-muted-foreground">{piece.name}</p>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noPhotos")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {list.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    onClick={() => setOpen(photo)}
                    className="group relative overflow-hidden rounded-(--radius-control) stage focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={[tk(photo.kind), photo.label].filter(Boolean).join(" · ")}
                  >
                    {/* The button carries the name; the thumbnail and caption only repeat it. */}
                    <StorageImage
                      src={photo.url}
                      alt=""
                      fit="cover"
                      className="aspect-square w-full"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-x-1 bottom-1 truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white"
                    >
                      {photo.label || tk(photo.kind)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle>{open ? open.label || tk(open.kind) : ""}</DialogTitle>
          {open ? (
            <StorageImage
              src={open.url}
              alt={open.label ?? tk(open.kind)}
              className="max-h-[75dvh] w-full rounded-(--radius-control) stage"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
