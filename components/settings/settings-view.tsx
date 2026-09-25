"use client";

import {
  Bot,
  CheckCircle2,
  Cloud,
  Coins,
  KeyRound,
  Loader2,
  Palette,
  Save,
  Shapes,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CustomModelsEditor } from "@/components/settings/custom-models-editor";
import { PasswordCard } from "@/components/settings/password-card";
import { ModelCapabilitiesSummary } from "@/components/generation/model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider, Switch } from "@/components/ui/controls";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateSettingsAction } from "@/lib/actions/settings";
import {
  CATALOGUE_ASPECT_RATIOS,
  CATALOGUE_SHADOWS,
  type CatalogueStyle,
} from "@/lib/domain/catalogue-style";
import type { KeyStatus } from "@/lib/env";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import type { CostSummary } from "@/lib/settings/costs";
import type { DriveSettings } from "@/lib/settings/service";
import { cn } from "@/lib/utils";

type SettingsData = {
  llmProvider: "claude" | "gemini";
  claudeModel: string | null;
  geminiModel: string | null;
  catalogueStyle: CatalogueStyle;
  defaultImageModel: string | null;
  defaultVideoModel: string | null;
  customModelsJson: string;
  drive: DriveSettings;
};

function useSave() {
  const router = useRouter();
  const t = useTranslations("settings");
  const [pending, startTransition] = useTransition();
  return {
    pending,
    save: (input: Record<string, unknown>) =>
      startTransition(async () => {
        const result = await updateSettingsAction(input);
        if (!result.ok) toast.error(result.error);
        else {
          toast.success(t("saved"));
          router.refresh();
        }
      }),
  };
}

export function SettingsView({
  settings,
  brain,
  defaults,
  keys,
  providerMode,
  imageModels,
  videoModels,
  costs,
}: {
  settings: SettingsData;
  brain: { provider: string; model: string };
  defaults: { claude: string; gemini: string };
  keys: KeyStatus;
  providerMode: "higgsfield" | "mock";
  imageModels: ModelOption[];
  videoModels: ModelOption[];
  costs: CostSummary;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <BrainCard settings={settings} brain={brain} defaults={defaults} keys={keys} />
      <CatalogueStyleCard style={settings.catalogueStyle} />
      <ModelsCard
        settings={settings}
        providerMode={providerMode}
        imageModels={imageModels}
        videoModels={videoModels}
      />
      <div className="flex flex-col gap-6">
        <KeysCard keys={keys} />
        <DriveCard drive={settings.drive} configured={keys.googleDrive} />
        <PasswordCard />
      </div>
      <CostCard costs={costs} />
    </div>
  );
}

