"use client";

import { Minus, Plus, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { MultiControlPicker, SingleControlPicker } from "@/components/ads/control-picker";
import { Slider, Switch } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";
import type { DirectorControls } from "@/lib/domain/director";

const GROUPS = [
  {
    key: "camera",
    single: ["cameraLens", "visualStyle"],
    multi: ["cameraAngles", "cameraMovements"],
  },
  { key: "light", single: ["lighting", "timeOfDay", "colorGrading"], multi: [] },
  { key: "set", single: ["location"], multi: ["decorProps", "productPlacements"] },
  { key: "story", single: ["hookType", "adStructure", "moodMusic"], multi: [] },
] as const;

export function DirectorControlsPanel({
  controls,
  onChange,
}: {
  controls: DirectorControls;
  onChange: (controls: DirectorControls) => void;
}) {
  const t = useTranslations("director");
  return (
    <div className="flex flex-col gap-7">
      {GROUPS.map((group) => (
        <section key={group.key} className="flex flex-col gap-5">
          <h3 className="text-xs font-semibold tracking-[0.18em] text-champagne-ink uppercase">
            {t(`groups.${group.key}`)}
          </h3>
          {group.single.map((control) => (
            <SingleControlPicker
              key={control}
              control={control}
              value={controls[control]}
              onChange={(value) => onChange({ ...controls, [control]: value })}
            />
          ))}
          {group.multi.map((control) => (
            <MultiControlPicker
              key={control}
              control={control}
              value={controls[control]}
              onChange={(value) => onChange({ ...controls, [control]: value })}
            />
          ))}
        </section>
      ))}

      <section className="flex flex-col gap-5">
        <h3 className="text-xs font-semibold tracking-[0.18em] text-champagne-ink uppercase">
          {t("groups.rhythm")}
        </h3>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t("controls.shotCount")}</span>
          <div className="inline-flex items-center gap-1 rounded-full p-1 glass">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("fewerShots")}
              onClick={() =>
                onChange({ ...controls, shotCount: Math.max(1, controls.shotCount - 1) })
              }
            >
              <Minus aria-hidden />
            </Button>
            <span className="w-8 text-center text-sm font-semibold" dir="ltr">
              {controls.shotCount}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("moreShots")}
              onClick={() =>
                onChange({ ...controls, shotCount: Math.min(12, controls.shotCount + 1) })
              }
            >
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{t("controls.shotDurationS")}</span>
            <span className="text-muted-foreground" dir="ltr">
              {controls.shotDurationS.toFixed(1)}s
            </span>
          </div>
          <Slider
            min={1}
            max={10}
            step={0.5}
            value={[controls.shotDurationS]}
            onValueChange={([value]) =>
              onChange({ ...controls, shotDurationS: value ?? controls.shotDurationS })
            }
            aria-label={t("controls.shotDurationS")}
          />
        </div>
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span className="flex items-center gap-2">
            <UserRound className="size-4" aria-hidden />
            {t("controls.humanModel")}
          </span>
          <Switch
            checked={controls.humanModel}
            onCheckedChange={(humanModel) => onChange({ ...controls, humanModel })}
          />
        </label>
      </section>
    </div>
  );
}
