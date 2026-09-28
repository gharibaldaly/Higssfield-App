import { describe, expect, it } from "vitest";

import {
  clampRect,
  fitRectToAspect,
  padRect,
  pixelRect,
  rectFromBrainBox,
} from "@/lib/sheet/boxes";

describe("sheet boxes", () => {
  it("reads the brain's [ymin, xmin, ymax, xmax] boxes on a 0–1000 scale", () => {
    expect(rectFromBrainBox([100, 200, 400, 600])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.3 });
    // Out-of-range values are clamped to the photo.
    expect(rectFromBrainBox([-50, 900, 500, 1200])).toEqual({ x: 0.9, y: 0, w: 0.1, h: 0.5 });
  });

  it("rejects boxes that are not boxes", () => {
    expect(rectFromBrainBox(null)).toBeNull();
    expect(rectFromBrainBox([1, 2, 3])).toBeNull();
    expect(rectFromBrainBox([500, 500, 400, 600])).toBeNull(); // ymax above ymin
    expect(rectFromBrainBox([500, 500, 505, 900])).toBeNull(); // a sliver
    expect(rectFromBrainBox([Number.NaN, 0, 100, 100])).toBeNull();
  });

  it("grows a box to the card's shape around its centre, never shrinking it", () => {
    // A square photo and a card twice as wide as tall: a square box widens.
    const wide = fitRectToAspect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 2, 1);
    expect(wide).toEqual({ x: 0.3, y: 0.4, w: 0.4, h: 0.2 });
    // A portrait photo (3:4): the same card shape needs a wider box in photo units.
    const portrait = fitRectToAspect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 1, 0.75);
    expect(portrait.w / portrait.h).toBeCloseTo(1 / 0.75, 3);
    expect(portrait.h).toBeCloseTo(0.2, 5);
  });

  it("slides a grown box back inside the photo", () => {
    const edge = fitRectToAspect({ x: 0.9, y: 0.1, w: 0.1, h: 0.4 }, 1, 1);
    expect(edge).toEqual({ x: 0.6, y: 0.1, w: 0.4, h: 0.4 });
  });

  it("keeps a box that cannot grow further (the whole photo) as it is", () => {
    expect(fitRectToAspect({ x: 0, y: 0, w: 1, h: 1 }, 2, 1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("pads and clamps within the photo", () => {
    expect(padRect({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, 0.1)).toEqual({
      x: 0.48,
      y: 0.48,
      w: 0.24,
      h: 0.24,
    });
    expect(padRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, 0.1)).toEqual({ x: 0, y: 0, w: 0.55, h: 0.55 });
    expect(clampRect({ x: 0.95, y: -0.2, w: 0.3, h: 0.001 })).toEqual({
      x: 0.7,
      y: 0,
      w: 0.3,
      h: 0.02,
    });
  });

  it("turns a normalised box into pixels inside the image", () => {
    expect(pixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 400, 200)).toEqual({
      left: 100,
      top: 100,
      width: 200,
      height: 100,
    });
    expect(pixelRect({ x: 0.99, y: 0.99, w: 0.5, h: 0.5 }, 100, 100)).toEqual({
      left: 99,
      top: 99,
      width: 1,
      height: 1,
    });
  });
});
