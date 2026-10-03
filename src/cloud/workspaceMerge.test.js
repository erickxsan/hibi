import { describe, expect, it } from "vitest";
import { createGroup, createStarterState, createStudent } from "../domain/index.js";
import {
  describeOperation,
  diffWorkspaceStates,
  indexOrderKeys,
  mergeWorkspaceStates,
  operationEntityKeys,
  orderKeysFor,
  sameValue,
} from "./workspaceMerge.js";

const student = (id, overrides = {}) => createStudent({ id, code: id, fullName: `Student ${id}`, ...overrides });
const withStudents = (...students) => ({ ...createStarterState(), students });
const edit = (state, id, changes) => ({
  ...state,
  students: state.students.map((item) => (item.id === id ? { ...item, ...changes } : item)),
});

describe("field-level workspace merge", () => {
  it("combines edits of different fields and keeps remote-only changes", () => {
    const base = withStudents(student("a"), student("b"));
    const local = edit(base, "a", { notes: "Local" });
    const remote = edit(edit(base, "a", { phone: "555" }), "b", { notes: "Remote B" });
    const { state, conflicts } = mergeWorkspaceStates({ base, local, remote });
    expect(conflicts).toEqual([]);
    expect(state.students.map(({ notes, phone }) => [notes, phone])).toEqual([
      ["Local", "555"],
      ["Remote B", ""],
    ]);
  });

  it("treats an identical value on both sides as satisfied", () => {
    const base = withStudents(student("a"));
    const next = edit(base, "a", { notes: "Same" });
    expect(mergeWorkspaceStates({ base, local: next, remote: next })).toEqual({ state: next, conflicts: [] });
  });

  it("reports contradicting values and applies the local side only when asked", () => {
    const base = withStudents(student("a"));
    const local = edit(base, "a", { notes: "Local", phone: "1" });
    const remote = edit(base, "a", { notes: "Remote", guardianContact: "Guardian" });
    const manual = mergeWorkspaceStates({ base, local, remote });
    expect(manual.conflicts).toEqual([{ collection: "students", entityId: "a", kind: "field", fields: ["notes"] }]);
    expect(manual.state.students[0]).toMatchObject({ notes: "Remote", phone: "1", guardianContact: "Guardian" });
    const kept = mergeWorkspaceStates({ base, local, remote, prefer: "local" });
    expect(kept.state.students[0]).toMatchObject({ notes: "Local", phone: "1", guardianContact: "Guardian" });
  });

  it("detects edit/delete combinations in both directions", () => {
    const base = withStudents(student("a"), student("b"));
    const editedRemote = edit(base, "a", { notes: "Remote" });
    const deletedLocal = { ...base, students: [base.students[1]] };
    expect(mergeWorkspaceStates({ base, local: deletedLocal, remote: editedRemote }).conflicts).toEqual([
      { collection: "students", entityId: "a", kind: "delete-edit", fields: [] },
    ]);
    // An untouched remote record is deleted without review.
    expect(mergeWorkspaceStates({ base, local: deletedLocal, remote: base }).state.students).toEqual([
      base.students[1],
    ]);
    const editedLocal = edit(base, "a", { notes: "Local" });
    const result = mergeWorkspaceStates({ base, local: editedLocal, remote: deletedLocal });
    expect(result.conflicts[0].kind).toBe("edit-delete");
    expect(result.state.students.map(({ id }) => id)).toEqual(["b"]);
    expect(
      mergeWorkspaceStates({ base, local: editedLocal, remote: deletedLocal, prefer: "local" }).state.students.map(
        ({ id }) => id,
      ),
    ).toEqual(["b", "a"]);
  });

  it("appends local additions after remote additions and keeps identical concurrent creations", () => {
    const base = withStudents(student("a"));
    const local = { ...base, students: [...base.students, student("local")] };
    const remote = { ...base, students: [...base.students, student("remote")] };
    expect(mergeWorkspaceStates({ base, local, remote }).state.students.map(({ id }) => id)).toEqual([
      "a",
      "remote",
      "local",
    ]);
    const same = mergeWorkspaceStates({ base, local, remote: local });
    expect(same.conflicts).toEqual([]);
    const different = { ...base, students: [...base.students, student("local", { notes: "Other" })] };
    expect(mergeWorkspaceStates({ base, local, remote: different }).conflicts[0]).toMatchObject({
      kind: "create",
      fields: ["notes"],
    });
  });

  it("merges unordered ID lists and lets device preferences use the newest local value", () => {
    const base = {
      ...createStarterState(),
      groups: [createGroup({ id: "g1", name: "G1" }), createGroup({ id: "g2", name: "G2" })],
      students: [student("a", { groupIds: ["g1"] })],
    };
    const local = {
      ...edit(base, "a", { groupIds: ["g1", "g2"] }),
      settings: { ...base.settings, selectedMonth: "2031-11-01" },
    };
    const remote = {
      ...edit(base, "a", { groupIds: [] }),
      settings: { ...base.settings, selectedMonth: "2031-08-01", hourlyRate: 80 },
    };
    const { state, conflicts } = mergeWorkspaceStates({ base, local, remote });
    expect(conflicts).toEqual([]);
    expect(state.students[0].groupIds).toEqual(["g2"]);
    expect(state.settings).toMatchObject({ selectedMonth: "2031-11-01", hourlyRate: 80 });
    const rate = { ...local, settings: { ...local.settings, hourlyRate: 60 } };
    expect(mergeWorkspaceStates({ base, local: rate, remote }).conflicts).toEqual([
      { collection: "settings", entityId: "__settings__", kind: "field", fields: ["hourlyRate"] },
    ]);
  });

  it("compares JSON values independently of key order", () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue("", null)).toBe(false);
  });
});

