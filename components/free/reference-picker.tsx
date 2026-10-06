"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isAcceptedPhoto, uploadToStudio } from "@/lib/client/upload";
import { storagePaths } from "@/lib/storage/paths";
import { cn } from "@/lib/utils";

/** A reference on the form: uploaded to Storage, shown from a local preview or a signed link. */
export type FreeReference = {
  id: string;
  path: string;
  url: string;
  name: string;
};

/**
 * The references for a free generation. Files upload straight to the
 * owner's folder in Storage (as product photos do) and are listed in order;
 * the first ones are what a model with a smaller cap receives.
 */
export function ReferencePicker({
  ownerId,
  references,
  onChange,
  max,
  modelMax,
}: {
  ownerId: string;
  references: FreeReference[];
  onChange: (next: FreeReference[]) => void;
  /** Uploads allowed on the form. */
  max: number;
  /** What the chosen model takes; null when it takes none. */
  modelMax: number | null;
}) {
  const t = useTranslations("free.references");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const latest = useRef(references);
  useEffect(() => {
    latest.current = references;
  }, [references]);

  async function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const room = max - latest.current.length;
    const accepted = files.filter(isAcceptedPhoto);
    if (accepted.length < files.length) toast.warning(t("rejected"));
    const chosen = accepted.slice(0, Math.max(0, room));
    if (chosen.length < accepted.length) toast.warning(t("max", { count: max }));
    setUploading(chosen.length);
    for (const file of chosen) {
      try {
        const id = crypto.randomUUID();
        const path = storagePaths.freeReference(ownerId, id, file.type);
        await uploadToStudio(path, file, file.type);
        onChange([
          ...latest.current,
          { id, path, url: URL.createObjectURL(file), name: file.name },
        ]);
      } catch (error) {
        toast.error(t("uploadFailed", { name: file.name }), {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  const over = modelMax !== null && references.length > modelMax;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{t("title")}</span>
        <span className="hud text-muted-foreground" dir="ltr">
          {references.length} / {modelMax ?? max}
        </span>
      </div>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {references.map((reference, index) => (
          <li
            key={reference.id}
            className={cn(
              "group relative aspect-square overflow-hidden rounded-(--radius-control) stage",
              modelMax !== null && index >= modelMax && "opacity-40",
            )}
          >
            <img
              src={reference.url}
              alt={reference.name}
              className="size-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <span className="absolute start-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">
              {index + 1}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="absolute end-1 top-1 size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={t("remove", { name: reference.name })}
              onClick={() => {
                URL.revokeObjectURL(reference.url);
                onChange(references.filter((candidate) => candidate.id !== reference.id));
              }}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          </li>
        ))}
        {references.length < max ? (
          <li className="aspect-square">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void addFiles(event.dataTransfer.files);
              }}
              disabled={uploading > 0}
              className={cn(
                "flex size-full flex-col items-center justify-center gap-1 rounded-(--radius-control) border border-dashed border-border-strong bg-[repeating-linear-gradient(135deg,transparent_0_9px,var(--muted)_9px_10px)] text-center text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait",
                dragging && "border-ring bg-highlight text-foreground",
              )}
            >
              {uploading > 0 ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-5" aria-hidden />
              )}
              <span className="text-[11px] font-medium">
                {uploading > 0 ? t("uploading", { count: uploading }) : t("add")}
              </span>
            </button>
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-muted-foreground">
        {over && modelMax !== null ? t("overModel", { count: modelMax }) : t("hint")}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
