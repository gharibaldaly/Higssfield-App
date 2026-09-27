"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Processes queued items one at a time (e.g. catalogue jobs or shots). Each
 * item is started at most once per page visit; the server claims items
 * atomically, so a second tab cannot double-run them.
 */
export function useSequentialRunner({
  queue,
  run,
  enabled = true,
}: {
  /** Ids still waiting, oldest first. */
  queue: string[];
  run: (id: string) => Promise<void>;
  enabled?: boolean;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const started = useRef(new Set<string>());
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const queueKey = queue.join(",");
  useEffect(() => {
    if (!enabled || current) return;
    const next = queue.find((id) => !started.current.has(id));
    if (!next) return;
    started.current.add(next);
    setCurrent(next);
    setStartedAt(new Date().toISOString());
    void runRef.current(next).finally(() => {
      setCurrent(null);
      setStartedAt(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey, current, enabled]);

  const waiting = queue.filter((id) => id !== current);
  return {
    current,
    startedAt,
    waiting,
    positionOf: (id: string) => {
      if (id === current) return 0;
      const index = waiting.indexOf(id);
      return index === -1 ? null : index + 1 + (current ? 1 : 0);
    },
  };
}
