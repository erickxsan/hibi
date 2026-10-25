// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HibiLogo } from "../components/BrandMark";
import { createStarterState } from "../domain";
import Settings from "../features/Settings";
import { I18nProvider } from "../i18n";
import {
  APPEARANCE_STORAGE_KEY,
  THEME_COLORS,
  getAppearance,
  getResolvedTheme,
  initAppearance,
  readStoredAppearance,
  setAppearance,
  storeAppearance,
} from "./appearance";

const DARK_QUERY = "(prefers-color-scheme: dark)";
// jsdom gives import.meta.url an http: scheme, so resolve from the project root (vitest's working directory).
const bootScript = readFileSync(path.join(process.cwd(), "public", "theme-boot.js"), "utf8");
const mediaListeners = new Set();
let systemDark = false;

function setSystemDark(next) {
  systemDark = next;
  for (const listener of mediaListeners) listener({ matches: next, media: DARK_QUERY });
}

const html = () => document.documentElement;
const themeColor = () => document.querySelector('meta[name="theme-color"]').getAttribute("content");
const colorScheme = () => document.querySelector('meta[name="color-scheme"]').getAttribute("content");

function renderSettings() {
  const actions = {
    updateSettings: vi.fn(async () => true),
    notify: vi.fn(),
    listRecoveryPoints: vi.fn(async () => []),
  };
  return render(
    <I18nProvider>
      <Settings
        state={createStarterState()}
        actions={actions}
        persistenceMode="local"
        encryption={undefined}
        registerNavigationBlocker={() => () => {}}
        onDeleteAccount={vi.fn()}
        onOpenOnboarding={undefined}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.matchMedia.mockImplementation((query) => ({
    get matches() {
      return query === DARK_QUERY && systemDark;
    },
    media: query,
    addEventListener: (_type, listener) => {
      if (query === DARK_QUERY) mediaListeners.add(listener);
    },
    removeEventListener: (_type, listener) => mediaListeners.delete(listener),
  }));
  systemDark = false;
  localStorage.clear();
  html().removeAttribute("data-theme");
  document.head.innerHTML =
    '<meta name="theme-color" content="#f6f1e8" /><meta name="color-scheme" content="light dark" />';
  initAppearance();
});

describe("appearance preference", () => {
  it("defaults to the system theme and follows it live", () => {
    expect(getAppearance()).toBe("system");
    expect(html().hasAttribute("data-theme")).toBe(false);
    expect(themeColor()).toBe(THEME_COLORS.light);
    expect(colorScheme()).toBe("light dark");

    act(() => setSystemDark(true));
    expect(getResolvedTheme()).toBe("dark");
    expect(html().hasAttribute("data-theme")).toBe(false);
    expect(themeColor()).toBe(THEME_COLORS.dark);

    act(() => setSystemDark(false));
    expect(getResolvedTheme()).toBe("light");
    expect(themeColor()).toBe(THEME_COLORS.light);
  });

  it("persists an explicit choice per device and applies it as data-theme", () => {
    setAppearance("dark");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(themeColor()).toBe(THEME_COLORS.dark);
    expect(colorScheme()).toBe("dark");

    // A reload reads the stored choice again; an OS change no longer overrides it.
    html().removeAttribute("data-theme");
    expect(initAppearance()).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
    act(() => setSystemDark(false));
    expect(html().getAttribute("data-theme")).toBe("dark");

    setAppearance("light");
    act(() => setSystemDark(true));
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(themeColor()).toBe(THEME_COLORS.light);

    setAppearance("system");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("system");
    expect(html().hasAttribute("data-theme")).toBe(false);
    expect(themeColor()).toBe(THEME_COLORS.dark);
  });

  it("falls back to the system theme when storage is unavailable or holds an unknown value", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "sepia");
    expect(readStoredAppearance()).toBe("system");
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readStoredAppearance(/** @type {Storage} */ (/** @type {unknown} */ (blocked)))).toBe("system");
    expect(() => storeAppearance("dark", /** @type {Storage} */ (/** @type {unknown} */ (blocked)))).not.toThrow();
  });

  it("applies the saved choice from the boot script, before the app starts", () => {
    const runBoot = () => new Function(bootScript)();

    localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
    runBoot();
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(themeColor()).toBe(THEME_COLORS.dark);
    expect(colorScheme()).toBe("dark");

    systemDark = true;
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "light");
    runBoot();
    expect(html().getAttribute("data-theme")).toBe("light");
    expect(themeColor()).toBe(THEME_COLORS.light);

    localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    runBoot();
    expect(html().hasAttribute("data-theme")).toBe(false);
    expect(themeColor()).toBe(THEME_COLORS.dark);
    expect(colorScheme()).toBe("light dark");
  });

  it("offers System, Light and Dark under Interface and switches the theme", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /^Interface/ }));
    const group = screen.getByRole("group", { name: "Appearance" });
    expect(within(group).getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(group).getByRole("button", { name: "Dark" }));
    expect(within(group).getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
    // The open section hides its menu summary; it shows again once another section is open.
    expect(screen.getByRole("button", { name: /^Interface/ })).not.toHaveTextContent("Dark theme");
    fireEvent.click(screen.getByRole("button", { name: /^Class values/ }));
    expect(screen.getByRole("button", { name: /^Interface/ })).toHaveTextContent("Dark theme");

    fireEvent.click(screen.getByRole("button", { name: /^Interface/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Appearance" })).getByRole("button", { name: "System" }));
    expect(html().hasAttribute("data-theme")).toBe(false);
  });

  it("reads Apariencia / Sistema / Claro / Oscuro in Spanish", () => {
    localStorage.setItem("hibi:language:v1", "es");
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /^Interfaz/ }));
    const group = screen.getByRole("group", { name: "Apariencia" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Sistema", "Claro", "Oscuro"]);
  });

  it("swaps the logo to the washi wordmark in the dark theme", () => {
    render(<HibiLogo />);
    expect(screen.getByRole("img", { name: "hibi" })).toHaveAttribute("src", "/brand/hibi-logo-horizontal.svg");
    act(() => setAppearance("dark"));
    expect(screen.getByRole("img", { name: "hibi" })).toHaveAttribute("src", "/brand/hibi-logo-horizontal-dark.svg");
  });
});
