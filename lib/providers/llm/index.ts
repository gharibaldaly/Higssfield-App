import "server-only";

import { llmGatewayConfig, serverEnv } from "@/lib/env";
import { ClaudeBrain, DEFAULT_CLAUDE_MODEL } from "@/lib/providers/llm/claude";
import { GatewayBrain } from "@/lib/providers/llm/gateway";
import { DEFAULT_GEMINI_MODEL, GeminiBrain } from "@/lib/providers/llm/gemini";
import { MockBrain } from "@/lib/providers/llm/mock";
import type { DirectorBrain } from "@/lib/providers/llm/types";

/** The brain part of the owner's settings. */
export type BrainPreferences = {
  llmProvider: "claude" | "gemini" | "gateway";
  claudeModel?: string | null;
  geminiModel?: string | null;
  gatewayModel?: string | null;
};

/**
 * Picks the director brain from Settings. If the chosen provider is not
 * configured, the next configured one is used (Claude, Gemini, then the
 * gateway); with none at all, the mock brain keeps the app usable.
 * `brain.provider` tells the UI which one answered.
 */
export function getDirectorBrain(preferences: BrainPreferences): DirectorBrain {
  const env = serverEnv();
  const claudeModel =
    preferences.claudeModel?.trim() || env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
  const geminiModel = preferences.geminiModel?.trim() || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const gatewayConfig = llmGatewayConfig();
  // A gateway serves many models and has no sensible default: it needs a model id.
  const gatewayModel = preferences.gatewayModel?.trim() || gatewayConfig?.model || null;

  const claude = env.ANTHROPIC_API_KEY
    ? () => new ClaudeBrain(env.ANTHROPIC_API_KEY!, claudeModel)
    : null;
  const gemini = env.GEMINI_API_KEY
    ? () => new GeminiBrain(env.GEMINI_API_KEY!, geminiModel)
    : null;
  const gateway =
    gatewayConfig && gatewayModel
      ? () => new GatewayBrain({ ...gatewayConfig, model: gatewayModel })
      : null;

  const ordered = {
    claude: [claude, gemini, gateway],
    gemini: [gemini, claude, gateway],
    gateway: [gateway, claude, gemini],
  }[preferences.llmProvider];
  const factory = ordered.find((candidate) => candidate !== null);
  return factory ? factory() : new MockBrain();
}

export { DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL };
export type { DirectorBrain } from "@/lib/providers/llm/types";
