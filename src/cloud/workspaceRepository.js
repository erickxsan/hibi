import { deserializeState, MAX_BACKUP_BYTES } from "../domain/index.js";
import {
  CloudAuthenticationError,
  cloudWritesEnabled,
  requireCloudClient,
  supabase,
} from "./client.js";

export const WORKSPACES_TABLE = "workspaces";
export const SAVE_WORKSPACE_RPC = "save_workspace_state";
export const REPLACE_WORKSPACE_RPC = "replace_workspace_state";
export const RESTORE_WORKSPACE_RPC = "restore_workspace_snapshot";
export const RECOVERY_SNAPSHOTS_TABLE = "workspace_recovery_snapshots";

export class CloudPersistenceError extends Error {
  constructor(message = "Cloud records could not be loaded or saved.", options) {
    super(message, options);
    this.name = "CloudPersistenceError";
  }
}

export class WorkspaceConflictError extends CloudPersistenceError {
  constructor({ latestState, latestRevision, latestUpdatedAt = null, cause } = {}) {
    super("These records changed in another session. The latest cloud version has been loaded.", { cause });
    this.name = "WorkspaceConflictError";
    this.latestState = latestState;
    this.latestRevision = latestRevision;
    this.latestUpdatedAt = latestUpdatedAt;
  }
}

function canonicalState(value) {
  // Reuse the import boundary so malformed remote JSON never enters app state.
  return deserializeState(JSON.stringify(value));
}

function assertStateSize(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
  if (bytes > MAX_BACKUP_BYTES) {
    throw new CloudPersistenceError("This workspace is larger than the 5 MB cloud limit. Export a backup and remove old records before saving more.");
  }
}

function normalizeRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new CloudPersistenceError("The cloud workspace has an invalid revision number.");
  }
  return revision;
}

