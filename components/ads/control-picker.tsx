"use client";

import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import {
  CONTROL_OPTIONS,
  type MultiChoice,
  type MultiControl,
  type SingleChoice,
  type SingleControl,
} from "@/lib/domain/director";
import { cn } from "@/lib/utils";

/** Soft gradient per option so the pickers read visually, not as a form. */
function swatchFor(index: number): string {
  const hues = [
    "linear-gradient(135deg,#6b0a1f,#c9a66b)",
    "linear-gradient(135deg,#cfa8a4,#f7f3ee)",
    "linear-gradient(135deg,#1c1a1a,#6b0a1f)",
    "linear-gradient(135deg,#c9a66b,#f7f3ee)",
    "linear-gradient(135deg,#4d0011,#cfa8a4)",
    "linear-gradient(135deg,#2b2b2b,#c9a66b)",
    "linear-gradient(135deg,#f7f3ee,#cfa8a4)",
    "linear-gradient(135deg,#4d0011,#111111)",
  ];
  return hues[index % hues.length]!;
}

function Chip({
  active,
  label,
  index,
  onClick,
}: {
  active: boolean;
  label: string;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border py-1 ps-1 pe-3 text-xs transition-all duration-200",
        active
          ? "border-primary bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-foreground shadow-sm"
          : "border-border text-muted-foreground hover:border-ring hover:text-foreground",
      )}
    >
      <span
        className="size-5 shrink-0 rounded-full"
        style={{ background: swatchFor(index) }}
        aria-hidden
      />
      {label}
    </button>
  );
}

export function SingleControlPicker({
  control,
  value,
  onChange,
}: {
  control: SingleControl;
  value: SingleChoice;
  onChange: (value: SingleChoice) => void;
}) {
  const t = useTranslations("director");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t(`controls.${control}`)}</legend>
      <div className="flex flex-wrap gap-1.5">
        {CONTROL_OPTIONS[control].map((option, index) => (
          <Chip
            key={option.id}
            index={index}
            active={value.preset === option.id}
            label={t(`options.${control}.${option.id}` as "options.cameraLens.sony-a7-cinema-50")}
            onClick={() =>
              onChange({ ...value, preset: value.preset === option.id ? null : option.id })
            }
          />
        ))}
      </div>
      <Input
        value={value.custom}
        onChange={(event) => onChange({ ...value, custom: event.target.value })}
        placeholder={t("customPlaceholder")}
        className="h-9 text-xs"
        aria-label={t("customFor", { control: t(`controls.${control}`) })}
      />
    </fieldset>
  );
}

export function MultiControlPicker({
  control,
  value,
  onChange,
}: {
  control: MultiControl;
  value: MultiChoice;
  onChange: (value: MultiChoice) => void;
}) {
  const t = useTranslations("director");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t(`controls.${control}`)}</legend>
      <div className="flex flex-wrap gap-1.5">
        {CONTROL_OPTIONS[control].map((option, index) => {
          const active = value.presets.includes(option.id);
          return (
            <Chip
              key={option.id}
              index={index}
              active={active}
              label={t(`options.${control}.${option.id}` as "options.cameraLens.sony-a7-cinema-50")}
              onClick={() =>
                onChange({
                  ...value,
                  presets: active
                    ? value.presets.filter((id) => id !== option.id)
                    : [...value.presets, option.id],
                })
              }
            />
          );
        })}
      </div>
      <Input
        value={value.custom}
        onChange={(event) => onChange({ ...value, custom: event.target.value })}
        placeholder={t("customPlaceholder")}
        className="h-9 text-xs"
        aria-label={t("customFor", { control: t(`controls.${control}`) })}
      />
    </fieldset>
  );
}
