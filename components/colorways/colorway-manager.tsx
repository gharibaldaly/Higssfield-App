"use client";

import { ImagePlus, Loader2, Palette, Pipette, Plus, SwatchBook, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { Eyedropper } from "@/components/colorways/eyedropper";
import { StorageImage } from "@/components/generation/generation-media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addColorwayAction,
  deleteColorwayAction,
  updateColorwayAction,
} from "@/lib/actions/colorways";
import { averageColor } from "@/lib/client/color";
import { extensionForType, isAcceptedPhoto, uploadToStudio } from "@/lib/client/upload";
import { cn } from "@/lib/utils";

export type ColorwayView = {
  id: string;
  name: string;
  hex: string;
  source: "swatch" | "eyedropper" | "manual";
  swatchUrl: string | null;
  sampleUrl: string | null;
};

type SourcePhoto = { id: string; url: string | null; storagePath: string; label: string };

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function ColorwayManager({
  ownerId,
  productId,
  colorways,
  photos,
}: {
  ownerId: string;
  productId: string;
  colorways: ColorwayView[];
  photos: SourcePhoto[];
}) {
  const t = useTranslations("colorways");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("intro")}</p>
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </div>
      {colorways.length === 0 ? (
        <EmptyState
          icon={Palette}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              {t("add")}
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {colorways.map((colorway) => (
            <ColorwayCard key={colorway.id} colorway={colorway} productId={productId} />
          ))}
        </ul>
      )}
      <AddColorwayDialog
        open={open}
        onOpenChange={setOpen}
        ownerId={ownerId}
        productId={productId}
        photos={photos}
      />
    </div>
  );
}

