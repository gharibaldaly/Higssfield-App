import { describe, expect, it } from "vitest";

import { outputFileName, safeFileName, uniqueFileNames } from "@/lib/library/file-names";

const named = (slot: string, slotLabel: string | null = null, purpose = "ghost_front") => ({
  model: "B20133",
  slot,
  slotLabel,
  purpose,
  mimeType: "image/png",
});

describe("outputFileName", () => {
  it("names catalogue views after the model and the view", () => {
    expect(outputFileName(named("front"))).toBe("B20133/B20133-front.png");
    expect(outputFileName(named("back", null, "ghost_back"))).toBe("B20133/B20133-back.png");
    expect(outputFileName(named("macro_1", "lace trim", "macro"))).toBe(
      "B20133/B20133-closeup-1-lace trim.png",
    );
    expect(outputFileName(named("macro_2", null, "macro"))).toBe("B20133/B20133-closeup-2.png");
    expect(outputFileName(named("colorway:abc", "أسود", "colorway"))).toBe(
      "B20133/B20133-colour-أسود.png",
    );
  });

  it("names the other purposes by what they are", () => {
    expect(outputFileName({ ...named("x", null, "product_sheet"), mimeType: "image/jpeg" })).toBe(
      "B20133/B20133-sheet.jpg",
    );
    expect(outputFileName({ ...named("x", null, "shot_video"), mimeType: "video/mp4" })).toBe(
      "B20133/B20133-shot.mp4",
    );
    expect(outputFileName(named("x", null, "shot_preview"))).toBe("B20133/B20133-shot-frame.png");
    expect(outputFileName(named("x", null, "other"))).toBe("B20133/B20133-image.png");
  });

  it("keeps the model's letters but drops characters file systems refuse", () => {
    expect(outputFileName({ ...named("front"), model: 'Set: "Rose" / Night?' })).toBe(
      "Set- -Rose- - Night-/Set- -Rose- - Night--front.png",
    );
    expect(outputFileName({ ...named("front"), model: "موديل ١" })).toBe(
      "موديل ١/موديل ١-front.png",
    );
    expect(outputFileName({ ...named("front"), model: "   " })).toBe("model/model-front.png");
  });

  it("falls back to png when the type is unknown", () => {
    expect(outputFileName({ ...named("front"), mimeType: null })).toBe("B20133/B20133-front.png");
  });
});

describe("safeFileName", () => {
  it("trims trailing dots and spaces, which Windows drops", () => {
    expect(safeFileName("name. . ", "x")).toBe("name");
  });
  it("collapses whitespace and caps the length", () => {
    expect(safeFileName("a   b\t\nc", "x")).toBe("a b c");
    expect(safeFileName("m".repeat(200), "x")).toHaveLength(80);
  });
});

describe("uniqueFileNames", () => {
  it("numbers repeats before the extension", () => {
    expect(
      uniqueFileNames(["a/a-front.png", "a/a-front.png", "a/a-back.png", "a/a-front.png"]),
    ).toEqual(["a/a-front.png", "a/a-front (2).png", "a/a-back.png", "a/a-front (3).png"]);
  });
  it("numbers names without an extension at the end", () => {
    expect(uniqueFileNames(["a.b/x", "a.b/x"])).toEqual(["a.b/x", "a.b/x (2)"]);
  });
});
