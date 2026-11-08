import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleIdle } from "../schedule-idle";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  } as unknown as Window);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scheduleIdle", () => {
  it("runs work on the fallback scheduler", async () => {
    const work = vi.fn();

    scheduleIdle(work);
    await vi.advanceTimersByTimeAsync(200);

    expect(work).toHaveBeenCalledOnce();
  });

  it("cancels fallback work when its prefetch run is aborted", async () => {
    const work = vi.fn();
    const controller = new AbortController();

    scheduleIdle(work, 500, controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);

    expect(work).not.toHaveBeenCalled();
  });

  it("does not schedule work for an already-aborted run", () => {
    const work = vi.fn();
    const controller = new AbortController();
    controller.abort();

    scheduleIdle(work, 500, controller.signal);

    expect(vi.getTimerCount()).toBe(0);
    expect(work).not.toHaveBeenCalled();
  });
});
