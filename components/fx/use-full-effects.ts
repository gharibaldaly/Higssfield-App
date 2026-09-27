"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-fx"] });
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function readFullEffects(): boolean {
  return (
    document.documentElement.dataset.fx !== "calm" && !window.matchMedia(REDUCED_MOTION).matches
  );
}

/**
 * True when the decorative layer may move: the owner has not chosen "calm" (html[data-fx]) and
 * the system does not ask for reduced motion. False on the server, so effects start after hydration.
 */
export function useFullEffects(): boolean {
  return useSyncExternalStore(subscribe, readFullEffects, () => false);
}
