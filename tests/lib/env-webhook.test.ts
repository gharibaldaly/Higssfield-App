import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  higgsfieldCredentials,
  higgsfieldKeyForm,
  isHiggsfieldMockForced,
  keyStatus,
  resetServerEnvCache,
} from "@/lib/env";
import { verifyWebhookSignature, webhookUrlFor } from "@/lib/generations/webhook";

const MANAGED = [
  "HIGGSFIELD_API_KEY",
  "HIGGSFIELD_API_SECRET",
  "HIGGSFIELD_MOCK",
  "HIGGSFIELD_WEBHOOK_SECRET",
  "APP_URL",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
] as const;

function setEnv(values: Partial<Record<(typeof MANAGED)[number], string>>) {
  for (const name of MANAGED) vi.stubEnv(name, values[name] ?? "");
  resetServerEnvCache();
}

beforeEach(() => setEnv({}));
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("Higgsfield credentials", () => {
  it("accepts a separate key id and secret", () => {
    setEnv({ HIGGSFIELD_API_KEY: "key-id", HIGGSFIELD_API_SECRET: "key-secret" });
    expect(higgsfieldCredentials()).toEqual({ keyId: "key-id", keySecret: "key-secret" });
  });

  it("accepts the combined KEY_ID:KEY_SECRET form", () => {
    setEnv({ HIGGSFIELD_API_KEY: "key-id:key-secret" });
    expect(higgsfieldCredentials()).toEqual({ keyId: "key-id", keySecret: "key-secret" });
  });

  it("prefers the combined form even when a secret is also set", () => {
    // The API splits on the colon, so a key id never holds one.
    setEnv({ HIGGSFIELD_API_KEY: "key-id:key-secret", HIGGSFIELD_API_SECRET: "key-secret" });
    expect(higgsfieldCredentials()).toEqual({ keyId: "key-id", keySecret: "key-secret" });
  });

  it("drops pasted quotes and the header's leading Key", () => {
    setEnv({ HIGGSFIELD_API_KEY: '"key-id"', HIGGSFIELD_API_SECRET: " 'key-secret' " });
    expect(higgsfieldCredentials()).toEqual({ keyId: "key-id", keySecret: "key-secret" });
    setEnv({ HIGGSFIELD_API_KEY: "Key key-id:key-secret" });
    expect(higgsfieldCredentials()).toEqual({ keyId: "key-id", keySecret: "key-secret" });
  });

  it("treats blank or incomplete values as missing", () => {
    setEnv({ HIGGSFIELD_API_KEY: "   " });
    expect(higgsfieldCredentials()).toBeNull();
    setEnv({ HIGGSFIELD_API_KEY: "key-id-only" });
    expect(higgsfieldCredentials()).toBeNull();
    expect(higgsfieldKeyForm()).toBeNull();
  });

  it("says which form the key was read in, for Settings", () => {
    setEnv({ HIGGSFIELD_API_KEY: "key-id:key-secret", HIGGSFIELD_API_SECRET: "old-secret" });
    expect(higgsfieldKeyForm()).toBe("combined");
    setEnv({ HIGGSFIELD_API_KEY: "key-id", HIGGSFIELD_API_SECRET: "key-secret" });
    expect(higgsfieldKeyForm()).toBe("separate");
  });

  it("reports the mock provider when no key is set or mock is forced", () => {
    expect(keyStatus()).toMatchObject({
      higgsfield: false,
      higgsfieldMock: true,
      anthropic: false,
    });
    setEnv({ HIGGSFIELD_API_KEY: "a:b", HIGGSFIELD_MOCK: "true", ANTHROPIC_API_KEY: "sk" });
    expect(isHiggsfieldMockForced()).toBe(true);
    expect(keyStatus()).toMatchObject({ higgsfield: true, higgsfieldMock: true, anthropic: true });
  });

  it("returns booleans only — never secret values", () => {
    setEnv({
      HIGGSFIELD_API_KEY: "a:super-secret",
      ANTHROPIC_API_KEY: "sk-secret",
      GEMINI_API_KEY: "gm-secret",
    });
    const status = keyStatus();
    expect(Object.values(status).every((value) => typeof value === "boolean")).toBe(true);
    expect(JSON.stringify(status)).not.toContain("secret");
  });
});

describe("webhook signatures", () => {
  it("is disabled until a secret and the app URL are configured", () => {
    expect(webhookUrlFor("gen-1")).toBeNull();
    expect(verifyWebhookSignature("gen-1", "0".repeat(64))).toBe(false);
  });

  it("signs per generation and verifies only matching signatures", () => {
    setEnv({ HIGGSFIELD_WEBHOOK_SECRET: "whsec", APP_URL: "https://studio.example.com/" });
    const url = new URL(webhookUrlFor("gen-1")!);
    expect(url.origin + url.pathname).toBe("https://studio.example.com/api/webhooks/higgsfield");
    expect(url.searchParams.get("gid")).toBe("gen-1");
    const sig = url.searchParams.get("sig")!;
    expect(verifyWebhookSignature("gen-1", sig)).toBe(true);
    expect(verifyWebhookSignature("gen-2", sig)).toBe(false);
    expect(verifyWebhookSignature("gen-1", "not-hex")).toBe(false);

    setEnv({ HIGGSFIELD_WEBHOOK_SECRET: "rotated", APP_URL: "https://studio.example.com" });
    expect(verifyWebhookSignature("gen-1", sig)).toBe(false);
  });
});