describe("sparse order keys", () => {
  it("deletes without rewriting later records and appends after the last key", () => {
    const state = withStudents(student("a"), student("b"), student("c"));
    const keys = indexOrderKeys(state);
    const deleted = { ...state, students: state.students.slice(1) };
    const diff = diffWorkspaceStates(state, deleted, keys);
    expect(diff.collections.students).toEqual({ upserts: [], deletes: ["a"] });
    expect(diff.positions.students).toEqual({ b: 1, c: 2 });
    expect(diff.entityKeys).toEqual(["students/a"]);
    const appended = diffWorkspaceStates(
      deleted,
      { ...deleted, students: [...deleted.students, student("d")] },
      diff.positions,
    );
    expect(appended.collections.students.upserts).toEqual([
      { data: expect.objectContaining({ id: "d" }), position: 3 },
    ]);
  });

  it("re-keys repeated keys as order-only rewrites, separate from content edits", () => {
    const state = withStudents(student("a"), student("b"));
    const diff = diffWorkspaceStates(state, edit(state, "a", { notes: "Edit" }), { students: { a: 0, b: 0 } });
    expect(diff.collections.students.upserts.map(({ data, position }) => [data.id, position])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(diff.entityKeys).toEqual(["students/a"]);
    expect(diff.changeCount).toBe(2);
  });

  it("uses stored keys when present and list indexes for older cached workspaces", () => {
    const state = withStudents(student("a"), student("b"));
    expect(orderKeysFor({ state })).toEqual(indexOrderKeys(state));
    expect(orderKeysFor({ state, positions: { students: { a: 4, b: "x" } } }).students).toEqual({ a: 4 });
  });

  it("counts settings changes and reports no work for identical states", () => {
    const state = createStarterState();
    expect(diffWorkspaceStates(state, structuredClone(state)).changeCount).toBe(0);
    const changed = { ...state, settings: { ...state.settings, hourlyRate: 99 } };
    expect(diffWorkspaceStates(state, changed)).toMatchObject({ settings: true, changeCount: 1 });
  });
});

describe("operation descriptions", () => {
  it("lists content keys without order-only rewrites, with fallbacks for older queue entries", () => {
    const state = withStudents(student("a"), student("b"));
    expect(operationEntityKeys({ entityKeys: ["students/b"] })).toEqual(["students/b"]);
    expect(operationEntityKeys({ previousState: state, state: { ...state, students: [state.students[1]] } })).toEqual([
      "students/a",
    ]);
    expect(operationEntityKeys({ upserts: [{ collection: "groups", entityId: "g" }], deletes: [] })).toEqual([
      "groups/g",
    ]);
  });

  it("shows the value before the edit, on this device and in the cloud now", () => {
    const base = withStudents(student("a"));
    const mutation = { previousState: base, state: edit(base, "a", { notes: "Local", phone: "1" }) };
    const remote = edit(base, "a", { notes: "Cloud" });
    const { changes } = describeOperation(mutation, remote);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ collection: "students", entityId: "a", kind: "edit", conflict: "field" });
    expect(changes[0].fields).toEqual([
      { field: "phone", before: "", local: "1", cloud: "", conflict: false },
      { field: "notes", before: "", local: "Local", cloud: "Cloud", conflict: true },
    ]);
    const deleted = describeOperation(mutation, { ...base, students: [] }).changes[0];
    expect(deleted).toMatchObject({ cloud: null, conflict: "edit-delete" });
    expect(describeOperation({}, remote)).toEqual({ changes: [], conflicts: [] });
  });
});
