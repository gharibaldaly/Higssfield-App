/**
 * Runs a task at most once at a time: a request made while it runs becomes
 * one more run after it, however many requests arrive meanwhile (the latest
 * request's task is the one that runs). Used for page refreshes, because Next
 * runs refreshes and server actions one after another, so a burst of
 * refreshes delays every click that follows.
 */
export type Coalescer = {
  /** Run the task now, or once more after the current run. */
  request(task: () => void): void;
  /** Report that the current run is over. */
  finished(): void;
  readonly running: boolean;
};

export function createCoalescer(): Coalescer {
  let running = false;
  let next: (() => void) | null = null;
  const coalescer: Coalescer = {
    request(task) {
      if (running) {
        next = task;
        return;
      }
      running = true;
      task();
    },
    finished() {
      if (!running) return;
      running = false;
      const task = next;
      next = null;
      if (task) coalescer.request(task);
    },
    get running() {
      return running;
    },
  };
  return coalescer;
}
