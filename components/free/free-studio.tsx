"use client";

import {
  Clapperboard,
  Coins,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Undo2,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { postJson } from "@/components/common/post-json";
import { useRefresh } from "@/components/common/use-refresh";
import { EmptyState } from "@/components/common/empty-state";
import { FreeResultCard } from "@/components/free/free-result-card";
import { ReferencePicker, type FreeReference } from "@/components/free/reference-picker";
import { ModelPicker } from "@/components/generation/model-picker";
import { formatPrice, useEstimate } from "@/components/generation/use-estimate";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GenerationView } from "@/lib/domain/generation";
import type { FreeItem } from "@/lib/generations/free";
import {
  FREE_MAX_OUTPUTS,
  FREE_MAX_PROMPT_CHARS,
  FREE_MAX_REFERENCES,
  freeModeFor,
  type FreeKind,
} from "@/lib/generations/free-shared";
import { preferredResolution } from "@/lib/providers/higgsfield/fit";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import { storagePaths } from "@/lib/storage/paths";
import type { PolishedPrompt } from "@/lib/providers/llm/types";

type FormState = {
  modelId: string | null;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string | null;
  resolution: string | null;
  durationS: number | null;
  count: number;
};

const emptyForm = (modelId: string | null): FormState => ({
  modelId,
  prompt: "",
  negativePrompt: "",
  aspectRatio: null,
  resolution: null,
  durationS: null,
  count: 1,
});

/**
 * The free generation studio: references, a prompt sent as it is, any model,
 * the size and quality it offers, and up to four outputs per click. Results
 * arrive below as they finish; the history under them is what the page loaded.
 */
