import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
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
    await expect(store.loadWorkspaceCache("user-1")).resolves.toBeNull();
    await expect(store.listMutations("user-1")).resolves.toEqual([]);
  });

  it("encrypts and restores a staged mutation across store instances", async () => {
    const indexedDb = new IDBFactory();
    const store = createDeviceRecoveryStore(indexedDb, globalThis.crypto);
    const state = createStarterState();
    state.students.push({
      id: "student-secret",
      code: "PRIVATE-1",
      fullName: "Private Student",
      avatarId: "cat",
      groupIds: [],
      isIndividual: true,
      customHourlyRate: null,
      studentEmail: "",
      guardianPhone: "",
      phone: "",
      guardianContact: "",
      notes: "",
      status: "Active",
    });
    const workspace = { state, versions: {}, revision: 4, updatedAt: null };
    const mutation = {
      operationId: "33333333-3333-4333-8333-333333333333",
      patch: { students: { upserts: [{ data: state.students[0], position: 0 }], deletes: [] } },
      expectedVersions: { students: { "student-secret": 0 } },
    };

    await store.stageMutation({ ownerId: "user-1", workspace, mutation });
    const reopened = createDeviceRecoveryStore(indexedDb, globalThis.crypto);

    await expect(reopened.loadWorkspaceCache("user-1")).resolves.toMatchObject({ state, revision: 4 });
    await expect(reopened.listMutations("user-1")).resolves.toEqual([
      expect.objectContaining({ id: mutation.operationId, status: "pending", mutation, workspace: expect.objectContaining({ state }) }),
    ]);
    const recoveryPoints = await reopened.list("user-1");
    expect(recoveryPoints[0]).toMatchObject({ source: "automatic-local", encrypted: true });
    await expect(reopened.load("user-1", recoveryPoints[0].id)).resolves.toMatchObject({ state });

    const database = await new Promise((resolve, reject) => {
      const request = indexedDb.open("hibi-device-recovery-v1", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const raw = await new Promise((resolve, reject) => {
      const request = database.transaction("workspace-outbox", "readonly").objectStore("workspace-outbox").get(mutation.operationId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(raw).not.toHaveProperty("mutation");
    expect(raw).not.toHaveProperty("workspace");
    expect(raw.payload).toMatchObject({ version: 1 });
    expect(JSON.stringify(raw)).not.toContain("Private Student");
  });
});
