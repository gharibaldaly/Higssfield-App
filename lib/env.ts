import "server-only";

import { z } from "zod";

/**
 * Server-side environment. Parsed lazily (not at import time) so `next build`
 * works without secrets; each accessor throws a clear error only when the
 * feature that needs the variable is actually used.
 */
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  APP_OWNER_EMAIL: optionalString,
  APP_URL: optionalString,

  HIGGSFIELD_API_KEY: optionalString,
  HIGGSFIELD_API_SECRET: optionalString,
  HIGGSFIELD_BASE_URL: optionalString,
  HIGGSFIELD_MODELS_URL: optionalString,
  HIGGSFIELD_WEBHOOK_SECRET: optionalString,
  HIGGSFIELD_MOCK: optionalString,
  HIGGSFIELD_MAX_CONCURRENT: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,

  LLM_GATEWAY_BASE_URL: optionalString,
  LLM_GATEWAY_API_KEY: optionalString,
  LLM_GATEWAY_MODEL: optionalString,
  LLM_GATEWAY_NAME: optionalString,
  LLM_GATEWAY_MAX_TOKENS: optionalString,
  LLM_GATEWAY_REASONING_EFFORT: optionalString,

  MISTRAL_API_KEY: optionalString,
  MISTRAL_MODEL: optionalString,
  ZAI_API_KEY: optionalString,
  ZAI_MODEL: optionalString,
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_MODEL: optionalString,

  GOOGLE_DRIVE_CLIENT_ID: optionalString,
  GOOGLE_DRIVE_CLIENT_SECRET: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (!cached) {
    cached = serverEnvSchema.parse(process.env);
  }
  return cached;
}

/** Test hook: forget the parsed environment so tests can change process.env. */
export function resetServerEnvCache(): void {
  cached = null;
}

export class MissingEnvError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Missing environment variable(s): ${variables.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

export function supabaseEnv(): { url: string; anonKey: string } {
  const env = serverEnv();
  const missing: string[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) throw new MissingEnvError(missing);
  return { url: env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY! };
}

/** A pasted credential without surrounding quotes or the header's leading "Key ". */
function cleanCredential(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Key\s+/i, "")
    .trim();
}

/** How the Higgsfield key was read: `KEY_ID:SECRET` in one variable, or two variables. */
export type HiggsfieldKeyForm = "combined" | "separate";

/**
 * Higgsfield credentials. The API authenticates with `Key KEY_ID:KEY_SECRET`
 * (docs, Authentication). Accept both halves in separate variables, or the
 * combined form in HIGGSFIELD_API_KEY, which wins even when a secret is also
 * set: the API splits on the colon, so a key id never contains one.
 */
function readHiggsfieldKey(): { keyId: string; keySecret: string; form: HiggsfieldKeyForm } | null {
  const env = serverEnv();
  const key = cleanCredential(env.HIGGSFIELD_API_KEY);
  if (!key) return null;
  const separator = key.indexOf(":");
  if (separator > 0 && separator < key.length - 1) {
    return {
      keyId: key.slice(0, separator).trim(),
      keySecret: key.slice(separator + 1).trim(),
      form: "combined",
    };
  }
  const secret = cleanCredential(env.HIGGSFIELD_API_SECRET);
  return secret ? { keyId: key, keySecret: secret, form: "separate" } : null;
}

export function higgsfieldCredentials(): { keyId: string; keySecret: string } | null {
  const key = readHiggsfieldKey();
  return key ? { keyId: key.keyId, keySecret: key.keySecret } : null;
}

/** Which form the key was read in, for Settings (never the key itself). */
export function higgsfieldKeyForm(): HiggsfieldKeyForm | null {
  return readHiggsfieldKey()?.form ?? null;
}

/**
 * Requests the account may have queued or running at Higgsfield at once. The
 * docs set this per account (shown in the Higgsfield console) and give 4 as
 * the example, so 4 is the default until the owner sets their own.
 */
export function higgsfieldMaxConcurrent(): number {
  const value = Number.parseInt(serverEnv().HIGGSFIELD_MAX_CONCURRENT ?? "", 10);
  return Number.isFinite(value) && value >= 1 ? Math.min(value, 64) : 4;
}

