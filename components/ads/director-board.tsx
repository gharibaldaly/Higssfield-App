"use client";

import { Clapperboard, Film, Loader2, Plus, Save, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { DirectorControlsPanel } from "@/components/ads/director-controls-panel";
import { SavePresetDialog } from "@/components/ads/save-preset-dialog";
import { ShotCard } from "@/components/ads/shot-card";
import { VideoSettingsPanel } from "@/components/ads/video-settings-panel";
import { useConfirm } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StringListEditor } from "@/components/dna/list-editors";
import { useGenerationPolling } from "@/components/generation/use-generation-polling";
import { useSequentialRunner } from "@/components/generation/use-sequential-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addShotAction,
  applyPresetAction,
  deleteShotAction,
  generateShotAction,
  planShotsAction,
  reorderShotsAction,
  updateAdProjectAction,
} from "@/lib/actions/director";
import type { DirectorBoardData } from "@/lib/director/queries";
import type { DirectorControls, VideoSettings } from "@/lib/domain/director";

export function DirectorBoard({ data }: { data: DirectorBoardData }) {
  const t = useTranslations("director");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const router = useRouter();
  const { project } = data;
  const [name, setName] = useState(project.name);
  const [brief, setBrief] = useState(project.brief);
  const [controls, setControls] = useState<DirectorControls>(project.controls);
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(project.videoSettings);
  const [rules, setRules] = useState<string[]>(project.rules);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "plan" | "preset" | "add">(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [batch, setBatch] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  // Adopt fresh server data (after refresh) unless the owner has unsaved edits.
  const serverKey = JSON.stringify([
    project.name,
    project.brief,
    project.controls,
    project.videoSettings,
    project.rules,
  ]);
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (!dirty) {
      setName(project.name);
      setBrief(project.brief);
      setControls(project.controls);
      setVideoSettings(project.videoSettings);
      setRules(project.rules);
    }
  }

  const { views } = useGenerationPolling(
    data.shots.flatMap((shot) => [shot.preview, shot.video].filter((view) => view !== null)),
    { onSettled: () => router.refresh() },
  );

  const runner = useSequentialRunner({
    queue: batch,
    run: async (shotId) => {
      const result = await generateShotAction(project.id, { shotId, target: "auto" });
      if (!result.ok) toast.error(result.error);
      setBatch((current) => current.filter((id) => id !== shotId));
      router.refresh();
    },
  });

  const plannedDuration = useMemo(
    () => Math.round(data.shots.reduce((sum, shot) => sum + shot.durationS, 0) * 10) / 10,
    [data.shots],
  );

  function mark<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  async function saveProject(): Promise<boolean> {
    const result = await updateAdProjectAction({
      projectId: project.id,
      name,
      brief,
      controls,
      videoSettings,
      rules: rules.map((rule) => rule.trim()).filter(Boolean),
    });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setDirty(false);
    return true;
  }

  function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusy(null);
      }
    });
  }

  const plan = () =>
    run("plan", async () => {
      if (dirty && !(await saveProject())) return;
      const result = await planShotsAction(project.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("planned", { count: result.data.shots }));
      router.refresh();
    });

  const pendingShots = data.shots
    .filter((shot) => shot.status !== "approved" && shot.status !== "ready")
    .map((shot) => shot.id);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-3">
            <Input
              value={name}
              onChange={(event) => mark(setName)(event.target.value)}
              className="h-12 font-display text-2xl font-semibold"
              aria-label={t("name")}
            />
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Film className="size-4" aria-hidden />
              {data.product.name}
              <Badge variant="outline">{t(`status.${project.status as "draft"}`)}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={project.presetId ?? undefined}
                onValueChange={(presetId) =>
                  run("preset", async () => {
                    const result = await applyPresetAction(project.id, presetId);
                    if (!result.ok) toast.error(result.error);
                    else {
                      setDirty(false);
                      toast.success(t("presetApplied"));
                    }
                    router.refresh();
                  })
                }
              >
                <SelectTrigger className="w-64" aria-label={t("applyPreset")}>
                  <SelectValue placeholder={t("applyPreset")} />
                </SelectTrigger>
                <SelectContent>
                  {data.presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="glass" size="sm" onClick={() => setPresetOpen(true)}>
                <Save aria-hidden />
                {t("savePreset")}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="brief" className="text-sm font-medium">
              {t("brief")}
            </label>
            <Textarea
              id="brief"
              value={brief}
              onChange={(event) => mark(setBrief)(event.target.value)}
              placeholder={t("briefPlaceholder")}
              className="min-h-24"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={plan} disabled={busy !== null || data.crops.length === 0}>
                {busy === "plan" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Wand2 aria-hidden />
                )}
                {busy === "plan" ? t("planning") : data.shots.length > 0 ? t("replan") : t("plan")}
              </Button>
              <Button
                variant="glass"
                disabled={!dirty || busy !== null}
                onClick={() =>
                  run("save", async () => {
                    if (await saveProject()) toast.success(t("saved"));
                    router.refresh();
                  })
                }
              >
                {busy === "save" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                {t("save")}
              </Button>
              {dirty ? (
                <span className="self-center text-xs text-warning">{t("unsaved")}</span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {project.plan ? (
        <Card>
          <CardContent className="grid gap-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs font-semibold tracking-wide text-champagne-ink uppercase">
                {t("planConcept")}
              </p>
              <p className="mt-1">{project.plan.concept}</p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-champagne-ink uppercase">
                {t("planHook")}
              </p>
              <p className="mt-1">{project.plan.hook}</p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-champagne-ink uppercase">
                {t("planEnvironment")}
              </p>
              <p className="mt-1">{project.plan.environmentBible}</p>
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-champagne-ink uppercase">
                {t("planMusic")}
              </p>
              <p className="mt-1">{project.plan.musicCue}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        <Card className="xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto">
          <CardHeader>
            <CardTitle className="text-lg">{t("controlsTitle")}</CardTitle>
            <CardDescription>{t("controlsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-7">
            <DirectorControlsPanel controls={controls} onChange={mark(setControls)} />
            <div className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold tracking-[0.18em] text-champagne-ink uppercase">
                {t("rules")}
              </h3>
              <StringListEditor
                items={rules}
                onChange={mark(setRules)}
                addLabel={t("addRule")}
                itemLabel={(index) => t("ruleNumber", { number: index + 1 })}
              />
            </div>
          </CardContent>
        </Card>

        <section className="flex min-w-0 flex-col gap-4" aria-label={t("storyboard")}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="me-auto font-display text-2xl font-semibold">{t("storyboard")}</h2>
            {data.shots.length > 0 ? (
              <Button
                variant="glass"
                size="sm"
                disabled={pendingShots.length === 0 || runner.current !== null}
                onClick={() => setBatch(pendingShots)}
              >
                {runner.current ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Sparkles aria-hidden />
                )}
                {runner.current
                  ? t("generatingAll", { count: runner.waiting.length + 1 })
                  : t("generateAll")}
              </Button>
            ) : null}
            <Button
              variant="glass"
              size="sm"
              disabled={busy !== null || data.crops.length === 0}
              onClick={() =>
                run("add", async () => {
                  const result = await addShotAction(project.id);
                  if (!result.ok) toast.error(result.error);
                  router.refresh();
                })
              }
            >
              <Plus aria-hidden />
              {t("addShot")}
            </Button>
          </div>
          {data.shots.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title={t("noShots.title")}
              description={
                data.crops.length === 0 ? t("noShots.noCrops") : t("noShots.description")
              }
            />
          ) : (
            data.shots.map((shot, index) => (
              <ShotCard
                key={shot.id}
                projectId={project.id}
                shot={shot}
                index={index}
                count={data.shots.length}
                crops={data.crops}
                videoModels={data.videoModels}
                maxShotDurationS={videoSettings.maxShotDurationS}
                preview={shot.preview ? (views.get(shot.preview.id) ?? shot.preview) : null}
                video={shot.video ? (views.get(shot.video.id) ?? shot.video) : null}
                onChanged={() => router.refresh()}
                onDelete={async () => {
                  const confirmed = await confirm({
                    title: t("confirmDeleteShot"),
                    confirmLabel: tc("delete"),
                    destructive: true,
                  });
                  if (!confirmed) return;
                  startTransition(async () => {
                    const result = await deleteShotAction(project.id, shot.id);
                    if (!result.ok) toast.error(result.error);
                    router.refresh();
                  });
                }}
                onMove={(to) => {
                  const ids = data.shots.map((item) => item.id);
                  const [moved] = ids.splice(index, 1);
                  ids.splice(to, 0, moved!);
                  startTransition(async () => {
                    const result = await reorderShotsAction(project.id, ids);
                    if (!result.ok) toast.error(result.error);
                    router.refresh();
                  });
                }}
              />
            ))
          )}
        </section>

        <aside className="flex flex-col gap-6 xl:sticky xl:top-24 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("videoTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <VideoSettingsPanel
                settings={videoSettings}
                onChange={mark(setVideoSettings)}
                models={data.videoModels}
                defaultModelId={data.defaultVideoModelId}
                plannedDurationS={plannedDuration}
              />
            </CardContent>
          </Card>
          <Card className="opacity-80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                {t("montage.title")}
                <Badge variant="muted">{t("montage.phase")}</Badge>
              </CardTitle>
              <CardDescription>{t("montage.description")}</CardDescription>
            </CardHeader>
          </Card>
        </aside>
      </div>

      <SavePresetDialog
        open={presetOpen}
        onOpenChange={setPresetOpen}
        presets={data.presets}
        currentPresetId={project.presetId}
        controls={controls}
        videoSettings={videoSettings}
        rules={rules.map((rule) => rule.trim()).filter(Boolean)}
      />
    </div>
  );
}
