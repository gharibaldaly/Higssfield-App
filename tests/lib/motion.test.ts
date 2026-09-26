import { describe, expect, it } from "vitest";

import { approach, clamp, normaliseVelocity, shouldPour } from "@/lib/fx/motion";
import { ringPath, starPoints, wavePath } from "@/lib/fx/shapes";

describe("motion helpers", () => {
  it("clamps and normalises scroll speed", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(normaliseVelocity(21, 42)).toBeCloseTo(0.5);
    expect(normaliseVelocity(-400)).toBe(-1);
    expect(normaliseVelocity(Number.NaN)).toBe(0);
    expect(normaliseVelocity(10, 0)).toBe(0);
  });

  it("eases towards a target at the same pace at any frame rate", () => {
    const at60 = [1, 2].reduce((value) => approach(value, 0, 0.2, 1 / 60), 1);
    const at30 = approach(1, 0, 0.2, 1 / 30);
    expect(at30).toBeCloseTo(at60, 6);
    expect(approach(0, 1, 1, 1 / 60)).toBe(1);
    expect(approach(0.4, 1, 0.5, 0)).toBe(0.4);
  });

  it("pours only when the section or the item changes", () => {
    expect(shouldPour("/", "/products")).toBe(true);
    expect(shouldPour("/products", "/ads")).toBe(true);
    expect(shouldPour("/products", "/products/abc")).toBe(true);
    expect(shouldPour("/products/abc", "/products/def/dna")).toBe(true);
    expect(shouldPour("/products/abc", "/products/abc/dna")).toBe(false);
    expect(shouldPour("/products/abc/dna", "/products/abc/sheet")).toBe(false);
    expect(shouldPour("/library?approved=1", "/library?status=pending")).toBe(false);
    expect(shouldPour("/", "/#main")).toBe(false);
  });
});

describe("shapes", () => {
  it("draws a closed wave that stays inside its band", () => {
    const path = wavePath({ width: 1200, height: 80, baseline: 40, amplitude: 18, waves: 3 });
    expect(path.startsWith("M0 40")).toBe(true);
    expect(path.endsWith("L1200 80 L0 80 Z")).toBe(true);
    const ys = [...path.matchAll(/L?([\d.]+) ([\d.]+)/g)].map((match) => Number(match[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(22);
    expect(Math.max(...ys)).toBeLessThanOrEqual(80);
  });

  it("tiles seamlessly: both ends of a whole number of waves meet at the baseline", () => {
    const path = wavePath({ width: 600, height: 60, baseline: 30, amplitude: 10, waves: 2 });
    const points = [...path.matchAll(/([\d.]+) ([\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    const last = points.find(([x]) => x === 600);
    expect(last?.[1]).toBeCloseTo(30, 0);
  });

  it("builds starbursts and rings", () => {
    expect(starPoints(12, 50, 40).split(" ")).toHaveLength(24);
    expect(starPoints(12, 50, 40, 60, 60).split(" ")[0]).toBe("60,10");
    expect(ringPath(50, 50, 40)).toBe("M50 10 a40 40 0 1 1 0 80 a40 40 0 1 1 0 -80");
  });
});
