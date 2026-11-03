// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPOTLIGHT_MS, useSpotlight } from "./useSpotlight.js";

beforeEach(() => {
  // The shared setup only fakes Date; this hook needs timers too. Frames run right away.
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useSpotlight", () => {
  it("marks what an alert named, scrolls to the first visible one and lets it go on its own", () => {
    const hidden = document.createElement("div");
    const shown = document.createElement("div");
    hidden.className = "is-spotlit";
    shown.className = "is-spotlit";
    hidden.scrollIntoView = vi.fn();
    shown.scrollIntoView = vi.fn();
    // The phone and desktop markup both carry the class; only one of them is laid out.
    shown.getClientRects = () => /** @type {any} */ ([{ width: 1, height: 1 }]);
    document.body.append(hidden, shown);

    const { result } = renderHook(() => useSpotlight());
    act(() => result.current.light({ kind: "students", ids: ["s1", "s2"] }));
    expect(result.current.spotlit("students", "s1")).toBe("is-spotlit");
    expect(result.current.spotlit("students", "s3")).toBe("");
    expect(result.current.spotlit("fees", "s1")).toBe("");

    expect(shown.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(hidden.scrollIntoView).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SPOTLIGHT_MS));
    expect(result.current.spotlit("students", "s1")).toBe("");
  });

  it("ignores an alert with nothing to mark and can skip the scroll", () => {
    const { result } = renderHook(() => useSpotlight({ scroll: false }));
    act(() => result.current.light(null));
    act(() => result.current.light({ kind: "students", ids: [] }));
    expect(result.current.spotlit("students", "s1")).toBe("");
    act(() => result.current.light({ kind: "class", ids: ["k1"] }));
    expect(result.current.spotlit("class", "k1")).toBe("is-spotlit");
  });
});
