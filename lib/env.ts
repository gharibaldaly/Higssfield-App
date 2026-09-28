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

export type LlmGatewayConfig = {
  /** Base URL including the version path, e.g. https://example.com/v1. */
  baseUrl: string;
  apiKey: string;
  /** Default model id; Settings can override it. */
  model: string | null;
  /** Shown in Settings, e.g. the gateway's brand name. */
  name: string;
  /** Output token cap sent to the gateway. */
  maxTokens: number;
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
    baseUrl,
    apiKey: env.LLM_GATEWAY_API_KEY,
    model: env.LLM_GATEWAY_MODEL ?? null,
    name: env.LLM_GATEWAY_NAME ?? "Gateway",
    maxTokens: Number.isFinite(maxTokens) && maxTokens >= 1024 ? maxTokens : 16_000,
  };
}

export type KeyStatus = {
  supabase: boolean;
  supabaseServiceRole: boolean;
  higgsfield: boolean;
  higgsfieldMock: boolean;
  higgsfieldWebhook: boolean;
  anthropic: boolean;
  gemini: boolean;
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
    gateway: llmGatewayConfig() !== null,
    googleDrive: Boolean(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET),
    ownerEmail: Boolean(env.APP_OWNER_EMAIL),
  };
}
