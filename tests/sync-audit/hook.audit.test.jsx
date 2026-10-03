// @vitest-environment jsdom
// Regression tests for the hook coordination findings of the 2026-10-03 audit
// (S04, S05, S07, S08). The repository is mocked to control callback order.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEncryptedWorkspace } from "../../src/cloud/useEncryptedWorkspace.js";
import { WorkspaceConflictError } from "../../src/cloud/workspaceRepository.js";
import { createStarterState } from "../../src/domain/index.js";

const mocks = vi.hoisted(() => ({ store: {}, repository: {}, writeIntegrity: vi.fn(async () => true) }));
vi.mock("../../src/cloud/deviceRecoveryStore.js", () => ({ deviceRecoveryStore: mocks.store }));
vi.mock("../../src/cloud/encryptedWorkspaceRepository.js", () => ({ encryptedWorkspaceRepository: mocks.repository }));
vi.mock("../../src/crypto/index.js", async (importOriginal) => ({
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
const withSettings = (revision, settings) => ({
  ...workspace,
  revision,
  manifest: { root: `root-${revision}` },
  state: { ...workspace.state, settings: { ...workspace.state.settings, ...settings } },
});
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
    stageMutation: vi.fn(async ({ mutation }) => {
      queue = [...queue, { id: mutation.operationId, status: "pending", mutation }];
    }),
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
    prepareMutation: vi.fn(async ({ state }) => ({ operationId: "local", upserts: [], deletes: [], state })),
    applyMutation: vi.fn(async () => ({ ...workspace, revision: 2 })),
    resolveMutation: vi.fn(async (mutation) => ({ ...mutation, operationId: "replacement" })),
    optimisticWorkspace: vi.fn((current, mutation) => ({
      ...current,
      state: mutation.state ?? current.state,
      revision: current.revision + 1,
    })),
    projectPendingWorkspace: vi.fn(async (confirmed, entries) => ({ workspace: confirmed, entries })),
    subscribe: vi.fn(async () => () => {}),
  });
});