export function isHiggsfieldMockForced(): boolean {
  const flag = serverEnv().HIGGSFIELD_MOCK?.toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** The known free services, plus the owner's own gateway (LLM_GATEWAY_*). */
export type LlmGatewayId = "mistral" | "zai" | "openrouter" | "custom";

export type LlmGatewayConfig = {
  id: LlmGatewayId;
  /** Base URL including the version path, e.g. https://example.com/v1. */
  baseUrl: string;
  apiKey: string;
  /** Default model id; Settings can override it. */
  model: string | null;
  /** Shown in Settings, e.g. the gateway's brand name. */
  name: string;
  /** Output token cap sent to the gateway. */
  maxTokens: number;
  /**
   * Sent as `reasoning_effort` when set (e.g. "high" for Kimi K3 on NVIDIA),
   * and dropped for a model that refuses the field.
   */
  reasoningEffort?: string | null;
  /** Request fields the service wants with every call (Z.ai: thinking off). */
  extraBody?: Record<string, unknown>;
  /** Request headers the service wants (OpenRouter: the app's name and URL). */
  headers?: Record<string, string>;
  /** Images the service takes per request; a call with more sends the first ones. */
  maxImages?: number | null;
  /**
   * Whether the generic reasoning fields (`reasoning_effort`,
   * `chat_template_kwargs`) may be sent. On for the owner's own gateway, whose
   * model is unknown; off for a known service, whose model has its own
   * defaults (and `extraBody` its switch, where it needs one).
   */
  thinkingFields?: boolean;
  /**
   * Requests the service takes at once. With 1 (Z.ai's free model) the photo
   * routes are tested one after another, and a busy answer is retried more.
   */
  maxConcurrent?: number | null;
  /**
   * Whether the Anthropic messages format (`/messages`) is tried for photos.
   * Off for a known service whose base URL does not serve it.
   */
  anthropicFormat?: boolean;
};

/**
 * An OpenAI-compatible gateway for the director brain (chat completions,
 * Bearer key). Null unless both the base URL and the key are set; the URL must
 * be https (the key travels with every request).
 */
export function llmGatewayConfig(): LlmGatewayConfig | null {
  const env = serverEnv();
  const baseUrl = env.LLM_GATEWAY_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl || !env.LLM_GATEWAY_API_KEY) return null;
  if (!/^https:\/\//i.test(baseUrl)) return null;
  const maxTokens = Number.parseInt(env.LLM_GATEWAY_MAX_TOKENS ?? "", 10);
  return {
    id: "custom",
    baseUrl,
    apiKey: env.LLM_GATEWAY_API_KEY,
    model: env.LLM_GATEWAY_MODEL ?? null,
    name: env.LLM_GATEWAY_NAME ?? "Gateway",
    maxTokens: Number.isFinite(maxTokens) && maxTokens >= 1024 ? maxTokens : 16_000,
    reasoningEffort: /^[a-z]{2,12}$/i.test(env.LLM_GATEWAY_REASONING_EFFORT ?? "")
      ? env.LLM_GATEWAY_REASONING_EFFORT!.toLowerCase()
      : null,
  };
}

type GatewayPreset = {
  id: Exclude<LlmGatewayId, "custom">;
  name: string;
  baseUrl: string;
  model: string;
  maxImages: number | null;
  maxConcurrent?: number;
  extraBody?: Record<string, unknown>;
};

/**
 * Free services with OpenAI-compatible chat completions that read images
 * (checked 2026-09-28, see the Decisions log). Each needs only its key.
 */
const GATEWAY_PRESETS: GatewayPreset[] = [
  {
    // The Free plan includes API credits every month. Mistral Small 4 reads
    // images (8 per request) and is a hybrid reasoning model: its reasoning is
    // switched off, since the brain's answers are JSON and reasoning would
    // only cost credits and time.
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    maxImages: 8,
    extraBody: { reasoning_effort: "none" },
  },
  {
    // GLM-4.6V-Flash is free, one request at a time. Its reasoning is off: the
    // brain's answers are JSON and reasoning would eat the output.
    id: "zai",
    name: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    model: "glm-4.6v-flash",
    maxImages: 150,
    maxConcurrent: 1,
    extraBody: { thinking: { type: "disabled" } },
  },
  {
    // Free models (":free"), 50 requests a day, 1,000 once $10 of credits were bought.
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemma-4-31b-it:free",
    maxImages: null,
  },
];

const PRESET_KEYS: Record<GatewayPreset["id"], { key: keyof ServerEnv; model: keyof ServerEnv }> = {
  mistral: { key: "MISTRAL_API_KEY", model: "MISTRAL_MODEL" },
  zai: { key: "ZAI_API_KEY", model: "ZAI_MODEL" },
  openrouter: { key: "OPENROUTER_API_KEY", model: "OPENROUTER_MODEL" },
};

/**
 * Every configured gateway, in the order the brain asks them: the free
 * services first (Mistral, Z.ai, OpenRouter), then the owner's own gateway.
 */
export function llmGatewayConfigs(): LlmGatewayConfig[] {
  const env = serverEnv();
  const presets = GATEWAY_PRESETS.flatMap((preset): LlmGatewayConfig[] => {
    const vars = PRESET_KEYS[preset.id];
    const apiKey = env[vars.key];
    if (!apiKey) return [];
    return [
      {
        id: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey,
        model: env[vars.model] ?? preset.model,
        maxTokens: 16_000,
        reasoningEffort: null,
        thinkingFields: false,
        anthropicFormat: false,
        extraBody: preset.extraBody,
        maxImages: preset.maxImages,
        maxConcurrent: preset.maxConcurrent ?? null,
        // OpenRouter asks apps to name themselves.
        headers:
          preset.id === "openrouter"
            ? {
                "X-Title": "Dr. Secret Studio",
                ...(env.APP_URL ? { "HTTP-Referer": env.APP_URL } : {}),
              }
            : undefined,
      },
    ];
  });
  const custom = llmGatewayConfig();
  return custom ? [...presets, custom] : presets;
}

export type KeyStatus = {
  supabase: boolean;
  supabaseServiceRole: boolean;
  higgsfield: boolean;
  higgsfieldMock: boolean;
  higgsfieldWebhook: boolean;
  anthropic: boolean;
  gemini: boolean;
  mistral: boolean;
  zai: boolean;
  openrouter: boolean;
  gateway: boolean;
  googleDrive: boolean;
  ownerEmail: boolean;
};

/** Which integrations are configured. Booleans only — never the values. */
export function keyStatus(): KeyStatus {
  const env = serverEnv();
  const higgsfield = higgsfieldCredentials() !== null;
  return {
    supabase: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    higgsfield,
    higgsfieldMock: !higgsfield || isHiggsfieldMockForced(),
    higgsfieldWebhook: Boolean(env.HIGGSFIELD_WEBHOOK_SECRET && env.APP_URL),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    mistral: Boolean(env.MISTRAL_API_KEY),
    zai: Boolean(env.ZAI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
    gateway: llmGatewayConfig() !== null,
    googleDrive: Boolean(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET),
    ownerEmail: Boolean(env.APP_OWNER_EMAIL),
  };
}
