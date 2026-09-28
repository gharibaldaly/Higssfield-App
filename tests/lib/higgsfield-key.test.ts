import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetServerEnvCache } from "@/lib/env";
import { higgsfieldKeyCheck, requireHiggsfieldKey } from "@/lib/providers/higgsfield";

/** The status endpoint's answer for a request id the account does not have. */
function statusAnswer(status: 401 | 404): Response {
  const detail = status === 401 ? "Invalid credentials" : "Request not found";
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Each test uses its own key id, since an accepted key is remembered per server instance. */
function useKey(key: string) {
  vi.stubEnv("HIGGSFIELD_API_KEY", key);
  resetServerEnvCache();
}

describe("Higgsfield key guard", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("HIGGSFIELD_API_SECRET", "");
    vi.stubEnv("HIGGSFIELD_MOCK", "");
    vi.stubEnv("HIGGSFIELD_BASE_URL", "https://api.test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetServerEnvCache();
  });

  it("stops the work before a prompt is written while Higgsfield rejects the key", async () => {
    useKey("rejected-id:secret");
    fetchMock.mockResolvedValue(statusAnswer(401));
    await expect(requireHiggsfieldKey()).rejects.toMatchObject({
      code: "provider_auth",
      status: 401,
      message: expect.stringContaining("then redeploy"),
    });
    // A rejected key is asked again each time, so a fixed key works at once.
    await expect(requireHiggsfieldKey()).rejects.toMatchObject({ code: "provider_auth" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/api\.test\/requests\/[0-9a-f-]{36}\/status$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Key rejected-id:secret");
  });

  it("lets the work go on with an accepted key, asking only once in a while", async () => {
    useKey("accepted-id:secret");
    fetchMock.mockResolvedValue(statusAnswer(404));
    await expect(requireHiggsfieldKey()).resolves.toBeUndefined();
    await expect(requireHiggsfieldKey()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets the work go on when Higgsfield cannot be asked", async () => {
    useKey("unreachable-id:secret");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(requireHiggsfieldKey()).resolves.toBeUndefined();
  });

  it("asks nothing in mock mode", async () => {
    useKey("");
    await expect(requireHiggsfieldKey()).resolves.toBeUndefined();
    await expect(higgsfieldKeyCheck()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
