"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { lockScroll, unlockScroll } from "@/components/fx/scroll-store";
import { useFullEffects } from "@/components/fx/use-full-effects";
import { shouldPour } from "@/lib/fx/motion";
import { wavePath } from "@/lib/fx/shapes";

type Phase = "idle" | "cover" | "hold" | "reveal";

const COVER_MS = 520;
const REVEAL_MS = 860;
/** The second layer trails the first, so two tones of liquid pass. */
const LAYER_GAP_MS = 80;
/** The route is requested once most of the screen is under the liquid. */
const PUSH_AT = 0.8;
/** If no new page arrives (a failed request, a redirect back), the liquid drains anyway. */
const HOLD_LIMIT_MS = 6000;
const COVER_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
const REVEAL_EASING = "cubic-bezier(0.55, 0, 0.2, 1)";

/** Four whole waves across a 2400-wide strip: the strip drifts by half its width and loops. */
const WAVE = wavePath({ width: 2400, height: 100, baseline: 52, amplitude: 30, waves: 4 });

type Controller = { pour: () => Promise<void>; drain: () => void };
let controller: Controller | null = null;

/** Floods the screen and resolves once it is covered (no-op without full effects). */
export function pourLiquid(): Promise<void> {
  return controller?.pour() ?? Promise.resolve();
}

/** Lets the liquid run off the screen, e.g. when a sign-in attempt fails. */
export function drainLiquid(): void {
  controller?.drain();
}

function Edge({ position }: { position: "top" | "bottom" }) {
  return (
    <div className={`liquid-edge liquid-edge-${position}`}>
      <svg viewBox="0 0 2400 100" preserveAspectRatio="none" focusable="false">
        <path d={WAVE} fill="currentColor" />
      </svg>
    </div>
  );
}

/**
 * Page transition in the spirit of a pour: two layers of liquid satin rise over the page with a
 * wavy surface, the next page loads underneath, and the liquid runs on up and off the screen.
 * Plays for links that change the section or the item (`shouldPour`); tabs and filters stay
 * instant. Only with full effects; the old CSS veil is gone.
 */
export function LiquidTransition() {
  const full = useFullEffects();
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const run = useRef({
    phase: "idle" as Phase,
    covered: null as Promise<void> | null,
    timer: 0,
    locked: false,
  });
  const lastPath = useRef(pathname);

  const setPhase = (phase: Phase) => {
    run.current.phase = phase;
    rootRef.current?.setAttribute("data-phase", phase);
  };

  const layers = () => {
    const root = rootRef.current;
    if (!root) return null;
    const found = Array.from(root.querySelectorAll<HTMLElement>(".liquid-layer"));
    const edge = root.querySelector<HTMLElement>(".liquid-edge");
    const back = found[0];
    const front = found[1];
    if (!back || !front || !edge) return null;
    // The layer is one screen tall plus a wave at each end; this is its travel off-screen.
    return { back, front, travel: back.offsetHeight - edge.offsetHeight };
  };

  const reveal = useCallback(async () => {
    const state = run.current;
    if (state.phase === "idle" || state.phase === "reveal") return;
    window.clearTimeout(state.timer);
    await state.covered;
    if (run.current.phase === "reveal" || run.current.phase === "idle") return;
    setPhase("reveal");
    const found = layers();
    if (found) {
      const { back, front, travel } = found;
      const leave = (element: HTMLElement, delay: number) =>
        element.animate(
          [{ transform: "translateY(0)" }, { transform: `translateY(${-travel}px)` }],
          { duration: REVEAL_MS, delay, easing: REVEAL_EASING, fill: "forwards" },
        ).finished;
      await Promise.all([leave(front, 0), leave(back, LAYER_GAP_MS)]).catch(() => undefined);
      for (const element of [back, front]) {
        for (const animation of element.getAnimations()) animation.cancel();
      }
    }
    setPhase("idle");
    state.covered = null;
    if (state.locked) {
      state.locked = false;
      unlockScroll();
    }
  }, []);

  const cover = useCallback(
    (onMostlyCovered?: () => void): Promise<void> => {
      const state = run.current;
      if (state.phase !== "idle") return state.covered ?? Promise.resolve();
      const found = layers();
      if (!found) {
        onMostlyCovered?.();
        return Promise.resolve();
      }
      setPhase("cover");
      lockScroll();
      state.locked = true;
      const { back, front, travel } = found;
      const rise = (element: HTMLElement, delay: number) =>
        element.animate(
          [{ transform: `translateY(${travel}px)` }, { transform: "translateY(0)" }],
          { duration: COVER_MS, delay, easing: COVER_EASING, fill: "forwards" },
        ).finished;
      if (onMostlyCovered) {
        window.setTimeout(onMostlyCovered, COVER_MS * PUSH_AT + LAYER_GAP_MS);
      }
      state.covered = Promise.all([rise(back, 0), rise(front, LAYER_GAP_MS)])
        .then(() => {
          if (run.current.phase === "cover") setPhase("hold");
        })
        .catch(() => undefined);
      state.timer = window.setTimeout(() => void reveal(), HOLD_LIMIT_MS);
      return state.covered;
    },
    [reveal],
  );

  // Links: a capture listener runs before Next's Link handler, which then sees defaultPrevented.
  useEffect(() => {
    if (!full) return;
    controller = { pour: () => cover(), drain: () => void reveal() };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (!shouldPour(window.location.pathname, url.pathname)) return;
      event.preventDefault();
      if (run.current.phase !== "idle") return;
      const href = `${url.pathname}${url.search}${url.hash}`;
      void cover(() => router.push(href));
    };
    window.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("click", onClick, { capture: true });
      controller = null;
    };
  }, [full, cover, reveal, router]);

  // The next page has arrived: let the liquid run off.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const phase = run.current.phase;
    if (phase === "cover" || phase === "hold") void reveal();
  }, [pathname, reveal]);

  useEffect(() => {
    const state = run.current;
    return () => {
      window.clearTimeout(state.timer);
      if (state.locked) unlockScroll();
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden data-phase="idle" className="liquid-veil">
      <div className="liquid-layer liquid-back">
        <Edge position="top" />
        <div className="liquid-body" />
        <Edge position="bottom" />
      </div>
      <div className="liquid-layer liquid-front">
        <Edge position="top" />
        <div className="liquid-body" />
        <Edge position="bottom" />
      </div>
      <span className="liquid-wait" />
    </div>
  );
}
