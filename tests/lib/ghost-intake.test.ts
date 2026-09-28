import { describe, expect, it } from "vitest";

import {
  isCameraName,
  modelKeyOfName,
  normalizeToken,
  planIntake,
  stemOf,
  tagOfToken,
  type IntakeFileInfo,
} from "@/lib/ghost-batches/intake";

function files(paths: string[]): IntakeFileInfo[] {
  return paths.map((path, index) => ({
    id: `f${index}`,
    name: path.split("/").pop()!,
    path,
  }));
}

function summary(plan: ReturnType<typeof planIntake>) {
  return plan.models.map((model) => ({
    name: model.name,
    tags: model.photos.map((photo) => `${photo.tag}:${photo.tagSource}`),
  }));
}

describe("keywords", () => {
  it("reads English and Arabic role words", () => {
    expect(tagOfToken("Front")).toBe("front");
    expect(tagOfToken("back2")).toBe("back");
    expect(tagOfToken("أمام")).toBe("front");
    expect(tagOfToken("ظهر")).toBe("back");
    expect(tagOfToken("تفصيلة")).toBe("detail");
    expect(tagOfToken("كلوز")).toBe("detail");
    expect(tagOfToken("ألوان")).toBe("colour");
    expect(tagOfToken("لون")).toBe("colour");
    expect(tagOfToken("robe")).toBeNull();
    // A model code is never a role, even when it starts with a role letter.
    expect(tagOfToken("B20124")).toBeNull();
    expect(tagOfToken("F1023")).toBeNull();
    expect(tagOfToken("b")).toBe("back");
    expect(tagOfToken("front01")).toBe("front");
    expect(normalizeToken("إضاءة")).toBe("اضاءه");
  });

  it("spots camera names and model keys", () => {
    expect(isCameraName("IMG_2231.JPG")).toBe(true);
    expect(isCameraName("PXL_20260927_101010.jpg")).toBe(true);
    expect(isCameraName("20260927_101010.jpg")).toBe(true);
    expect(isCameraName("WhatsApp Image 2026-09-27 at 10.10.10 (2).jpeg")).toBe(true);
    // Doubled extensions, iPhone edits, copies and image tools.
    expect(isCameraName("IMG_5124.JPG.jpg")).toBe(true);
    expect(isCameraName("IMG_5124.HEIC.jpeg")).toBe(true);
    expect(isCameraName("IMG_E5124.JPG")).toBe(true);
    expect(isCameraName("IMG_5124 - Copy (2).JPG")).toBe(true);
    expect(isCameraName("PXL_20260927_101010123.MP.jpg")).toBe(true);
    expect(isCameraName("ChatGPT Image Sep 27, 2026, 10_05_26 AM.png")).toBe(true);
    expect(isCameraName("Gemini_Generated_Image_x1y2z3.png")).toBe(true);
    expect(isCameraName("Screenshot_20260927-101010.png")).toBe(true);
    expect(isCameraName("Screenshots of lace.png")).toBe(false);
    expect(isCameraName("DS1024_front.jpg")).toBe(false);
    expect(stemOf("DS1024 front.JPG.jpeg")).toBe("DS1024 front");
    expect(stemOf("notes.v2.txt")).toBe("notes.v2");
    expect(modelKeyOfName("DS1024_front.jpg")).toBe("ds1024");
    expect(modelKeyOfName("DS-1024-back-2.jpg")).toBe("ds-1024");
    expect(modelKeyOfName("DS-1024.jpg")).toBe("ds-1024");
    expect(modelKeyOfName("IMG_1.jpg")).toBeNull();
  });
});

