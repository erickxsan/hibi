export const APP_HISTORY_KEY = "__hibiNavigation";

export const APP_ROUTES = Object.freeze({
  home: "/",
  students: "/students",
  groups: "/groups",
  classes: "/classes",
  grades: "/grades",
  payments: "/payments",
  settings: "/settings",
});

const subscribers = new Set();
let listeningWindow = null;
let currentMetadata = null;
let restoringEntry = false;

function normalizePath(pathname = "/") {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (withLeadingSlash === "/") return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/, "");
}

function validStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, item]) => key && typeof item === "string"),
  );
}

function validOverlayIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item);
}

export function pageFromPath(pathname, routes = APP_ROUTES) {
  const normalized = normalizePath(pathname);
  return Object.entries(routes).find(([, path]) => normalizePath(path) === normalized)?.[0] ?? null;
}

export function pathForPage(page, routes = APP_ROUTES) {
  return routes[page] ?? null;
}

export function readAppHistoryState(state) {
  const metadata = state?.[APP_HISTORY_KEY];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return {
    entry: Number.isInteger(metadata.entry) ? metadata.entry : 0,
    page: typeof metadata.page === "string" ? metadata.page : null,
    overlays: validOverlayIds(metadata.overlays),
    views: validStringRecord(metadata.views),
  };
}

export function createAppHistoryState(baseState, metadata) {
  const safeBase = baseState && typeof baseState === "object" && !Array.isArray(baseState) ? baseState : {};
  return {
    ...safeBase,
    [APP_HISTORY_KEY]: {
      entry: Number.isInteger(metadata?.entry) ? metadata.entry : 0,
      page: typeof metadata?.page === "string" ? metadata.page : null,
      overlays: validOverlayIds(metadata?.overlays),
      views: validStringRecord(metadata?.views),
    },
  };
}

function browserAvailable() {
  return typeof window !== "undefined" && Boolean(window.history);
}

function metadataFromBrowser() {
  return browserAvailable() ? readAppHistoryState(window.history.state) : null;
}

function setCurrentMetadata(metadata) {
  currentMetadata = metadata;
  return metadata;
}

function replaceMetadata(metadata, url) {
  if (!browserAvailable()) return null;
  window.history.replaceState(createAppHistoryState(window.history.state, metadata), "", url);
  return setCurrentMetadata(readAppHistoryState(window.history.state));
}

function pushMetadata(metadata, url) {
  if (!browserAvailable()) return null;
  window.history.pushState(createAppHistoryState(window.history.state, metadata), "", url);
  return setCurrentMetadata(readAppHistoryState(window.history.state));
}

function dispatchPopState(event) {
  const previous = currentMetadata ?? metadataFromBrowser();
  const next = readAppHistoryState(event.state);
  const context = {
    event,
    previous,
    next,
    pathname: window.location.pathname,
  };

  if (restoringEntry) {
    restoringEntry = false;
    setCurrentMetadata(next);
    return;
  }

  const blocked = [...subscribers].some((subscriber) => subscriber.beforePop?.(context) === false);
  if (blocked) {
    const previousEntry = previous?.entry;
    const nextEntry = next?.entry;
    if (Number.isInteger(previousEntry) && Number.isInteger(nextEntry) && previousEntry !== nextEntry) {
      restoringEntry = true;
      window.history.go(previousEntry - nextEntry);
      return;
    }
  }

  setCurrentMetadata(next);
  subscribers.forEach((subscriber) => subscriber.onPop?.(context));
}

function ensureDispatcher() {
  if (!browserAvailable() || listeningWindow === window) return;
  listeningWindow?.removeEventListener?.("popstate", dispatchPopState);
  window.addEventListener("popstate", dispatchPopState);
  listeningWindow = window;
  setCurrentMetadata(metadataFromBrowser());
}

export function subscribeToAppHistory(subscriber) {
  if (!browserAvailable()) return () => {};
  ensureDispatcher();
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function ensurePageHistory(page, routes = APP_ROUTES) {
  if (!browserAvailable()) return null;
  ensureDispatcher();
  const existing = metadataFromBrowser();
  const knownPath = pageFromPath(window.location.pathname, routes);
  const destination = knownPath ? window.location.href : pathForPage(page, routes);
  return replaceMetadata({
    entry: existing?.entry ?? 0,
    page,
    overlays: [],
    views: existing?.views ?? {},
  }, destination);
}

export function pushPageHistory(page, routes = APP_ROUTES) {
  if (!browserAvailable()) return null;
  ensureDispatcher();
  const existing = metadataFromBrowser() ?? currentMetadata;
  const destination = pathForPage(page, routes);
  if (!destination) return null;

  // A page transition from inside a drawer consumes the drawer's same-URL
  // entry. Replacing it with the destination avoids an orphaned Home -> Home
  // stop before Back reaches the page underneath the drawer.
  if (existing?.overlays?.length) {
    return replaceMetadata({
      ...existing,
      page,
      overlays: [],
    }, destination);
  }

  return pushMetadata({
    entry: (existing?.entry ?? 0) + 1,
    page,
    overlays: [],
    views: existing?.views ?? {},
  }, destination);
}

export function replacePageHistory(page, routes = APP_ROUTES) {
  if (!browserAvailable()) return null;
  ensureDispatcher();
  const existing = metadataFromBrowser() ?? currentMetadata;
  const destination = pathForPage(page, routes);
  if (!destination) return null;
  return replaceMetadata({
    entry: existing?.entry ?? 0,
    page,
    overlays: [],
    views: existing?.views ?? {},
  }, destination);
}

export function pushViewHistory(key, value) {
  if (!browserAvailable() || !key || typeof value !== "string") return null;
  ensureDispatcher();
  const existing = metadataFromBrowser() ?? currentMetadata ?? { entry: 0, page: null, overlays: [], views: {} };
  return pushMetadata({
    ...existing,
    entry: existing.entry + 1,
    views: { ...existing.views, [key]: value },
  }, window.location.href);
}

export function replaceViewHistory(key, value) {
  if (!browserAvailable() || !key || typeof value !== "string") return null;
  ensureDispatcher();
  const existing = metadataFromBrowser() ?? currentMetadata ?? { entry: 0, page: null, overlays: [], views: {} };
  return replaceMetadata({
    ...existing,
    views: { ...existing.views, [key]: value },
  }, window.location.href);
}

export function currentHistoryView(key) {
  return metadataFromBrowser()?.views?.[key];
}

export function pushOverlayHistory(overlayId) {
  if (!browserAvailable() || !overlayId) return null;
  ensureDispatcher();
  const existing = metadataFromBrowser() ?? currentMetadata ?? { entry: 0, page: null, overlays: [], views: {} };
  if (existing.overlays.includes(overlayId)) return existing;
  return pushMetadata({
    ...existing,
    entry: existing.entry + 1,
    overlays: [...existing.overlays, overlayId],
  }, window.location.href);
}

export function isTopHistoryOverlay(overlayId) {
  const overlays = metadataFromBrowser()?.overlays ?? [];
  return overlays.at(-1) === overlayId;
}

export function closeOverlayHistory(overlayId) {
  if (!browserAvailable() || !overlayId) return false;
  const existing = metadataFromBrowser();
  if (!existing?.overlays.includes(overlayId)) return false;
  if (existing.overlays.at(-1) === overlayId) {
    window.history.back();
    return true;
  }
  replaceMetadata({
    ...existing,
    overlays: existing.overlays.filter((item) => item !== overlayId),
  }, window.location.href);
  return false;
}
