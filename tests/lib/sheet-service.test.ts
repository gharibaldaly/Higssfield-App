import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetServerEnvCache } from "@/lib/env";
import type * as GenerationQueries from "@/lib/generations/queries";
import { anySheetLayoutSchema, type ComposedLayout } from "@/lib/sheet/layout";
import { approveSheet, buildSheet, updateSheetSources } from "@/lib/sheet/service";
import type { ProductSheetRow } from "@/lib/supabase/database.types";
import type { TypedSupabaseClient } from "@/lib/supabase/server";
import { createFakeSupabase } from "@/tests/stubs/fake-supabase";

vi.mock("@/lib/dna/service", () => ({
  requireApprovedDna: async () => ({
    row: { id: "dna-1" },
    dna: (await import("@/tests/fixtures/dna")).ROBE_SET_DNA,
  }),
}));
vi.mock("@/lib/generations/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof GenerationQueries>()),
  approvedCatalogueImage: async () => null,
}));

const OWNER = "owner-1";
const PRODUCT = "prod-1";
const path = (name: string) => `${OWNER}/products/${PRODUCT}/sources/${name}.jpg`;

/** A 900×1200 photo of one colour, with a white square where a detail would be. */
async function photo(background: string): Promise<Buffer> {
  const square = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "#FFFFFF" },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: 900, height: 1200, channels: 3, background } })
    .composite([{ input: square, left: 350, top: 500 }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

let fake: ReturnType<typeof createFakeSupabase>;
const supabase = () => fake.client as unknown as TypedSupabaseClient;

beforeEach(async () => {
  // No LLM key: the mock director brain plans the sheet.
  for (const name of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "LLM_GATEWAY_BASE_URL"]) {
    vi.stubEnv(name, "");
  }
  resetServerEnvCache();
  fake = createFakeSupabase();
  fake.rows("products").push({
    id: PRODUCT,
    name: "Royal Blue Slip Dress",
    product_line: "SECRET",
    notes: null,
  });
  fake.rows("product_pieces").push({
    id: "piece-1",
    product_id: PRODUCT,
    position: 1,
    name: "Slip dress",
  });
  const photos = [
    { name: "front", kind: "front", colour: "#1646C0" },
    { name: "back", kind: "back", colour: "#0E3290" },
    { name: "lace", kind: "detail", colour: "#4F78E0" },
  ];
  for (const [index, item] of photos.entries()) {
    fake.rows("source_photos").push({
      id: `photo-${index}`,
      product_id: PRODUCT,
      piece_id: "piece-1",
      kind: item.kind,
      label: null,
      storage_path: path(item.name),
      position: index,
      created_at: `2026-09-28T08:0${index}:00Z`,
    });
    fake.objects.set(path(item.name), await photo(item.colour));
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

function layoutOf(sheet: ProductSheetRow): ComposedLayout {
  const layout = anySheetLayoutSchema.parse(sheet.layout);
  if (layout.version !== 2) throw new Error("expected a sheet built from photos");
  return layout;
}

describe("product sheets built from photos", () => {
  it("builds the board from the photos the brain chose, and stores it", async () => {
    const sheet = await buildSheet(supabase(), OWNER, PRODUCT);
    expect(sheet).toMatchObject({ version: 1, status: "review" });
    // No image model is involved.
    expect(sheet.generation_id ?? null).toBeNull();
    expect(sheet.image_path).toMatch(
      new RegExp(`^${OWNER}/products/${PRODUCT}/sheets/${sheet.id}/board-[0-9a-f-]{36}\\.jpg$`),
    );
    const board = await sharp(fake.objects.get(sheet.image_path!)!).metadata();
    expect([board.width, board.height]).toEqual([3840, 2160]);

    const cards = new Map(layoutOf(sheet).cards.map((card) => [card.id, card]));
    expect(cards.get("hero")?.sources[0]?.path).toBe(path("front"));
    expect(cards.get("back")?.sources[0]?.path).toBe(path("back"));
    expect(cards.get("detail-1")?.sources[0]?.path).toBe(path("lace"));
    expect(sheet.plan).toMatchObject({
      title: "Royal Blue Slip Dress",
      warnings: [],
      promptVersion: "product-sheet@2.0.0",
      llm: "mock:mock-director",
    });
  }, 60_000);

  it("cuts the references for the ads from the photos when the sheet is approved", async () => {
    const sheet = await buildSheet(supabase(), OWNER, PRODUCT);
    const crops = await approveSheet(supabase(), OWNER, sheet.id);
    expect(crops.map((crop) => crop.kind)).toEqual([
      "front",
      "back",
      "detail",
      "detail",
      "detail",
      "detail",
      "detail",
      "detail",
      "swatch",
      "swatch",
    ]);
    for (const crop of crops) {
      expect(crop.storage_path).toMatch(/\/crops\/[0-9a-f-]{36}\.jpg$/);
      expect(fake.objects.has(crop.storage_path)).toBe(true);
    }
    // The front reference is the photo region itself, at the photo's resolution.
    const front = await sharp(fake.objects.get(crops[0]!.storage_path)!).metadata();
    expect(front.height).toBeGreaterThan(1000);
    expect(fake.rows("product_sheets")[0]).toMatchObject({ status: "approved" });
    expect(fake.rows("products")[0]).toMatchObject({ approved_sheet_id: sheet.id });
  }, 60_000);

  it("takes the owner's box and photo for a card, renders again and re-cuts approved references", async () => {
    const sheet = await buildSheet(supabase(), OWNER, PRODUCT);
    const first = await approveSheet(supabase(), OWNER, sheet.id);
    const box = { x: 0.35, y: 0.4, w: 0.25, h: 0.2 };
    const updated = await updateSheetSources(supabase(), OWNER, sheet.id, [
      { cardId: "detail-1", path: path("front"), box },
    ]);

    const detail = layoutOf(updated).cards.find((card) => card.id === "detail-1")!;
    expect(detail.sources[0]!.path).toBe(path("front"));
    // Grown to the card's shape around the owner's box, never smaller.
    expect(detail.sources[0]!.box.w).toBeGreaterThanOrEqual(box.w);
    expect(detail.sources[0]!.box.h).toBeGreaterThanOrEqual(box.h);

    expect(updated.image_path).not.toBe(sheet.image_path);
    expect(fake.objects.has(updated.image_path!)).toBe(true);
    expect(fake.objects.has(sheet.image_path!)).toBe(false);

    const crops = fake.rows("reference_crops");
    expect(crops).toHaveLength(10);
    for (const crop of first) expect(fake.objects.has(crop.storage_path)).toBe(false);
  }, 60_000);

  it("refuses a photo that does not belong to the product", async () => {
    const sheet = await buildSheet(supabase(), OWNER, PRODUCT);
    await expect(
      updateSheetSources(supabase(), OWNER, sheet.id, [
        { cardId: "detail-1", path: "someone-else/photo.jpg", box: { x: 0, y: 0, w: 1, h: 1 } },
      ]),
    ).rejects.toMatchObject({ code: "validation" });
  }, 60_000);
});
