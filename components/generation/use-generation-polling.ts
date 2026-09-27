"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GenerationView } from "@/lib/domain/generation";

const PENDING = new Set(["queued", "in_progress"]);

function viewsKey(views: GenerationView[]): string {
  return views
    .map((view) => `${view.id}:${view.status}:${view.reviewStatus}:${view.url ? 1 : 0}`)
    .join("|");
}

/**
 * Keeps generation views fresh. Polls the status API while anything is
 * pending (every 4 s, backing off to 10 s on errors) and calls onSettled when
 * an item reaches a final state so pages can refresh their server data.
 */
export function useGenerationPolling(
  initial: GenerationView[],
  options: { onSettled?: (view: GenerationView) => void } = {},
) {
  const [views, setViews] = useState<Map<string, GenerationView>>(
    () => new Map(initial.map((view) => [view.id, view])),
  );
  const viewsRef = useRef(views);
  const onSettled = useRef(options.onSettled);

  useEffect(() => {
    viewsRef.current = views;
  }, [views]);
  useEffect(() => {
    onSettled.current = options.onSettled;
  }, [options.onSettled]);

  // Merge server-provided views (e.g. after router.refresh()). A stale
  // "pending" from the server never overwrites a locally settled view.
  const initialKey = viewsKey(initial);
  const [mergedKey, setMergedKey] = useState(initialKey);
  if (initialKey !== mergedKey) {
    setMergedKey(initialKey);
    setViews((current) => {
      const next = new Map(current);
      for (const view of initial) {
        const existing = next.get(view.id);
        const staleServer = existing && !PENDING.has(existing.status) && PENDING.has(view.status);
        if (!staleServer) next.set(view.id, view);
      }
      return next;
    });
  }

  const upsert = useCallback((view: GenerationView) => {
    setViews((current) => new Map(current).set(view.id, view));
  }, []);

  const pendingKey = [...views.values()]
    .filter((view) => PENDING.has(view.status))
    .map((view) => view.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!pendingKey) return;
    let cancelled = false;
    let delay = 4000;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch(`/api/generations/status?ids=${pendingKey}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const payload = (await response.json()) as { generations: GenerationView[] };
          if (cancelled) return;
          const settled = payload.generations.filter((view) => {
            const before = viewsRef.current.get(view.id);
            return before && PENDING.has(before.status) && !PENDING.has(view.status);
          });
          setViews((current) => {
            const next = new Map(current);
            for (const view of payload.generations) next.set(view.id, view);
            return next;
          });
          for (const view of settled) onSettled.current?.(view);
          delay = 4000;
        } else {
          delay = Math.min(delay * 1.5, 10000);
        }
      } catch {
        delay = Math.min(delay * 1.5, 10000);
      }
      if (!cancelled) timer = setTimeout(poll, delay);
    }

    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingKey]);

  return { views, upsert, pendingCount: pendingKey ? pendingKey.split(",").length : 0 };
}
