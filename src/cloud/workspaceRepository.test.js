import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain/index.js";
import {
  createWorkspaceRepository,
  WorkspaceConflictError,
} from "./workspaceRepository.js";

function authenticatedClient(overrides = {}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
    },
    ...overrides,
  };
}

function selectResult(result) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return {
    select: vi.fn(() => query),
    query,
  };
}

describe("workspace repository", () => {
  it("blocks development writes before contacting Supabase", async () => {
    const client = authenticatedClient({ rpc: vi.fn() });
    const repository = createWorkspaceRepository(client, { allowWrites: false });

    await expect(repository.saveWorkspace(createStarterState(), 0, "user-1"))
      .rejects.toThrow("Cloud writes are disabled");
    await expect(repository.replaceWorkspace(createStarterState(), 0, "user-1"))
      .rejects.toThrow("Cloud writes are disabled");
    expect(client.auth.getUser).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("loads an existing revision and validates its JSONB state", async () => {
    const state = createStarterState();
    const selection = selectResult({
      data: { owner_id: "user-1", state, revision: 4, updated_at: "2026-07-11T12:00:00Z" },
      error: null,
    });
    const client = authenticatedClient({
      from: vi.fn(() => selection),
    });

    const result = await createWorkspaceRepository(client).loadWorkspace("user-1");

    expect(result).toEqual({
      state,
      revision: 4,
      updatedAt: "2026-07-11T12:00:00Z",
    });
    expect(client.from).toHaveBeenCalledWith("workspaces");
    expect(selection.query.eq).toHaveBeenCalledWith("owner_id", "user-1");
  });

  it("rejects a workspace row that is not owned by the requested account", async () => {
    const state = createStarterState();
    const client = authenticatedClient({
      from: vi.fn(() => selectResult({
        data: { owner_id: "user-2", state, revision: 1, updated_at: null },
        error: null,
      })),
    });

    await expect(createWorkspaceRepository(client).loadWorkspace("user-1"))
      .rejects.toThrow("did not belong to the expected account");
  });

  it("reports a missing trigger-created workspace without attempting a direct write", async () => {
    const client = authenticatedClient({
      from: vi.fn(() => selectResult({ data: null, error: null })),
    });

    await expect(createWorkspaceRepository(client).loadOrCreateWorkspace())
      .rejects.toThrow("Apply the latest Supabase migration");
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("saves through the revision-aware RPC", async () => {
    const state = createStarterState();
    state.settings.hourlyRate = 60;
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({
        data: [{ state, revision: 8, updated_at: "2026-07-11T12:30:00Z" }],
        error: null,
      })),
    });

    const result = await createWorkspaceRepository(client).saveWorkspace(state, 7);

    expect(client.rpc).toHaveBeenCalledWith("save_workspace_state", {
      p_expected_owner_id: "user-1",
      p_expected_revision: 7,
      p_state: state,
    });
    expect(result).toMatchObject({ state, revision: 8 });
  });

  it("rejects a queued save when the active account no longer matches its owner", async () => {
    const client = authenticatedClient();
    const repository = createWorkspaceRepository(client);

    await expect(repository.saveWorkspace(createStarterState(), 0, "user-2"))
      .rejects.toThrow("active account changed");
    expect(client.rpc).toBeUndefined();
  });

  it("replaces a workspace only through the explicit revision-aware RPC", async () => {
    const state = createStarterState();
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({
        data: [{ state, revision: 5, updated_at: "2026-07-11T14:00:00Z" }],
        error: null,
      })),
    });

    const result = await createWorkspaceRepository(client).replaceWorkspace(state, 4, "user-1");

    expect(client.rpc).toHaveBeenCalledWith("replace_workspace_state", {
      p_expected_owner_id: "user-1",
      p_expected_revision: 4,
      p_state: state,
      p_confirmation: "replace:4",
    });
    expect(result).toMatchObject({ state, revision: 5 });
  });

  it("applies an additive import through the audited revision-aware RPC", async () => {
    const state = createStarterState();
    const fileHash = "a".repeat(64);
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({
        data: [{ state, revision: 6, updated_at: "2026-07-27T12:00:00Z", already_imported: false }],
        error: null,
      })),
    });

    const result = await createWorkspaceRepository(client).applyWorkspaceImport(state, 5, "user-1", {
      fileHash,
      sourceName: "backup.json",
      summary: { added: 3 },
    });

    expect(client.rpc).toHaveBeenCalledWith("apply_workspace_import", {
      p_expected_owner_id: "user-1",
      p_expected_revision: 5,
      p_state: state,
      p_file_hash: fileHash,
      p_source_name: "backup.json",
      p_summary: { added: 3 },
      p_confirmation: `import:5:${fileHash}`,
    });
    expect(result).toMatchObject({ state, revision: 6, alreadyImported: false });
  });

  it("checks owner-bound import history by SHA-256 hash", async () => {
    const fileHash = "b".repeat(64);
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "job-1",
          owner_id: "user-1",
          file_hash: fileHash,
          source_name: "backup.json",
          base_revision: 4,
          result_revision: 5,
          summary: { added: 2 },
          created_at: "2026-07-27T12:00:00Z",
        },
        error: null,
      })),
    };
    const client = authenticatedClient({ from: vi.fn(() => query) });

    const result = await createWorkspaceRepository(client).findImportJob(fileHash, "user-1");

    expect(query.eq).toHaveBeenNthCalledWith(1, "owner_id", "user-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "file_hash", fileHash);
    expect(result).toMatchObject({ id: "job-1", fileHash, resultRevision: 5 });
  });

  it("refreshes the latest state and raises a typed conflict", async () => {
    const local = createStarterState();
    const latest = createStarterState();
    latest.settings.hourlyRate = 80;
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "PT409", message: "workspace revision conflict" },
      })),
      from: vi.fn(() => selectResult({
        data: { owner_id: "user-1", state: latest, revision: 3, updated_at: "2026-07-11T13:00:00Z" },
        error: null,
      })),
    });

    const error = await createWorkspaceRepository(client)
      .saveWorkspace(local, 2)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(WorkspaceConflictError);
    expect(error.latestState).toEqual(latest);
    expect(error.latestRevision).toBe(3);
  });

  it("explains when the server blocks unexpected record loss", async () => {
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "22023", message: "workspace_collection_delete_blocked" },
      })),
    });

    await expect(createWorkspaceRepository(client).saveWorkspace(createStarterState(), 2, "user-1"))
      .rejects.toThrow("previous cloud version is still intact");
  });

  it("lists only owner-bound recovery metadata without downloading snapshot state", async () => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({
        data: [{
          id: "snapshot-1",
          owner_id: "user-1",
          source_revision: 6,
          reason: "save",
          created_at: "2026-07-19T12:00:00Z",
        }],
        error: null,
      })),
    };
    const client = authenticatedClient({ from: vi.fn(() => query) });

    const points = await createWorkspaceRepository(client).listRecoverySnapshots("user-1");

    expect(query.select).toHaveBeenCalledWith("id, owner_id, source_revision, reason, created_at");
    expect(points).toEqual([expect.objectContaining({ id: "snapshot-1", revision: 6, source: "cloud-snapshot" })]);
  });

  it("restores a snapshot through the revision-aware recovery RPC", async () => {
    const state = createStarterState();
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({
        data: [{ state, revision: 9, updated_at: "2026-07-19T12:30:00Z" }],
        error: null,
      })),
    });

    const restored = await createWorkspaceRepository(client)
      .restoreRecoverySnapshot("snapshot-1", 8, "user-1");

    expect(client.rpc).toHaveBeenCalledWith("restore_workspace_snapshot", {
      p_expected_owner_id: "user-1",
      p_snapshot_id: "snapshot-1",
      p_expected_revision: 8,
    });
    expect(restored.revision).toBe(9);
  });

  it("delivers canonical realtime updates and removes its channel", async () => {
    const state = createStarterState();
    let updateHandler;
    const channel = {
      on: vi.fn((_kind, _filter, callback) => {
        updateHandler = callback;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const client = authenticatedClient({
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    });
    const onChange = vi.fn();

    const unsubscribe = await createWorkspaceRepository(client)
      .subscribeToWorkspace(onChange, { userId: "user-1" });
    updateHandler({ new: { state, revision: 2, updated_at: null } });

    expect(onChange).toHaveBeenCalledWith({ state, revision: 2, updatedAt: null });
    await unsubscribe();
    await unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
