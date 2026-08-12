import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain/index.js";
import {
  advanceWorkspaceVersions,
  applyWorkspacePatch,
  buildWorkspacePatch,
  workspacePatchesOverlap,
} from "./normalizedWorkspace.js";

describe("normalized workspace patches", () => {
  it("sends only the entity that changed", () => {
    const previous = createStarterState();
    previous.students = [
      { id: "s1", fullName: "Ana", groupIds: [] },
      { id: "s2", fullName: "Luis", groupIds: [] },
    ];
    const next = {
      ...previous,
      students: previous.students.map((student) => (
        student.id === "s2" ? { ...student, fullName: "Luis M." } : student
      )),
    };

    const result = buildWorkspacePatch(previous, next, {
      students: { s1: 3, s2: 7 },
    });

    expect(result.patch).toEqual({
      students: {
        upserts: [{ data: next.students[1], position: 1 }],
        deletes: [],
      },
    });
    expect(result.expectedVersions).toEqual({ students: { s2: 7 } });
  });

  it("applies independent upserts and deletes without cloning untouched collections", () => {
    const state = createStarterState();
    state.groups = [{ id: "g1", name: "A" }];
    state.students = [{ id: "s1", fullName: "Ana" }];
    const patch = {
      groups: { upserts: [{ data: { id: "g2", name: "B" }, position: 1 }], deletes: ["g1"] },
    };

    const next = applyWorkspacePatch(state, patch);

    expect(next.groups).toEqual([{ id: "g2", name: "B" }]);
    expect(next.students).toBe(state.students);
  });

  it("tracks revisions per entity instead of using one write revision", () => {
    const versions = { groups: { g1: 2 }, students: { s1: 5 } };
    const patch = {
      groups: { upserts: [{ data: { id: "g1" }, position: 0 }], deletes: [] },
      students: { upserts: [], deletes: ["s1"] },
    };

    expect(advanceWorkspaceVersions(versions, patch)).toEqual({
      groups: { g1: 3 },
      students: {},
    });
  });

  it("distinguishes same-entity races from independent edits", () => {
    const groupPatch = { groups: { upserts: [{ data: { id: "g1" } }], deletes: [] } };
    const sameGroupPatch = { groups: { upserts: [], deletes: ["g1"] } };
    const studentPatch = { students: { upserts: [{ data: { id: "s1" } }], deletes: [] } };

    expect(workspacePatchesOverlap(groupPatch, sameGroupPatch)).toBe(true);
    expect(workspacePatchesOverlap(groupPatch, studentPatch)).toBe(false);
  });
});
