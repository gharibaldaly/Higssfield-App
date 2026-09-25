"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { registerPhotoAction } from "@/lib/actions/products";
import {
  extensionForType,
  isAcceptedPhoto,
  readImageSize,
  uploadToStudio,
} from "@/lib/client/upload";
import type { PhotoKind } from "@/lib/domain/product";
import { cn } from "@/lib/utils";

export function PhotoDropzone({
  ownerId,
  productId,
  pieceId,
  kind,
  compact = false,
}: {
  ownerId: string;
  productId: string;
  pieceId: string;
  kind: PhotoKind;
  compact?: boolean;
}) {
  const t = useTranslations("products.photos");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const accepted = files.filter(isAcceptedPhoto);
    if (accepted.length < files.length) toast.warning(t("rejected"));
    setUploading(accepted.length);
    let done = 0;
    for (const file of accepted) {
      try {
        const id = crypto.randomUUID();
        const path = `${ownerId}/products/${productId}/sources/${id}.${extensionForType(file.type)}`;
        const size = await readImageSize(file);
        await uploadToStudio(path, file, file.type);
        const result = await registerPhotoAction({
          productId,
          pieceId,
          kind,
          storagePath: path,
          mimeType: file.type,
          width: size?.width,
          height: size?.height,
          sizeBytes: file.size,
          label: kind === "detail" ? file.name.replace(/\.[^.]+$/, "").slice(0, 80) : undefined,
        });
        if (!result.ok) throw new Error(result.error);
        done += 1;
      } catch (error) {
        toast.error(t("uploadFailed", { name: file.name }), {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setUploading((count) => count - 1);
      }
    }
    if (done > 0) {
      toast.success(t("uploaded", { count: done }));
      router.refresh();
    }
  }

  return (
    // `contents` keeps the button as the grid item; the file input is a hidden sibling because
    // an input nested inside a button is unreachable for assistive technology.
    <div className="contents">
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
          void handleFiles(event.dataTransfer.files);
        }}
        disabled={uploading > 0}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-input text-center text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait",
          compact ? "aspect-square p-2" : "min-h-32 p-5",
          dragging && "border-ring bg-muted text-foreground",
        )}
      >
        {uploading > 0 ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : (
          <ImagePlus className="size-5" aria-hidden />
        )}
        <span className="text-xs font-medium">
          {uploading > 0
            ? t("uploading", { count: uploading })
            : compact
              ? t("addShort")
              : t("add")}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={kind === "detail"}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
