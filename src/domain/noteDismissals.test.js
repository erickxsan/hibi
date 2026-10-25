import { describe, expect, it } from "vitest";
import { normalizeDismissedNotes, noteKey, updateDismissedNotes } from "./noteDismissals";
import { normalizeState } from "./validation";
import { createStarterState } from "./index.js";

describe("notes marked as seen", () => {
  it("keys each note by what caused it, so something new brings it back", () => {
    expect(noteKey("s1", { kind: "owes", latest: "2026-10-15" })).toBe("owes:s1:2026-10-15");
    expect(noteKey("s1", { kind: "absences", lastAbsence: "2026-10-19" })).toBe("absences:s1:2026-10-19");
    expect(noteKey("s1", { kind: "ungraded", gradeId: "g9", assessment: "Quiz" })).toBe("ungraded:s1:g9");
    expect(noteKey("s1", { kind: "monthlyPending", period: "2026-10" })).toBe("monthly:s1:2026-10");
    expect(noteKey("s1", { kind: "upToDate" })).toBe("");
    expect(noteKey("s1", { kind: "owes" })).toBe("");
  });

  it("adds, removes and forgets entries older than six months", () => {
    const seen = updateDismissedNotes({ old: "2026-03-01", kept: "2026-09-01" }, ["a", "b", ""], true, "2026-10-24");
    expect(seen).toEqual({ kept: "2026-09-01", a: "2026-10-24", b: "2026-10-24" });
    expect(updateDismissedNotes(seen, ["a"], false, "2026-10-24")).toEqual({ kept: "2026-09-01", b: "2026-10-24" });
  });

  it("keeps only dated keys in settings and leaves the field out when empty", () => {
    expect(normalizeDismissedNotes({ a: "2026-10-24", b: 3, c: "soon" })).toEqual({ a: "2026-10-24" });
    expect(normalizeDismissedNotes(["a"])).toEqual({});
    const starter = createStarterState();
    expect(
      normalizeState({ ...starter, settings: { ...starter.settings, dismissedNotes: {} } }).settings,
    ).not.toHaveProperty("dismissedNotes");
    expect(
      normalizeState({ ...starter, settings: { ...starter.settings, dismissedNotes: { a: "2026-10-24" } } }).settings
        .dismissedNotes,
    ).toEqual({ a: "2026-10-24" });
  });
});