function workspaceFromRow(row, expectedOwnerId) {
  if (!row || typeof row !== "object") {
    throw new CloudPersistenceError("The cloud workspace response was empty.");
  }
  if (expectedOwnerId && row.owner_id !== expectedOwnerId) {
    throw new CloudAuthenticationError("The cloud workspace did not belong to the expected account.");
  }
  return {
    state: canonicalState(row.state),
    revision: normalizeRevision(row.revision),
    updatedAt: row.updated_at ?? null,
  };
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function isRevisionConflict(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return error?.code === "PT409"
    || error?.code === "40001"
    || text.includes("revision_conflict")
    || text.includes("revision conflict")
    || text.includes("stale revision");
}

function persistenceFailure(message, error) {
  const providerMessage = String(error?.message || "");
  if ([
    "workspace_collection_delete_blocked",
    "workspace_large_delete_blocked",
    "workspace_mass_delete_blocked",
  ].some((code) => providerMessage.includes(code))) {
    return new CloudPersistenceError("Hibi blocked an unexpected loss of records. Your previous cloud version is still intact.", { cause: error });
  }
  if (providerMessage.includes("empty_workspace_replacement_blocked")) {
    return new CloudPersistenceError("Hibi will not replace a populated workspace with an empty backup.", { cause: error });
  }
  return new CloudPersistenceError(error?.message || message, { cause: error });
}

/**
 * One authenticated account owns one JSONB workspace. Keeping all canonical app
 * state in one row makes a complete edit atomic and preserves import/export.
 */
export function createWorkspaceRepository(client = supabase, { allowWrites = true } = {}) {
  const cloud = () => requireCloudClient(client);

  function requireWritesEnabled() {
    if (!allowWrites) {
      throw new CloudPersistenceError("Cloud writes are disabled on this preview or development address. Open the official Hibi site to make changes.");
    }
  }

  async function requireUser(expectedOwnerId) {
    const { data, error } = await cloud().auth.getUser();
    if (error) throw new CloudAuthenticationError(error.message, { cause: error });
    if (!data?.user) throw new CloudAuthenticationError();
    if (expectedOwnerId && data.user.id !== expectedOwnerId) {
      throw new CloudAuthenticationError("The active account changed before this operation completed.");
    }
    return data.user;
  }

  async function fetchWorkspace(expectedOwnerId) {
    const { data, error } = await cloud()
      .from(WORKSPACES_TABLE)
      .select("owner_id, state, revision, updated_at")
      .eq("owner_id", expectedOwnerId)
      .maybeSingle();

    if (error) throw persistenceFailure("Cloud records could not be loaded.", error);
    return data ? workspaceFromRow(data, expectedOwnerId) : null;
  }

  async function loadWorkspace(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    return fetchWorkspace(expectedOwnerId || user.id);
  }

  async function loadOrCreateWorkspace(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const existing = await fetchWorkspace(expectedOwnerId || user.id);
    if (existing) return existing;
    throw new CloudPersistenceError("Your cloud workspace is missing. Apply the latest Supabase migration, then try again.");
  }

  async function saveWorkspace(state, expectedRevision, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const nextState = canonicalState(state);
    assertStateSize(nextState);
    const revision = normalizeRevision(expectedRevision);
    const { data, error } = await cloud().rpc(SAVE_WORKSPACE_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_expected_revision: revision,
      p_state: nextState,
    });

    if (error && isRevisionConflict(error)) {
      await requireUser(expectedOwnerId);
      const latest = await fetchWorkspace(expectedOwnerId || user.id);
      if (!latest) throw persistenceFailure("The latest cloud records could not be recovered.", error);
      throw new WorkspaceConflictError({
        latestState: latest.state,
        latestRevision: latest.revision,
        latestUpdatedAt: latest.updatedAt,
        cause: error,
      });
    }
    if (error) throw persistenceFailure("Cloud records could not be saved.", error);

    const row = firstRow(data);
    if (row) return workspaceFromRow(row);

    // Support SQL functions declared without a row return while still reporting
    // the revision actually committed by the server.
    const saved = await fetchWorkspace(expectedOwnerId || user.id);
    if (!saved) throw new CloudPersistenceError("The saved cloud workspace could not be reloaded.");
    return saved;
  }

  async function replaceWorkspace(state, expectedRevision, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const nextState = canonicalState(state);
    assertStateSize(nextState);
    const revision = normalizeRevision(expectedRevision);
    const { data, error } = await cloud().rpc(REPLACE_WORKSPACE_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_expected_revision: revision,
      p_state: nextState,
      p_confirmation: `replace:${revision}`,
    });
    if (error && isRevisionConflict(error)) {
      const latest = await fetchWorkspace(expectedOwnerId || user.id);
      if (!latest) throw persistenceFailure("The latest cloud records could not be recovered.", error);
      throw new WorkspaceConflictError({
        latestState: latest.state,
        latestRevision: latest.revision,
        latestUpdatedAt: latest.updatedAt,
        cause: error,
      });
    }
    if (error) throw persistenceFailure("The backup could not replace the cloud workspace.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The replacement cloud workspace response was empty.");
    return workspaceFromRow(row);
  }

  async function listRecoverySnapshots(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const { data, error } = await cloud()
      .from(RECOVERY_SNAPSHOTS_TABLE)
      .select("id, owner_id, source_revision, reason, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw persistenceFailure("Recovery history could not be loaded.", error);
    return (data || []).map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      revision: normalizeRevision(row.source_revision),
      reason: row.reason,
      capturedAt: row.created_at,
      source: "cloud-snapshot",
    }));
  }

  async function loadRecoverySnapshot(snapshotId, expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const { data, error } = await cloud()
      .from(RECOVERY_SNAPSHOTS_TABLE)
      .select("id, owner_id, state, source_revision, reason, created_at")
      .eq("owner_id", ownerId)
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) throw persistenceFailure("The recovery copy could not be loaded.", error);
    if (!data) return null;
    if (data.owner_id !== ownerId) throw new CloudAuthenticationError("The recovery copy did not belong to the expected account.");
    return {
      id: data.id,
      ownerId: data.owner_id,
      state: canonicalState(data.state),
      revision: normalizeRevision(data.source_revision),
      reason: data.reason,
      capturedAt: data.created_at,
      source: "cloud-snapshot",
    };
  }

  async function restoreRecoverySnapshot(snapshotId, expectedRevision, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const revision = normalizeRevision(expectedRevision);
    const { data, error } = await cloud().rpc(RESTORE_WORKSPACE_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_snapshot_id: snapshotId,
      p_expected_revision: revision,
    });
    if (error && isRevisionConflict(error)) {
      const latest = await fetchWorkspace(expectedOwnerId || user.id);
      if (!latest) throw persistenceFailure("The latest cloud records could not be recovered.", error);
      throw new WorkspaceConflictError({
        latestState: latest.state,
        latestRevision: latest.revision,
        latestUpdatedAt: latest.updatedAt,
        cause: error,
      });
    }
    if (error) throw persistenceFailure("The recovery copy could not be restored.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The restored cloud workspace response was empty.");
    return workspaceFromRow(row);
  }

  /**
   * Subscribe to updates from other tabs or devices. The callback receives the
   * same { state, revision, updatedAt } shape as load/save.
   */
  async function subscribeToWorkspace(onChange, { userId, onStatus, onError } = {}) {
    if (typeof onChange !== "function") {
      throw new TypeError("subscribeToWorkspace requires an update callback.");
    }
    const ownerId = (await requireUser(userId)).id;
    const channel = cloud()
      .channel(`workspace:${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: WORKSPACES_TABLE,
          filter: `owner_id=eq.${ownerId}`,
        },
        (payload) => {
          try {
            onChange(workspaceFromRow(payload.new));
          } catch (error) {
            onError?.(error);
          }
        },
      )
      .subscribe((status, error) => {
        onStatus?.(status);
        if (error) onError?.(persistenceFailure("Cloud live updates disconnected.", error));
      });

    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      await cloud().removeChannel(channel);
    };
  }

  return {
    loadWorkspace,
    loadOrCreateWorkspace,
    saveWorkspace,
    replaceWorkspace,
    listRecoverySnapshots,
    loadRecoverySnapshot,
    restoreRecoverySnapshot,
    subscribeToWorkspace,
  };
}

export const workspaceRepository = createWorkspaceRepository(supabase, { allowWrites: cloudWritesEnabled });
