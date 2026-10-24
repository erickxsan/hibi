import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNavigationPass,
  discardChangesRequest,
  draftChanged,
  draftSignature,
  replayableHistoryMove,
} from "./useUnsavedChanges";
import { APP_HISTORY_KEY } from "../navigation/appHistory";

describe("unsaved-change helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("compares serializable drafts without relying on object identity", () => {
    expect(draftChanged({ name: "A", count: 2 }, { name: "A", count: 2 })).toBe(false);
    expect(draftChanged({ name: "B", count: 2 }, { name: "A", count: 2 })).toBe(true);
    expect(draftSignature(null)).toBe("");
  });

  it("builds a destructive in-app question with a safe way out", () => {
    expect(discardChangesRequest("Discard your unsaved class changes?")).toEqual({
      title: "Discard your unsaved class changes?",
      description: "The changes you haven't saved will be lost.",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      tone: "danger",
    });
    expect(discardChangesRequest("").title).toBe("Discard your unsaved changes?");
  });

  it("grants an approved navigation once, for its target only and only briefly", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const pass = createNavigationPass();
    expect(pass.consume("home")).toBe(false);
    pass.grant("home");
    expect(pass.consume("settings")).toBe(false);
    expect(pass.consume("home")).toBe(true);
    expect(pass.consume("home")).toBe(false);

    pass.grant("home");
    now.mockReturnValue(5_000);
    expect(pass.consume("home")).toBe(false);

    pass.grant("home");
    pass.clear();
    now.mockReturnValue(1_000);
    expect(pass.consume("home")).toBe(false);
  });

  it("replays a blocked Back move from wherever history was restored to", () => {
    const history = { state: { [APP_HISTORY_KEY]: { entry: 2 } }, go: vi.fn() };
    vi.stubGlobal("history", history);
    // Back from entry 3 already shows entry 2 when the guard runs…
    const replay = replayableHistoryMove();
    // …and the dispatcher puts the teacher back on entry 3 before the answer arrives.
    history.state = { [APP_HISTORY_KEY]: { entry: 3 } };
    expect(replay()).toBe(true);
    expect(history.go).toHaveBeenCalledWith(-1);

    history.state = { [APP_HISTORY_KEY]: { entry: 2 } };
    expect(replay()).toBe(false);
    history.state = {};
    expect(replay()).toBe(false);
    expect(history.go).toHaveBeenCalledTimes(1);
  });
});
