import { describe, expect, it, vi } from "vitest";

import { createCoalescer } from "@/lib/coalesce";

describe("createCoalescer", () => {
  it("runs at once when idle", () => {
    const task = vi.fn();
    const coalescer = createCoalescer();
    coalescer.request(task);
    expect(task).toHaveBeenCalledTimes(1);
    expect(coalescer.running).toBe(true);
  });

  it("turns any number of requests during a run into one more run", () => {
    const task = vi.fn();
    const coalescer = createCoalescer();
    coalescer.request(task);
    coalescer.request(task);
    coalescer.request(task);
    coalescer.request(task);
    expect(task).toHaveBeenCalledTimes(1);
    coalescer.finished();
    expect(task).toHaveBeenCalledTimes(2);
    expect(coalescer.running).toBe(true);
    coalescer.finished();
    expect(task).toHaveBeenCalledTimes(2);
    expect(coalescer.running).toBe(false);
  });

  it("runs the latest request's task after the current run", () => {
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    const coalescer = createCoalescer();
    coalescer.request(first);
    coalescer.request(second);
    coalescer.request(third);
    coalescer.finished();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("does nothing more when no request came during the run", () => {
    const task = vi.fn();
    const coalescer = createCoalescer();
    coalescer.request(task);
    coalescer.finished();
    expect(task).toHaveBeenCalledTimes(1);
    expect(coalescer.running).toBe(false);
  });

  it("ignores a finish reported while idle, so a late watchdog never starts a run", () => {
    const task = vi.fn();
    const coalescer = createCoalescer();
    coalescer.finished();
    coalescer.request(task);
    coalescer.finished();
    coalescer.finished();
    expect(task).toHaveBeenCalledTimes(1);
    expect(coalescer.running).toBe(false);
  });

  it("allows a request made from inside the running task", () => {
    const coalescer = createCoalescer();
    const task = vi.fn(() => {
      if (task.mock.calls.length === 1) coalescer.request(task);
    });
    coalescer.request(task);
    coalescer.finished();
    expect(task).toHaveBeenCalledTimes(2);
  });
});
