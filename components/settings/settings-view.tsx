"use client";

import {
  Bot,
  CheckCircle2,
  ChevronDown,
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
import { RadioGroup } from "radix-ui";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { CustomModelsEditor } from "@/components/settings/custom-models-editor";
import { DerivativesCard } from "@/components/settings/derivatives-card";
import { GuestsCard } from "@/components/settings/guests-card";
import { PasswordCard } from "@/components/settings/password-card";
import { ModelCapabilitiesSummary, ModelSelectItems } from "@/components/generation/model-picker";
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
import type { HiggsfieldKeyForm, KeyStatus } from "@/lib/env";
import type { CredentialCheck } from "@/lib/providers/higgsfield/client";
import { groupByFamily } from "@/lib/providers/higgsfield/model-groups";
import type { GuestAccount } from "@/lib/auth/guests";
import type { ModelOption } from "@/lib/providers/higgsfield/options";
import type { CostSummary } from "@/lib/settings/costs";
import type { DriveSettings } from "@/lib/settings/service";
import { cn } from "@/lib/utils";

type SettingsData = {
  llmProvider: "claude" | "gemini" | "gateway";
  claudeModel: string | null;
  geminiModel: string | null;
  gatewayModel: string | null;
  /** The gateway asked first under "Free gateways"; null keeps the default order. */
  gatewayFirst: string | null;
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
  higgsfieldKey,
  higgsfieldKeyForm,
  imageModels,
  videoModels,
  costs,
  gateway,
  guests,
}: {
  settings: SettingsData;
  brain: { provider: string; model: string; chain: string[] };
  defaults: { claude: string; gemini: string; gateway: string };
  gateway: GatewayInfo;
  keys: KeyStatus;
  providerMode: "higgsfield" | "mock";
  /** What Higgsfield said about the key (null in mock mode). */
  higgsfieldKey: CredentialCheck | null;
  /** How the key was read from the environment (never the key itself). */
  higgsfieldKeyForm: HiggsfieldKeyForm | null;
  imageModels: ModelOption[];
  videoModels: ModelOption[];
  costs: CostSummary;
  /** Accounts allowed into Generate only, with their histories. */
  guests: GuestAccount[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <BrainCard
        settings={settings}
        brain={brain}
        defaults={defaults}
        keys={keys}
        gateway={gateway}
      />
      <CatalogueStyleCard style={settings.catalogueStyle} />
      <ModelsCard
        settings={settings}
        providerMode={providerMode}
        keyRejected={higgsfieldKey === "rejected"}
        imageModels={imageModels}
        videoModels={videoModels}
      />
      <div className="flex flex-col gap-6">
        <KeysCard
          keys={keys}
          higgsfieldRejected={higgsfieldKey === "rejected"}
          higgsfieldForm={higgsfieldKeyForm}
        />
        <DriveCard drive={settings.drive} configured={keys.googleDrive} />
        <GuestsCard guests={guests} />
        <DerivativesCard />
        <PasswordCard />
      </div>
      <CostCard costs={costs} />
    </div>
  );
}

/**
 * The owner's own gateway, when configured (its name and the models it
 * lists), and every configured gateway in the order the brain asks them.
 */
type GatewayInfo = {
  name: string | null;
  models: string[];
  configured: { id: string; name: string; model: string | null }[];
};

const BRAIN_PROVIDERS = ["claude", "gemini", "gateway"] as const;

function BrainCard({
  settings,
  brain,
  defaults,
  keys,
  gateway,
}: {
  settings: SettingsData;
  brain: { provider: string; model: string; chain: string[] };
  defaults: { claude: string; gemini: string; gateway: string };
  keys: KeyStatus;
  gateway: GatewayInfo;
}) {
  const t = useTranslations("settings.brain");
  const { pending, save } = useSave();
  const [provider, setProvider] = useState(settings.llmProvider);
  const [claudeModel, setClaudeModel] = useState(settings.claudeModel ?? "");
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel ?? "");
  const [gatewayModel, setGatewayModel] = useState(settings.gatewayModel ?? "");
  const [gatewayFirst, setGatewayFirst] = useState(settings.gatewayFirst);
  const firstGateway =
    gateway.configured.find((item) => item.id === gatewayFirst)?.id ??
    gateway.configured[0]?.id ??
    null;
  const configured = {
    claude: keys.anthropic,
    gemini: keys.gemini,
    gateway: gateway.configured.length > 0,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-5 text-accent-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <RadioGroup.Root
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          aria-label={t("provider")}
          value={provider}
          onValueChange={(value) => setProvider(value as typeof provider)}
        >
          {BRAIN_PROVIDERS.map((option) => (
            <RadioGroup.Item
              key={option}
              value={option}
              className="rounded-(--radius-control) border border-border p-4 text-start transition-[border-color,background-color] outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:border-primary data-[state=checked]:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
            >
              <span className="block font-heading text-lg">{t(`providers.${option}`)}</span>
              {option === "gateway" ? (
                <span className="block text-xs text-muted-foreground">
                  {gateway.configured.length > 0
                    ? gateway.configured.map((item) => item.name).join(" · ")
                    : t("gatewayNone")}
                </span>
              ) : null}
              <span className={cn("text-xs", configured[option] ? "text-success" : "text-warning")}>
                {configured[option] ? t("keyConfigured") : t("keyMissing")}
              </span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <div className="grid gap-3 sm:grid-cols-3">
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="gateway-model">{t("gatewayModel")}</Label>
            <Input
              id="gateway-model"
              dir="ltr"
              list={gateway.models.length > 0 ? "gateway-models" : undefined}
              value={gatewayModel}
              placeholder={defaults.gateway}
              aria-describedby="gateway-model-hint"
              onChange={(event) => setGatewayModel(event.target.value)}
            />
            {gateway.models.length > 0 ? (
              <datalist id="gateway-models">
                {gateway.models.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            ) : null}
          </div>
        </div>
        <p id="gateway-model-hint" className="text-xs text-muted-foreground">
          {keys.gateway ? t("gatewayHint") : t("gatewayMissing")}
        </p>
        <p className="text-xs text-muted-foreground">{t("gatewayChain")}</p>
        {provider === "gateway" && gateway.configured.length > 1 ? (
          <div className="flex flex-col gap-2">
            <Label id="gateway-first-label">{t("gatewayFirst")}</Label>
            <RadioGroup.Root
              className="flex flex-wrap gap-2"
              aria-labelledby="gateway-first-label"
              value={firstGateway ?? undefined}
              onValueChange={(value) => setGatewayFirst(value)}
            >
              {gateway.configured.map((item) => (
                <RadioGroup.Item
                  key={item.id}
                  value={item.id}
                  className="rounded-full border border-border px-4 py-1.5 text-sm transition-[border-color,background-color] outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:border-primary data-[state=checked]:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                >
                  {item.name}
                </RadioGroup.Item>
              ))}
            </RadioGroup.Root>
            <p className="text-xs text-muted-foreground">{t("gatewayFirstHint")}</p>
          </div>
        ) : null}
        {provider === "gemini" ? (
          <p className="text-xs text-muted-foreground">{t("geminiHint")}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={pending}
            onClick={() =>
              save({
                llmProvider: provider,
                claudeModel: claudeModel.trim() || null,
                geminiModel: geminiModel.trim() || null,
                gatewayModel: gatewayModel.trim() || null,
                // Only sent when changed, so a database without the column still saves the rest.
                ...(gatewayFirst !== settings.gatewayFirst ? { gatewayFirst } : {}),
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
            {t("save")}
          </Button>
          <Badge variant={brain.provider === "mock" ? "warning" : "accent"}>
            {t("active", { provider: brain.provider, model: brain.model })}
          </Badge>
        </div>
        {brain.chain.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            {t("chain")} <bdi dir="ltr">{brain.chain.join(" → ")}</bdi>
          </p>
        ) : null}
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
          <Palette className="size-5 text-accent-ink" aria-hidden />
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
              <Label id="style-aspect-label">{t("aspect")}</Label>
              <Select
                value={value.aspectRatio}
                onValueChange={(aspectRatio) =>
                  setValue({ ...value, aspectRatio: aspectRatio as CatalogueStyle["aspectRatio"] })
                }
              >
                <SelectTrigger aria-labelledby="style-aspect-label">
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
              <Label id="style-shadow-label">{t("shadow")}</Label>
              <Select
                value={value.shadow}
                onValueChange={(shadow) =>
                  setValue({ ...value, shadow: shadow as CatalogueStyle["shadow"] })
                }
              >
                <SelectTrigger aria-labelledby="style-shadow-label">
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
            role="img"
            className="flex w-full items-center justify-center rounded-(--radius-control) border border-border shadow-inner"
            style={{
              background: value.background,
              aspectRatio: `${w} / ${h}`,
              padding: `${value.paddingPercent}%`,
            }}
            aria-label={t("preview")}
          >
            {/* A neutral stand-in garment: the preview is about background, padding and shadow. */}
            <div className="size-full rounded-[40%_40%_12%_12%] bg-[linear-gradient(160deg,#a3a3a3,#4d4d4d)] opacity-80" />
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
  keyRejected,
  imageModels,
  videoModels,
}: {
  settings: SettingsData;
  providerMode: "higgsfield" | "mock";
  keyRejected: boolean;
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
          <Shapes className="size-5 text-accent-ink" aria-hidden />
          {t("title")}
          {keyRejected ? (
            <Badge variant="danger">{t("provider.rejected")}</Badge>
          ) : (
            <Badge variant={providerMode === "mock" ? "warning" : "success"}>
              {t(`provider.${providerMode}`)}
            </Badge>
          )}
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
              <Label id={`default-${kind}-label`}>{t(`default.${kind}`)}</Label>
              <Select value={value} onValueChange={setter}>
                <SelectTrigger aria-labelledby={`default-${kind}-label`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">{t("auto")}</SelectItem>
                  <ModelSelectItems models={models} />
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
        <div className="flex flex-col gap-3">
          {groupByFamily([...imageModels, ...videoModels]).map(({ family, models }) => (
            <details
              key={family ?? "__other"}
              className="group rounded-(--radius-control) border border-border"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-(--radius-control) p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                  <span className="font-medium">{family ?? t("otherModels")}</span>
                  {family && models[0]?.description ? (
                    <span className="text-xs text-muted-foreground">
                      {/* Docs descriptions are English: isolate them so RTL keeps their punctuation. */}
                      <bdi>{models[0].description}</bdi>
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">{t(`kinds.${models[0]!.kind}`)}</Badge>
                  <Badge variant="muted">{t("workflows", { count: models.length })}</Badge>
                  <ChevronDown
                    className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </span>
              </summary>
              <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2 xl:grid-cols-3">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="rounded-(--radius-control) border border-border p-4"
                  >
                    <div className="mb-2">
                      <p className="font-medium">{model.label}</p>
                      <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {model.id}
                      </p>
                    </div>
                    {!family && model.description ? (
                      <p className="mb-2 text-xs text-muted-foreground">
                        <bdi>{model.description}</bdi>
                      </p>
                    ) : null}
                    <ModelCapabilitiesSummary model={model} />
                    {model.sourceNote ? (
                      <p className="mt-2 text-xs break-words text-muted-foreground" dir="ltr">
                        {model.sourceNote}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
        <CustomModelsEditor initialJson={settings.customModelsJson} />
      </CardContent>
    </Card>
  );
}

function KeysCard({
  keys,
  higgsfieldRejected,
  higgsfieldForm,
}: {
  keys: KeyStatus;
  higgsfieldRejected: boolean;
  higgsfieldForm: HiggsfieldKeyForm | null;
}) {
  const t = useTranslations("settings.keys");
  // A rejected key says how it was read, so a paste slip shows without the key.
  const rows: [string, boolean | "rejected", string?][] = [
    ["Supabase", keys.supabase],
    [t("serviceRole"), keys.supabaseServiceRole],
    [
      "Higgsfield",
      higgsfieldRejected ? "rejected" : keys.higgsfield,
      higgsfieldRejected && higgsfieldForm ? t(`readAs.${higgsfieldForm}`) : undefined,
    ],
    [t("webhook"), keys.higgsfieldWebhook],
    ["Anthropic (Claude)", keys.anthropic],
    ["Google Gemini", keys.gemini],
    ["Mistral", keys.mistral],
    ["Z.ai (GLM)", keys.zai],
    ["OpenRouter", keys.openrouter],
    [t("gateway"), keys.gateway],
    ["Google Drive", keys.googleDrive],
    [t("ownerEmail"), keys.ownerEmail],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5 text-accent-ink" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {rows.map(([label, state, hint]) => (
            <li key={label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="flex flex-col gap-0.5">
                <span>{label}</span>
                {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5",
                  state === "rejected"
                    ? "text-destructive"
                    : state
                      ? "text-success"
                      : "text-muted-foreground",
                )}
              >
                {state === true ? (
                  <CheckCircle2 className="size-4" aria-hidden />
                ) : (
                  <XCircle className="size-4" aria-hidden />
                )}
                {state === "rejected" ? t("rejected") : state ? t("configured") : t("missing")}
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
          <Cloud className="size-5 text-accent-ink" aria-hidden />
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
            variant="surface"
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
          <Coins className="size-5 text-accent-ink" aria-hidden />
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
            <div key={label} className="rounded-(--radius-control) border border-border p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-editorial text-4xl" dir="ltr">
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
                className="flex items-center justify-between rounded-(--radius-control) border border-border px-3 py-2 text-sm"
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
