"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { createCoalescer } from "@/lib/coalesce";

/** A refresh whose end was never seen still lets the next one start after this long. */
const WATCHDOG_MS = 20_000;

/**
 * `router.refresh()` that never piles up. Next runs refreshes and server
 * actions one after another, so every queued refresh delays the next click
 * (an Approve waited behind each image that settled). Here at most one
 * refresh runs; any asked for meanwhile become one more after it.
 */
export function useRefresh(): () => void {
  const router = useRouter();
  const routerRef = useRef(router);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [coalescer] = useState(createCoalescer);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const start = useCallback(() => {
    clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => coalescer.finished(), WATCHDOG_MS);
    startTransition(() => routerRef.current.refresh());
  }, [coalescer]);

  // The transition stays pending until the refreshed page has arrived.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      clearTimeout(watchdog.current);
      coalescer.finished();
    }
    wasPending.current = pending;
  }, [pending, coalescer]);

  useEffect(() => () => clearTimeout(watchdog.current), []);

  return useCallback(() => coalescer.request(start), [coalescer, start]);
}
