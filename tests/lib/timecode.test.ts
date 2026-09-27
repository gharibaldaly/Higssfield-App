import { describe, expect, it } from "vitest";

import { formatTimecode, shotStarts } from "@/lib/format/timecode";

describe("timecode", () => {
  it("formats whole and fractional seconds", () => {
    expect(formatTimecode(0)).toBe("00:00");
    expect(formatTimecode(3)).toBe("00:03");
    expect(formatTimecode(4.5)).toBe("00:04.5");
    expect(formatTimecode(59.96)).toBe("01:00");
    expect(formatTimecode(75.25)).toBe("01:15.3");
    expect(formatTimecode(-2)).toBe("00:00");
  });

  it("accumulates shot starts in order", () => {
    expect(shotStarts([3, 2.5, 3])).toEqual([0, 3, 5.5]);
    expect(shotStarts([])).toEqual([]);
    expect(shotStarts([2, -1, 1])).toEqual([0, 2, 2]);
  });
});
