import { describe, expect, it } from "vitest";

import { buildGhostForm, CENTER_Y, POINT_KIND, profileAt } from "@/lib/fx/ghost-form-geometry";

describe("ghost form geometry", () => {
  const form = buildGhostForm();

  it("keeps every buffer the same length", () => {
    expect(form.count).toBeGreaterThan(12_000);
    expect(form.target).toHaveLength(form.count * 3);
    expect(form.scatter).toHaveLength(form.count * 3);
    expect(form.info).toHaveLength(form.count * 2);
  });

  it("is deterministic per seed", () => {
    const again = buildGhostForm();
    expect(again.target).toEqual(form.target);
    expect(buildGhostForm({ seed: 7 }).target).not.toEqual(form.target);
  });

  it("stays centred and inside the unit frame the shader projects", () => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < form.count; index += 1) {
      const x = form.target[index * 3]!;
      const y = form.target[index * 3 + 1]!;
      const z = form.target[index * 3 + 2]!;
      expect(Math.abs(x)).toBeLessThan(0.5);
      expect(Math.abs(z)).toBeLessThan(0.5);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(maxY).toBeLessThanOrEqual(1.5);
    expect(minY).toBeGreaterThanOrEqual(-1.5);
    expect(Math.abs(maxY + minY)).toBeLessThan(0.05);
    expect(CENTER_Y).toBeLessThan(0);
  });

  it("marks seams and the stand separately from the surface cloud", () => {
    const kinds = new Set<number>();
    for (let index = 0; index < form.count; index += 1) kinds.add(form.info[index * 2]!);
    expect([...kinds].sort()).toEqual([POINT_KIND.surface, POINT_KIND.seam, POINT_KIND.stand]);
  });

  it("narrows at the waist and neck", () => {
    expect(profileAt(0.05).rx).toBeLessThan(profileAt(-0.62).rx);
    expect(profileAt(0.05).rx).toBeLessThan(profileAt(0.74).rx);
    expect(profileAt(1.1).rx).toBeLessThan(0.15);
    expect(profileAt(-5).rx).toBe(profileAt(-0.85).rx);
  });
});
