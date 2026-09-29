import "server-only";

import { llmGatewayConfigs, serverEnv, type LlmGatewayId } from "@/lib/env";
import { ChainBrain, type ChainMember } from "@/lib/providers/llm/chain";
import { ClaudeBrain, DEFAULT_CLAUDE_MODEL } from "@/lib/providers/llm/claude";
import { GatewayBrain } from "@/lib/providers/llm/gateway";
import { DEFAULT_GEMINI_MODEL, GeminiBrain } from "@/lib/providers/llm/gemini";
import { MockBrain } from "@/lib/providers/llm/mock";
import type { DirectorBrain, LlmImageHost } from "@/lib/providers/llm/types";

/** The brain part of the owner's settings. */
export type BrainPreferences = {
  llmProvider: "claude" | "gemini" | "gateway";
  claudeModel?: string | null;
  geminiModel?: string | null;
  /** The model at the owner's own gateway (LLM_GATEWAY_*); the free services have their own. */
  gatewayModel?: string | null;
  /** The gateway asked first under "Free gateways"; the others keep their order after it. */
  gatewayFirst?: LlmGatewayId | null;
};

export type BrainOptions = {
  /** Links for photos, which a gateway brain sends instead of inline image data. */
  imageHost?: LlmImageHost;
};

/**
 * The director brain from Settings: every configured brain, in order of
 * preference, as one chain. The chosen provider comes first ("gateway" means
 * the gateways in their order: Mistral, Z.ai, OpenRouter, then the owner's
 * own), and the others follow, so a limit or an outage at one brain moves
 * the call to the next. With nothing configured, the mock brain keeps the
 * app usable. `brain.provider` and `brain.model` tell the UI which one
 * answered.
 */
export function getDirectorBrain(
  preferences: BrainPreferences,
  options: BrainOptions = {},
): DirectorBrain {
  const env = serverEnv();
  const claudeModel =
    preferences.claudeModel?.trim() || env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
  const geminiModel = preferences.geminiModel?.trim() || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

  const configs = llmGatewayConfigs();
  const first = preferences.gatewayFirst ?? null;
  const gateways = [
    ...configs.filter((config) => config.id === first),
    ...configs.filter((config) => config.id !== first),
  ].flatMap((config): ChainMember[] => {
    // A custom gateway serves many models and has no sensible default: it needs a model id.
    const model =
      config.id === "custom" ? preferences.gatewayModel?.trim() || config.model : config.model;
    if (!model) return [];
    return [
      {
        key: `${config.id}|${config.baseUrl}|${model}`,
        label: `${config.name} · ${model}`,
        brain: new GatewayBrain({ ...config, model }, options.imageHost),
      },
    ];
  });
  const claude: ChainMember[] = env.ANTHROPIC_API_KEY
    ? [
        {
          key: `claude|${claudeModel}`,
          label: `Claude · ${claudeModel}`,
          brain: new ClaudeBrain(env.ANTHROPIC_API_KEY, claudeModel),
        },
      ]
    : [];
  const gemini: ChainMember[] = env.GEMINI_API_KEY
    ? [
        {
          key: `gemini|${geminiModel}`,
          label: `Gemini · ${geminiModel}`,
          brain: new GeminiBrain(env.GEMINI_API_KEY, geminiModel),
        },
      ]
    : [];

  const ordered = {
    claude: [...claude, ...gemini, ...gateways],
    gemini: [...gemini, ...claude, ...gateways],
    gateway: [...gateways, ...claude, ...gemini],
  }[preferences.llmProvider];
  if (ordered.length === 0) return new MockBrain();
  if (ordered.length === 1) return ordered[0]!.brain;
  return new ChainBrain(ordered);
}

export { DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL };
export type { DirectorBrain } from "@/lib/providers/llm/types";
