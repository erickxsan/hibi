import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createStarterState } from "../domain/index.js";
import { createDeviceRecoveryStore, workspaceCounts } from "./deviceRecoveryStore.js";

describe("device recovery store", () => {
  it("uses the committed account key when independent instances initialize concurrently", async () => {
    const indexedDb = new IDBFactory();
    let generated = 0;
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    const cryptoApi = {
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
      subtle: {
        encrypt: globalThis.crypto.subtle.encrypt.bind(globalThis.crypto.subtle),
        decrypt: globalThis.crypto.subtle.decrypt.bind(globalThis.crypto.subtle),
        async generateKey(...args) {
          const key = await globalThis.crypto.subtle.generateKey(...args);
          if (++generated === 2) release();
          await barrier;
          return key;
        },
      },
    };
    const stores = [createDeviceRecoveryStore(indexedDb, cryptoApi), createDeviceRecoveryStore(indexedDb, cryptoApi)];
    const states = [createStarterState(), createStarterState()];
    states[0].settings.hourlyRate = 111;
    states[1].settings.hourlyRate = 222;
    const copies = await Promise.all(
      stores.map((store, index) =>
        store.capture({
          ownerId: "owner",
          state: states[index],
          revision: index + 1,
        }),
      ),
    );
    // Both instances must keep using the winner for subsequent encrypted writes.
    await Promise.all(
      stores.map((store, index) =>
        store.stageMutation({
          ownerId: "owner",
          workspace: { state: states[index], revision: index + 1 },
          mutation: { operationId: `operation-${index}` },
        }),
      ),
    );
    expect(generated).toBe(2);
    const reopened = createDeviceRecoveryStore(indexedDb, globalThis.crypto);
    await expect(reopened.list("owner")).resolves.toHaveLength(3);
    for (const [index, copy] of copies.entries()) {
      await expect(reopened.load("owner", copy.id)).resolves.toMatchObject({ state: states[index] });
    }
    const mutations = await reopened.listMutations("owner");
    expect(mutations).toHaveLength(2);
    for (let index = 0; index < 2; index++) {
      expect(mutations.find((item) => item.id === `operation-${index}`).workspace.state).toEqual(states[index]);
    }
    expect((await reopened.loadWorkspaceCache("owner")).state).toEqual(mutations[1].workspace.state);
  });

  it("atomically replaces or discards one operation and its cached projection", async () => {
    const indexedDb = new IDBFactory();
    const store = createDeviceRecoveryStore(indexedDb, globalThis.crypto);
    const workspace = { state: createStarterState(), revision: 1 };
    await store.stageMutation({ ownerId: "owner", workspace, mutation: { operationId: "a" } });
    await store.stageMutation({ ownerId: "owner", workspace, mutation: { operationId: "b" } });
    await store.markMutationConflict("owner", "a", "Conflict");
    await expect(store.replaceMutation("other", "a", null, workspace)).rejects.toThrow();
    await store.replaceMutation("owner", "a", { operationId: "replacement" }, { ...workspace, revision: 7 });
    const reopened = createDeviceRecoveryStore(indexedDb, globalThis.crypto);
    expect((await reopened.listMutations("owner")).map((item) => item.id)).toEqual(["replacement", "b"]);
    expect((await reopened.loadWorkspaceCache("owner")).revision).toBe(7);
    await reopened.replaceMutation("owner", "replacement", null, { ...workspace, revision: 8 });
    expect((await reopened.listMutations("owner")).map((item) => item.id)).toEqual(["b"]);
    expect((await reopened.loadWorkspaceCache("owner")).revision).toBe(8);
  });
  it("summarizes the records preserved in a recovery copy", () => {
    const state = createStarterState();
    state.students.push({});
    state.classLog.push({}, {});
    expect(workspaceCounts(state)).toEqual({ students: 1, groups: 0, grades: 0, classes: 2 });
  });

  it("degrades safely when IndexedDB is unavailable", async () => {
    const store = createDeviceRecoveryStore(null);
    await expect(store.capture({ ownerId: "user-1", state: createStarterState(), revision: 1 })).resolves.toBeNull();
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
      expect.objectContaining({
        id: mutation.operationId,
        status: "pending",
        mutation,
        workspace: expect.objectContaining({ state }),
      }),
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
      const request = database
        .transaction("workspace-outbox", "readonly")
        .objectStore("workspace-outbox")
        .get(mutation.operationId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(raw).not.toHaveProperty("mutation");
    expect(raw).not.toHaveProperty("workspace");
    expect(raw.payload).toMatchObject({ version: 1 });
    expect(JSON.stringify(raw)).not.toContain("Private Student");
  });

  it("purges only the selected account from copies, cache, outbox, and keys", async () => {
    const indexedDb = new IDBFactory();
    const store = createDeviceRecoveryStore(indexedDb, globalThis.crypto);
    const stateA = createStarterState();
    const stateB = createStarterState();
    stateA.settings.hourlyRate = 111;
    stateB.settings.hourlyRate = 222;
    const mutation = (operationId) => ({ operationId, patch: {}, expectedVersions: {} });

    await store.capture({ ownerId: "user-a", state: stateA, revision: 1 });
    await store.capture({ ownerId: "user-b", state: stateB, revision: 1 });
    await store.cacheWorkspace("user-a", { state: stateA, versions: {}, revision: 1 });
    await store.cacheWorkspace("user-b", { state: stateB, versions: {}, revision: 1 });
    await store.stageMutation({
      ownerId: "user-a",
      workspace: { state: stateA, versions: {}, revision: 1 },
      mutation: mutation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    });
    await store.stageMutation({
      ownerId: "user-b",
      workspace: { state: stateB, versions: {}, revision: 1 },
      mutation: mutation("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    });

    await store.purgeAccount("user-a");

    await expect(store.list("user-a")).resolves.toEqual([]);
    await expect(store.loadWorkspaceCache("user-a")).resolves.toBeNull();
    await expect(store.listMutations("user-a")).resolves.toEqual([]);
    await expect(store.list("user-b")).resolves.toHaveLength(2);
    await expect(store.loadWorkspaceCache("user-b")).resolves.toMatchObject({ revision: 1 });
    await expect(store.listMutations("user-b")).resolves.toHaveLength(1);
  });
});
