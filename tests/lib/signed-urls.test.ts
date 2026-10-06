import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetSignedUrls, removeObjects, signPaths } from "@/lib/storage/objects";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createFakeSupabase } from "@/tests/stubs/fake-supabase";

const HOUR = 60 * 60;
const T0 = Date.parse("2026-10-06T10:00:00Z");

/** The fake bucket, with every signing call recorded. */
function signingClient() {
  const db = createFakeSupabase();
  const bucket = db.client.storage.from();
  const calls: { paths: string[]; expiresIn: number }[] = [];
  const spy = {
    ...bucket,
    createSignedUrls: async (paths: string[], expiresIn: number) => {
      calls.push({ paths, expiresIn });
      return bucket.createSignedUrls(paths, expiresIn);
    },
  };
  const supabase = { ...db.client, storage: { from: () => spy } } as unknown as TypedSupabaseClient;
  return { db, calls, supabase };
}

let client: ReturnType<typeof signingClient>;

beforeEach(() => {
  forgetSignedUrls();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  client = signingClient();
  client.db.objects.set("owner/a.jpg", Buffer.from("a"));
  client.db.objects.set("owner/b.jpg", Buffer.from("b"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signed URL cache", () => {
  it("signs once, with a margin, and repeats the same URL while it has the asked time left", async () => {
    const first = await signPaths(client.supabase, ["owner/a.jpg", "owner/b.jpg"]);
    expect(client.calls).toEqual([{ paths: ["owner/a.jpg", "owner/b.jpg"], expiresIn: 7 * HOUR }]);

    const again = await signPaths(client.supabase, ["owner/b.jpg", "owner/a.jpg"]);
    expect(again).toEqual(first);
    expect(client.calls).toHaveLength(1);

    // Five hours on, the URLs still have the asked hour left.
    vi.setSystemTime(T0 + 5 * HOUR * 1000);
    expect(await signPaths(client.supabase, ["owner/a.jpg"])).toEqual(
      new Map([["owner/a.jpg", first.get("owner/a.jpg")!]]),
    );
    expect(client.calls).toHaveLength(1);

    // Six and a half hours on, they would expire within the hour: signed again.
    vi.setSystemTime(T0 + 6.5 * HOUR * 1000);
    await signPaths(client.supabase, ["owner/a.jpg"]);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]).toEqual({ paths: ["owner/a.jpg"], expiresIn: 7 * HOUR });
  });

  it("signs fresh when a longer validity is asked than the remembered URL has", async () => {
    await signPaths(client.supabase, ["owner/a.jpg"]);
    await signPaths(client.supabase, ["owner/a.jpg"], { expiresIn: 24 * HOUR });
    expect(client.calls.map((call) => call.expiresIn)).toEqual([7 * HOUR, 30 * HOUR]);
    // The longer URL now serves the short requests too.
    await signPaths(client.supabase, ["owner/a.jpg"]);
    expect(client.calls).toHaveLength(2);
  });

  it("keeps download links apart from view links", async () => {
    await signPaths(client.supabase, ["owner/a.jpg"]);
    await signPaths(client.supabase, ["owner/a.jpg"], { download: true });
    await signPaths(client.supabase, ["owner/a.jpg"], { download: true });
    expect(client.calls).toHaveLength(2);
  });

  it("signs for exactly the asked time and remembers nothing with cache: false", async () => {
    await signPaths(client.supabase, ["owner/a.jpg"], { expiresIn: 900, cache: false });
    await signPaths(client.supabase, ["owner/a.jpg"], { expiresIn: 900, cache: false });
    expect(client.calls.map((call) => call.expiresIn)).toEqual([900, 900]);
    await signPaths(client.supabase, ["owner/a.jpg"]);
    expect(client.calls).toHaveLength(3);
  });

  it("never remembers a missing object as present", async () => {
    expect(await signPaths(client.supabase, ["owner/new.jpg"])).toEqual(new Map());
    client.db.objects.set("owner/new.jpg", Buffer.from("new"));
    expect((await signPaths(client.supabase, ["owner/new.jpg"])).size).toBe(1);
    expect(client.calls).toHaveLength(2);
  });

  it("forgets the links of removed objects", async () => {
    await signPaths(client.supabase, ["owner/a.jpg"]);
    await removeObjects(client.supabase, ["owner/a.jpg"]);
    expect(await signPaths(client.supabase, ["owner/a.jpg"])).toEqual(new Map());
    expect(client.calls).toHaveLength(2);
  });
});
