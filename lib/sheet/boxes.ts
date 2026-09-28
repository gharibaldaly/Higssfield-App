import type { NormalizedRect } from "@/lib/sheet/layout";

/** The whole photo. */
export const FULL_RECT: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest side of a usable box, as a share of the photo. */
const MIN_SIDE = 0.02;

const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * The brain's box — [ymin, xmin, ymax, xmax] on a 0–1000 scale — as a
 * normalised rect, or null when it is not a usable box.
 */
export function rectFromBrainBox(box: readonly number[] | null | undefined): NormalizedRect | null {
  if (!box || box.length !== 4 || box.some((value) => !Number.isFinite(value))) return null;
  const [ymin, xmin, ymax, xmax] = box.map(
    (value) => Math.min(1000, Math.max(0, value)) / 1000,
  ) as [number, number, number, number];
  const w = xmax - xmin;
  const h = ymax - ymin;
  if (w < MIN_SIDE || h < MIN_SIDE) return null;
  return { x: round(xmin), y: round(ymin), w: round(w), h: round(h) };
}

/** Keeps a rect inside the photo and at least the minimum size. */
export function clampRect(rect: NormalizedRect): NormalizedRect {
  const w = Math.min(1, Math.max(MIN_SIDE, rect.w));
  const h = Math.min(1, Math.max(MIN_SIDE, rect.h));
  return {
    x: round(Math.min(Math.max(0, rect.x), 1 - w)),
    y: round(Math.min(Math.max(0, rect.y), 1 - h)),
    w: round(w),
    h: round(h),
  };
}

/** Grows a rect by a share of its own size on every side, within the photo. */
export function padRect(rect: NormalizedRect, share: number): NormalizedRect {
  const dx = rect.w * share;
  const dy = rect.h * share;
  const x = Math.max(0, rect.x - dx);
  const y = Math.max(0, rect.y - dy);
  return clampRect({
    x,
    y,
    w: Math.min(1, rect.x + rect.w + dx) - x,
    h: Math.min(1, rect.y + rect.h + dy) - y,
  });
}

/**
 * Grows a rect around its centre until it has the card's shape, so a card can
 * show it without stretching: never smaller, moved back inside the photo when
 * it would spill over. Shapes are width / height in pixels; `photoAspect` is
 * the photo's own. A rect that cannot grow further (the whole photo) keeps
 * its shape.
 */
export function fitRectToAspect(
  rect: NormalizedRect,
  cardAspect: number,
  photoAspect: number,
): NormalizedRect {
  if (!(cardAspect > 0) || !(photoAspect > 0)) return clampRect(rect);
  // The card's shape in the photo's normalised units.
  const want = cardAspect / photoAspect;
  let w = rect.w;
  let h = rect.h;
  if (w / h < want) w = Math.min(1, h * want);
  else h = Math.min(1, w / want);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}

/** Pixel rectangle of a normalised rect on an image, inside its bounds. */
export function pixelRect(rect: NormalizedRect, width: number, height: number) {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(rect.w * width))),
    height: Math.max(1, Math.min(height - top, Math.round(rect.h * height))),
  };
}
