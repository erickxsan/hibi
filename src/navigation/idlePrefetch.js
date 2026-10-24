import { useEffect } from "react";

const IDLE_TIMEOUT_MS = 4000;
const FALLBACK_DELAY_MS = 1500;

/** Data saver or a 2G connection: leave the bandwidth to what the teacher actually opens. */
export function prefersReducedData(navigatorLike = globalThis.navigator) {
  const connection = /** @type {any} */ (navigatorLike)?.connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/u.test(String(connection?.effectiveType || ""));
}

/**
 * Downloads the lazy section chunks one at a time while the browser is idle, starting after the first paint, so
 * opening a section later does not show «Cargando…». Failures are ignored: the section still loads on demand.
 * @param {Array<() => Promise<unknown>>} loaders
 * @returns {() => void} cancel
 */
export function prefetchWhenIdle(loaders, win = globalThis) {
  if (!loaders.length || prefersReducedData(win.navigator)) return () => {};
  let cancelled = false;
  let frame = null;
  let timer = null;
  let idle = null;
  const queue = [...loaders];

  const whenIdle = (task) => {
    if (typeof win.requestIdleCallback === "function")
      idle = win.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    else timer = win.setTimeout(task, FALLBACK_DELAY_MS);
  };
  const next = () => {
    idle = null;
    timer = null;
    // Offline, stop: the browser remembers a failed import() for the life of the page, so a prefetch
    // that fails now would break that section later, even once the connection is back.
    if (cancelled || !queue.length || win.navigator?.onLine === false) return;
    const load = queue.shift();
    Promise.resolve()
      .then(load)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) whenIdle(next);
      });
  };
  // A frame plus a task puts the first idle check after the first paint.
  const afterPaint = () => {
    frame = null;
    timer = win.setTimeout(() => whenIdle(next), 0);
  };
  if (typeof win.requestAnimationFrame === "function") frame = win.requestAnimationFrame(afterPaint);
  else afterPaint();

  return () => {
    cancelled = true;
    if (frame !== null) win.cancelAnimationFrame?.(frame);
    if (timer !== null) win.clearTimeout(timer);
    if (idle !== null) win.cancelIdleCallback?.(idle);
  };
}

/** Starts {@link prefetchWhenIdle} once, after the shell has mounted. */
export function useIdlePrefetch(loaders) {
  useEffect(() => prefetchWhenIdle(loaders), [loaders]);
}