describe("planIntake", () => {
  it("groups by model folder and reads role folders inside it", () => {
    const plan = planIntake(
      files([
        "Batch/DS-1025/IMG_3.jpg",
        "Batch/DS-1024/IMG_2.jpg",
        "Batch/DS-1024/IMG_1.jpg",
        "Batch/DS-1024/colours/red.jpg",
        "Batch/DS-1024/تفاصيل/IMG_9.jpg",
        "Batch/DS-1025/back.jpg",
      ]),
    );
    expect(plan.grouping).toBe("folders");
    expect(summary(plan)).toEqual([
      {
        name: "DS-1024",
        tags: ["colour:name", "front:order", "back:order", "detail:name"],
      },
      { name: "DS-1025", tags: ["back:name", "front:order"] },
    ]);
    const colour = plan.models[0]!.photos.find((photo) => photo.tag === "colour");
    expect(colour?.colourName).toBe("red");
  });

  it("treats a single dropped folder of loose files by their names", () => {
    const plan = planIntake(
      files([
        "Sept/DS1024_front.jpg",
        "Sept/DS1024_back.jpg",
        "Sept/DS1024_lace.jpg",
        "Sept/DS1025_front.jpg",
        "Sept/DS1025 لون كحلي.jpg",
      ]),
    );
    expect(plan.grouping).toBe("names");
    expect(summary(plan)).toEqual([
      { name: "DS1024", tags: ["back:name", "front:name", "detail:order"] },
      { name: "DS1025", tags: ["colour:name", "front:name"] },
    ]);
    expect(plan.models[1]!.photos[0]!.colourName).toBe("كحلي");
  });

  it("keeps a drop of camera photos together as one model", () => {
    // The owner's first batch: fourteen phone photos with doubled extensions and
    // one ChatGPT image became fifteen models of one photo each.
    const names = [
      "IMG_5124.JPG.jpg",
      "IMG_5126.JPG.jpg",
      "IMG_5128.JPG.jpg",
      "IMG_5129.JPG.jpg",
      "IMG_5130.JPG.jpg",
      "IMG_5131.JPG.jpg",
      "IMG_5134.JPG.jpg",
      "IMG_5135.JPG.jpg",
      "IMG_5137.JPG.jpg",
      "IMG_5138.JPG.jpg",
      "IMG_5139.JPG.jpg",
      "IMG_5140.JPG.jpg",
      "IMG_5142.JPG.jpg",
      "IMG_5143.JPG.jpg",
      "ChatGPT Image Sep 27, 2026, 10_05_26 AM.png",
    ];
    const plan = planIntake(files(names));
    expect(plan.grouping).toBe("sequence");
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.photos).toHaveLength(15);
    expect(
      plan.models[0]!.photos.slice(0, 3).map((photo) => `${photo.tag}:${photo.tagSource}`),
    ).toEqual(["front:order", "back:order", "detail:order"]);
  });

  it("reads lone descriptive names as photos of the same model", () => {
    const plan = planIntake(
      files(["front.jpg", "back.jpg", "lace 1.jpg", "lace 2.jpg", "strap.jpg", "IMG_7.jpg"]),
    );
    expect(plan.grouping).toBe("sequence");
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.photos).toHaveLength(6);
  });

  it("names the drop after its one model name", () => {
    const plan = planIntake(files(["Rose robe front.jpg", "Rose robe back.jpg", "IMG_1.jpg"]));
    expect(plan.grouping).toBe("names");
    expect(summary(plan)).toEqual([
      { name: "Rose robe", tags: ["detail:order", "back:name", "front:name"] },
    ]);
  });

  it("keeps numbered copies of a code-named photo together", () => {
    const plan = planIntake(
      files(["B20124 (1).jpg", "B20124 (2).jpg", "B20124 (3).jpg", "B20124 (4).jpg"]),
    );
    expect(plan.models.map((model) => [model.name, model.photos.length])).toEqual([["B20124", 4]]);
    expect(modelKeyOfName("B20124_back.jpg")).toBe("b20124");
  });

  it("splits by names only when they name several models", () => {
    const plan = planIntake(
      files([
        "DS1024_front.jpg",
        "DS1024_back.jpg",
        "DS1025_front.jpg",
        "DS1025_back.jpg",
        "IMG_7.jpg",
      ]),
    );
    expect(plan.grouping).toBe("names");
    expect(plan.models.map((model) => [model.name, model.photos.length])).toEqual([
      ["DS1024", 2],
      ["DS1025", 2],
      ["#3", 1],
    ]);
    // Model codes count even with one photo each.
    expect(planIntake(files(["DS1024.jpg", "DS1025.jpg"])).models).toHaveLength(2);
  });

  it("splits camera names in order when the owner asks for it", () => {
    const plan = planIntake(
      files(["IMG_10.jpg", "IMG_2.jpg", "IMG_3.jpg", "IMG_4.jpg", "IMG_5.jpg", "IMG_1.jpg"]),
      { perModel: 3 },
    );
    expect(plan.grouping).toBe("sequence");
    expect(plan.models.map((model) => model.name)).toEqual(["#1", "#2"]);
    expect(plan.models[0]!.photos.map((photo) => photo.fileId)).toEqual(["f5", "f1", "f2"]);
    expect(plan.models[1]!.photos.map((photo) => photo.tag)).toEqual(["front", "back", "detail"]);
  });

  it("keeps a lone model folder with loose files as one model", () => {
    const plan = planIntake(files(["DS-1030/IMG_1.jpg", "DS-1030/IMG_2.jpg"]));
    expect(summary(plan)).toEqual([{ name: "DS-1030", tags: ["front:order", "back:order"] }]);
  });

  it("keeps a model folder that only holds role folders as one model", () => {
    const plan = planIntake(
      files([
        "DS-1024/أمام/IMG_1.jpg",
        "DS-1024/خلف/IMG_2.jpg",
        "DS-1024/IMG_3.jpg",
        "DS-1024/ألوان/red.jpg",
      ]),
    );
    expect(plan.grouping).toBe("folders");
    expect(plan.models).toHaveLength(1);
    expect(plan.models[0]!.name).toBe("DS-1024");
    const tags = new Map(
      plan.models[0]!.photos.map((photo) => [photo.fileId, `${photo.tag}:${photo.tagSource}`]),
    );
    expect(Object.fromEntries(tags)).toEqual({
      f0: "front:name",
      f1: "back:name",
      f2: "detail:order",
      f3: "colour:name",
    });
    expect(plan.models[0]!.photos.find((photo) => photo.fileId === "f3")?.colourName).toBe("red");

    // Role folders dragged in on their own, and one photo inside a role folder.
    const loose = planIntake(files(["front/IMG_1.jpg", "back/IMG_2.jpg"]));
    expect(loose.models.map((model) => model.name)).toEqual(["#1"]);
    expect(loose.models[0]!.photos.map((photo) => photo.tag).sort()).toEqual(["back", "front"]);
    expect(summary(planIntake(files(["DS-1030/front/IMG_1.jpg"])))).toEqual([
      { name: "DS-1030", tags: ["front:name"] },
    ]);
  });

  it("never reads a model folder with a letter code as a role folder", () => {
    const plan = planIntake(files(["Batch/B1/IMG_1.jpg", "Batch/B2/IMG_2.jpg"]));
    expect(plan.models.map((model) => model.name)).toEqual(["B1", "B2"]);
  });

  it("returns nothing for an empty drop", () => {
    expect(planIntake([]).models).toEqual([]);
  });
});
