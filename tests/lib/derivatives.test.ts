import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  derivedPath,
  downloadForBrain,
  ensureDerivatives,
  makeThumbnail,
  preparedPathFor,
  REFERENCE_LONG_EDGE,
  thumbUrls,
} from "@/lib/storage/derivatives";
import { forgetSignedUrls } from "@/lib/storage/objects";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createFakeSupabase } from "@/tests/stubs/fake-supabase";

const SOURCE = "owner/products/p1/sources/front.jpg";

/** A landscape JPEG stored sideways with an EXIF orientation, as phone exports are. */
function phonePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#884466" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

let db: ReturnType<typeof createFakeSupabase>;
let supabase: TypedSupabaseClient;

beforeEach(async () => {
  forgetSignedUrls();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  db = createFakeSupabase();
  supabase = db.client as unknown as TypedSupabaseClient;
  db.objects.set(SOURCE, await phonePhoto());
});

describe("derived paths", () => {
  it("keys both copies by the source path, under the owner's derived folder", () => {
    const thumb = derivedPath(SOURCE, "thumb");
    const prep = derivedPath(SOURCE, "prep");
    expect(thumb).toMatch(/^owner\/derived\/thumbs\/[0-9a-f]{24}\.jpg$/);
    expect(prep).toMatch(/^owner\/derived\/refs\/[0-9a-f]{24}-2560\.jpg$/);
    expect(prep).toBe(preparedPathFor(SOURCE, REFERENCE_LONG_EDGE));
    expect(/([0-9a-f]{24})\.jpg$/.exec(thumb)?.[1]).toBe(/([0-9a-f]{24})-2560/.exec(prep)?.[1]);
    expect(derivedPath("owner/products/p1/sources/back.jpg", "thumb")).not.toBe(thumb);
    expect(() => derivedPath("/no-owner.jpg", "thumb")).toThrow(/owner/);
  });
});

describe("makeThumbnail", () => {
  it("is an upright JPEG within 768 px on the long side, never enlarged", async () => {
    const meta = await sharp(await makeThumbnail(await phonePhoto())).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([512, 768]);
    expect(meta.orientation).toBeUndefined();

    const small = await sharp({
      create: { width: 300, height: 200, channels: 4, background: "#FFFFFF" },
    })
      .png()
      .toBuffer();
    const smallMeta = await sharp(await makeThumbnail(small)).metadata();
    expect([smallMeta.width, smallMeta.height]).toEqual([300, 200]);
  });
});

describe("ensureDerivatives", () => {
  it("makes the missing copies once and leaves them alone afterwards", async () => {
    expect(await ensureDerivatives(supabase, SOURCE)).toEqual({
      made: ["thumb", "prep"],
      failed: [],
    });
    const thumb = db.objects.get(derivedPath(SOURCE, "thumb"))!;
    const prep = db.objects.get(derivedPath(SOURCE, "prep"))!;
    expect((await sharp(thumb).metadata()).height).toBe(768);
    expect((await sharp(prep).metadata()).height).toBe(2560);

    expect(await ensureDerivatives(supabase, SOURCE)).toEqual({ made: [], failed: [] });
    expect(db.objects.get(derivedPath(SOURCE, "thumb"))).toBe(thumb);
    expect(db.objects.size).toBe(3);
  });

  it("makes only the kinds asked for", async () => {
    expect(await ensureDerivatives(supabase, SOURCE, undefined, ["thumb"])).toEqual({
      made: ["thumb"],
      failed: [],
    });
    expect(db.objects.has(derivedPath(SOURCE, "prep"))).toBe(false);
  });

  it("reports a source it cannot read or decode instead of throwing", async () => {
    expect(await ensureDerivatives(supabase, "owner/missing.jpg")).toEqual({
      made: [],
      failed: ["thumb", "prep"],
    });
    db.objects.set("owner/notes.jpg", Buffer.from("not an image"));
    expect(await ensureDerivatives(supabase, "owner/notes.jpg")).toEqual({
      made: [],
      failed: ["thumb", "prep"],
    });
  });
});

describe("thumbUrls", () => {
  it("links the small copy when it exists and the original otherwise", async () => {
    db.objects.set("owner/products/p1/sources/back.jpg", await phonePhoto());
    await ensureDerivatives(supabase, SOURCE);
    const urls = await thumbUrls(supabase, [
      SOURCE,
      "owner/products/p1/sources/back.jpg",
      "owner/products/p1/sources/gone.jpg",
      null,
    ]);
    expect(urls.get(SOURCE)).toContain(derivedPath(SOURCE, "thumb"));
    expect(urls.get("owner/products/p1/sources/back.jpg")).toContain("/sources/back.jpg?");
    expect(urls.has("owner/products/p1/sources/gone.jpg")).toBe(false);
    expect(urls.size).toBe(2);
  });
});

describe("downloadForBrain", () => {
  it("reads the prepared copy, or the original once while making the copies", async () => {
    const original = db.objects.get(SOURCE)!;
    expect((await downloadForBrain(supabase, SOURCE)).equals(original)).toBe(true);
    const prep = db.objects.get(derivedPath(SOURCE, "prep"));
    expect(prep).toBeDefined();
    expect(db.objects.has(derivedPath(SOURCE, "thumb"))).toBe(true);
    expect((await downloadForBrain(supabase, SOURCE)).equals(prep!)).toBe(true);
  });

  it("fails like a plain download when the original is missing", async () => {
    await expect(downloadForBrain(supabase, "owner/missing.jpg")).rejects.toThrow(
      /Could not read a stored file/,
    );
  });
});
