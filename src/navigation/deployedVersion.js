import { useEffect, useState } from "react";

// A tab left open across a deploy keeps running the old JavaScript; Hibi has no service worker to tell it.
// When the tab is shown again (at most every few minutes), it reads the published index.html and compares its
// entry script, which carries a content hash in production builds, with the one this tab started from.

export const DEPLOY_CHECK_INTERVAL_MS = 5 * 60_000;

/** Path of the entry module script of an HTML document, or "" when it has none. */
export function entryScriptOf(doc) {
  const src = doc?.querySelector?.('script[type="module"][src]')?.getAttribute("src");
  if (!src) return "";
  try {
    return new URL(src, "https://hibi.invalid/").pathname;
  } catch {
    return "";
  }
}

/** Entry script of the published index.html, or "" when it cannot be read (offline, error page, non-HTML). */
export async function deployedEntryScript(win = globalThis) {
  if (typeof win.fetch !== "function" || typeof win.DOMParser !== "function") return "";
  if (win.navigator?.onLine === false) return "";
  try {
    const url = new URL("/", win.location.href);
    url.searchParams.set("hibi-version-check", String(Date.now()));
    const response = await win.fetch(url.href, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "text/html" },
    });
    if (!response?.ok) return "";
    const type = response.headers?.get?.("content-type") || "";
    if (type && !type.includes("text/html")) return "";
    return entryScriptOf(new win.DOMParser().parseFromString(await response.text(), "text/html"));
  } catch {
    return "";
  }
}

/** Whether the published index.html loads a different entry script than `current`. */
export async function isNewDeployAvailable(current, win = globalThis) {
  if (!current) return false;
  const deployed = await deployedEntryScript(win);
  return Boolean(deployed) && deployed !== current;
}

/**
 * Calls `onNewDeploy` once when the published site has moved on from this tab's build. Checks run when the tab
 * becomes visible, never more often than `minIntervalMs`, and fail silently.
 * @returns {() => void} stop
 */
export function watchForNewDeploy(onNewDeploy, { win = globalThis, minIntervalMs = DEPLOY_CHECK_INTERVAL_MS } = {}) {
  const doc = win.document;
  const current = entryScriptOf(doc);
  if (!current || typeof doc?.addEventListener !== "function") return () => {};
  // This tab has just loaded the current build.
  let lastCheck = Date.now();
  let running = false;
  let stopped = false;
  const stop = () => {
    stopped = true;
    doc.removeEventListener("visibilitychange", check);
  };
  async function check() {
    if (stopped || running || doc.visibilityState !== "visible") return;
    if (Date.now() - lastCheck < minIntervalMs) return;
    running = true;
    lastCheck = Date.now();
    try {
      if ((await isNewDeployAvailable(current, win)) && !stopped) {
        stop();
        onNewDeploy();
      }
    } finally {
      running = false;
    }
  }
  doc.addEventListener("visibilitychange", check);
  return stop;
}

/** True once a newer Hibi has been published while this tab was open. Off in development and tests. */
export function useNewDeployAvailable({ enabled = import.meta.env.PROD } = {}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => (enabled ? watchForNewDeploy(() => setAvailable(true)) : undefined), [enabled]);
  return available;
}