describe("sync audit regressions: hook coordination", () => {
  it("S04: a conflict on one student does not freeze independent remote changes", async () => {
    queue = [entry("a", "a")];
    const remote = withSettings(2, { hourlyRate: 999 });
    mocks.repository.applyMutation.mockRejectedValue(
      new WorkspaceConflictError({ latestState: workspace.state, latestRevision: 1 }),
    );
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("conflict"));
    let unsubscribe;
    const seen = [];
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe((state) => seen.push(state.settings.hourlyRate));
    });
    const [, receive, { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    const loads = mocks.repository.loadWorkspace.mock.calls.length;
    await act(async () => {
      await receive(remote);
      onStatus("SYNCED");
    });
    // The remote rate is shown with the queued edit layered on top, and the
    // conflict still waits for a decision without re-downloading every record.
    expect(hook.result.current.workspace.state.settings.hourlyRate).toBe(999);
    expect(seen.at(-1)).toBe(999);
    expect(mocks.repository.projectPendingWorkspace).toHaveBeenLastCalledWith(
      remote,
      [expect.objectContaining({ id: "a", status: "conflict" })],
      session,
    );
    expect(hook.result.current.syncStatus).toBe("conflict");
    expect(mocks.repository.loadWorkspace).toHaveBeenCalledTimes(loads);
    unsubscribe();
    hook.unmount();
  });

  it("S04: heartbeats keep sending independent work while another operation waits for review", async () => {
    queue = [entry("a", "a", "conflict")];
    mocks.repository.applyMutation.mockImplementation(async (mutation) => {
      if (mutation.operationId === "a") throw new WorkspaceConflictError({ latestState: {}, latestRevision: 1 });
      return withSettings(2, {});
    });
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("conflict"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    queue = [...queue, entry("b", "b")];
    const attempts = mocks.repository.applyMutation.mock.calls.length;
    await act(async () => {
      onStatus("SYNCED");
    });
    await waitFor(() => expect(queue.map((item) => item.id)).toEqual(["a"]));
    // Only the independent operation was sent; a heartbeat does not re-ask about the flagged one.
    expect(mocks.repository.applyMutation.mock.calls.slice(attempts).map(([mutation]) => mutation.operationId)).toEqual(
      ["b"],
    );
    expect(hook.result.current.syncStatus).toBe("conflict");
    unsubscribe();
    hook.unmount();
  });

  it("S05: a revision collision stays an automatic retry and healthy heartbeats retry it", async () => {
    queue = [entry("a", "a")];
    const error = new Error("workspace_revision_conflict", {
      cause: { code: "PT409", message: "workspace_revision_conflict" },
    });
    mocks.repository.applyMutation.mockRejectedValueOnce(error);
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(mocks.repository.applyMutation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.persistence?.syncMessage).toContain("retry automatically"));
    expect(hook.result.current.syncStatus).toBe("pending");
    expect(queue[0].status).toBe("pending");
    expect(mocks.store.markMutationConflict).not.toHaveBeenCalled();
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    await act(async () => {
      onStatus("SYNCED");
    });
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    expect(mocks.repository.applyMutation).toHaveBeenCalledTimes(2);
    expect(queue).toEqual([]);
    unsubscribe();
    hook.unmount();
  });

  it("S07: a verified live update received during a flush is published when the flush ends", async () => {
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    const [, receive, { onStatus }] = mocks.repository.subscribe.mock.calls[0];
    const older = withSettings(2, { hourlyRate: 222 });
    const newer = withSettings(3, { hourlyRate: 333 });
    mocks.repository.loadWorkspace.mockResolvedValue(older);
    let releaseCache;
    mocks.store.cacheWorkspace.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCache = resolve;
        }),
    );
    let flushing;
    await act(async () => {
      flushing = hook.result.current.persistence.retrySync();
    });
    await waitFor(() => expect(releaseCache).toBeTypeOf("function"));
    await act(async () => {
      await receive(newer);
      onStatus("SYNCED");
    });
    await act(async () => {
      releaseCache();
      await flushing;
    });
    await waitFor(() => expect(hook.result.current.workspace.revision).toBe(3));
    expect(hook.result.current.workspace.state.settings.hourlyRate).toBe(333);
    expect(hook.result.current.syncStatus).toBe("saved");
    expect(mocks.writeIntegrity).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 3, root: "root-3" }));
    unsubscribe();
    hook.unmount();
  });

  it("S07: an update that arrives during a slow save is shown with the local edit kept on top", async () => {
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    const [, receive] = mocks.repository.subscribe.mock.calls[0];
    const local = { ...workspace.state, settings: { ...workspace.state.settings, currency: "USD" } };
    let finishPrepare;
    mocks.repository.prepareMutation.mockImplementation(
      ({ state }) =>
        new Promise((resolve) => {
          finishPrepare = () => resolve({ operationId: "local", upserts: [], deletes: [], state, empty: false });
        }),
    );
    let finishApply;
    mocks.repository.applyMutation.mockReturnValue(
      new Promise((resolve) => {
        finishApply = resolve;
      }),
    );
    const remote = withSettings(2, { hourlyRate: 444 });
    mocks.repository.projectPendingWorkspace.mockImplementation(async (confirmed, entries) => ({
      workspace: {
        ...confirmed,
        state: { ...confirmed.state, settings: { ...confirmed.state.settings, currency: "USD" } },
      },
      entries,
    }));
    let saving;
    await act(async () => {
      saving = hook.result.current.persistence.save(local, workspace.state);
    });
    await waitFor(() => expect(finishPrepare).toBeTypeOf("function"));
    await act(async () => {
      // Arrives while the save still holds the local write lock.
      void receive(remote);
    });
    await act(async () => {
      finishPrepare();
      await saving;
    });
    await waitFor(() => expect(hook.result.current.workspace.state.settings.hourlyRate).toBe(444));
    expect(hook.result.current.workspace.state.settings.currency).toBe("USD");
    await waitFor(() => expect(finishApply).toBeTypeOf("function"));
    await act(async () => {
      finishApply(withSettings(3, { hourlyRate: 444, currency: "USD" }));
    });
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    expect(hook.result.current.workspace.revision).toBe(3);
    expect(hook.result.current.workspace.state.settings).toMatchObject({ hourlyRate: 444, currency: "USD" });
    unsubscribe();
    hook.unmount();
  });

  it("S08: a failed first subscription is installed again on reconnect without duplicates", async () => {
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    mocks.repository.subscribe.mockRejectedValueOnce(new Error("Failed to fetch"));
    let unsubscribe;
    await act(async () => {
      unsubscribe = hook.result.current.persistence.subscribe(() => {});
    });
    expect(hook.result.current.persistence.connectionStatus).toBe("reconnecting");
    const cleanup = vi.fn();
    mocks.repository.subscribe.mockResolvedValue(cleanup);
    await act(async () => {
      globalThis.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(mocks.repository.subscribe).toHaveBeenCalledTimes(2));
    await act(async () => {
      await hook.result.current.persistence.retrySync();
      globalThis.dispatchEvent(new Event("online"));
    });
    expect(mocks.repository.subscribe).toHaveBeenCalledTimes(2);
    const [, , { onStatus }] = mocks.repository.subscribe.mock.calls[1];
    await act(async () => {
      onStatus("SUBSCRIBED");
    });
    expect(hook.result.current.persistence.connectionStatus).toBe("connected");
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("S08: a failed first subscription retries on its own schedule until disposed", async () => {
    const hook = renderHook(() => useEncryptedWorkspace(user, session, security));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe("saved"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mocks.repository.subscribe.mockRejectedValueOnce(new Error("Failed to fetch"));
      let unsubscribe;
      await act(async () => {
        unsubscribe = hook.result.current.persistence.subscribe(() => {});
      });
      expect(mocks.repository.subscribe).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(mocks.repository.subscribe).toHaveBeenCalledTimes(2);
      unsubscribe();
      mocks.repository.subscribe.mockRejectedValue(new Error("Failed to fetch"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(mocks.repository.subscribe).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      hook.unmount();
    }
  });
});
