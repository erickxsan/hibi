import { describe, expect, it } from "vitest";
import {
  APP_HISTORY_KEY,
  APP_ROUTES,
  createAppHistoryState,
  pageFromPath,
  pathForPage,
  readAppHistoryState,
} from "./appHistory";

describe("app history routes", () => {
  it("maps canonical and trailing-slash paths to finite app pages", () => {
    expect(pageFromPath("/", APP_ROUTES)).toBe("home");
    expect(pageFromPath("/students/", APP_ROUTES)).toBe("students");
    expect(pageFromPath("/groups", APP_ROUTES)).toBe("groups");
    expect(pageFromPath("/classes", APP_ROUTES)).toBe("classes");
    expect(pageFromPath("/grades", APP_ROUTES)).toBe("grades");
    expect(pageFromPath("/payments", APP_ROUTES)).toBe("payments");
    expect(pageFromPath("/settings", APP_ROUTES)).toBe("settings");
    expect(pageFromPath("/setup", APP_ROUTES)).toBe("settings");
    expect(pageFromPath("/class-log", APP_ROUTES)).toBe("classes");
    expect(pageFromPath("/student/private-name", APP_ROUTES)).toBeNull();
    expect(pathForPage("students", APP_ROUTES)).toBe("/students");
    expect(pathForPage("missing", APP_ROUTES)).toBeNull();
  });

  it("preserves unrelated browser state while keeping only navigation metadata", () => {
    const state = createAppHistoryState(
      { supabase: { callback: true }, [APP_HISTORY_KEY]: { stale: true } },
      {
        entry: 4,
        page: "grades",
        overlays: ["grade-drawer", "", 123],
        views: { "setup-tab": "students", invalid: { draft: "private" } },
      },
    );

    expect(state.supabase).toEqual({ callback: true });
    expect(readAppHistoryState(state)).toEqual({
      entry: 4,
      page: "grades",
      overlays: ["grade-drawer"],
      views: { "setup-tab": "students" },
    });
  });

  it("treats malformed or absent metadata as external history", () => {
    expect(readAppHistoryState(null)).toBeNull();
    expect(readAppHistoryState({ [APP_HISTORY_KEY]: "bad" })).toBeNull();
  });
});
