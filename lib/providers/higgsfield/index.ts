import "server-only";

import { higgsfieldCredentials, isHiggsfieldMockForced, serverEnv } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http/retry";
import { specsFromCatalog } from "@/lib/providers/higgsfield/catalog";
import { HiggsfieldClient } from "@/lib/providers/higgsfield/client";
import { MockProvider } from "@/lib/providers/higgsfield/mock";
import { buildRegistry } from "@/lib/providers/higgsfield/registry";
import type { ImageVideoProvider, ModelSpec } from "@/lib/providers/higgsfield/types";

export type ProviderMode = "higgsfield" | "mock";

export function activeProviderMode(): ProviderMode {
  return higgsfieldCredentials() && !isHiggsfieldMockForced() ? "higgsfield" : "mock";
}

/** Provider for a generation row (rows remember which provider made them). */
export function getProvider(mode: ProviderMode = activeProviderMode()): ImageVideoProvider {
  if (mode === "mock") return new MockProvider();
  const credentials = higgsfieldCredentials();
  if (!credentials) return new MockProvider();
  return new HiggsfieldClient({
    keyId: credentials.keyId,
    keySecret: credentials.keySecret,
    baseUrl: serverEnv().HIGGSFIELD_BASE_URL,
  });
}

let catalogCache: { at: number; specs: ModelSpec[] } | null = null;
const CATALOG_TTL_MS = 10 * 60 * 1000;

/** Fetch the optional remote catalogue (HIGGSFIELD_MODELS_URL), cached. */
async function loadCatalog(): Promise<ModelSpec[]> {
  const url = serverEnv().HIGGSFIELD_MODELS_URL;
  const credentials = higgsfieldCredentials();
  if (!url || !credentials) return [];
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.specs;
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Key ${credentials.keyId}:${credentials.keySecret}`,
        Accept: "application/json",
      },
      timeoutMs: 10_000,
      cache: "no-store",
    });
    const specs = response.ok ? specsFromCatalog(await response.json()) : [];
    catalogCache = { at: Date.now(), specs };
    return specs;
  } catch (error) {
    console.warn("Higgsfield model catalogue unavailable", error);
    catalogCache = { at: Date.now(), specs: [] };
    return [];
  }
}

/** Every image and video model the app can use right now. */
export async function getModelRegistry(customModels: unknown[] = []): Promise<ModelSpec[]> {
  const mode = activeProviderMode();
  return buildRegistry({
    includeReal: mode === "higgsfield",
    includeMock: mode === "mock",
    customModels,
    catalogModels: mode === "higgsfield" ? await loadCatalog() : [],
  });
}

export { buildProviderInput, capabilitiesOf, pickModel } from "@/lib/providers/higgsfield/registry";
export type { ModelSpec } from "@/lib/providers/higgsfield/types";
