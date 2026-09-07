// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEncryptedWorkspace } from "./useEncryptedWorkspace.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";

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
const workspace = { state: {}, revision: 1, manifest: { root: "root" }, workspaceCryptoId: "workspace" };
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
  });
});
describe("encrypted offline queue", () => {
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
