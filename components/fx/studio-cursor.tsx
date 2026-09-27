"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { useFullEffects } from "@/components/fx/use-full-effects";

const FINE_POINTER = "(pointer: fine)";
const INTERACTIVE =
  "a, button, summary, label, select, [role='button'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio'], [role='slider'], [role='menuitem'], [role='option']";
const TEXT_ENTRY =
  "input:not([type='checkbox']):not([type='radio']), textarea, [contenteditable='true']";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(FINE_POINTER);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * A stitched ring that trails the pointer and opens up over anything clickable. The system
 * cursor stays visible; the ring hides over text fields so it never covers the caret.
 */
export function StudioCursor() {
  const full = useFullEffects();
  const fine = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(FINE_POINTER).matches,
    () => false,
  );
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!full || !fine || !ring) return;
    const target = { x: -100, y: -100, scale: 1 };
    const current = { x: -100, y: -100, scale: 1 };
    let frame = 0;
    let shown = false;

    const tick = () => {
      current.x += (target.x - current.x) * 0.22;
      current.y += (target.y - current.y) * 0.22;
      current.scale += (target.scale - current.scale) * 0.2;
      ring.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) translate(-50%, -50%) scale(${current.scale})`;
      const settled =
        Math.abs(target.x - current.x) < 0.1 &&
        Math.abs(target.y - current.y) < 0.1 &&
        Math.abs(target.scale - current.scale) < 0.005;
      frame = settled ? 0 : requestAnimationFrame(tick);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      target.x = event.clientX;
      target.y = event.clientY;
      if (!shown) {
        current.x = target.x;
        current.y = target.y;
        shown = true;
      }
      const element = event.target instanceof Element ? event.target : null;
      const typing = Boolean(element?.closest(TEXT_ENTRY));
      const interactive = Boolean(element?.closest(INTERACTIVE));
      target.scale = typing ? 0 : interactive ? 1.8 : 1;
      ring.dataset.active = interactive && !typing ? "true" : "false";
      ring.style.opacity = typing ? "0" : "1";
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onLeave = () => {
      shown = false;
      ring.style.opacity = "0";
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [full, fine]);

  if (!full || !fine) return null;
  return (
    <div
      ref={ringRef}
      aria-hidden
      data-active="false"
      className="studio-cursor pointer-events-none fixed z-[70] size-7 rounded-full opacity-0 mix-blend-difference transition-opacity duration-300"
      style={{ left: 0, top: 0 }}
    >
      <span className="absolute inset-0 rounded-full border border-dashed border-white" />
    </div>
  );
}
