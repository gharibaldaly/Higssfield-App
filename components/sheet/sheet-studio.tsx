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
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { GenerationMedia, StorageImage } from "@/components/generation/generation-media";
import { ModelPicker } from "@/components/generation/model-picker";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { CropEditor } from "@/components/sheet/crop-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import { Textarea } from "@/components/ui/input";
import { approveSheetAction, generateSheetAction, recropSheetAction } from "@/lib/actions/sheets";
import type { GenerationView } from "@/lib/domain/generation";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import type { SheetLayout } from "@/lib/sheet/layout";
import { cn } from "@/lib/utils";

export type SheetView = {
  id: string;
  version: number;
  status: "draft" | "generating" | "review" | "approved" | "failed";
  plan: {
    title: string;
    overviewBullets: string[];
    detailCards: { label: string; description: string }[];
    bottomCards: { kind: string; label: string; description: string }[];
  } | null;
  layout: SheetLayout;
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
  models,
  defaultModelId,
  references,
}: {
  productId: string;
  dnaApproved: boolean;
  sheets: SheetView[];
  selectedId: string | null;
  crops: CropView[];
  models: ModelOption[];
  defaultModelId: string | null;
  references: { id: string; url: string | null; label: string }[];
}) {
  const t = useTranslations("sheet");
  const router = useRouter();
  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? sheets[0] ?? null;
  const [modelId, setModelId] = useState<string | null>(defaultModelId);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showBoxes, setShowBoxes] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "generate" | "approve">(null);
  const [, startTransition] = useTransition();
  const { views } = useGenerationPolling(
    sheets.flatMap((sheet) => (sheet.generation ? [sheet.generation] : [])),
    { onSettled: () => router.refresh() },
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

  function generate(withNote: boolean) {
    setBusy("generate");
    startTransition(async () => {
      const result = await generateSheetAction({
        productId,
        modelId,
        note: withNote ? note : null,
      });
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

  const ready = generation?.status === "completed";

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
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
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

        {selected && generation ? (
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selected.plan?.title ?? t("sheetTitle", { version: selected.version })}
                </CardTitle>
                <CardDescription>{t(`status.${selected.status}`)}</CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showBoxes} onCheckedChange={setShowBoxes} />
                <Frame className="size-4" aria-hidden />
                {t("showBoxes")}
              </label>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <GenerationMedia
                  view={generation}
                  alt={t("sheetAlt")}
                  className="aspect-video w-full"
                  controls={false}
                />
                {showBoxes && ready ? (
                  <div className="pointer-events-none absolute inset-0" dir="ltr">
                    {selected.layout.cards
                      .filter((card) => card.imageRect)
                      .map((card) => (
                        <div
                          key={card.id}
                          className="absolute border-2 border-champagne/90"
                          style={{
                            left: `${card.imageRect!.x * 100}%`,
                            top: `${card.imageRect!.y * 100}%`,
                            width: `${card.imageRect!.w * 100}%`,
                            height: `${card.imageRect!.h * 100}%`,
                          }}
                        >
                          <span className="absolute top-0 left-0 bg-black/60 px-1 text-[11px] text-cream">
                            {card.label}
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}
              </div>
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
                <Button variant="glass" onClick={() => generate(false)} disabled={busy !== null}>
                  <RefreshCw aria-hidden />
                  {t("regenerate")}
                </Button>
                <Button
                  variant="glass"
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
                    onClick={() => generate(true)}
                    disabled={!note.trim() || busy !== null}
                  >
                    {busy === "generate" ? (
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
                    className="aspect-square rounded-xl"
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
              {generation?.url ? (
                <Button variant="glass" onClick={() => setEditing(true)}>
                  <Scissors aria-hidden />
                  {t("crops.adjust")}
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
                      className="aspect-square rounded-xl bg-[#FAF8F5]"
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
            <CardTitle>{t("generate.title")}</CardTitle>
            <CardDescription>{t("generate.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ModelPicker
              models={models}
              value={modelId}
              onChange={setModelId}
              label={t("generate.model")}
              id="sheet-model"
            />
            <Button onClick={() => generate(false)} disabled={busy !== null || !modelId}>
              {busy === "generate" ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}
              {busy === "generate"
                ? t("generate.working")
                : sheets.length > 0
                  ? t("generate.again")
                  : t("generate.first")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("generate.referencesNote")}</p>
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
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t("plan.details")}
                </p>
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

      {editing && selected && generation?.url ? (
        <CropEditor
          open={editing}
          onOpenChange={setEditing}
          imageUrl={generation.url}
          cards={selected.layout.cards}
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
