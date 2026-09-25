"use client";

import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronDown,
  Clapperboard,
  Frame,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { GenerationMedia, StorageImage } from "@/components/generation/generation-media";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import { Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approvePreviewAction,
  approveShotAction,
  generateShotAction,
  updateShotAction,
} from "@/lib/actions/director";
import type { CropOption, ShotView } from "@/lib/director/queries";
import type { GenerationView } from "@/lib/domain/generation";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import { cn } from "@/lib/utils";

const PENDING = new Set(["queued", "in_progress"]);

type Editable = Pick<
  ShotView,
  | "purpose"
  | "detailShown"
  | "framing"
  | "angle"
  | "movement"
  | "placement"
  | "durationS"
  | "referenceCropIds"
  | "prompt"
  | "overrides"
  | "previewFrameFirst"
>;

function editableOf(shot: ShotView): Editable {
  return {
    purpose: shot.purpose,
    detailShown: shot.detailShown,
    framing: shot.framing,
    angle: shot.angle,
    movement: shot.movement,
    placement: shot.placement,
    durationS: shot.durationS,
    referenceCropIds: shot.referenceCropIds,
    prompt: shot.prompt,
    overrides: shot.overrides,
    previewFrameFirst: shot.previewFrameFirst,
  };
}

export function ShotCard({
  projectId,
  shot,
  index,
  count,
  crops,
  videoModels,
  maxShotDurationS,
  preview,
  video,
  onMove,
  onDelete,
  onChanged,
}: {
  projectId: string;
  shot: ShotView;
  index: number;
  count: number;
  crops: CropOption[];
  videoModels: ModelOption[];
  maxShotDurationS: number;
  preview: GenerationView | null;
  video: GenerationView | null;
  onMove: (to: number) => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("director.shot");
  const [draft, setDraft] = useState<Editable>(() => editableOf(shot));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "generate" | "approve">(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [overridesOpen, setOverridesOpen] = useState(false);

  // Adopt fresh server data (after refresh) unless there are unsaved edits.
  const serverKey = JSON.stringify(editableOf(shot));
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (!dirty) setDraft(editableOf(shot));
  }

  function patch(partial: Partial<Editable>) {
    setDraft((current) => ({ ...current, ...partial }));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    const result = await updateShotAction(projectId, {
      shotId: shot.id,
      purpose: draft.purpose,
      detailShown: draft.detailShown,
      framing: draft.framing,
      angle: draft.angle,
      movement: draft.movement,
      placement: draft.placement,
      durationS: draft.durationS,
      referenceCropIds: draft.referenceCropIds,
      prompt: draft.prompt,
      overrides: draft.overrides,
      previewFrameFirst: draft.previewFrameFirst,
    });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setDirty(false);
    return true;
  }

  async function generate(target: "preview" | "video", withNote: boolean) {
    setBusy("generate");
    try {
      if (dirty && !(await save())) return;
      const result = await generateShotAction(projectId, {
        shotId: shot.id,
        target,
        note: withNote ? note.trim() : null,
      });
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(target === "preview" ? t("previewStarted") : t("videoStarted"));
        setNote("");
        setNoteOpen(false);
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function approve(kind: "preview" | "shot") {
    setBusy("approve");
    const result =
      kind === "preview"
        ? await approvePreviewAction(projectId, shot.id)
        : await approveShotAction(projectId, shot.id);
    setBusy(null);
    if (!result.ok) toast.error(result.error);
    else toast.success(kind === "preview" ? t("previewApproved") : t("shotApproved"));
    onChanged();
  }

  const selectedCrops = crops.filter((crop) => draft.referenceCropIds.includes(crop.id));
  const previewPending = preview ? PENDING.has(preview.status) : false;
  const videoPending = video ? PENDING.has(video.status) : false;
  const needsPreview = draft.previewFrameFirst && !shot.previewApproved;
  const overLimit = draft.durationS > maxShotDurationS + 0.001;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {index + 1}
        </span>
        <Input
          value={draft.purpose}
          onChange={(event) => patch({ purpose: event.target.value })}
          className="h-9 max-w-xs font-medium"
          aria-label={t("purpose")}
        />
        <Badge variant={overLimit ? "warning" : "muted"} dir="ltr">
          {draft.durationS}s
        </Badge>
        <Badge
          variant={
            shot.status === "approved" ? "success" : shot.status === "failed" ? "danger" : "outline"
          }
        >
          {t(`status.${shot.status}`)}
        </Badge>
        <div className="ms-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            aria-label={t("moveUp")}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
            aria-label={t("moveDown")}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            onClick={onDelete}
            aria-label={t("delete")}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-w-0 flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("detailShown")}</span>
            <Input
              value={draft.detailShown}
              onChange={(event) => patch({ detailShown: event.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(["framing", "angle", "movement"] as const).map((field) => (
              <label key={field} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t(field)}</span>
                <Input
                  value={draft[field]}
                  onChange={(event) => patch({ [field]: event.target.value })}
                  className="h-9 text-sm"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("placement")}</span>
              <Input
                value={draft.placement ?? ""}
                onChange={(event) => patch({ placement: event.target.value || null })}
                className="h-9 text-sm"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("prompt")}</span>
            <Textarea
              value={draft.prompt}
              onChange={(event) => patch({ prompt: event.target.value })}
              className="min-h-24 text-sm"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("duration")}</span>
              <Input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={draft.durationS}
                onChange={(event) =>
                  patch({ durationS: Math.max(0.5, Number(event.target.value) || 0.5) })
                }
                className="h-9 w-20"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.previewFrameFirst}
                onCheckedChange={(previewFrameFirst) => patch({ previewFrameFirst })}
              />
              <Frame className="size-4" aria-hidden />
              {t("previewFirst")}
            </label>
            <button
              type="button"
              onClick={() => setOverridesOpen((value) => !value)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={overridesOpen}
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", overridesOpen && "rotate-180")}
                aria-hidden
              />
              {t("overrides")}
            </button>
          </div>
          {overlimitHint(overLimit, maxShotDurationS, t)}
          {overridesOpen ? (
            <div className="grid gap-3 rounded-2xl bg-muted p-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 sm:col-span-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("overrideModel")}
                </span>
                <Select
                  value={draft.overrides.modelId ?? "__default"}
                  onValueChange={(value) =>
                    patch({
                      overrides: {
                        ...draft.overrides,
                        modelId: value === "__default" ? null : value,
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default">{t("useProjectModel")}</SelectItem>
                    {videoModels.map((model) => (
                      <SelectItem
                        key={model.id}
                        value={model.id}
                        disabled={model.disabledReason !== null}
                      >
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("overrideAspect")}
                </span>
                <Input
                  value={draft.overrides.aspectRatio ?? ""}
                  placeholder="9:16"
                  dir="ltr"
                  onChange={(event) =>
                    patch({
                      overrides: { ...draft.overrides, aspectRatio: event.target.value || null },
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("overrideResolution")}
                </span>
                <Input
                  value={draft.overrides.resolution ?? ""}
                  placeholder="1080p"
                  dir="ltr"
                  onChange={(event) =>
                    patch({
                      overrides: { ...draft.overrides, resolution: event.target.value || null },
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("overrideDuration")}
                </span>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={draft.overrides.durationS ?? ""}
                  onChange={(event) =>
                    patch({
                      overrides: {
                        ...draft.overrides,
                        durationS:
                          event.target.value === ""
                            ? null
                            : Math.max(1, Number(event.target.value)),
                      },
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("references")}</span>
            <div className="flex flex-wrap items-center gap-2">
              {selectedCrops.map((crop) => (
                <figure key={crop.id} className="w-16">
                  <StorageImage
                    src={crop.url}
                    alt={crop.label}
                    className="aspect-square rounded-lg bg-[#FAF8F5]"
                  />
                  <figcaption className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {crop.label}
                  </figcaption>
                </figure>
              ))}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ImagePlus aria-hidden />
                    {t("chooseReferences")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="start">
                  <p className="mb-2 text-xs text-muted-foreground">{t("referencesHint")}</p>
                  <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
                    {crops.map((crop) => {
                      const active = draft.referenceCropIds.includes(crop.id);
                      return (
                        <button
                          key={crop.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            patch({
                              referenceCropIds: active
                                ? draft.referenceCropIds.filter((id) => id !== crop.id)
                                : [...draft.referenceCropIds, crop.id].slice(-8),
                            })
                          }
                          className={cn(
                            "overflow-hidden rounded-lg border-2 text-start",
                            active ? "border-primary" : "border-transparent",
                          )}
                        >
                          <StorageImage
                            src={crop.url}
                            alt={crop.label}
                            className="aspect-square bg-[#FAF8F5]"
                          />
                          <span className="block truncate px-1 py-0.5 text-[10px]">
                            {crop.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {draft.previewFrameFirst || preview ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t("previewFrame")}
              </p>
              {preview ? (
                <GenerationMedia
                  view={preview}
                  alt={t("previewFrame")}
                  className="aspect-[9/16] w-full"
                />
              ) : (
                <div className="grid aspect-[9/16] place-items-center rounded-2xl border border-dashed border-input text-xs text-muted-foreground">
                  {t("noPreview")}
                </div>
              )}
            </div>
          ) : null}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("video")}</p>
            {video ? (
              <GenerationMedia view={video} alt={t("video")} className="aspect-[9/16] w-full" />
            ) : (
              <div className="grid aspect-[9/16] place-items-center rounded-2xl border border-dashed border-input p-3 text-center text-xs text-muted-foreground">
                <Clapperboard className="mb-1 size-5" aria-hidden />
                {t("noVideo")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {dirty ? (
          <Button
            variant="glass"
            size="sm"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("save");
              if (await save()) toast.success(t("saved"));
              setBusy(null);
              onChanged();
            }}
          >
            {busy === "save" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            {t("save")}
          </Button>
        ) : null}

        {needsPreview ? (
          <>
            {preview?.status === "completed" ? (
              <Button size="sm" disabled={busy !== null} onClick={() => void approve("preview")}>
                <BadgeCheck aria-hidden />
                {t("approvePreview")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={preview?.status === "completed" ? "glass" : "default"}
              disabled={busy !== null || previewPending}
              onClick={() => void generate("preview", false)}
            >
              {busy === "generate" || previewPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Frame aria-hidden />
              )}
              {preview ? t("regeneratePreview") : t("generatePreview")}
            </Button>
          </>
        ) : (
          <>
            {video?.status === "completed" && shot.status !== "approved" ? (
              <Button size="sm" disabled={busy !== null} onClick={() => void approve("shot")}>
                <BadgeCheck aria-hidden />
                {t("approveShot")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={video?.status === "completed" ? "glass" : "default"}
              disabled={busy !== null || videoPending}
              onClick={() => void generate("video", false)}
            >
              {busy === "generate" || videoPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              {video ? t("regenerateVideo") : t("generateVideo")}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => setNoteOpen((value) => !value)}
        >
          <MessageSquarePlus aria-hidden />
          {t("withNote")}
        </Button>
      </div>
      {noteOpen ? (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("notePlaceholder")}
            maxLength={1000}
          />
          <Button
            size="sm"
            className="w-fit"
            disabled={!note.trim() || busy !== null}
            onClick={() => void generate(needsPreview ? "preview" : "video", true)}
          >
            <RefreshCw aria-hidden />
            {t("regenerateWithNote")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function overlimitHint(
  overLimit: boolean,
  max: number,
  t: ReturnType<typeof useTranslations<"director.shot">>,
) {
  if (!overLimit) return null;
  return <p className="text-xs text-warning">{t("overLimit", { seconds: max })}</p>;
}
