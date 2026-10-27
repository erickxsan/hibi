import { describe, expect, it } from "vitest";
import { GROUP_COLOR_IDS } from "./constants.js";
import { groupBadgeFields, groupBadgeOf, groupInitials, withGroupBadge } from "./groupBadge.js";
import { createGroup, createStarterState, normalizeState, validateGroup } from "./index.js";

describe("group badge", () => {
  it("stores only a chosen icon or color", () => {
    expect(groupBadgeFields({ iconId: "book", colorId: "jade" })).toEqual({ iconId: "book", colorId: "jade" });
    expect(groupBadgeFields({ iconId: "rocket", colorId: "" })).toEqual({});
    expect(groupBadgeFields(null)).toEqual({});
  });

  it("applies a change and goes back to automatic with an empty value", () => {
    const group = createGroup({ id: "g1", name: "Primaria 5A" });
    const chosen = withGroupBadge(group, { iconId: "music", colorId: "ocre" });
    expect(chosen).toMatchObject({ iconId: "music", colorId: "ocre", name: "Primaria 5A" });
    expect(withGroupBadge(chosen, { colorId: "indigo" })).toMatchObject({ iconId: "music", colorId: "indigo" });
    const automatic = withGroupBadge(chosen, { iconId: "" });
    expect(automatic).not.toHaveProperty("iconId");
    expect(automatic.colorId).toBe("ocre");
  });

  it("uses the group code or the first letter as initials", () => {
    expect(groupInitials("IS SA 10 – 12")).toBe("IS");
    expect(groupInitials("S SA 8 – 10")).toBe("S");
    expect(groupInitials("diagnóstico 11 Octubre", "es-MX")).toBe("D");
    expect(groupInitials("  ")).toBe("");
  });

  it("keeps a chosen color and gives every other group a stable vivid one", () => {
    expect(groupBadgeOf({ id: "g1", iconId: "star", colorId: "kraft" })).toEqual({ iconId: "star", colorId: "kraft" });
    const automatic = groupBadgeOf({ id: "group_abc", iconId: "rocket" });
    expect(automatic.iconId).toBe("");
    expect(GROUP_COLOR_IDS).toContain(automatic.colorId);
    expect(automatic.colorId).not.toBe("kraft");
    expect(groupBadgeOf({ id: "group_abc" })).toEqual(automatic);
    expect(GROUP_COLOR_IDS).toContain(groupBadgeOf(null).colorId);
  });

  it("validates and normalizes the stored fields", () => {
    const group = createGroup({ id: "g1", name: "Primaria 5A", iconId: "rocket", colorId: "pink" });
    expect(validateGroup(group).errors.map((error) => error.path)).toEqual(["iconId", "colorId"]);
    expect(validateGroup({ ...group, iconId: "book", colorId: "jade" }).valid).toBe(true);
    const state = createStarterState();
    state.groups = [group, createGroup({ id: "g2", name: "Inglés", iconId: "languages", colorId: "indigo" })];
    const [dropped, kept] = normalizeState(state).groups;
    expect(dropped).not.toHaveProperty("iconId");
    expect(dropped).not.toHaveProperty("colorId");
    expect(kept).toMatchObject({ iconId: "languages", colorId: "indigo" });
  });
});
