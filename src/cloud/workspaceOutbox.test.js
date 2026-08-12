import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain/index.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";
import { flushWorkspaceOutbox, statusForOutbox } from "./workspaceOutbox.js";

function queued(id, status = "pending") {
  return { id, status, mutation: { operationId: id, patch: {}, expectedVersions: {} } };
}

function memoryStore(entries = []) {
  const items = [...entries];
  return {
    items,
    listMutations: vi.fn(async () => [...items]),
    completeMutation: vi.fn(async (_ownerId, id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) items.splice(index, 1);
      return index >= 0;
    }),
    markMutationConflict: vi.fn(async (_ownerId, id, message) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) Object.assign(item, { status: "conflict", conflictMessage: message });
      return Boolean(item);
    }),
    cacheWorkspace: vi.fn(async () => {}),
  };
}

describe("persistent workspace outbox", () => {
  it("distinguishes pending, conflict, saved, and offline states", () => {
    expect(statusForOutbox([queued("a")])).toBe("pending");
    expect(statusForOutbox([queued("a", "conflict")])).toBe("conflict");
    expect(statusForOutbox([], { online: true })).toBe("saved");
    expect(statusForOutbox([], { online: false })).toBe("offline");
  });

  it("replays mutations in order and removes them only after acknowledgement", async () => {
    const store = memoryStore([queued("a"), queued("b")]);
    const workspace = { state: createStarterState(), versions: {}, revision: 2, updatedAt: null };
    const repository = {
      loadWorkspace: vi.fn(async () => workspace),
      applyWorkspaceMutation: vi.fn(async () => ({ eventId: 2 })),
    };

    const result = await flushWorkspaceOutbox({ ownerId: "user-1", store, repository });

    expect(result).toMatchObject({ status: "saved", applied: 2, workspace });
    expect(repository.applyWorkspaceMutation.mock.calls.map(([mutation]) => mutation.operationId)).toEqual(["a", "b"]);
    expect(store.items).toEqual([]);
    expect(store.cacheWorkspace).toHaveBeenCalledWith("user-1", workspace);
  });

  it("persists a same-entity conflict and leaves later edits queued", async () => {
    const store = memoryStore([queued("a"), queued("b")]);
    const conflict = new WorkspaceConflictError({ latestState: createStarterState(), latestRevision: 3 });
    const repository = {
      loadWorkspace: vi.fn(async () => ({ state: createStarterState(), versions: {}, revision: 2 })),
      applyWorkspaceMutation: vi.fn(async () => { throw conflict; }),
    };

    const result = await flushWorkspaceOutbox({ ownerId: "user-1", store, repository });

    expect(result.status).toBe("conflict");
    expect(store.items).toHaveLength(2);
    expect(store.items[0].status).toBe("conflict");
    expect(store.completeMutation).not.toHaveBeenCalled();
  });

  it("leaves a mutation pending after a network failure", async () => {
    const store = memoryStore([queued("a")]);
    const repository = {
      loadWorkspace: vi.fn(async () => ({ state: createStarterState(), versions: {}, revision: 2 })),
      applyWorkspaceMutation: vi.fn(async () => { throw new Error("network unavailable"); }),
    };

    await expect(flushWorkspaceOutbox({ ownerId: "user-1", store, repository })).rejects.toThrow("network unavailable");
    expect(store.items[0].status).toBe("pending");
    expect(store.completeMutation).not.toHaveBeenCalled();
    expect(store.markMutationConflict).not.toHaveBeenCalled();
  });
});
