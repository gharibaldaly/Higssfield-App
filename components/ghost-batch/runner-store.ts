"use client";

import { useSyncExternalStore } from "react";

import type { GhostWorkReport } from "@/lib/ghost-batches/schemas";

/**
 * Shared state of the ghost batch runner: the last report from the server and
 * whether the loop is running. The runner publishes; the batch board and the
 * status chip read it. `wakeGhostRunner()` asks an idle runner to look for work.
 */

export type RunnerState = {
  running: boolean;
  report: GhostWorkReport | null;
  /** Time of the last finished step, so views know when to refresh their data. */
  lastStepAt: number;
};

const WAKE_EVENT = "ghost-runner:wake";

let state: RunnerState = { running: false, report: null, lastStepAt: 0 };
const listeners = new Set<() => void>();

export function publishRunner(next: Partial<RunnerState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverState: RunnerState = { running: false, report: null, lastStepAt: 0 };

export function useRunnerState(): RunnerState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverState,
  );
}

export function wakeGhostRunner(): void {
  window.dispatchEvent(new Event(WAKE_EVENT));
}

export function onWakeGhostRunner(handler: () => void): () => void {
  window.addEventListener(WAKE_EVENT, handler);
  return () => window.removeEventListener(WAKE_EVENT, handler);
}