function BrainCard({
  settings,
  brain,
  defaults,
  keys,
}: {
  settings: SettingsData;
  brain: { provider: string; model: string };
  defaults: { claude: string; gemini: string };
  keys: KeyStatus;
}) {
  const t = useTranslations("settings.brain");
  const { pending, save } = useSave();
  const [provider, setProvider] = useState(settings.llmProvider);
  const [claudeModel, setClaudeModel] = useState(settings.claudeModel ?? "");
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("provider")}>
          {(["claude", "gemini"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={provider === option}
              onClick={() => setProvider(option)}
              className={cn(
                "rounded-2xl p-4 text-start glass transition-all",
                provider === option && "ring-2 ring-primary",
              )}
            >
              <span className="block font-display text-lg font-semibold">
                {t(`providers.${option}`)}
              </span>
              <span
                className={cn(
                  "text-xs",
                  (option === "claude" ? keys.anthropic : keys.gemini)
                    ? "text-success"
                    : "text-warning",
                )}
              >
                {(option === "claude" ? keys.anthropic : keys.gemini)
                  ? t("keyConfigured")
                  : t("keyMissing")}
              </span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="claude-model">{t("claudeModel")}</Label>
            <Input
              id="claude-model"
              dir="ltr"
              value={claudeModel}
              placeholder={defaults.claude}
              onChange={(event) => setClaudeModel(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="gemini-model">{t("geminiModel")}</Label>
            <Input
              id="gemini-model"
              dir="ltr"
              value={geminiModel}
              placeholder={defaults.gemini}
              onChange={(event) => setGeminiModel(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              save({
                llmProvider: provider,
                claudeModel: claudeModel.trim() || null,
                geminiModel: geminiModel.trim() || null,
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("save")}
          </Button>
          <Badge variant={brain.provider === "mock" ? "warning" : "champagne"}>
            {t("active", { provider: brain.provider, model: brain.model })}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CatalogueStyleCard({ style }: { style: CatalogueStyle }) {
  const t = useTranslations("settings.style");
  const { pending, save } = useSave();
  const [value, setValue] = useState<CatalogueStyle>(style);
  const [w, h] = value.aspectRatio.split(":").map(Number) as [number, number];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="style-bg">{t("background")}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value.background}
                onChange={(event) =>
                  setValue({ ...value, background: event.target.value.toUpperCase() })
                }
                className="size-10 cursor-pointer rounded-full border-0 bg-transparent p-0"
                aria-label={t("background")}
              />
              <Input
                id="style-bg"
                dir="ltr"
                className="font-mono uppercase"
                value={value.background}
                onChange={(event) => setValue({ ...value, background: event.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>{t("aspect")}</Label>
              <Select
                value={value.aspectRatio}
                onValueChange={(aspectRatio) =>
                  setValue({ ...value, aspectRatio: aspectRatio as CatalogueStyle["aspectRatio"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATALOGUE_ASPECT_RATIOS.map((ratio) => (
                    <SelectItem key={ratio} value={ratio}>
                      {ratio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("shadow")}</Label>
              <Select
                value={value.shadow}
                onValueChange={(shadow) =>
                  setValue({ ...value, shadow: shadow as CatalogueStyle["shadow"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATALOGUE_SHADOWS.map((shadow) => (
                    <SelectItem key={shadow} value={shadow}>
                      {t(`shadows.${shadow}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex justify-between text-sm">
              <Label>{t("padding")}</Label>
              <span className="text-muted-foreground" dir="ltr">
                {value.paddingPercent}%
              </span>
            </div>
            <Slider
              min={0}
              max={30}
              step={1}
              value={[value.paddingPercent]}
              onValueChange={([padding]) =>
                setValue({ ...value, paddingPercent: padding ?? value.paddingPercent })
              }
              aria-label={t("padding")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="style-light">{t("lighting")}</Label>
            <Textarea
              id="style-light"
              value={value.lighting}
              onChange={(event) => setValue({ ...value, lighting: event.target.value })}
              className="min-h-16"
            />
          </div>
          <Button
            className="w-fit"
            disabled={pending}
            onClick={() => save({ catalogueStyle: value })}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("save")}
          </Button>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div
            className="flex w-full items-center justify-center rounded-xl border border-border shadow-inner"
            style={{
              background: value.background,
              aspectRatio: `${w} / ${h}`,
              padding: `${value.paddingPercent}%`,
            }}
            aria-label={t("preview")}
          >
            <div className="size-full rounded-[40%_40%_12%_12%] bg-[linear-gradient(160deg,#cfa8a4,#6b0a1f)] opacity-80" />
          </div>
          <span className="text-xs text-muted-foreground">{t("preview")}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ModelsCard({
  settings,
  providerMode,
  imageModels,
  videoModels,
}: {
  settings: SettingsData;
  providerMode: "higgsfield" | "mock";
  imageModels: ModelOption[];
  videoModels: ModelOption[];
}) {
  const t = useTranslations("settings.models");
  const { pending, save } = useSave();
  const [image, setImage] = useState(settings.defaultImageModel ?? "__auto");
  const [video, setVideo] = useState(settings.defaultVideoModel ?? "__auto");
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shapes className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
          <Badge variant={providerMode === "mock" ? "warning" : "success"}>
            {t(`provider.${providerMode}`)}
          </Badge>
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          {(
            [
              ["image", image, setImage, imageModels],
              ["video", video, setVideo, videoModels],
            ] as const
          ).map(([kind, value, setter, models]) => (
            <div key={kind} className="flex flex-col gap-2">
              <Label>{t(`default.${kind}`)}</Label>
              <Select value={value} onValueChange={setter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">{t("auto")}</SelectItem>
                  {models.map((model) => (
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
            </div>
          ))}
          <Button
            disabled={pending}
            onClick={() =>
              save({
                defaultImageModel: image === "__auto" ? null : image,
                defaultVideoModel: video === "__auto" ? null : video,
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("save")}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...imageModels, ...videoModels].map((model) => (
            <div key={model.id} className="rounded-2xl bg-muted p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{model.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground" dir="ltr">
                    {model.id}
                  </p>
                </div>
                <Badge variant="outline">{t(`kinds.${model.kind}`)}</Badge>
              </div>
              {model.description ? (
                <p className="mb-2 text-xs text-muted-foreground">{model.description}</p>
              ) : null}
              <ModelCapabilitiesSummary model={model} />
              {model.sourceNote ? (
                <p className="mt-2 text-[11px] text-muted-foreground">{model.sourceNote}</p>
              ) : null}
            </div>
          ))}
        </div>
        <CustomModelsEditor initialJson={settings.customModelsJson} />
      </CardContent>
    </Card>
  );
}

function KeysCard({ keys }: { keys: KeyStatus }) {
  const t = useTranslations("settings.keys");
  const rows: [string, boolean][] = [
    ["Supabase", keys.supabase],
    [t("serviceRole"), keys.supabaseServiceRole],
    ["Higgsfield", keys.higgsfield],
    [t("webhook"), keys.higgsfieldWebhook],
    ["Anthropic (Claude)", keys.anthropic],
    ["Google Gemini", keys.gemini],
    ["Google Drive", keys.googleDrive],
    [t("ownerEmail"), keys.ownerEmail],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {rows.map(([label, ok]) => (
            <li key={label} className="flex items-center justify-between py-2.5 text-sm">
              <span>{label}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5",
                  ok ? "text-success" : "text-muted-foreground",
                )}
              >
                {ok ? (
                  <CheckCircle2 className="size-4" aria-hidden />
                ) : (
                  <XCircle className="size-4" aria-hidden />
                )}
                {ok ? t("configured") : t("missing")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DriveCard({ drive, configured }: { drive: DriveSettings; configured: boolean }) {
  const t = useTranslations("settings.drive");
  const { pending, save } = useSave();
  const [folderId, setFolderId] = useState(drive.folderId ?? "");
  const [folderName, setFolderName] = useState(drive.folderName ?? "");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
          <Badge variant="muted">{t("phase")}</Badge>
        </CardTitle>
        <CardDescription>{configured ? t("hintConfigured") : t("hintMissing")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="drive-folder">{t("folderId")}</Label>
            <Input
              id="drive-folder"
              dir="ltr"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="drive-name">{t("folderName")}</Label>
            <Input
              id="drive-name"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm text-muted-foreground">
          <Switch checked={false} disabled />
          {t("autoMirror")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="glass"
            disabled={pending}
            onClick={() =>
              save({
                drive: {
                  folderId: folderId.trim() || null,
                  folderName: folderName.trim() || null,
                  autoMirror: false,
                },
              })
            }
          >
            <Save aria-hidden />
            {t("save")}
          </Button>
          <Button variant="outline" disabled>
            {t("connect")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CostCard({ costs }: { costs: CostSummary }) {
  const t = useTranslations("settings.costs");
  const tp = useTranslations("library.purposes");
  const money = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-5 text-champagne-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [
              t("thisMonth"),
              `$${money(costs.thisMonth.usd)}`,
              t("creditsValue", { value: money(costs.thisMonth.credits) }),
            ],
            [
              t("allTime"),
              `$${money(costs.allTime.usd)}`,
              t("creditsValue", { value: money(costs.allTime.credits) }),
            ],
            [
              t("generations"),
              String(costs.generations.total),
              t("split", { images: costs.generations.images, videos: costs.generations.videos }),
            ],
            [
              t("success"),
              String(costs.generations.completed),
              t("failedValue", { count: costs.generations.failed }),
            ],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-2xl bg-muted p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-display text-3xl font-semibold" dir="ltr">
                {value}
              </p>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>
        {costs.byPurpose.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {costs.byPurpose.map((row) => (
              <li
                key={row.purpose}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm"
              >
                <span>{tp(row.purpose as "ghost_front")}</span>
                <span className="text-muted-foreground" dir="ltr">
                  {row.count}
                  {row.usd > 0 ? ` · $${money(row.usd)}` : ""}
                  {row.credits > 0 ? ` · ${money(row.credits)} cr` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {costs.unpricedCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("unpriced", { count: costs.unpricedCount })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
