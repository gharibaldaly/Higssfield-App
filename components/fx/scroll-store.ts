/**
 * Shared scroll state for the motion layer. SmoothScroll publishes one frame per animation frame
 * while the page moves; effects read it instead of each listening to scroll events.
 */

export type ScrollFrame = {
  /** Scroll offset in px (the smoothed value while Lenis glides). */
  y: number;
  /** Scroll speed, -1…1; positive while moving down the page. */
  velocity: number;
  /** How far through the page, 0…1. */
  progress: number;
};

const frame: ScrollFrame = { y: 0, velocity: 0, progress: 0 };
const listeners = new Set<(frame: Readonly<ScrollFrame>) => void>();

export function readScroll(): Readonly<ScrollFrame> {
  return frame;
}

export function subscribeScroll(listener: (frame: Readonly<ScrollFrame>) => void): () => void {
  listeners.add(listener);
  listener(frame);
  return () => {
    listeners.delete(listener);
  };
}

export function publishScroll(next: ScrollFrame): void {
  frame.y = next.y;
  frame.velocity = next.velocity;
  frame.progress = next.progress;
  for (const listener of listeners) listener(frame);
}

type ScrollDriver = { lock: () => void; unlock: () => void };
let driver: ScrollDriver | null = null;

export function setScrollDriver(next: ScrollDriver | null): void {
  driver = next;
}

/** Holds the smoothed wheel still (page transitions); calls nest and must be paired. */
export function lockScroll(): void {
  driver?.lock();
}

export function unlockScroll(): void {
  driver?.unlock();
}
