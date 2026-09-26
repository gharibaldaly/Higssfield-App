"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/common/confirm-dialog";
import { StorageImage } from "@/components/generation/generation-media";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { deletePhotoAction, updatePhotoAction } from "@/lib/actions/products";
import { PHOTO_KINDS, type PhotoKind } from "@/lib/domain/product";
import type { PhotoView } from "@/lib/products/queries";

export function PhotoTile({ photo, productId }: { photo: PhotoView; productId: string }) {
  const t = useTranslations("products.photos");
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(photo.label ?? "");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error);
      else {
        if (success) toast.success(success);
        router.refresh();
      }
    });
  }

  return (
    <figure className="group relative">
      <StorageImage
        src={photo.url}
        alt={photo.label ?? t(`kinds.${photo.kind}`)}
        fit="cover"
        className="aspect-square w-full rounded-(--radius-control) stage"
      />
      {photo.label ? (
        <figcaption className="mt-1.5 truncate text-xs text-muted-foreground" title={photo.label}>
          {photo.label}
        </figcaption>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="surface"
            size="icon-sm"
            className="absolute end-2 top-2 size-8 opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
            aria-label={t("actions")}
            disabled={pending}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("moveTo")}</DropdownMenuLabel>
          {PHOTO_KINDS.filter((kind) => kind !== photo.kind).map((kind: PhotoKind) => (
            <DropdownMenuItem
              key={kind}
              onSelect={() => run(() => updatePhotoAction({ photoId: photo.id, productId, kind }))}
            >
              {t(`kinds.${kind}`)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t("editLabel")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={async () => {
              const confirmed = await confirm({
                title: t("confirmDelete"),
                confirmLabel: t("delete"),
                destructive: true,
              });
              if (confirmed) run(() => deletePhotoAction(photo.id, productId), t("deleted"));
            }}
          >
            <Trash2 aria-hidden />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editLabel")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`label-${photo.id}`}>{t("label")}</Label>
            <Input
              id={`label-${photo.id}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={200}
              placeholder={t("labelPlaceholder")}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await updatePhotoAction({
                    photoId: photo.id,
                    productId,
                    label: label.trim() || null,
                  });
                  if (result.ok) setEditing(false);
                  return result;
                })
              }
            >
              {t("saveLabel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </figure>
  );
}
