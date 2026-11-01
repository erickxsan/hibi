import { describe, expect, it, vi } from "vitest";
import { memoizeOnState, memoizeRecent } from "./stateMemo.js";

describe("answers remembered per workspace state", () => {
  const rowsFor = (state, groupId) => state.classLog.filter((row) => row.groupId === groupId);

  it("reuses an answer while the state and its records are the same", () => {
    const compute = vi.fn(rowsFor);
    const rows = memoizeOnState(compute, (groupId) => groupId);
    const state = { settings: {}, classLog: [{ id: "a", groupId: "g1" }] };

    const first = rows(state, "g1");
    first.reverse();
    expect(rows(state, "g1")).toEqual([{ id: "a", groupId: "g1" }]);
    expect(compute).toHaveBeenCalledOnce();
    rows(state, "g2");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes when a collection or one of its records is replaced", () => {
    const compute = vi.fn(rowsFor);
    const rows = memoizeOnState(compute, (groupId) => groupId);
    const state = { settings: {}, classLog: [{ id: "a", groupId: "g1" }] };
    rows(state, "g1");

    state.classLog[0] = { id: "a", groupId: "g2" };
    expect(rows(state, "g1")).toEqual([]);
    state.classLog = [...state.classLog, { id: "b", groupId: "g1" }];
    expect(rows(state, "g1")).toEqual([{ id: "b", groupId: "g1" }]);
    state.grades = [];
    rows(state, "g1");
    expect(compute).toHaveBeenCalledTimes(4);
  });
});

describe("recent screen models", () => {
  it("reuses a result for the same arguments and keeps only the last few", () => {
    const compute = vi.fn((state, asOf) => ({ state, asOf }));
    const model = memoizeRecent(compute, 2);
    const state = {};

    expect(model(state, "2026-10-21")).toBe(model(state, "2026-10-21"));
    model(state, "2026-10-22");
    model(state, "2026-10-23");
    model(state, "2026-10-21");
    expect(compute).toHaveBeenCalledTimes(4);
    model({}, "2026-10-23");
    expect(compute).toHaveBeenCalledTimes(5);
  });
});
