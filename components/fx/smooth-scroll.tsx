"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { publishScroll, setScrollDriver } from "@/components/fx/scroll-store";
import { useFullEffects } from "@/components/fx/use-full-effects";
import { approach, normaliseVelocity } from "@/lib/fx/motion";

const FINE_POINTER = "(pointer: fine)";
/** Floating layers keep their own native scrolling: dialogs, menus, listboxes and popovers. */
const NATIVE_SCROLL =
  "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]";

/**
 * Weighted, smoothed wheel scrolling (Lenis) and the scroll frame every effect reads: offset,
 * speed and progress. Display titles marked `.fx-skew` lean with the speed (--skew).
 * The page still scrolls natively underneath, so sticky elements, scroll-driven CSS and keyboard
 * scrolling keep working. Runs only with full effects; touch scrolling always stays native.
 */
export function SmoothScroll() {
  const full = useFullEffects();
  const pathname = usePathname();
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (!full) return;
    const lenis = window.matchMedia(FINE_POINTER).matches
      ? new Lenis({
          lerp: 0.1,
          wheelMultiplier: 0.9,
          allowNestedScroll: true,
          stopInertiaOnNavigate: true,
          prevent: (node) => node.matches(NATIVE_SCROLL),
        })
      : null;
    lenisRef.current = lenis;

    // Radix locks the page under dialogs and menus (body[data-scroll-locked]); the smoothed wheel
    // stops too, or the page would glide on behind the overlay.
    const locks = { overlay: false, held: 0 };
    const sync = () => {
      if (!lenis) return;
      if (locks.overlay || locks.held > 0) lenis.stop();
      else lenis.start();
    };
    const lockObserver = new MutationObserver(() => {
      locks.overlay = document.body.hasAttribute("data-scroll-locked");
      sync();
    });
    lockObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-scroll-locked"],
    });
    setScrollDriver({
      lock: () => {
        locks.held += 1;
        sync();
      },
      unlock: () => {
        locks.held = Math.max(0, locks.held - 1);
        sync();
      },
    });

    const skewed = document.getElementsByClassName("fx-skew");
    let lastY = window.scrollY;
    let lastTime = performance.now();
    let velocity = 0;
    let idle = false;
    let frameId = 0;
    const tick = (time: number) => {
      frameId = requestAnimationFrame(tick);
      lenis?.raf(time);
      const dt = Math.min(0.1, Math.max(0.001, (time - lastTime) / 1000));
      lastTime = time;
      const y = lenis ? lenis.scroll : window.scrollY;
      const step = (y - lastY) / (dt * 60);
      lastY = y;
      velocity = approach(velocity, normaliseVelocity(step), 0.16, dt);
      const moving = Math.abs(step) > 0.05 || Math.abs(velocity) > 0.002;
      if (!moving && idle) return;
      idle = !moving;
      if (idle) velocity = 0;
      const limit = document.documentElement.scrollHeight - window.innerHeight;
      publishScroll({ y, velocity, progress: limit > 0 ? Math.min(1, Math.max(0, y / limit)) : 0 });
      const skew = velocity.toFixed(4);
      for (const element of skewed) (element as HTMLElement).style.setProperty("--skew", skew);
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      lockObserver.disconnect();
      setScrollDriver(null);
      lenis?.destroy();
      lenisRef.current = null;
      for (const element of skewed) (element as HTMLElement).style.removeProperty("--skew");
      publishScroll({ y: window.scrollY, velocity: 0, progress: 0 });
    };
  }, [full]);

  // A new page swaps the content in one go; measure again (Lenis also watches size changes).
  useEffect(() => {
    lenisRef.current?.resize();
  }, [pathname]);

  return null;
}
