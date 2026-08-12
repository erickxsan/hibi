import { deserializeState, MAX_BACKUP_BYTES } from "../domain/index.js";
import {
  advanceWorkspaceVersions,
  applyWorkspacePatch,
  buildWorkspacePatch,
  NORMALIZED_COLLECTIONS,
  workspacePatchesOverlap,
} from "./normalizedWorkspace.js";
import { CloudAuthenticationError, cloudWritesEnabled, requireCloudClient, supabase } from "./client.js";

export const LOAD_WORKSPACE_RPC = "load_normalized_workspace";
export const SAVE_WORKSPACE_RPC = "apply_workspace_patch_idempotent";
export const REPLACE_WORKSPACE_RPC = "replace_normalized_workspace_state";
export const RESTORE_WORKSPACE_RPC = "restore_normalized_workspace_snapshot";
export const RESET_WORKSPACE_RPC = "reset_normalized_workspace_records";
export const APPLY_IMPORT_RPC = "apply_normalized_workspace_import";
export const WORKSPACE_CHANGE_EVENTS_TABLE = "workspace_change_events";
export const RECOVERY_SNAPSHOTS_TABLE = "workspace_recovery_snapshots";
export const IMPORT_JOBS_TABLE = "workspace_import_jobs";

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PATCH_BYTES = 1024 * 1024;

export class CloudPersistenceError extends Error {
  constructor(message = "Cloud records could not be loaded or saved.", options) {
    super(message, options);
    this.name = "CloudPersistenceError";
  }
}

export class WorkspaceConflictError extends CloudPersistenceError {
  constructor({ latestState, latestRevision, latestUpdatedAt = null, cause } = {}) {
    super("This record changed in another session. The latest cloud version has been loaded.", { cause });
    this.name = "WorkspaceConflictError";
    this.latestState = latestState;
    this.latestRevision = latestRevision;
    this.latestUpdatedAt = latestUpdatedAt;
  }
}

function canonicalState(value) {
  return deserializeState(JSON.stringify(value));
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertStateSize(state) {
  if (byteLength(state) > MAX_BACKUP_BYTES) {
    throw new CloudPersistenceError("This backup is larger than the 5 MB import and recovery limit.");
  }
}

function assertPatchSize(patch) {
  if (byteLength(patch) > MAX_PATCH_BYTES) {
    throw new CloudPersistenceError("This single change is too large to synchronize. Save it in smaller batches.");
  }
}

export function createOperationId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean))
    throw new CloudPersistenceError("Secure local operation IDs are unavailable in this browser.");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeRevision(value) {
  const revision = Number(value ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new CloudPersistenceError("The cloud workspace has an invalid synchronization cursor.");
  }
  return revision;
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function normalizeVersions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized = {};
  for (const key of ["settings", ...NORMALIZED_COLLECTIONS]) {
    if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) continue;
    normalized[key] = Object.fromEntries(
      Object.entries(value[key]).map(([id, revision]) => [id, normalizeRevision(revision)]),
    );
  }
  return normalized;
}

function workspaceFromRow(row, expectedOwnerId, { validate = true } = {}) {
  if (!row || typeof row !== "object") throw new CloudPersistenceError("The cloud workspace response was empty.");
  if (expectedOwnerId && row.owner_id && row.owner_id !== expectedOwnerId) {
    throw new CloudAuthenticationError("The cloud workspace did not belong to the expected account.");
  }
  return {
    state: validate ? canonicalState(row.state) : row.state,
    versions: normalizeVersions(row.versions),
    revision: normalizeRevision(row.revision ?? row.event_id),
    updatedAt: row.updated_at ?? null,
  };
}

function isEntityConflict(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return error?.code === "40001" || text.includes("workspace_entity_conflict");
}

