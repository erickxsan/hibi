import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(async () => {
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
