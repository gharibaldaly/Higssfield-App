"use client";

import { Info, Music4 } from "lucide-react";
import { useTranslations } from "next-intl";

import { ModelPicker } from "@/components/generation/model-picker";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VideoSettings } from "@/lib/domain/director";
import type { ModelOption } from "@/lib/providers/higgsfield/options";

const FALLBACK_ASPECTS = ["9:16", "4:5", "1:1", "16:9"];

export function VideoSettingsPanel({
  settings,
  onChange,
  models,
  defaultModelId,
  plannedDurationS,
}: {
  settings: VideoSettings;
  onChange: (settings: VideoSettings) => void;
  models: ModelOption[];
  defaultModelId: string | null;
  plannedDurationS: number;
}) {
  const t = useTranslations("director.video");
  const modelId = settings.modelId ?? defaultModelId;
  const model = models.find((candidate) => candidate.id === modelId) ?? null;
  const aspects =
    model && model.capabilities.aspectRatios.length > 0
      ? model.capabilities.aspectRatios
      : FALLBACK_ASPECTS;
  const resolutions = model?.capabilities.resolutions ?? [];
  const overLength = plannedDurationS > settings.totalDurationS + 0.5;

  return (
    <div className="flex flex-col gap-5">
      <ModelPicker
        models={models}
        value={modelId}
        onChange={(id) => onChange({ ...settings, modelId: id })}
        label={t("model")}
        id="video-model"
      />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("total")}</span>
          <Input
            type="number"
            min={2}
            max={120}
            step={1}
            value={settings.totalDurationS}
            onChange={(event) =>
              onChange({
                ...settings,
                totalDurationS: Math.max(2, Number(event.target.value) || 2),
              })
            }
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("maxShot")}</span>
          <Input
            type="number"
            min={1}
            max={30}
            step={0.5}
            value={settings.maxShotDurationS}
            onChange={(event) =>
              onChange({
                ...settings,
                maxShotDurationS: Math.max(1, Number(event.target.value) || 1),
              })
            }
          />
        </label>
      </div>
      <div className="flex items-center justify-between rounded-2xl bg-muted px-3 py-2 text-xs">
        <span className="text-muted-foreground">{t("planned")}</span>
        <Badge variant={overLength ? "warning" : "success"} dir="ltr">
          {plannedDurationS.toFixed(1)}s / {settings.totalDurationS}s
        </Badge>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("aspect")}</span>
        <Select
          value={settings.aspectRatio}
          onValueChange={(aspectRatio) => onChange({ ...settings, aspectRatio })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...new Set([settings.aspectRatio, ...aspects])].map((aspect) => (
              <SelectItem key={aspect} value={aspect}>
                {aspect}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {model && model.capabilities.aspectRatios.length === 0 ? (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("aspectFromReference")}
        </p>
      ) : null}
      {resolutions.length > 0 ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("resolution")}</span>
          <Select
            value={settings.resolution ?? resolutions[resolutions.length - 1]}
            onValueChange={(resolution) => onChange({ ...settings, resolution })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resolutions.map((resolution) => (
                <SelectItem key={resolution} value={resolution}>
                  {resolution}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}
      {model && model.capabilities.durations.length === 0 ? (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("fixedDuration")}
        </p>
      ) : null}
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        <span className="flex items-center gap-2">
          <Music4 className="size-4" aria-hidden />
          {t("cutsToMusic")}
        </span>
        <Switch
          checked={settings.cutsMatchedToMusic}
          onCheckedChange={(cutsMatchedToMusic) => onChange({ ...settings, cutsMatchedToMusic })}
        />
      </label>
    </div>
  );
}
