import "server-only";

import { serverEnv } from "@/lib/env";
import { ClaudeBrain, DEFAULT_CLAUDE_MODEL } from "@/lib/providers/llm/claude";
import { DEFAULT_GEMINI_MODEL, GeminiBrain } from "@/lib/providers/llm/gemini";
import { MockBrain } from "@/lib/providers/llm/mock";
import type { DirectorBrain } from "@/lib/providers/llm/types";

export type BrainPreferences = {
  provider: "claude" | "gemini";
  claudeModel?: string | null;
  geminiModel?: string | null;
};

/**
 * Picks the director brain from Settings. If the chosen provider has no key,
 * the other configured provider is used; with no keys at all, the mock brain
 * keeps the app usable. `brain.provider` tells the UI which one answered.
 */
export function getDirectorBrain(preferences: BrainPreferences): DirectorBrain {
  const env = serverEnv();
  const claudeModel =
    preferences.claudeModel?.trim() || env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL;
  const geminiModel = preferences.geminiModel?.trim() || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const claude = env.ANTHROPIC_API_KEY
    ? () => new ClaudeBrain(env.ANTHROPIC_API_KEY!, claudeModel)
    : null;
  const gemini = env.GEMINI_API_KEY
    ? () => new GeminiBrain(env.GEMINI_API_KEY!, geminiModel)
    : null;

  const ordered = preferences.provider === "gemini" ? [gemini, claude] : [claude, gemini];
  const factory = ordered.find((candidate) => candidate !== null);
  return factory ? factory() : new MockBrain();
}

export { DEFAULT_CLAUDE_MODEL, DEFAULT_GEMINI_MODEL };
export type { DirectorBrain } from "@/lib/providers/llm/types";
