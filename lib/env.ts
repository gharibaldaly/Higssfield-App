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

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString,

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

/**
 * Higgsfield credentials. The API authenticates with `KEY_ID:KEY_SECRET`
 * (per the official SDK). Accept either both halves in separate variables or
 * the combined form in HIGGSFIELD_API_KEY.
 */
export function higgsfieldCredentials(): { keyId: string; keySecret: string } | null {
  const env = serverEnv();
  const key = env.HIGGSFIELD_API_KEY;
  if (!key) return null;
  if (env.HIGGSFIELD_API_SECRET) return { keyId: key, keySecret: env.HIGGSFIELD_API_SECRET };
  const separator = key.indexOf(":");
  if (separator > 0 && separator < key.length - 1) {
    return { keyId: key.slice(0, separator), keySecret: key.slice(separator + 1) };
  }
  return null;
}

export function isHiggsfieldMockForced(): boolean {
  const flag = serverEnv().HIGGSFIELD_MOCK?.toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export type KeyStatus = {
  supabase: boolean;
  supabaseServiceRole: boolean;
  higgsfield: boolean;
  higgsfieldMock: boolean;
  higgsfieldWebhook: boolean;
  anthropic: boolean;
  gemini: boolean;
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
    googleDrive: Boolean(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET),
    ownerEmail: Boolean(env.APP_OWNER_EMAIL),
  };
}