function persistenceFailure(message, error) {
  const providerMessage = String(error?.message || "");
  if (providerMessage.includes("account_deletion_pending")) {
    const pending = new CloudPersistenceError(
      "This account is pending deletion. Resume the verified deletion instead of editing this workspace.",
      { cause: error },
    );
    pending.code = "account_deletion_pending";
    return pending;
  }
  if (providerMessage.includes("workspace_entity_conflict")) {
    return new CloudPersistenceError("The same record changed on another device. Hibi is loading that version.", {
      cause: error,
    });
  }
  if (providerMessage.includes("workspace_replacement_not_confirmed")) {
    return new CloudPersistenceError("The full-workspace replacement was not confirmed.", { cause: error });
  }
  if (providerMessage.includes("workspace_import_would_remove_records")) {
    return new CloudPersistenceError("Hibi blocked an import that could remove existing records.", { cause: error });
  }
  return new CloudPersistenceError(error?.message || message, { cause: error });
}

function importVersionsForState(state) {
  const versions = { settings: { __settings__: 1 } };
  for (const collection of NORMALIZED_COLLECTIONS) {
    versions[collection] = Object.fromEntries((state[collection] || []).map((item) => [item.id, 1]));
  }
  return versions;
}

export function createWorkspaceRepository(client = supabase, { allowWrites = true } = {}) {
  const cloud = () => requireCloudClient(client);
  let cache = null;

  function requireWritesEnabled() {
    if (!allowWrites) {
      throw new CloudPersistenceError(
        "Cloud writes are disabled on this preview or development address. Open the official Hibi site to make changes.",
      );
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

  function adopt(workspace) {
    cache = workspace;
    return workspace;
  }

  async function fetchWorkspace(expectedOwnerId) {
    const { data, error } = await cloud().rpc(LOAD_WORKSPACE_RPC, {
      p_expected_owner_id: expectedOwnerId,
    });
    if (error) throw persistenceFailure("Cloud records could not be loaded.", error);
    const row = firstRow(data);
    return row ? adopt(workspaceFromRow(row, expectedOwnerId)) : null;
  }

  async function loadWorkspace(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    return fetchWorkspace(expectedOwnerId || user.id);
  }

  async function loadOrCreateWorkspace(expectedOwnerId) {
    const loaded = await loadWorkspace(expectedOwnerId);
    if (loaded) return loaded;
    throw new CloudPersistenceError(
      "Your cloud workspace is missing. Apply the latest Supabase migration, then try again.",
    );
  }

  async function conflictFrom(error, ownerId) {
    const latest = await fetchWorkspace(ownerId);
    if (!latest) throw persistenceFailure("The latest cloud records could not be recovered.", error);
    return new WorkspaceConflictError({
      latestState: latest.state,
      latestRevision: latest.revision,
      latestUpdatedAt: latest.updatedAt,
      cause: error,
    });
  }

  function prepareWorkspaceMutation(state, previousState, versions, operationId = createOperationId()) {
    const base = canonicalState(previousState);
    const nextState = canonicalState(state);
    const { patch, expectedVersions, empty } = buildWorkspacePatch(base, nextState, versions);
    if (!empty) assertPatchSize(patch);
    if (!UUID_RE.test(operationId)) throw new TypeError("A valid operation UUID is required.");
    return { operationId, patch, expectedVersions, empty, state: nextState, previousState: base };
  }

  async function applyWorkspaceMutation(mutation, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    if (!mutation || mutation.empty) return { eventId: cache?.revision ?? 0, updatedAt: cache?.updatedAt ?? null };
    if (!UUID_RE.test(String(mutation.operationId || ""))) throw new TypeError("A valid operation UUID is required.");
    assertPatchSize(mutation.patch);
    const { data, error } = await cloud().rpc(SAVE_WORKSPACE_RPC, {
      p_expected_owner_id: ownerId,
      p_operation_id: mutation.operationId,
      p_patch: mutation.patch,
      p_expected_versions: mutation.expectedVersions,
    });
    if (error && isEntityConflict(error)) throw await conflictFrom(error, ownerId);
    if (error) throw persistenceFailure("Cloud records could not be saved.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The saved cloud change response was empty.");
    return {
      eventId: normalizeRevision(row.event_id),
      updatedAt: row.updated_at ?? null,
      alreadyApplied: Boolean(row.already_applied),
    };
  }

  async function saveWorkspace(
    state,
    _expectedRevision,
    expectedOwnerId,
    previousState,
    operationId = createOperationId(),
  ) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    if (!cache) await fetchWorkspace(ownerId);
    const base = previousState || cache.state;
    const mutation = prepareWorkspaceMutation(state, base, cache.versions, operationId);
    const { patch, expectedVersions, empty } = mutation;
    if (empty) return cache;
    const remotePatch = buildWorkspacePatch(base, cache.state, cache.versions).patch;
    if (workspacePatchesOverlap(patch, remotePatch)) {
      throw new WorkspaceConflictError({
        latestState: cache.state,
        latestRevision: cache.revision,
        latestUpdatedAt: cache.updatedAt,
      });
    }
    const result = await applyWorkspaceMutation({ ...mutation, expectedVersions }, ownerId);
    return adopt({
      state: applyWorkspacePatch(cache.state, patch),
      versions: advanceWorkspaceVersions(cache.versions, patch),
      revision: result.eventId,
      updatedAt: result.updatedAt,
    });
  }

  async function replaceWorkspace(state, expectedRevision, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const nextState = canonicalState(state);
    assertStateSize(nextState);
    const revision = normalizeRevision(expectedRevision);
    const { data, error } = await cloud().rpc(REPLACE_WORKSPACE_RPC, {
      p_expected_owner_id: ownerId,
      p_expected_revision: revision,
      p_state: nextState,
      p_confirmation: `replace:${revision}`,
    });
    if (error && isEntityConflict(error)) throw await conflictFrom(error, ownerId);
    if (error) throw persistenceFailure("The backup could not replace the cloud workspace.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The replacement cloud workspace response was empty.");
    return adopt({
      state: nextState,
      versions: normalizeVersions(row.versions || importVersionsForState(nextState)),
      revision: normalizeRevision(row.event_id),
      updatedAt: row.updated_at ?? null,
    });
  }

  async function findImportJob(fileHash, expectedOwnerId) {
    if (!SHA256_RE.test(String(fileHash || ""))) throw new TypeError("A valid SHA-256 file hash is required.");
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const { data, error } = await cloud()
      .from(IMPORT_JOBS_TABLE)
      .select("id, owner_id, file_hash, source_name, base_revision, result_revision, summary, created_at")
      .eq("owner_id", ownerId)
      .eq("file_hash", fileHash)
      .maybeSingle();
    if (error) throw persistenceFailure("Import history could not be checked.", error);
    if (!data) return null;
    return {
      id: data.id,
      ownerId: data.owner_id,
      fileHash: data.file_hash,
      sourceName: data.source_name,
      baseRevision: normalizeRevision(data.base_revision),
      resultRevision: normalizeRevision(data.result_revision),
      summary: data.summary || {},
      createdAt: data.created_at,
    };
  }

  async function applyWorkspaceImport(state, expectedRevision, expectedOwnerId, metadata = {}) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const nextState = canonicalState(state);
    assertStateSize(nextState);
    const revision = normalizeRevision(expectedRevision);
    const fileHash = String(metadata.fileHash || "");
    if (!SHA256_RE.test(fileHash)) throw new TypeError("A valid SHA-256 file hash is required.");
    const { data, error } = await cloud().rpc(APPLY_IMPORT_RPC, {
      p_expected_owner_id: ownerId,
      p_expected_revision: revision,
      p_state: nextState,
      p_file_hash: fileHash,
      p_source_name: String(metadata.sourceName || "").slice(0, 255),
      p_summary: metadata.summary && typeof metadata.summary === "object" ? metadata.summary : {},
      p_confirmation: `import:${revision}:${fileHash}`,
    });
    if (error && isEntityConflict(error)) throw await conflictFrom(error, ownerId);
    if (error) throw persistenceFailure("The records could not be imported.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The imported cloud workspace response was empty.");
    if (row.already_imported) {
      const latest = await fetchWorkspace(ownerId);
      if (!latest) throw new CloudPersistenceError("The imported cloud workspace could not be reloaded.");
      return { ...latest, alreadyImported: true };
    }
    const imported = adopt({
      state: nextState,
      versions: normalizeVersions(row.versions || importVersionsForState(nextState)),
      revision: normalizeRevision(row.event_id),
      updatedAt: row.updated_at ?? null,
    });
    return { ...imported, alreadyImported: false };
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
    const ownerId = expectedOwnerId || user.id;
    const { data, error } = await cloud().rpc(RESTORE_WORKSPACE_RPC, {
      p_expected_owner_id: ownerId,
      p_snapshot_id: snapshotId,
      p_expected_revision: normalizeRevision(expectedRevision),
    });
    if (error && isEntityConflict(error)) throw await conflictFrom(error, ownerId);
    if (error) throw persistenceFailure("The recovery copy could not be restored.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The restored cloud workspace response was empty.");
    return adopt(workspaceFromRow(row, ownerId));
  }

  async function resetWorkspace(expectedRevision, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const revision = normalizeRevision(expectedRevision);
    const { data, error } = await cloud().rpc(RESET_WORKSPACE_RPC, {
      p_expected_owner_id: ownerId,
      p_expected_revision: revision,
      p_confirmation: `reset:${revision}`,
    });
    if (error && isEntityConflict(error)) throw await conflictFrom(error, ownerId);
    if (error) throw persistenceFailure("The workspace could not be reset.", error);
    const row = firstRow(data);
    if (!row) throw new CloudPersistenceError("The reset workspace response was empty.");
    return adopt(workspaceFromRow(row, ownerId));
  }

  async function loadMissedEvents(ownerId) {
    if (!cache) return fetchWorkspace(ownerId);
    const { data, error } = await cloud()
      .from(WORKSPACE_CHANGE_EVENTS_TABLE)
      .select("revision, owner_id, patch, updated_at")
      .eq("owner_id", ownerId)
      .gt("revision", cache.revision)
      .order("revision", { ascending: true })
      .limit(101);
    if (error) throw persistenceFailure("Cloud live updates could not be loaded.", error);
    if ((data || []).length > 100 || (data || []).some((event) => event.patch?.reload)) {
      return fetchWorkspace(ownerId);
    }
    for (const event of data || []) {
      if (normalizeRevision(event.revision) <= cache.revision) continue;
      cache = {
        state: applyWorkspacePatch(cache.state, event.patch),
        versions: advanceWorkspaceVersions(cache.versions, event.patch),
        revision: normalizeRevision(event.revision),
        updatedAt: event.updated_at ?? null,
      };
    }
    return cache;
  }

  async function subscribeToWorkspace(onChange, { userId, onStatus, onError } = {}) {
    if (typeof onChange !== "function") throw new TypeError("subscribeToWorkspace requires an update callback.");
    const ownerId = (await requireUser(userId)).id;
    let active = true;
    let refreshTask = null;
    let refreshQueued = false;

    const refresh = () => {
      if (!active) return null;
      if (refreshTask) {
        refreshQueued = true;
        return refreshTask;
      }
      refreshQueued = false;
      refreshTask = loadMissedEvents(ownerId)
        .then((latest) => {
          if (active && latest) onChange(latest);
        })
        .catch((error) => {
          if (active) onError?.(error);
        })
        .finally(() => {
          refreshTask = null;
          if (active && refreshQueued) void refresh();
        });
      return refreshTask;
    };

    const channel = cloud()
      .channel(`workspace-events:${ownerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: WORKSPACE_CHANGE_EVENTS_TABLE,
          filter: `owner_id=eq.${ownerId}`,
        },
        (payload) => {
          if (!active || payload?.new?.owner_id !== ownerId) return;
          void refresh();
        },
      )
      .subscribe((status, error) => {
        if (!active) return;
        onStatus?.(status);
        if (status === "SUBSCRIBED") void refresh();
        if (error) onError?.(persistenceFailure("Cloud live updates disconnected.", error));
      });

    return async () => {
      if (!active) return;
      active = false;
      await cloud().removeChannel(channel);
    };
  }

  return {
    loadWorkspace,
    loadOrCreateWorkspace,
    prepareWorkspaceMutation,
    applyWorkspaceMutation,
    saveWorkspace,
    replaceWorkspace,
    findImportJob,
    applyWorkspaceImport,
    listRecoverySnapshots,
    loadRecoverySnapshot,
    restoreRecoverySnapshot,
    resetWorkspace,
    subscribeToWorkspace,
  };
}

export const workspaceRepository = createWorkspaceRepository(supabase, { allowWrites: cloudWritesEnabled });
