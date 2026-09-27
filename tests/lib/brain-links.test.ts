import { describe, expect, it } from "vitest";

import type { LlmImage } from "@/lib/providers/llm/types";
import { storageImageHost } from "@/lib/storage/brain-links";
import type { TypedSupabaseClient } from "@/lib/supabase/server";

type Stored = { size: number; contentType: string; cacheControl: string };

/** Just enough of Supabase Storage: upload, signed links and removal. */
function fakeStorage(options: { failUpload?: string } = {}) {
  const objects = new Map<string, Stored>();
  const removed: string[] = [];
  const bucket = {
    upload: async (
      path: string,
      data: Buffer,
      opts: { contentType: string; cacheControl: string },
    ) => {
      if (options.failUpload && path.endsWith(options.failUpload)) {
        return { data: null, error: { message: "quota exceeded" } };
      }
      objects.set(path, {
        size: data.length,
        contentType: opts.contentType,
        cacheControl: opts.cacheControl,
      });
      return { data: { path }, error: null };
    },
    createSignedUrls: async (paths: string[], expiresIn: number) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: `https://project.supabase.test/storage/v1/object/sign/studio/${path}?expires=${expiresIn}`,
      })),
      error: null,
    }),
    remove: async (paths: string[]) => {
      removed.push(...paths);
      for (const path of paths) objects.delete(path);
      return { data: [], error: null };
    },
  };
  const client = { storage: { from: () => bucket } };
  return { supabase: client as unknown as TypedSupabaseClient, objects, removed };
}

const images: LlmImage[] = [
  { mimeType: "image/jpeg", base64: Buffer.from("front").toString("base64"), caption: "Front" },
  { mimeType: "image/png", base64: Buffer.from("detail").toString("base64"), caption: "Lace" },
];

describe("brain photo links", () => {
  it("copies the photos into a temporary folder of the owner, links them in order, then deletes them", async () => {
    const storage = fakeStorage();
    const hosted = await storageImageHost(storage.supabase, "owner-1")(images);

    const paths = [...storage.objects.keys()];
    expect(paths[0]).toMatch(/^owner-1\/tmp\/brain\/[0-9a-f-]{36}\/1\.jpg$/);
    expect(paths[1]).toBe(paths[0]!.replace("1.jpg", "2.png"));
    expect(storage.objects.get(paths[0]!)).toEqual({
      size: 5,
      contentType: "image/jpeg",
      cacheControl: "60",
    });
    expect(hosted.urls).toEqual(
      paths.map((path) => expect.stringContaining(`/${path}?expires=900`)),
    );

    await hosted.release();
    expect(storage.removed).toEqual(paths);
    expect(storage.objects.size).toBe(0);
  });

  it("removes the copies it made when one of them fails", async () => {
    const storage = fakeStorage({ failUpload: "2.png" });
    await expect(storageImageHost(storage.supabase, "owner-1")(images)).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(storage.objects.size).toBe(0);
  });
});