function ColorwayCard({ colorway, productId }: { colorway: ColorwayView; productId: string }) {
  const t = useTranslations("colorways");
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(colorway.name);
  const [hex, setHex] = useState(colorway.hex);
  const changed = name !== colorway.name || hex.toUpperCase() !== colorway.hex;
  return (
    <li>
      <Card className="overflow-hidden">
        <div className="relative h-28" style={{ background: colorway.hex }}>
          {colorway.swatchUrl ? (
            <StorageImage
              src={colorway.swatchUrl}
              alt={colorway.name}
              fit="cover"
              className="absolute inset-y-0 end-0 w-1/2"
            />
          ) : null}
          <Badge variant="muted" className="absolute start-2 bottom-2 bg-black/45 text-cream">
            {t(`sources.${colorway.source}`)}
          </Badge>
        </div>
        <CardContent className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={t("name")}
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={HEX.test(hex) ? hex : "#000000"}
              onChange={(event) => setHex(event.target.value.toUpperCase())}
              className="size-9 cursor-pointer rounded-full border-0 bg-transparent p-0"
              aria-label={t("hex")}
            />
            <Input
              value={hex}
              onChange={(event) => setHex(event.target.value)}
              dir="ltr"
              className="font-mono uppercase"
              aria-label={t("hex")}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!changed || pending || !HEX.test(hex)}
              onClick={() =>
                startTransition(async () => {
                  const result = await updateColorwayAction({
                    colorwayId: colorway.id,
                    productId,
                    name,
                    hex,
                  });
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success(t("saved"));
                    router.refresh();
                  }
                })
              }
            >
              {t("save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={async () => {
                const confirmed = await confirm({
                  title: t("confirmDelete"),
                  confirmLabel: t("delete"),
                  destructive: true,
                });
                if (!confirmed) return;
                startTransition(async () => {
                  const result = await deleteColorwayAction(colorway.id, productId);
                  if (!result.ok) toast.error(result.error);
                  else router.refresh();
                });
              }}
            >
              <Trash2 aria-hidden />
              {t("delete")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function AddColorwayDialog({
  open,
  onOpenChange,
  ownerId,
  productId,
  photos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  productId: string;
  photos: SourcePhoto[];
}) {
  const t = useTranslations("colorways");
  const router = useRouter();
  const [mode, setMode] = useState<"swatch" | "eyedropper" | "manual">("swatch");
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#C9A66B");
  const [swatch, setSwatch] = useState<{ path: string; preview: string } | null>(null);
  const [samplePhoto, setSamplePhoto] = useState<SourcePhoto | null>(photos[0] ?? null);
  const [sample, setSample] = useState<{ hex: string; point: { x: number; y: number } } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setHex("#C9A66B");
    setSwatch(null);
    setSample(null);
  }

  async function handleSwatch(file: File | undefined) {
    if (!file) return;
    if (!isAcceptedPhoto(file)) {
      toast.error(t("badFile"));
      return;
    }
    setBusy(true);
    const preview = URL.createObjectURL(file);
    try {
      setHex(await averageColor(preview));
      const path = `${ownerId}/products/${productId}/swatches/${crypto.randomUUID()}.${extensionForType(file.type)}`;
      await uploadToStudio(path, file, file.type);
      setSwatch({ path, preview });
    } catch (error) {
      toast.error(t("uploadFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    const payload =
      mode === "swatch"
        ? { source: "swatch" as const, hex, swatchPath: swatch?.path ?? null }
        : mode === "eyedropper"
          ? {
              source: "eyedropper" as const,
              hex: sample?.hex ?? hex,
              sampleImagePath: samplePhoto?.storagePath ?? null,
              samplePoint: sample?.point ?? null,
            }
          : { source: "manual" as const, hex };
    const result = await addColorwayAction({ productId, name, ...payload });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("added"));
    reset();
    onOpenChange(false);
    router.refresh();
  }

  const effectiveHex = mode === "eyedropper" ? (sample?.hex ?? hex) : hex;
  const ready =
    name.trim().length > 0 &&
    HEX.test(effectiveHex) &&
    (mode !== "swatch" || swatch !== null) &&
    (mode !== "eyedropper" || sample !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("add")}</DialogTitle>
          <DialogDescription>{t("addHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="colorway-name">{t("name")}</Label>
          <Input
            id="colorway-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("namePlaceholder")}
          />
        </div>
        <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
          <TabsList>
            <TabsTrigger value="swatch">
              <SwatchBook aria-hidden />
              {t("sources.swatch")}
            </TabsTrigger>
            <TabsTrigger value="eyedropper">
              <Pipette aria-hidden />
              {t("sources.eyedropper")}
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Palette aria-hidden />
              {t("sources.manual")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="swatch" className="flex flex-col gap-3">
            <label
              className={cn(
                "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-input text-sm text-muted-foreground",
                busy && "cursor-wait",
              )}
            >
              {swatch ? (
                <img
                  src={swatch.preview}
                  alt={t("swatchPreview")}
                  className="max-h-52 w-full object-contain"
                />
              ) : busy ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <>
                  <ImagePlus className="size-5" aria-hidden />
                  {t("uploadSwatch")}
                </>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => void handleSwatch(event.target.files?.[0])}
              />
            </label>
            <p className="text-xs text-muted-foreground">{t("swatchHint")}</p>
          </TabsContent>
          <TabsContent value="eyedropper" className="flex flex-col gap-3">
            {photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPhotos")}</p>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => {
                        setSamplePhoto(photo);
                        setSample(null);
                      }}
                      className={cn(
                        "shrink-0 overflow-hidden rounded-xl border-2",
                        samplePhoto?.id === photo.id ? "border-primary" : "border-transparent",
                      )}
                      aria-label={photo.label}
                    >
                      <StorageImage
                        src={photo.url}
                        alt={photo.label}
                        fit="cover"
                        className="size-16"
                      />
                    </button>
                  ))}
                </div>
                {samplePhoto?.url ? (
                  <Eyedropper
                    src={samplePhoto.url}
                    value={sample}
                    onPick={(pickedHex, point) => setSample({ hex: pickedHex, point })}
                  />
                ) : null}
              </>
            )}
          </TabsContent>
          <TabsContent value="manual">
            <p className="text-sm text-muted-foreground">{t("manualHint")}</p>
          </TabsContent>
        </Tabs>
        <div className="flex items-center gap-3 rounded-2xl bg-muted p-3">
          <span
            className="size-10 shrink-0 rounded-full border border-border"
            style={{ background: HEX.test(effectiveHex) ? effectiveHex : "transparent" }}
          />
          <Input
            value={effectiveHex}
            onChange={(event) => {
              setHex(event.target.value);
              if (mode === "eyedropper" && sample)
                setSample({ ...sample, hex: event.target.value });
            }}
            dir="ltr"
            className="font-mono uppercase"
            aria-label={t("hex")}
          />
          <input
            type="color"
            value={HEX.test(effectiveHex) ? effectiveHex : "#000000"}
            onChange={(event) => {
              setHex(event.target.value.toUpperCase());
              if (mode === "eyedropper" && sample)
                setSample({ ...sample, hex: event.target.value.toUpperCase() });
            }}
            className="size-10 cursor-pointer rounded-full border-0 bg-transparent p-0"
            aria-label={t("hex")}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
