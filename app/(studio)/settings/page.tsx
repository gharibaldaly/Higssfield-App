import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/common/page-header";
import { SettingsView } from "@/components/settings/settings-view";
import { requireOwner } from "@/lib/auth/owner";
import { keyStatus } from "@/lib/env";
import { ownerRegistry } from "@/lib/generations/models";
import { toModelOptions } from "@/lib/providers/higgsfield/options";
import { activeProviderMode } from "@/lib/providers/higgsfield";
import { DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL, getDirectorBrain } from "@/lib/providers/llm";
import { loadCostSummary } from "@/lib/settings/costs";
import { getOwnerSettings } from "@/lib/settings/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function SettingsPage() {
  const { supabase, user } = await requireOwner();
  const t = await getTranslations("settings");
  const [settings, costs] = await Promise.all([
    getOwnerSettings(supabase, user.id),
    loadCostSummary(supabase),
  ]);
  const registry = await ownerRegistry(settings);
  const brain = getDirectorBrain({
    provider: settings.llmProvider,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
  });
  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <SettingsView
        settings={{
          llmProvider: settings.llmProvider,
          claudeModel: settings.claudeModel,
          geminiModel: settings.geminiModel,
          catalogueStyle: settings.catalogueStyle,
          defaultImageModel: settings.defaultImageModel,
          defaultVideoModel: settings.defaultVideoModel,
          customModelsJson: JSON.stringify(settings.customModels, null, 2),
          drive: settings.drive,
        }}
        brain={{ provider: brain.provider, model: brain.model }}
        defaults={{ claude: DEFAULT_CLAUDE_MODEL, gemini: DEFAULT_GEMINI_MODEL }}
        keys={keyStatus()}
        providerMode={activeProviderMode()}
        imageModels={toModelOptions(registry, "image", ["image-to-image", "text-to-image"])}
        videoModels={toModelOptions(registry, "video", ["image-to-video"])}
        costs={costs}
      />
    </>
  );
}
