"use client";

import { AlertTriangle, FlaskConical, Images, ShieldCheck, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelOption } from "@/lib/providers/higgsfield/options";

export function ModelPicker({
  models,
  value,
  onChange,
  label,
  id,
}: {
  models: ModelOption[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
  id?: string;
}) {
  const t = useTranslations("models");
  const selected = models.find((model) => model.id === value) ?? null;
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      ) : null}
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={t("choose")} />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id} disabled={model.disabledReason !== null}>
              {model.label}
              {model.disabledReason ? ` — ${t("incompatible")}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? <ModelCapabilitiesSummary model={selected} /> : null}
    </div>
  );
}

export function ModelCapabilitiesSummary({ model }: { model: ModelOption }) {
  const t = useTranslations("models");
  const caps = model.capabilities;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {caps.modes.map((mode) => (
          <Badge key={mode} variant="muted">
            {t(`modes.${mode}`)}
          </Badge>
        ))}
        <Badge variant="muted">
          <Images aria-hidden />
          {t("references", { count: caps.maxReferenceImages })}
        </Badge>
        {caps.maxDurationS ? (
          <Badge variant="muted">{t("maxDuration", { seconds: caps.maxDurationS })}</Badge>
        ) : null}
        {model.source === "mock" ? (
          <Badge variant="warning">
            <FlaskConical aria-hidden />
            {t("sources.mock")}
          </Badge>
        ) : model.source === "custom" ? (
          <Badge variant="champagne">
            <UserCog aria-hidden />
            {t("sources.custom")}
          </Badge>
        ) : (
          <Badge variant="success">
            <ShieldCheck aria-hidden />
            {t(`sources.${model.source}`)}
          </Badge>
        )}
      </div>
      {caps.aspectRatios.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("aspectRatios")}: <span dir="ltr">{caps.aspectRatios.join(" · ")}</span>
        </p>
      ) : null}
      {model.unverifiedOptions ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden />
          {t("unverified")}
        </p>
      ) : null}
    </div>
  );
}