export function FreeStudio({
  ownerId,
  locale,
  imageModels,
  videoModels,
  defaultImageModelId,
  defaultVideoModelId,
  history,
}: {
  ownerId: string;
  locale: "ar" | "en";
  imageModels: ModelOption[];
  videoModels: ModelOption[];
  defaultImageModelId: string | null;
  defaultVideoModelId: string | null;
  history: FreeItem[];
}) {
  const t = useTranslations("free");
  const refresh = useRefresh();
  const [kind, setKind] = useState<FreeKind>("image");
  const [forms, setForms] = useState<Record<FreeKind, FormState>>({
    image: emptyForm(defaultImageModelId),
    video: emptyForm(defaultVideoModelId),
  });
  const [references, setReferences] = useState<FreeReference[]>([]);
  const [submitted, setSubmitted] = useState<FreeItem[]>([]);
  const [busy, setBusy] = useState<"generate" | "polish" | null>(null);
  const [beforePolish, setBeforePolish] = useState<string | null>(null);

  // Items the page loaded win over the ones this session submitted (fresher links).
  const items = useMemo(() => {
    const known = new Set(history.map((item) => item.view.id));
    return [...submitted.filter((item) => !known.has(item.view.id)), ...history];
  }, [history, submitted]);
  const views = useMemo(() => items.map((item) => item.view), [items]);
  const onSettled = useCallback(() => refresh(), [refresh]);
  const polling = useGenerationPolling(views, { onSettled });

  const form = forms[kind];
  const models = kind === "image" ? imageModels : videoModels;
  const model = models.find((candidate) => candidate.id === form.modelId) ?? null;
  const caps = model?.capabilities ?? null;
  const mode = freeModeFor(kind, references.length > 0);
  const modeOk = caps ? caps.modes.includes(mode) : false;
  const needsReference = Boolean(caps?.referenceRequired) && references.length === 0;
  const aspectRatio =
    caps && caps.aspectRatios.length > 0
      ? form.aspectRatio && caps.aspectRatios.includes(form.aspectRatio)
        ? form.aspectRatio
        : (caps.aspectRatios.find((value) => value === (kind === "image" ? "4:5" : "9:16")) ??
          caps.aspectRatios[0]!)
      : null;
  // Images take the highest tier; video takes 1080p unless chosen otherwise (4k costs several times more).
  const resolution =
    caps && caps.resolutions.length > 0
      ? form.resolution && caps.resolutions.includes(form.resolution)
        ? form.resolution
        : preferredResolution(kind, caps.resolutions)
      : null;
  const durationS =
    caps && caps.durations.length > 0
      ? form.durationS && caps.durations.includes(form.durationS)
        ? form.durationS
        : caps.durations[0]!
      : null;

  function patch(update: Partial<FormState>) {
    setForms((current) => ({ ...current, [kind]: { ...current[kind], ...update } }));
  }

  const { estimate } = useEstimate(
    model && modeOk
      ? {
          modelId: model.id,
          mode,
          aspectRatio,
          resolution,
          durationS,
          referenceCount: Math.min(references.length, caps?.maxReferenceImages ?? 0),
        }
      : null,
  );
  const price = formatPrice(estimate);
  const total =
    estimate?.usd !== null && estimate?.usd !== undefined
      ? `$${(estimate.usd * form.count).toFixed(2)}`
      : estimate?.credits !== null && estimate?.credits !== undefined
        ? `${estimate.credits * form.count} cr`
        : null;

  const canGenerate =
    Boolean(model) && !model?.disabledReason && modeOk && !needsReference && form.prompt.trim();

  async function generate() {
    if (!model || !canGenerate) return;
    setBusy("generate");
    const result = await postJson<{ items: FreeItem[]; warnings: string[] }>("/api/free/generate", {
      kind,
      modelId: model.id,
      prompt: form.prompt.trim(),
      negativePrompt: caps?.supportsNegativePrompt ? form.negativePrompt.trim() || null : null,
      referencePaths: references.map((reference) => reference.path),
      aspectRatio,
      resolution,
      durationS,
      count: form.count,
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSubmitted((current) => [...result.data.items, ...current]);
    for (const warning of result.data.warnings) toast.warning(warning);
    toast.success(t("submitted", { count: result.data.items.length }));
  }

  async function polish() {
    if (!form.prompt.trim()) return;
    setBusy("polish");
    const original = form.prompt;
    const result = await postJson<PolishedPrompt & { provider: string; model: string }>(
      "/api/free/polish",
      {
        kind,
        prompt: original.trim(),
        modelLabel: model?.label ?? "Higgsfield",
        referencePaths: references.map((reference) => reference.path),
        locale,
      },
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBeforePolish(original);
    patch({
      prompt: result.data.prompt,
      negativePrompt: result.data.negativePrompt || form.negativePrompt,
    });
    toast.success(t("polished", { model: result.data.model }), {
      description: result.data.notes || undefined,
    });
  }

  function reuse(item: FreeItem) {
    const itemKind = item.view.kind;
    setKind(itemKind);
    setForms((current) => ({
      ...current,
      [itemKind]: {
        ...current[itemKind],
        prompt: item.prompt,
        negativePrompt: item.negativePrompt ?? "",
        aspectRatio: item.aspectRatio,
        resolution: item.resolution,
        durationS: item.durationS,
        modelId: (itemKind === "image" ? imageModels : videoModels).some(
          (candidate) => candidate.id === item.view.modelId,
        )
          ? item.view.modelId
          : current[itemKind].modelId,
      },
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function useAsReference(item: FreeItem, view: GenerationView) {
    if (!view.url) return;
    const path = storagePaths.generation(ownerId, view.id, view.mimeType ?? "image/png");
    if (references.some((reference) => reference.path === path)) return;
    if (references.length >= FREE_MAX_REFERENCES) {
      toast.warning(t("references.max", { count: FREE_MAX_REFERENCES }));
      return;
    }
    setReferences((current) => [
      ...current,
      { id: view.id, path, url: view.url!, name: item.prompt.slice(0, 40) },
    ]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const shown = items.filter((item) => item.view.kind === kind);

  return (
    <Tabs value={kind} onValueChange={(value) => setKind(value as FreeKind)}>
      <TabsList>
        <TabsTrigger value="image">
          <ImageIcon aria-hidden />
          {t("tabs.image")}
        </TabsTrigger>
        <TabsTrigger value="video">
          <Clapperboard aria-hidden />
          {t("tabs.video")}
        </TabsTrigger>
      </TabsList>
      {(["image", "video"] as const).map((value) => (
        <TabsContent
          key={value}
          value={value}
          className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"
        >
          {value === kind ? (
            <>
              <Card className="flex h-fit flex-col gap-6 p-5 sm:p-6 lg:sticky lg:top-24">
                <ReferencePicker
                  ownerId={ownerId}
                  references={references}
                  onChange={setReferences}
                  max={FREE_MAX_REFERENCES}
                  modelMax={caps ? caps.maxReferenceImages || null : null}
                />

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="free-prompt">{t("prompt")}</Label>
                    <div className="flex items-center gap-1">
                      {beforePolish !== null ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            patch({ prompt: beforePolish });
                            setBeforePolish(null);
                          }}
                        >
                          <Undo2 aria-hidden />
                          {t("undoPolish")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null || !form.prompt.trim()}
                        onClick={() => void polish()}
                      >
                        {busy === "polish" ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Wand2 aria-hidden />
                        )}
                        {busy === "polish" ? t("polishing") : t("polish")}
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    id="free-prompt"
                    value={form.prompt}
                    onChange={(event) => patch({ prompt: event.target.value })}
                    placeholder={t(`promptPlaceholder.${kind}`)}
                    rows={6}
                    maxLength={FREE_MAX_PROMPT_CHARS}
                    dir="auto"
                  />
                  <p className="text-xs text-muted-foreground">{t("promptHint")}</p>
                </div>

                {caps?.supportsNegativePrompt ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="free-negative">{t("negative")}</Label>
                    <Textarea
                      id="free-negative"
                      value={form.negativePrompt}
                      onChange={(event) => patch({ negativePrompt: event.target.value })}
                      placeholder={t("negativePlaceholder")}
                      rows={2}
                      dir="auto"
                    />
                  </div>
                ) : null}

                <ModelPicker
                  models={models}
                  value={form.modelId}
                  onChange={(id) => patch({ modelId: id, aspectRatio: null, resolution: null })}
                  label={t("model")}
                  id="free-model"
                />
                {model && !modeOk ? (
                  <p className="text-xs text-warning">
                    {references.length > 0 ? t("textOnlyModel") : t("needsReference")}
                  </p>
                ) : model && needsReference ? (
                  <p className="text-xs text-warning">{t("needsReference")}</p>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">{t("size")}</span>
                    {caps && caps.aspectRatios.length > 0 ? (
                      <Select
                        value={aspectRatio ?? undefined}
                        onValueChange={(next) => patch({ aspectRatio: next })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {caps.aspectRatios.map((option) => (
                            <SelectItem key={option} value={option}>
                              <span dir="ltr">{option}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("sizeFromModel")}</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">{t("quality")}</span>
                    {caps && caps.resolutions.length > 0 ? (
                      <Select
                        value={resolution ?? undefined}
                        onValueChange={(next) => patch({ resolution: next })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {caps.resolutions.map((option) => (
                            <SelectItem key={option} value={option}>
                              <span dir="ltr">{option}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("qualityFromModel")}</span>
                    )}
                  </label>
                  {kind === "video" ? (
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium">{t("duration")}</span>
                      {caps && caps.durations.length > 0 ? (
                        <Select
                          value={durationS ? String(durationS) : undefined}
                          onValueChange={(next) => patch({ durationS: Number(next) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {caps.durations.map((option) => (
                              <SelectItem key={option} value={String(option)}>
                                {t("seconds", { seconds: option })}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {t("durationFromModel")}
                        </span>
                      )}
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">{t("count")}</span>
                    <Select
                      value={String(form.count)}
                      onValueChange={(next) => patch({ count: Number(next) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: FREE_MAX_OUTPUTS }, (_, index) => index + 1).map(
                          (option) => (
                            <SelectItem key={option} value={String(option)}>
                              {t("outputs", { count: option })}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">{t("countHint")}</p>
                {model && modeOk ? (
                  <p className="flex items-center gap-2 rounded-(--radius-control) border border-dashed border-border-strong px-3 py-2 text-xs">
                    <Coins className="size-3.5 shrink-0 text-accent-ink" aria-hidden />
                    <span className="text-muted-foreground">
                      {price && total
                        ? form.count > 1
                          ? t("estimate.total", { price, count: form.count, total })
                          : t("estimate.one", { price })
                        : t("estimate.unavailable")}
                    </span>
                  </p>
                ) : null}

                <Button
                  type="button"
                  size="lg"
                  disabled={busy !== null || !canGenerate}
                  onClick={() => void generate()}
                >
                  {busy === "generate" ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles aria-hidden />
                  )}
                  {busy === "generate" ? t("generating") : t("generate", { count: form.count })}
                </Button>
              </Card>

              <section aria-label={t("results.title")} className="min-w-0">
                {shown.length === 0 ? (
                  <EmptyState
                    icon={Sparkles}
                    title={t("results.empty")}
                    description={t(`results.emptyHint.${kind}`)}
                  />
                ) : (
                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.map((item) => (
                      <FreeResultCard
                        key={item.view.id}
                        item={item}
                        view={polling.views.get(item.view.id) ?? item.view}
                        onReuse={reuse}
                        onUseAsReference={useAsReference}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
