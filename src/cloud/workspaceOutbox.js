import { WorkspaceConflictError } from "./workspaceRepository.js";

export function statusForOutbox(entries, { online = globalThis.navigator?.onLine !== false } = {}) {
  if (entries.some((entry) => entry.status === "conflict")) return "conflict";
  if (entries.length) return "pending";
  return online ? "saved" : "offline";
}

export async function flushWorkspaceOutbox({ ownerId, store, repository }) {
  const queued = await store.listMutations(ownerId);
  const conflict = queued.find((entry) => entry.status === "conflict");
  if (conflict) return { status: "conflict", conflict };
  if (!queued.length) {
    const latest = await repository.loadWorkspace(ownerId);
    if (latest) await store.cacheWorkspace(ownerId, latest);
    return { status: "saved", workspace: latest, applied: 0 };
  }

  await repository.loadWorkspace(ownerId);
  let applied = 0;
  for (const entry of queued) {
    try {
      await repository.applyWorkspaceMutation(entry.mutation, ownerId);
      await store.completeMutation(ownerId, entry.id);
      applied += 1;
    } catch (error) {
      if (!(error instanceof WorkspaceConflictError) && !error?.latestState) throw error;
      await store.markMutationConflict(ownerId, entry.id, error.message);
      return { status: "conflict", conflict: { ...entry, error }, applied };
    }
  }

  const workspace = await repository.loadWorkspace(ownerId);
  if (workspace) await store.cacheWorkspace(ownerId, workspace);
  return { status: "saved", workspace, applied };
}
