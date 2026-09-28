"use client";

import {
  BadgeCheck,
  Frame,
  LayoutPanelLeft,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Scissors,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { useRefresh } from "@/components/common/use-refresh";
import { GenerationMedia, StorageImage } from "@/components/generation/generation-media";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { CropEditor } from "@/components/sheet/crop-editor";
import { SourceEditor, type EditorPhoto } from "@/components/sheet/source-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import { Textarea } from "@/components/ui/input";
import {
  approveSheetAction,
  buildSheetAction,
  recropSheetAction,
  updateSheetSourcesAction,
} from "@/lib/actions/sheets";
import type { GenerationView } from "@/lib/domain/generation";
import type { SheetPlanView } from "@/lib/domain/sheet";
import type { CardSource, SheetCard } from "@/lib/sheet/layout";
import { cn } from "@/lib/utils";

export type SheetCardView = SheetCard & { sources: CardSource[] };

export type SheetView = {
  id: string;
  version: number;
  status: "draft" | "generating" | "review" | "approved" | "failed";
  /** "photos": built from the owner's photos; "drawn": an image model drew it (older sheets). */
  source: "photos" | "drawn";
  plan: SheetPlanView | null;
  warnings: string[];
  cards: SheetCardView[];
  imageUrl: string | null;
  generation: GenerationView | null;
  approvedAt: string | null;
};

export type CropView = { id: string; kind: string; label: string; url: string | null };

export function SheetStudio({
  productId,
  dnaApproved,
  sheets,
  selectedId,
  crops,
  references,
  photos,
}: {
  productId: string;
  dnaApproved: boolean;
  sheets: SheetView[];
  selectedId: string | null;
  crops: CropView[];
  references: { id: string; url: string | null; label: string }[];
  /** Photos (and approved catalogue images) a card can be cut from. */
  photos: EditorPhoto[];
}) {
  const t = useTranslations("sheet");
  const router = useRouter();
  const refresh = useRefresh();
  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? sheets[0] ?? null;
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showBoxes, setShowBoxes] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "build" | "approve">(null);
  const [, startTransition] = useTransition();
  const { views } = useGenerationPolling(
    sheets.flatMap((sheet) => (sheet.generation ? [sheet.generation] : [])),
    { onSettled: refresh },
  );
  const generation = selected?.generation
    ? (views.get(selected.generation.id) ?? selected.generation)
    : null;

  if (!dnaApproved) {
    return (
      <EmptyState
        icon={LayoutPanelLeft}
        title={t("needDna.title")}
        description={t("needDna.description")}
        action={
          <Button asChild>
            <Link href={`/products/${productId}/dna`}>{t("needDna.action")}</Link>
          </Button>
        }
      />
    );
  }

  function build(withNote: boolean) {
    setBusy("build");
    startTransition(async () => {
      const result = await buildSheetAction({ productId, note: withNote ? note : null });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("started"));
      setNote("");
      setShowNote(false);
      router.replace(`/products/${productId}/sheet?s=${result.data.sheetId}`, { scroll: false });
      router.refresh();
    });
  }

  function approve() {
    if (!selected) return;
    setBusy("approve");
    startTransition(async () => {
      const result = await approveSheetAction(productId, selected.id);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("approved", { count: result.data.crops }));
      router.refresh();
    });
  }

  const fromPhotos = selected?.source === "photos";
  const ready = fromPhotos ? Boolean(selected?.imageUrl) : generation?.status === "completed";
  const hasImage = fromPhotos ? Boolean(selected?.imageUrl) : Boolean(generation);
  const canAdjust = fromPhotos || (selected?.status === "approved" && Boolean(generation?.url));

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        {sheets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {sheets.map((sheet) => (
              <Link
                key={sheet.id}
                href={`/products/${productId}/sheet?s=${sheet.id}`}
                scroll={false}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-xs font-medium transition-colors",
                  sheet.id === selected?.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                v{sheet.version}
                {sheet.status === "approved" ? (
                  <BadgeCheck className="size-3.5" aria-hidden />
                ) : null}
              </Link>
            ))}
          </div>
        ) : null}

        {selected && hasImage ? (
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selected.plan?.title ?? t("sheetTitle", { version: selected.version })}
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  {t(`status.${selected.status}`)}
                  <Badge variant={fromPhotos ? "success" : "muted"}>
                    {t(`source.${selected.source}`)}
                  </Badge>
                </CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showBoxes} onCheckedChange={setShowBoxes} />
                <Frame className="size-4" aria-hidden />
                {t("showBoxes")}
              </label>
            </CardHeader>
            <CardContent>
              <div className="relative">
                {fromPhotos ? (
                  <StorageImage
                    src={selected.imageUrl}
                    alt={t("sheetAlt")}
                    className="aspect-video w-full rounded-(--radius-control)"
                  />
                ) : (
                  <GenerationMedia
                    view={generation!}
                    alt={t("sheetAlt")}
                    className="aspect-video w-full"
                    controls={false}
                  />
                )}
                {showBoxes && ready ? (
                  <div className="pointer-events-none absolute inset-0" dir="ltr">
                    {selected.cards
                      .filter((card) => card.imageRect)
                      .map((card) => (
                        <div
                          key={card.id}
                          className="absolute border-2 border-veil"
                          style={{
                            left: `${card.imageRect!.x * 100}%`,
                            top: `${card.imageRect!.y * 100}%`,
                            width: `${card.imageRect!.w * 100}%`,
                            height: `${card.imageRect!.h * 100}%`,
                          }}
                        >
                          <span className="absolute top-0 left-0 bg-black/60 px-1 text-[11px] text-white">
                            {card.label}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
              {selected.warnings.length > 0 ? (
                <div className="mt-4 flex gap-2 rounded-(--radius-control) border border-dashed border-warning/60 p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div>
                    <p className="font-medium">{t("warnings")}</p>
                    <ul className="mt-1 list-disc ps-5 text-muted-foreground">
                      {selected.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-2">
                {selected.status !== "approved" ? (
                  <Button onClick={approve} disabled={!ready || busy !== null}>
                    {busy === "approve" ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <BadgeCheck aria-hidden />
                    )}
                    {t("approve")}
                  </Button>
                ) : (
                  <Badge variant="success" className="h-10 px-4 text-sm">
                    <BadgeCheck aria-hidden />
                    {t("isApproved")}
                  </Badge>
                )}
                {fromPhotos ? (
                  <Button
                    variant="surface"
                    onClick={() => setEditing(true)}
                    disabled={busy !== null}
                  >
                    <Scissors aria-hidden />
                    {t("adjustCards")}
                  </Button>
                ) : null}
                <Button variant="surface" onClick={() => build(false)} disabled={busy !== null}>
                  <RefreshCw aria-hidden />
                  {t("regenerate")}
                </Button>
                <Button
                  variant="surface"
                  onClick={() => setShowNote((value) => !value)}
                  disabled={busy !== null}
                >
                  <MessageSquarePlus aria-hidden />
                  {t("regenerateWithNote")}
                </Button>
              </div>
              {showNote ? (
                <div className="mt-4 flex flex-col gap-2">
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t("notePlaceholder")}
                    maxLength={1000}
                  />
                  <Button
                    className="w-fit"
                    onClick={() => build(true)}
                    disabled={!note.trim() || busy !== null}
                  >
                    {busy === "build" ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Sparkles aria-hidden />
                    )}
                    {t("regenerate")}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            icon={LayoutPanelLeft}
            title={t("empty.title")}
            description={t("empty.description")}
            steps={[t("empty.step1"), t("empty.step2"), t("empty.step3")]}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t("comparison")}</CardTitle>
            <CardDescription>{t("comparisonHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
              {references.map((reference) => (
                <figure key={reference.id}>
                  <StorageImage
                    src={reference.url}
                    alt={reference.label}
                    fit="cover"
                    className="aspect-square rounded-(--radius-control) stage"
                  />
                  <figcaption className="mt-1 truncate text-xs text-muted-foreground">
                    {reference.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          </CardContent>
        </Card>

        {selected?.status === "approved" ? (
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{t("crops.title")}</CardTitle>
                <CardDescription>{t("crops.hint")}</CardDescription>
              </div>
              {canAdjust ? (
                <Button variant="surface" onClick={() => setEditing(true)}>
                  <Scissors aria-hidden />
                  {fromPhotos ? t("adjustCards") : t("crops.adjust")}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {crops.map((crop) => (
                  <li key={crop.id}>
                    <StorageImage
                      src={crop.url}
                      alt={crop.label}
                      className="aspect-square rounded-(--radius-control) stage"
                    />
                    <p className="mt-1.5 truncate text-xs font-medium">{crop.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`crops.kinds.${crop.kind as "front"}`)}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("build.title")}</CardTitle>
            <CardDescription>{t("build.hint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => build(false)} disabled={busy !== null} className="w-full">
              {busy === "build" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {busy === "build"
                ? t("build.working")
                : sheets.length > 0
                  ? t("build.again")
                  : t("build.first")}
            </Button>
          </CardContent>
        </Card>
        {selected?.plan ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("plan.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <ul className="list-disc space-y-1 ps-5">
                {selected.plan.overviewBullets.map((bullet, index) => (
                  <li key={index}>{bullet}</li>
                ))}
              </ul>
              <div>
                <p className="mb-2 hud text-muted-foreground">{t("plan.details")}</p>
                <ol className="flex flex-col gap-2">
                  {selected.plan.detailCards.map((card, index) => (
                    <li key={index}>
                      <span className="font-medium">{card.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {card.description}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </aside>

      {editing && selected && fromPhotos ? (
        <SourceEditor
          open={editing}
          onOpenChange={setEditing}
          photos={photos}
          cards={selected.cards
            .filter((card) => card.imageRect && card.cropKind)
            .map((card) => ({
              id: card.id,
              label: card.label ?? card.id,
              closeUp: card.role === "detail" || card.cropKind === "swatch",
              editable: card.sources.length <= 1,
              source: card.sources[0] ?? null,
            }))}
          onSave={async (changes) => {
            const result = await updateSheetSourcesAction({
              productId,
              sheetId: selected.id,
              cards: changes,
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(t("editor.saved"));
            setEditing(false);
            router.refresh();
          }}
        />
      ) : null}

      {editing && selected && !fromPhotos && generation?.url ? (
        <CropEditor
          open={editing}
          onOpenChange={setEditing}
          imageUrl={generation.url}
          cards={selected.cards}
          onSave={async (boxes) => {
            const result = await recropSheetAction({
              productId,
              sheetId: selected.id,
              boxes: boxes.map((box) => ({ cardId: box.cardId, rect: box.rect })),
            });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(t("crops.saved", { count: result.data.crops }));
            setEditing(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
