import { describe, expect, it, vi } from "vitest";
import { confirmDiscard, draftChanged, draftSignature } from "./useUnsavedChanges";

describe("unsaved-change helpers", () => {
  it("compares serializable drafts without relying on object identity", () => {
    expect(draftChanged({ name: "A", count: 2 }, { name: "A", count: 2 })).toBe(false);
    expect(draftChanged({ name: "B", count: 2 }, { name: "A", count: 2 })).toBe(true);
    expect(draftSignature(null)).toBe("");
  });

  it("only asks for confirmation when a draft is dirty", () => {
    const originalConfirm = globalThis.confirm;
    const confirm = vi.fn(() => false);
    globalThis.confirm = confirm;
    try {
      expect(confirmDiscard(false)).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
      expect(confirmDiscard(true, "Leave?")).toBe(false);
      expect(confirm).toHaveBeenCalledWith("Leave?");
    } finally {
      globalThis.confirm = originalConfirm;
    }
  });
});
