import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain/index.js";
import { createDeviceRecoveryStore, workspaceCounts } from "./deviceRecoveryStore.js";

describe("device recovery store", () => {
  it("summarizes the records preserved in a recovery copy", () => {
    const state = createStarterState();
    state.students.push({});
    state.classLog.push({}, {});
    expect(workspaceCounts(state)).toEqual({ students: 1, groups: 0, grades: 0, classes: 2 });
  });

  it("degrades safely when IndexedDB is unavailable", async () => {
    const store = createDeviceRecoveryStore(null);
    await expect(store.capture({ ownerId: "user-1", state: createStarterState(), revision: 1 }))
      .resolves.toBeNull();
    await expect(store.list("user-1")).resolves.toEqual([]);
    await expect(store.load("user-1", "missing")).resolves.toBeNull();
  });
});
