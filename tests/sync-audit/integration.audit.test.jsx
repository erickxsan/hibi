// @vitest-environment jsdom
// Regression flows for the 2026-10-03 audit. Real hook + real repository + real
// WebCrypto + IndexedDB emulation; only the RPC server is synthetic.
import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncryptedWorkspace } from "../../src/cloud/useEncryptedWorkspace.js";
import { createDeviceRecoveryStore } from "../../src/cloud/deviceRecoveryStore.js";
import { createStarterState } from "../../src/domain/index.js";
import { twoDevices, student } from "./fixture.js";

const mocks = vi.hoisted(() => ({ repository: {}, store: {} }));
vi.mock("../../src/cloud/encryptedWorkspaceRepository.js", async (original) => ({
  ...(await original()),
  encryptedWorkspaceRepository: mocks.repository,
}));
vi.mock("../../src/cloud/deviceRecoveryStore.js", async (original) => ({
  ...(await original()),
  deviceRecoveryStore: mocks.store,
}));
vi.mock("../../src/crypto/index.js", async (original) => ({
  ...(await original()),
  deviceKeyStore: { readIntegrity: async () => null, writeIntegrity: async () => true },
}));
const user = { id: "owner" };
const security = { wrappers: [] };
const changed = (state, id, data) => ({
  ...state,
  students: state.students.map((s) => (s.id === id ? { ...s, ...data } : s)),
});
let store;
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ArrayBuffer", new TextEncoder().encode("").buffer.constructor);
  store = createDeviceRecoveryStore(new IDBFactory(), webcrypto);
  for (const key of Object.keys(mocks.store)) delete mocks.store[key];
  for (const key of Object.keys(mocks.repository)) delete mocks.repository[key];
  Object.assign(mocks.store, store);
});
afterEach(() => vi.unstubAllGlobals());

// Two offline edits of student A on this device (phone, then notes) and a
// remote phone edit of the same student from another device.
async function setupQueued({ extraRemote = false, remoteField = "phone" } = {}) {
  const state = { ...createStarterState(), students: [student("a"), student("b")] };
  const d = await twoDevices(state);
  Object.assign(mocks.repository, d.first);
  const firstState = changed(state, "a", { phone: "LOCAL-DISCARDED" });
  const first = await d.first.prepareMutation({ state: firstState, workspace: d.firstBase, session: d.session });
  const firstOptimistic = d.first.optimisticWorkspace(d.firstBase, first, d.session);
  await store.stageMutation({ ownerId: user.id, workspace: firstOptimistic, mutation: first });
  const second = await d.first.prepareMutation({
    state: changed(firstState, "a", { notes: "Later local note" }),
    workspace: firstOptimistic,
    session: d.session,
  });
  await store.stageMutation({
    ownerId: user.id,
    workspace: d.first.optimisticWorkspace(firstOptimistic, second, d.session),
    mutation: second,
  });
  const remote = await d.second.prepareMutation({
    state: changed(state, "a", { [remoteField]: "REMOTE-KEPT" }),
    workspace: d.secondBase,
    session: d.session,
  });
  let current = await d.second.applyMutation(remote, d.session, user.id);
  if (extraRemote) {
    const another = await d.second.prepareMutation({
      state: changed(current.state, "b", { notes: "Unrelated remote" }),
      workspace: current,
      session: d.session,
    });
    current = await d.second.applyMutation(another, d.session, user.id);
  }
  return { d, first, second, current };
}

