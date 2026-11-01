import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// Screens read «today» from the clock. Every test starts on the same day of October 2026, the month
// the fixtures describe, so the suite gives the same result whatever day it runs (CI runs in UTC).
// A test may still set its own date; HIBI_TEST_NOW tries the suite on another day.
const TEST_NOW = new Date(process.env.HIBI_TEST_NOW || "2026-10-21T12:00:00");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(TEST_NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  if (typeof document !== "undefined") {
    cleanup();
    document.body.innerHTML = "";
    // jsdom queues history.back() traversal separately from React cleanup.
    // Drain those events before the next component subscribes to navigation.
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.history.replaceState({}, "", "/");
  }
  vi.clearAllMocks();
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback) => window.setTimeout(callback, 0),
  });
}
