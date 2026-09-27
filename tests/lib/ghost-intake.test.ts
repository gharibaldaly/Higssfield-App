import { describe, expect, it } from "vitest";

import {
  isCameraName,
  modelKeyOfName,
  normalizeToken,
  planIntake,
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
    expect(normalizeToken("إضاءة")).toBe("اضاءه");
  });

  it("spots camera names and model keys", () => {
    expect(isCameraName("IMG_2231.JPG")).toBe(true);
    expect(isCameraName("PXL_20260927_101010.jpg")).toBe(true);
    expect(isCameraName("20260927_101010.jpg")).toBe(true);
    expect(isCameraName("WhatsApp Image 2026-09-27 at 10.10.10 (2).jpeg")).toBe(true);
    expect(isCameraName("DS1024_front.jpg")).toBe(false);
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

  it("splits camera names in order when nothing else groups them", () => {
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

  it("returns nothing for an empty drop", () => {
    expect(planIntake([]).models).toEqual([]);
  });
});