describe("sync audit regressions: complete synthetic device flows", () => {
  it("S03: one keep-local decision syncs the whole compatible chain and ends saved", async () => {
    const { d, first, second } = await setupQueued();
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("conflict"));
    const pending = hook.result.current.persistence.pendingOperations;
    expect(pending.map((entry) => [entry.id, entry.status, entry.blocked])).toEqual([
      [first.operationId, "conflict", false],
      [second.operationId, "pending", true],
    ]);
    // The review shows the cloud value that keeping the local change would replace.
    expect(pending[0].review.changes[0].fields).toEqual([
      expect.objectContaining({ field: "phone", local: "LOCAL-DISCARDED", cloud: "REMOTE-KEPT", conflict: true }),
    ]);
    await act(async () => {
      await hook.result.current.persistence.resolvePendingOperation(first.operationId, "local");
    });
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    expect(await store.listMutations(user.id)).toHaveLength(0);
    const cloud = await d.second.loadWorkspace(d.session, user.id);
    expect(cloud.state.students[0]).toMatchObject({ phone: "LOCAL-DISCARDED", notes: "Later local note" });
    expect(hook.result.current.workspace.state).toEqual(cloud.state);
    expect(d.violations).toEqual([]);
    hook.unmount();
  });

  it("S03b: discarding through the real adapter never resurrects the discarded phone", async () => {
    const { d, first } = await setupQueued({ extraRemote: true });
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("conflict"));
    await act(async () => {
      await hook.result.current.persistence.resolvePendingOperation(first.operationId, "discard");
    });
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    expect(await store.listMutations(user.id)).toHaveLength(0);
    const cloud = await d.second.loadWorkspace(d.session, user.id);
    expect(cloud.state.students[0]).toMatchObject({ phone: "REMOTE-KEPT", notes: "Later local note" });
    expect(cloud.state.students[1].notes).toBe("Unrelated remote");
    expect(hook.result.current.workspace.state).toEqual(cloud.state);
    hook.unmount();
  });

  it("S09: discarding with an equal revision and another root ends saved, not in a manifest error", async () => {
    const { d, first } = await setupQueued();
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("conflict"));
    await act(async () => {
      await hook.result.current.persistence.resolvePendingOperation(first.operationId, "discard");
    });
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    expect(await store.listMutations(user.id)).toHaveLength(0);
    const cloud = await d.second.loadWorkspace(d.session, user.id);
    expect(cloud.state.students[0]).toMatchObject({ phone: "REMOTE-KEPT", notes: "Later local note" });
    hook.unmount();
  });

  it("S02/S03: edits of other fields of the same record sync with no review at all", async () => {
    const { d } = await setupQueued({ remoteField: "guardianContact" });
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    expect(await store.listMutations(user.id)).toHaveLength(0);
    const cloud = await d.second.loadWorkspace(d.session, user.id);
    expect(cloud.state.students[0]).toMatchObject({
      phone: "LOCAL-DISCARDED",
      notes: "Later local note",
      guardianContact: "REMOTE-KEPT",
    });
    expect(hook.result.current.workspace.state).toEqual(cloud.state);
    hook.unmount();
  });

  it("S04: remote changes keep arriving while a conflict waits for review", async () => {
    const { d, current } = await setupQueued();
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("conflict"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    const rate = await d.second.prepareMutation({
      state: { ...current.state, settings: { ...current.state.settings, hourlyRate: 777 } },
      workspace: current,
      session: d.session,
    });
    await d.second.applyMutation(rate, d.session, user.id);
    await act(async () => {
      d.notify();
    });
    await waitFor(() => expect(hook.result.current.workspace.state.settings.hourlyRate).toBe(777));
    // This device's pending values stay visible on top of the newer cloud records.
    expect(hook.result.current.workspace.state.students[0]).toMatchObject({
      phone: "LOCAL-DISCARDED",
      notes: "Later local note",
    });
    expect(hook.result.current.syncStatus).toBe("conflict");
    unsubscribe();
    hook.unmount();
  });

  it("S07: a real event received during a flush leaves the interface on the newest revision", async () => {
    const state = { ...createStarterState(), students: [student("a"), student("b")] };
    const d = await twoDevices(state);
    Object.assign(mocks.repository, d.first);
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    const received = [];
    mocks.repository.subscribe = (session, onChange, options) =>
      d.first.subscribe(
        session,
        (incoming) => {
          received.push(incoming.revision);
          return onChange(incoming);
        },
        options,
      );
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    const editRemote = async (workspace, notes) => {
      const mutation = await d.second.prepareMutation({
        state: changed(workspace.state, "b", { notes }),
        workspace,
        session: d.session,
      });
      return d.second.applyMutation(mutation, d.session, user.id);
    };
    const remoteTwo = await editRemote(d.secondBase, "Remote two");
    let release;
    mocks.store.cacheWorkspace = vi.fn(async (ownerId, workspace) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      return store.cacheWorkspace(ownerId, workspace);
    });
    let flushing;
    await act(async () => {
      flushing = hook.result.current.persistence.retrySync();
    });
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await editRemote(remoteTwo, "Remote three");
    await act(async () => {
      d.notify();
    });
    await waitFor(() => expect(received).toContain(3));
    mocks.store.cacheWorkspace = store.cacheWorkspace;
    await act(async () => {
      release();
      await flushing;
    });
    await waitFor(() => expect(hook.result.current.workspace.revision).toBe(3));
    expect(hook.result.current.workspace.state.students[1].notes).toBe("Remote three");
    expect(hook.result.current.syncStatus).toBe("saved");
    unsubscribe();
    hook.unmount();
  });

  it("S01/S06: deleting the first of many students on one device keeps a payment from another", async () => {
    const students = Array.from({ length: 600 }, (_, index) => student(`s-${index}`));
    const state = { ...createStarterState(), students };
    const d = await twoDevices(state);
    Object.assign(mocks.repository, d.first);
    const hook = renderHook(() => useEncryptedWorkspace(user, d.session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"), { timeout: 20_000 });
    await act(async () => {
      await hook.result.current.persistence.save({ ...state, students: students.slice(1) }, state);
    });
    const remote = await d.second.prepareMutation({
      state: changed(state, "s-599", { notes: "Paid on the tablet" }),
      workspace: d.secondBase,
      session: d.session,
    });
    await d.second.applyMutation(remote, d.session, user.id);
    await act(async () => {
      await hook.result.current.persistence.retrySync();
    });
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"), { timeout: 20_000 });
    const cloud = await d.second.loadWorkspace(d.session, user.id);
    expect(cloud.state.students).toHaveLength(599);
    expect(cloud.state.students.at(-1).notes).toBe("Paid on the tablet");
    expect(cloud.orderingRepairs).toEqual([]);
    hook.unmount();
  }, 60_000);
});
