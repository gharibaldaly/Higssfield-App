import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Env from "@/lib/env";
import { prepareReferences } from "@/lib/generations/reference-prep";
import { submitGeneration } from "@/lib/generations/service";
import { preparedPathsOf, providerBodyFrom } from "@/lib/generations/waiting";
import type { ProviderState, SubmitContext } from "@/lib/providers/higgsfield/types";
import { modelSpecSchema } from "@/lib/providers/higgsfield/types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createFakeSupabase } from "@/tests/stubs/fake-supabase";

const hoisted = vi.hoisted(() => ({ bodies: [] as Record<string, unknown>[] }));

vi.mock("@/lib/providers/higgsfield", () => ({
  activeProviderMode: () => "higgsfield",
  getProvider: () => ({
    id: "higgsfield",
    submit: async (
      _target: unknown,
      body: Record<string, unknown>,
      context: SubmitContext,
    ): Promise<ProviderState> => {
      hoisted.bodies.push(body);
      return {
        requestId: `req-${context.generationId}`,
        status: "queued",
        statusUrl: null,
        resultUrls: [],
        resultKind: null,
        cost: null,
        error: null,
      };
    },
    getStatus: async () => {
      throw new Error("not polled here");
    },
    cancel: async () => undefined,
  }),
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof Env>()),
  higgsfieldMaxConcurrent: () => 10,
}));
vi.mock("@/lib/generations/side-effects", () => ({ settleLinkedRecords: async () => undefined }));
vi.mock("@/lib/generations/webhook", () => ({ webhookUrlFor: () => null }));

const SOURCE = "owner/products/p1/sources/front.jpg";

const model = modelSpecSchema.parse({
  id: "picky-edit",
  label: "Picky edit",
  endpoint: "picky/edit",
  kind: "image",
  modes: ["text-to-image", "image-to-image"],
  params: {
    prompt: { field: "prompt" },
    image: {
      field: "image_urls",
      format: "url_array",
      max: 4,
      required: false,
      prepare: { longEdge: 1024 },
    },
  },
  source: "custom",
});

let db: ReturnType<typeof createFakeSupabase>;
let supabase: TypedSupabaseClient;

beforeEach(async () => {
  hoisted.bodies = [];
  db = createFakeSupabase({
    generations: () => ({
      id: randomUUID(),
      owner_id: "owner",
      created_at: new Date().toISOString(),
      provider_request_id: null,
      provider_status_url: null,
      submitted_at: null,
      last_polled_at: null,
      completed_at: null,
      poll_attempts: 0,
      error: null,
      review_status: "pending",
    }),
  });
  supabase = db.client as unknown as TypedSupabaseClient;
  // A tall "phone photo" stored sideways with an EXIF orientation, as HEIC exports are.
  const photo = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: "#884466" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  db.objects.set(SOURCE, photo);
});

describe("prepareReferences", () => {
  it("re-encodes a phone photo upright within the long edge, once per source", async () => {
    const [prepared] = await prepareReferences(supabase, [SOURCE], 1024);
    expect(prepared).toMatch(/^owner\/derived\/refs\/[0-9a-f]{24}-1024\.jpg$/);
    const meta = await sharp(db.objects.get(prepared!)!).metadata();
    expect(meta.format).toBe("jpeg");
    // Orientation 6 turns the 3000×2000 photo upright: portrait, 1024 on its long side.
    expect([meta.width, meta.height]).toEqual([683, 1024]);
    expect(meta.orientation).toBeUndefined();

    const before = db.objects.get(prepared!);
    const again = await prepareReferences(supabase, [SOURCE], 1024);
    expect(again).toEqual([prepared]);
    expect(db.objects.get(prepared!)).toBe(before);
  });

  it("fails plainly when the source photo is missing", async () => {
    await expect(prepareReferences(supabase, ["owner/missing.jpg"], 1024)).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe("submitGeneration with a model that needs prepared references", () => {
  it("sends the copies, keeps the originals on the row and re-signs the copies later", async () => {
    const row = await submitGeneration(supabase, {
      purpose: "other",
      model,
      mode: "image-to-image",
      prompt: "exact garment",
      referencePaths: [SOURCE],
    });
    expect(row.reference_paths).toEqual([SOURCE]);
    const prepared = preparedPathsOf(row.params);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatch(/derived\/refs\//);
    expect(hoisted.bodies[0]?.image_urls).toEqual([
      expect.stringContaining(`storage.test/${prepared[0]}`),
    ]);
    expect(row.params).toMatchObject({ image_urls: [`storage:${prepared[0]}`] });

    // The waiting room rebuilds the body from the stored markers: the copies must sign too.
    const sign = (path: string) => (prepared.includes(path) ? `https://s/${path}` : undefined);
    expect(providerBodyFrom(row.params, sign)).toMatchObject({
      image_urls: [`https://s/${prepared[0]}`],
    });
    expect(() => providerBodyFrom(row.params, () => undefined)).toThrow(/could not be read/);
  });

  it("sends text-only requests untouched", async () => {
    const row = await submitGeneration(supabase, {
      purpose: "other",
      model,
      mode: "text-to-image",
      prompt: "a vase",
      referencePaths: [],
    });
    expect(preparedPathsOf(row.params)).toEqual([]);
    expect(hoisted.bodies[0]).not.toHaveProperty("image_urls");
  });
});
