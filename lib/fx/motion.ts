/** Pure helpers for the scroll-driven motion layer (see components/fx/smooth-scroll.tsx). */

/** Scroll speed, in px per 60 fps frame, that counts as full speed for skew and slosh. */
export const VELOCITY_SCALE = 42;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maps a scroll delta (px per 60 fps frame) to -1…1; positive means moving down the page. */
export function normaliseVelocity(pxPerFrame: number, scale = VELOCITY_SCALE): number {
  if (!Number.isFinite(pxPerFrame) || scale <= 0) return 0;
  return clamp(pxPerFrame / scale, -1, 1);
}

/**
 * Frame-rate independent easing towards `target`: `rate` is the share of the gap closed per
 * 60 fps frame, so the motion feels the same at 30, 60 or 120 fps.
 */
export function approach(current: number, target: number, rate: number, dtSeconds: number): number {
  const k = 1 - Math.pow(1 - clamp(rate, 0, 1), Math.max(0, dtSeconds) * 60);
  return current + (target - current) * k;
}

function segments(path: string): string[] {
  return (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
}

/**
 * Whether a link deserves the liquid page transition: the section (first path segment) or the
 * item inside it (second segment) changes. Tabs inside an item and query changes do not pour.
 */
export function shouldPour(fromPath: string, toPath: string): boolean {
  const from = segments(fromPath);
  const to = segments(toPath);
  return from[0] !== to[0] || from[1] !== to[1];
}
