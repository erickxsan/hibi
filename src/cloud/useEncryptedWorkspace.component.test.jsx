// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEncryptedWorkspace } from "./useEncryptedWorkspace.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";
import { useClassManager } from "../hooks/useClassManager.js";
import { createStarterState } from "../domain/index.js";

const mocks = vi.hoisted(() => ({ store: {}, repository: {}, writeIntegrity: vi.fn(async () => true) }));
vi.mock("./deviceRecoveryStore.js", () => ({ deviceRecoveryStore: mocks.store }));
vi.mock("./encryptedWorkspaceRepository.js", () => ({ encryptedWorkspaceRepository: mocks.repository }));
vi.mock("../crypto/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  deviceKeyStore: { readIntegrity: async () => null, writeIntegrity: mocks.writeIntegrity },
}));
const user = { id: "owner" };
const session = { workspaceCryptoId: "workspace" };
const security = { wrappers: [], clearLocalCopies: vi.fn(async () => {}) };
const workspace = {
  state: createStarterState(),
  revision: 1,
  manifest: { root: "root" },
  workspaceCryptoId: "workspace",
};
function entry(id, entity, status = "pending") {
  return {
    id,
    status,
    workspace,
    mutation: { operationId: id, upserts: [{ collection: "students", entityId: entity }], deletes: [] },
  };
}
let queue;
beforeEach(() => {
  queue = [];
  Object.assign(mocks.store, {
    listMutations: vi.fn(async () => [...queue]),
    loadWorkspaceCache: vi.fn(async () => workspace),
    cacheWorkspace: vi.fn(async () => {}),
    capture: vi.fn(async () => null),
    completeMutation: vi.fn(async (_, id) => {
      queue = queue.filter((item) => item.id !== id);
    }),
    markMutationConflict: vi.fn(async (_, id) => {
      queue = queue.map((item) => (item.id === id ? { ...item, status: "conflict" } : item));
    }),
    rewriteMutations: vi.fn(async (_, { remove = [], put = [] }) => {
      queue = queue.flatMap((item) => {
        if (remove.includes(item.id)) return [];
        const replacement = put.find((next) => next.replaces === item.id);
        return replacement
          ? [{ ...item, id: replacement.mutation.operationId, mutation: replacement.mutation, status: "pending" }]
          : [item];
      });
    }),
  });
  Object.assign(mocks.repository, {
    loadWorkspace: vi.fn(async () => workspace),
    applyMutation: vi.fn(async () => ({ ...workspace, revision: 2 })),
    resolveMutation: vi.fn(async (mutation) => ({ ...mutation, operationId: "replacement" })),
    optimisticWorkspace: vi.fn((current) => current),
    projectPendingWorkspace: vi.fn(async (confirmed, entries) => ({ workspace: confirmed, entries })),
    subscribe: vi.fn(async () => () => {}),
  });
});
describe("encrypted offline queue", () => {
  it("blocks overlapping restores and local purging until the restore completes", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.syncStatus).toBe("saved"));
    let finishReplace;
    mocks.repository.replaceWorkspace = vi.fn(
      () =>
        new Promise((resolve) => {
          finishReplace = resolve;
        }),
    );
    let replacing;
    await act(async () => {
      replacing = cloud.result.current.persistence.replace(workspace.state);
    });
    expect(mocks.repository.replaceWorkspace).toHaveBeenCalledOnce();
    await expect(cloud.result.current.persistence.replace(workspace.state)).rejects.toThrow("current operation");
    await expect(cloud.result.current.persistence.encryption.clearLocalCopies()).rejects.toThrow("current operation");
    await act(async () => {
      finishReplace({ ...workspace, revision: 2 });
      await replacing;
    });
    expect(cloud.result.current.workspace.revision).toBe(2);
  });
  it("waits for a late device write, then blocks further writes while clearing and locking", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.syncStatus).toBe("saved"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = cloud.result.current.persistence.subscribe(() => {});
    });
    let finishCache;
    mocks.store.cacheWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCache = resolve;
        }),
    );
    const receive = mocks.repository.subscribe.mock.calls[0][1];
    let reception;
    await act(async () => {
      reception = receive({ ...workspace, revision: 2 });
    });
    let clearing;
    await act(async () => {
      clearing = cloud.result.current.persistence.encryption.clearLocalCopies();
    });
    expect(security.clearLocalCopies).not.toHaveBeenCalled();
    await act(async () => {
      finishCache();
      await reception;
      await clearing;
    });
    expect(security.clearLocalCopies).toHaveBeenCalledOnce();
    const before = mocks.store.cacheWorkspace.mock.calls.length;
    await act(async () => {
      await receive({ ...workspace, revision: 3 });
      await cloud.result.current.persistence.retrySync();
    });
    expect(mocks.store.cacheWorkspace).toHaveBeenCalledTimes(before);
    await expect(cloud.result.current.persistence.save(workspace.state)).rejects.toThrow("locked");
    unsubscribe();
    cloud.unmount();
  });
  it("keeps a live integrity error that arrives during an idle outbox check", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.syncStatus).toBe("saved"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = cloud.result.current.persistence.subscribe(() => {});
    });
    const [, , { onStatus, onError }] = mocks.repository.subscribe.mock.calls[0];
    let finishQueue;
    mocks.store.listMutations.mockReturnValueOnce(
      new Promise((resolve) => {
        finishQueue = resolve;
      }),
    );
    const before = mocks.repository.loadWorkspace.mock.calls.length;
    await act(async () => {
      onStatus("SYNCED");
    });
    await act(async () => {
      onError(new Error("invalid_workspace_manifest"));
      finishQueue([]);
    });
    expect(cloud.result.current.syncStatus).toBe("error");
    expect(mocks.repository.loadWorkspace).toHaveBeenCalledTimes(before);
    unsubscribe();
    cloud.unmount();
  });

  it("does not reload the full workspace for healthy idle polls but still honors an explicit retry", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.syncStatus).toBe("saved"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = cloud.result.current.persistence.subscribe(() => {});
    });
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    const before = mocks.repository.loadWorkspace.mock.calls.length;
    for (const status of ["SUBSCRIBED", "SYNCED", "SYNCED", "SYNCED"]) {
      await act(async () => {
        onStatus(status);
      });
      expect(cloud.result.current.syncStatus).toBe("saved");
    }
    expect(mocks.repository.loadWorkspace).toHaveBeenCalledTimes(before);
    await act(async () => {
      await cloud.result.current.persistence.retrySync();
    });
    expect(mocks.repository.loadWorkspace).toHaveBeenCalledTimes(before + 1);
    unsubscribe();
    cloud.unmount();
  });

  it("keeps startup, unchanged polls and acknowledged local edits quiet", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.loading).toBe(false));
    const manager = renderHook(() => useClassManager({ persistence: cloud.result.current.persistence }));
    expect(manager.result.current.toasts).toEqual([]);
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    await act(async () => {
      onStatus("SYNCED");
      await cloud.result.current.persistence.retrySync();
    });
    expect(manager.result.current.toasts).toEqual([]);
    const local = { ...workspace.state, settings: { ...workspace.state.settings, hourlyRate: 321 } };
    // The manager already has its own edit when the durable outbox is acknowledged.
    const adapter = { ...cloud.result.current.persistence, save: async () => ({ state: local, pending: true }) };
    const localManager = renderHook(() => useClassManager({ persistence: adapter }));
    await act(async () => {
      await localManager.result.current.actions.updateSettings(local.settings);
    });
    const before = localManager.result.current.toasts.length;
    mocks.repository.loadWorkspace.mockResolvedValue({ ...workspace, revision: 2, state: structuredClone(local) });
    await act(async () => {
      await cloud.result.current.persistence.retrySync();
    });
    expect(localManager.result.current.toasts).toHaveLength(before);
    expect(localManager.result.current.state.settings.hourlyRate).toBe(321);
  });

  it("publishes a flush result to the real manager before a duplicate live revision", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.loading).toBe(false));
    const initialAdapter = cloud.result.current.persistence;
    const manager = renderHook(() => useClassManager({ persistence: cloud.result.current.persistence }));
    const latest = {
      ...workspace,
      revision: 2,
      state: { ...workspace.state, settings: { ...workspace.state.settings, hourlyRate: 987 } },
    };
    mocks.repository.loadWorkspace.mockResolvedValue(latest);
    await act(async () => {
      await cloud.result.current.persistence.retrySync();
    });
    expect(manager.result.current.state.settings.hourlyRate).toBe(987);
    expect(mocks.writeIntegrity).toHaveBeenLastCalledWith({
      ownerId: "owner",
      workspaceCryptoId: "workspace",
      revision: 2,
      root: "root",
    });
    expect(
      manager.result.current.toasts.filter((toast) => toast.message === "Records updated from another device"),
    ).toHaveLength(1);
    const [, onChange] = mocks.repository.subscribe.mock.calls[0];
    await act(async () => {
      await onChange(latest);
    });
    expect(manager.result.current.state.settings.hourlyRate).toBe(987);
    expect(cloud.result.current.workspace).toBe(latest);
    expect(
      manager.result.current.toasts.filter((toast) => toast.message === "Records updated from another device"),
    ).toHaveLength(1);
    const lateManager = renderHook(() => useClassManager({ persistence: initialAdapter }));
    expect(lateManager.result.current.state.settings.hourlyRate).toBe(987);
  });

  it("publishes the verified initial load after a manager mounts from the device cache", async () => {
    let finishLoad;
    mocks.repository.loadWorkspace.mockReturnValue(
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
    );
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.loading).toBe(false));
    expect(cloud.result.current.syncStatus).not.toBe("saved");
    const manager = renderHook(() => useClassManager({ persistence: cloud.result.current.persistence }));
    await act(async () => {
      finishLoad({
        ...workspace,
        revision: 2,
        state: {
          ...workspace.state,
          settings: { ...workspace.state.settings, hourlyRate: 456 },
        },
      });
    });
    expect(manager.result.current.state.settings.hourlyRate).toBe(456);
    expect(cloud.result.current.syncStatus).toBe("saved");
  });

  it("rechecks the durable queue after reconnect and never acknowledges an unapplied mutation", async () => {
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.loading).toBe(false));
    renderHook(() => useClassManager({ persistence: cloud.result.current.persistence }));
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    queue = [entry("offline", "student")];
    let finishApply;
    mocks.repository.applyMutation.mockReturnValue(
      new Promise((resolve) => {
        finishApply = resolve;
      }),
    );
    act(() => {
      onStatus("CHANNEL_ERROR");
    });
    expect(cloud.result.current.connectionStatus).toBe("reconnecting");
    act(() => {
      onStatus("SYNCED");
    });
    expect(cloud.result.current.syncStatus).not.toBe("saved");
    await waitFor(() => expect(mocks.repository.applyMutation).toHaveBeenCalledOnce());
    act(() => {
      onStatus("CHANNEL_ERROR");
      onStatus("SYNCED");
    });
    expect(queue).toHaveLength(1);
    expect(cloud.result.current.syncStatus).not.toBe("saved");
    await act(async () => {
      finishApply({ ...workspace, revision: 2 });
      await cloud.result.current.persistence.retrySync();
    });
    expect(queue).toEqual([]);
    expect(cloud.result.current.syncStatus).toBe("saved");
  });

  it("preserves integrity failures across healthy channel notifications", async () => {
    queue = [entry("a", "a")];
    mocks.repository.applyMutation.mockRejectedValue(new Error("invalid_workspace_manifest"));
    const cloud = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(cloud.result.current.syncStatus).toBe("error"));
    renderHook(() => useClassManager({ persistence: cloud.result.current.persistence }));
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    act(() => {
      onStatus("CHANNEL_ERROR");
      onStatus("SUBSCRIBED");
      onStatus("SYNCED");
    });
    expect(cloud.result.current.syncStatus).toBe("error");
    expect(queue).toHaveLength(1);
    expect(mocks.repository.applyMutation).toHaveBeenCalledOnce();
  });

  it("continues independent operations but holds descendants of a conflict", async () => {
    queue = [entry("a", "a"), entry("a2", "a"), entry("b", "b")];
    mocks.repository.applyMutation.mockImplementation(async (mutation) => {
      if (mutation.operationId === "a") throw new WorkspaceConflictError({ latestState: {}, latestRevision: 2 });
      return workspace;
    });
    const { result } = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(result.current.syncStatus).toBe("conflict"));
    expect(mocks.repository.applyMutation.mock.calls.map(([mutation]) => mutation.operationId)).toEqual(["a", "b"]);
    expect(queue.map((item) => item.id)).toEqual(["a", "a2"]);
  });

  it.each(["local", "discard"])("resumes normal sync after %s resolution", async (choice) => {
    queue = [entry("a", "a", "conflict")];
    mocks.repository.applyMutation.mockImplementation(async (mutation) => {
      if (mutation.operationId === "a") throw new WorkspaceConflictError({ latestState: {}, latestRevision: 2 });
      return workspace;
    });
    const { result } = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(result.current.syncStatus).toBe("conflict"));
    await act(async () => {
      await result.current.persistence.resolvePendingOperation("a", choice);
    });
    expect(queue).toEqual([]);
    expect(result.current.syncStatus).toBe("saved");
    expect(mocks.store.rewriteMutations).toHaveBeenCalledOnce();
    expect(mocks.repository.applyMutation).toHaveBeenCalledTimes(choice === "local" ? 2 : 1);
  });

  it("rechecks a previously flagged operation and clears it when the server acknowledges it", async () => {
    queue = [entry("acknowledged", "a", "conflict")];
    const { result } = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(queue).toEqual([]);
    expect(mocks.repository.applyMutation).toHaveBeenCalledOnce();
    expect(mocks.store.completeMutation).toHaveBeenCalledWith(user.id, "acknowledged");
  });

  it("does not report permanent errors as an automatic network retry", async () => {
    queue = [entry("a", "a")];
    mocks.repository.applyMutation.mockRejectedValue(new Error("invalid_workspace_manifest"));
    const { result } = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(result.current.syncStatus).toBe("error"));
    expect(queue).toHaveLength(1);
    expect(result.current.syncMessage).not.toContain("retry automatically");
  });
});
