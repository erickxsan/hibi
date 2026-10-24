import { describe, expect, it, vi } from "vitest";
import { prefersReducedData, prefetchWhenIdle } from "./idlePrefetch.js";

function fakeWindow({ idle = true, connection = undefined } = {}) {
  const frames = [];
  const timers = [];
  const idles = [];
  const win = {
    navigator: { connection },
    requestAnimationFrame: vi.fn((callback) => frames.push(callback)),
    cancelAnimationFrame: vi.fn(),
    setTimeout: vi.fn((callback, delay) => timers.push({ callback, delay })),
    clearTimeout: vi.fn(),
    ...(idle
      ? {
          requestIdleCallback: vi.fn((callback, options) => idles.push({ callback, options })),
          cancelIdleCallback: vi.fn(),
        }
      : {}),
  };
  const flush = async () => {
    for (let guard = 0; guard < 50 && (frames.length || timers.length || idles.length); guard += 1) {
      while (frames.length) frames.shift()();
      while (timers.length) timers.shift().callback();
      while (idles.length) idles.shift().callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { win, flush, frames, timers, idles };
}

describe("idle prefetch of section chunks", () => {
  it("waits for a frame and an idle period, then loads one chunk at a time", async () => {
    const order = [];
    const loaders = ["home", "classes"].map((name) => vi.fn(async () => order.push(name)));
    const { win, flush, frames, idles } = fakeWindow();
    prefetchWhenIdle(loaders, win);
    expect(loaders[0]).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames.shift()();
    win.setTimeout.mock.calls[0][0]();
    expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 });
    idles.shift().callback();
    await Promise.resolve();
    expect(loaders[0]).toHaveBeenCalledOnce();
    expect(loaders[1]).not.toHaveBeenCalled();
    await flush();
    expect(order).toEqual(["home", "classes"]);
  });

  it("falls back to a timeout without requestIdleCallback and ignores failed chunks", async () => {
    const loaders = [vi.fn(async () => Promise.reject(new Error("offline"))), vi.fn(async () => "ok")];
    const { win, flush } = fakeWindow({ idle: false });
    prefetchWhenIdle(loaders, win);
    await flush();
    expect(win.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
    expect(loaders[1]).toHaveBeenCalledOnce();
  });

  it("skips prefetching on Save-Data or 2G connections", () => {
    expect(prefersReducedData({ connection: { saveData: true } })).toBe(true);
    expect(prefersReducedData({ connection: { effectiveType: "slow-2g" } })).toBe(true);
    expect(prefersReducedData({ connection: { effectiveType: "4g" } })).toBe(false);
    expect(prefersReducedData({})).toBe(false);
    const loader = vi.fn(async () => undefined);
    const { win } = fakeWindow({ connection: { saveData: true } });
    prefetchWhenIdle([loader], win);
    expect(win.requestAnimationFrame).not.toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it("does not prefetch while offline, so a failed download never sticks to a section", async () => {
    const loader = vi.fn(async () => undefined);
    const { win, flush } = fakeWindow();
    win.navigator.onLine = false;
    prefetchWhenIdle([loader], win);
    await flush();
    expect(loader).not.toHaveBeenCalled();
  });

  it("stops when cancelled", async () => {
    const loader = vi.fn(async () => undefined);
    const { win, flush } = fakeWindow();
    const cancel = prefetchWhenIdle([loader], win);
    cancel();
    await flush();
    expect(loader).not.toHaveBeenCalled();
    expect(win.cancelAnimationFrame).toHaveBeenCalled();
  });
});
