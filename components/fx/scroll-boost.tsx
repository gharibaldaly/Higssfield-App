"use client";

import type * as React from "react";
import { useEffect, useRef } from "react";

import { subscribeScroll } from "@/components/fx/scroll-store";
import { useFullEffects } from "@/components/fx/use-full-effects";
import { approach } from "@/lib/fx/motion";

/** How much faster the ticker runs at full scroll speed. */
const BOOST = 7;

/**
 * Tickers inside run faster while the page scrolls and turn back while it scrolls up, then ease
 * back to their resting pace (it changes the playback rate of the CSS animations inside).
 */
export function ScrollBoost({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const full = useFullEffects();

  useEffect(() => {
    const root = ref.current;
    if (!full || !root) return;
    let animations: Animation[] = [];
    let target = 1;
    let rate = 1;
    let last = 0;
    let frame = 0;
    // Scroll frames stop when the page rests, so the ease back runs on its own frames.
    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      rate = approach(rate, target, 0.12, dt);
      if (Math.abs(rate - target) < 0.005) rate = target;
      for (const animation of animations) animation.updatePlaybackRate(rate);
      frame = rate === target ? 0 : requestAnimationFrame(tick);
    };
    const unsubscribe = subscribeScroll(({ velocity }) => {
      if (animations.length === 0) animations = root.getAnimations({ subtree: true });
      target = (velocity < -0.02 ? -1 : 1) * (1 + Math.abs(velocity) * BOOST);
      if (!frame && rate !== target) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      for (const animation of animations) animation.updatePlaybackRate(1);
    };
  }, [full]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
