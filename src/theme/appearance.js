import { useSyncExternalStore } from "react";

/**
 * Appearance preference («Apariencia»: Sistema / Claro / Oscuro), stored per device.
 *
 * `public/theme-boot.js` applies the saved choice before the first paint (index.html loads it as a blocking
 * same-origin script because the CSP forbids inline scripts); this module owns the same rules afterwards and
 * keeps <html data-theme> and the theme-color / color-scheme metas in step with the setting and the OS.
 * «Sistema» leaves data-theme unset so the CSS media query follows the OS live.
 *
 * @typedef {"system" | "light" | "dark"} AppearancePreference
 * @typedef {"light" | "dark"} ResolvedTheme
 */

export const APPEARANCE_STORAGE_KEY = "hibi:appearance:v1";
/** @type {readonly AppearancePreference[]} */
export const APPEARANCE_PREFERENCES = Object.freeze(["system", "light", "dark"]);
/** @type {AppearancePreference} */
export const DEFAULT_APPEARANCE = "system";
/** Browser chrome colour per theme: the page (washi) token of each palette. */
export const THEME_COLORS = Object.freeze({ light: "#f6f1e8", dark: "#131114" });
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * @param {unknown} value
 * @returns {AppearancePreference}
 */
export function normalizeAppearance(value) {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_APPEARANCE;
}

/** @param {Storage | null | undefined} [storage] */
export function readStoredAppearance(storage = globalThis.localStorage) {
  try {
    return normalizeAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    // Hardened or private contexts can refuse storage access; follow the system then.
    return DEFAULT_APPEARANCE;
  }
}

/**
 * @param {AppearancePreference} preference
 * @param {Storage | null | undefined} [storage]
 */
export function storeAppearance(preference, storage = globalThis.localStorage) {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, normalizeAppearance(preference));
  } catch {
    // The choice still applies for this session when storage is unavailable.
  }
}

/** @param {Window | undefined} [win] */
export function systemPrefersDark(win = globalThis.window) {
  try {
    return Boolean(win?.matchMedia?.(DARK_SCHEME_QUERY)?.matches);
  } catch {
    return false;
  }
}

/**
 * @param {AppearancePreference} preference
 * @param {boolean} prefersDark
 * @returns {ResolvedTheme}
 */
export function resolveAppearance(preference, prefersDark) {
  return preference === "dark" || (preference === "system" && prefersDark) ? "dark" : "light";
}

/**
 * Writes the preference onto <html> and the theme-color / color-scheme metas.
 *
 * @param {AppearancePreference} preference
 * @param {{ doc?: Document, prefersDark?: boolean }} [options]
 * @returns {ResolvedTheme}
 */
export function applyAppearance(preference, { doc = globalThis.document, prefersDark = systemPrefersDark() } = {}) {
  const normalized = normalizeAppearance(preference);
  const resolved = resolveAppearance(normalized, prefersDark);
  if (!doc?.documentElement) return resolved;
  if (normalized === "system") doc.documentElement.removeAttribute("data-theme");
  else doc.documentElement.setAttribute("data-theme", normalized);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[resolved]);
  doc
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute("content", normalized === "system" ? "light dark" : normalized);
  return resolved;
}

/** @type {AppearancePreference | null} */
let currentPreference = null;
/** @type {ResolvedTheme | null} */
let currentResolved = null;
const listeners = new Set();
let watchingEnvironment = false;

function emit() {
  for (const listener of listeners) listener();
}

function refresh() {
  currentResolved = applyAppearance(getAppearance());
  emit();
}

function watchEnvironment() {
  if (watchingEnvironment || typeof window === "undefined") return;
  watchingEnvironment = true;
  try {
    const media = window.matchMedia?.(DARK_SCHEME_QUERY);
    if (media?.addEventListener) media.addEventListener("change", refresh);
    else media?.addListener?.(refresh);
  } catch {
    // Without media queries the explicit choices still work.
  }
  // Another tab changed the setting: follow it here too.
  window.addEventListener("storage", (event) => {
    if (event.key !== APPEARANCE_STORAGE_KEY) return;
    currentPreference = normalizeAppearance(event.newValue);
    refresh();
  });
}

/** @returns {AppearancePreference} */
export function getAppearance() {
  if (currentPreference === null) currentPreference = readStoredAppearance();
  return currentPreference;
}

/** @returns {ResolvedTheme} */
export function getResolvedTheme() {
  if (currentResolved === null) currentResolved = resolveAppearance(getAppearance(), systemPrefersDark());
  return currentResolved;
}

/** @param {AppearancePreference} preference */
export function setAppearance(preference) {
  currentPreference = normalizeAppearance(preference);
  storeAppearance(currentPreference);
  refresh();
}

/** Applies the saved preference and starts following OS and cross-tab changes. Safe to call repeatedly. */
export function initAppearance() {
  currentPreference = readStoredAppearance();
  currentResolved = applyAppearance(currentPreference);
  watchEnvironment();
  return currentResolved;
}

/** @param {() => void} listener */
function subscribe(listener) {
  listeners.add(listener);
  watchEnvironment();
  return () => {
    listeners.delete(listener);
  };
}

/** @returns {AppearancePreference} */
const serverPreference = () => DEFAULT_APPEARANCE;
/** @returns {ResolvedTheme} */
const serverTheme = () => "light";

/** The saved preference, the theme it resolves to now, and a setter. */
export function useAppearance() {
  const preference = useSyncExternalStore(subscribe, getAppearance, serverPreference);
  const resolvedTheme = useSyncExternalStore(subscribe, getResolvedTheme, serverTheme);
  return { preference, resolvedTheme, setPreference: setAppearance };
}
