// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEncryptedWorkspace } from "./useEncryptedWorkspace.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";
import { useClassManager } from "../hooks/useClassManager.js";
import { createStarterState } from "../domain/index.js";

const mocks = vi.hoisted(() => ({ store: {}, repository: {} }));
vi.mock("./deviceRecoveryStore.js", () => ({ deviceRecoveryStore: mocks.store }));
vi.mock("./encryptedWorkspaceRepository.js", () => ({ encryptedWorkspaceRepository: mocks.repository }));
vi.mock("../crypto/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  deviceKeyStore: { readIntegrity: async () => null, writeIntegrity: async () => true },
}));
const user = { id: "owner" };
const session = { workspaceCryptoId: "workspace" };
const security = { wrappers: [] };
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
    replaceMutation: vi.fn(async (_, id, mutation) => {
      queue = queue.flatMap((item) =>
        item.id !== id ? [item] : mutation ? [{ ...item, id: mutation.operationId, mutation, status: "pending" }] : [],
      );
    }),
  });
  Object.assign(mocks.repository, {
    loadWorkspace: vi.fn(async () => workspace),
    applyMutation: vi.fn(async () => ({ ...workspace, revision: 2 })),
    resolveMutation: vi.fn(async (mutation) => ({ ...mutation, operationId: "replacement" })),
    optimisticWorkspace: vi.fn((current) => current),
    subscribe: vi.fn(async () => () => {}),
  });
});
describe("encrypted offline queue", () => {
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
    const [, onChange] = mocks.repository.subscribe.mock.calls[0];
    await act(async () => {
      await onChange(latest);
    });
    expect(manager.result.current.state.settings.hourlyRate).toBe(987);
    expect(cloud.result.current.workspace).toBe(latest);
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
    const { result } = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(result.current.syncStatus).toBe("conflict"));
    await act(async () => {
      await result.current.persistence.resolvePendingOperation("a", choice);
    });
    expect(queue).toEqual([]);
    expect(result.current.syncStatus).toBe("saved");
    expect(mocks.store.replaceMutation).toHaveBeenCalledOnce();
    expect(mocks.repository.applyMutation).toHaveBeenCalledTimes(choice === "local" ? 1 : 0);
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
