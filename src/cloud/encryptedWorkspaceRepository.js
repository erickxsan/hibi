import { deserializeState, MAX_BACKUP_BYTES } from "../domain/index.js";
import {
  canonicalWorkspaceHash,
  createImportFingerprint,
  createManifest,
  CRYPTO_PROTOCOL_VERSION,
  CRYPTO_SCHEMA_VERSION,
  decryptBackupPayload,
  decryptImportReceipt,
  decryptWorkspace,
  encryptBackupPayload,
  encryptImportReceipt,
  encryptEntity,
  encryptWorkspace,
  ENCRYPTED_COLLECTIONS,
  envelopeKey,
  parseRecoveryKey,
  recoveryKeyFingerprint,
  unwrapMasterKey,
  verifyManifest,
  verifyManifestMac,
  wipeBytes,
  WorkspaceCryptoError,
} from "../crypto/index.js";
import { applyWorkspacePatch, buildWorkspacePatch } from "./normalizedWorkspace.js";
import {
  CloudAuthenticationError,
  cloudWritesEnabled,
  requireCloudClient,
  retryJwtClockSkew,
  supabase,
} from "./client.js";
import { deviceRecoveryStore } from "./deviceRecoveryStore.js";
import { flushWorkspaceOutbox } from "./workspaceOutbox.js";
import {
  CloudPersistenceError,
  createOperationId,
  WorkspaceConflictError,
  workspaceRepository as legacyWorkspaceRepository,
} from "./workspaceRepository.js";

export const E2EE_PROFILE_TABLE = "workspace_encryption_profiles";
export const E2EE_WRAPPERS_TABLE = "workspace_key_wrappers";
export const E2EE_ENTITIES_TABLE = "encrypted_workspace_entities";
export const E2EE_EVENTS_TABLE = "encrypted_workspace_change_events";
export const E2EE_SNAPSHOTS_TABLE = "encrypted_workspace_snapshots";
export const E2EE_IMPORT_RECEIPTS_TABLE = "encrypted_workspace_import_receipts";
export const LOAD_E2EE_WORKSPACE_RPC = "load_encrypted_workspace";
export const APPLY_E2EE_MUTATION_RPC = "apply_encrypted_workspace_mutation";
export const REPLACE_E2EE_WORKSPACE_RPC = "replace_encrypted_workspace";
export const ROTATE_E2EE_WORKSPACE_KEY_RPC = "rotate_encrypted_workspace_key";
export const E2EE_ROLLOUT_STATUS_RPC = "workspace_e2ee_rollout_status";

const BEGIN_MIGRATION_RPC = "begin_workspace_e2ee_migration";
const STAGE_ENTITIES_RPC = "stage_workspace_e2ee_entities";
const STAGE_SNAPSHOT_RPC = "stage_workspace_e2ee_snapshot";
const STAGE_IMPORT_RECEIPT_RPC = "stage_workspace_e2ee_import_receipt";
const LOAD_STAGING_RPC = "load_workspace_e2ee_migration_staging";
const FINALIZE_MIGRATION_RPC = "finalize_workspace_e2ee_migration";
const ABORT_MIGRATION_RPC = "abort_workspace_e2ee_migration";
const ADD_WRAPPER_RPC = "add_workspace_key_wrapper";
const REPLACE_PASSWORD_WRAPPER_RPC = "replace_workspace_password_wrapper";
const REVOKE_WRAPPER_RPC = "revoke_workspace_key_wrapper";
const TOUCH_WRAPPER_RPC = "touch_workspace_key_wrapper";
const BEGIN_STAGED_ROTATION_RPC = "begin_staged_workspace_key_rotation";
const STAGE_ROTATION_ENTITIES_RPC = "stage_workspace_key_rotation_entities";
const STAGE_ROTATION_SNAPSHOT_RPC = "stage_workspace_key_rotation_snapshot";
const STAGE_ROTATION_IMPORTS_RPC = "stage_workspace_key_rotation_import_receipts";
const STAGE_ROTATION_WRAPPERS_RPC = "stage_workspace_key_rotation_wrappers";
const FINALIZE_STAGED_ROTATION_RPC = "finalize_staged_workspace_key_rotation";
const ABORT_STAGED_ROTATION_RPC = "abort_staged_workspace_key_rotation";
const MAX_MUTATION_BYTES = 5 * 1024 * 1024;

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function canonicalState(value) {
  return deserializeState(JSON.stringify(value));
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeRevision(value) {
  const revision = Number(value ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new CloudPersistenceError("The encrypted workspace has an invalid synchronization revision.");
  }
  return revision;
}

function normalizeEnvelope(value) {
  const envelope = {
    collection: String(value?.collection || ""),
    entityId: String(value?.entityId ?? value?.entity_id ?? ""),
    entityRevision: normalizeRevision(value?.entityRevision ?? value?.entity_revision),
    schemaVersion: Number(value?.schemaVersion ?? value?.schema_version),
    keyVersion: Number(value?.keyVersion ?? value?.key_version),
    nonce: String(value?.nonce || ""),
    ciphertext: String(value?.ciphertext || ""),
  };
  if (!envelope.collection || !envelope.entityId || envelope.entityRevision < 1) {
    throw new WorkspaceCryptoError("The server returned a malformed encrypted entity envelope.");
  }
  return envelope;
}

function normalizeWrapper(row) {
  const defaultLabel =
    row.wrapper_type === "password"
      ? "Encryption password"
      : row.wrapper_type === "passkey"
        ? "Passkey"
        : "Recovery key";
  return {
    wrapperId: row.wrapper_id,
    type: row.wrapper_type,
    label: row.label || defaultLabel,
    credentialId: row.credential_id,
    prfSalt: row.prf_salt,
    transports: row.transports || [],
    kdfAlgorithm: row.kdf_algorithm,
    kdfIterations: Number(row.kdf_iterations || 0),
    kdfSalt: row.kdf_salt,
    recoveryFingerprint: row.recovery_fingerprint,
    wrapperVersion: Number(row.wrapper_version),
    keyVersion: Number(row.key_version),
    nonce: row.nonce,
    wrappedKey: row.wrapped_key,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    workspaceCryptoId: row.workspace_crypto_id,
    protocolVersion: Number(row.protocol_version),
    schemaVersion: Number(row.schema_version),
    activeKeyVersion: Number(row.active_key_version),
    workspaceRevision: normalizeRevision(row.workspace_revision),
    migrationStatus: row.migration_status,
    manifest: row.manifest || null,
    activatedAt: row.activated_at,
    updatedAt: row.updated_at,
  };
}

function persistenceFailure(message, error) {
  if (error instanceof WorkspaceCryptoError || error instanceof WorkspaceConflictError) return error;
  const provider = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  if (provider.includes("account_deletion_pending")) {
    const pending = new CloudPersistenceError("This account is pending deletion.", { cause: error });
    pending.code = "account_deletion_pending";
    return pending;
  }
  if (provider.includes("encryption_required")) {
    const required = new CloudPersistenceError("This workspace requires the encrypted Hibi client.", { cause: error });
    required.code = "encryption_required";
    return required;
  }
  return new CloudPersistenceError(error?.message || message, { cause: error });
}

function envelopeMap(envelopes) {
  return new Map(envelopes.map((envelope) => [envelopeKey(envelope.collection, envelope.entityId), envelope]));
}

function versionsFromEnvelopes(envelopes) {
  const versions = Object.fromEntries(["settings", ...ENCRYPTED_COLLECTIONS].map((collection) => [collection, {}]));
  for (const envelope of envelopes) versions[envelope.collection][envelope.entityId] = envelope.entityRevision;
  return versions;
}

function envelopesAfterMutation(currentEnvelopes, upserts, deletes) {
  const next = envelopeMap(currentEnvelopes);
  for (const deletion of deletes) next.delete(envelopeKey(deletion.collection, deletion.entityId));
  for (const envelope of upserts) next.set(envelopeKey(envelope.collection, envelope.entityId), envelope);
  return [...next.values()];
}

function touchedEntitiesStillCurrent(mutation, latest) {
  for (const envelope of mutation.upserts) {
    const latestRevision = Number(latest.versions?.[envelope.collection]?.[envelope.entityId] || 0);
    if (latestRevision !== envelope.entityRevision - 1) return false;
  }
  for (const deletion of mutation.deletes) {
    const latestRevision = Number(latest.versions?.[deletion.collection]?.[deletion.entityId] || 0);
    if (latestRevision !== deletion.expectedRevision) return false;
  }
  return true;
}

function assertBackupSize(value) {
  if (byteLength(value) > MAX_BACKUP_BYTES * 5) {
    throw new CloudPersistenceError("This encrypted workspace is larger than the 25 MB safety limit.");
  }
}

export function createEncryptedWorkspaceRepository(
  client = supabase,
  {
    allowWrites = cloudWritesEnabled,
    legacyRepository = legacyWorkspaceRepository,
    deviceStore = deviceRecoveryStore,
  } = {},
) {
  const cloud = () => requireCloudClient(client);
  let cache = null;

  function requireWritesEnabled() {
    if (!allowWrites) {
      throw new CloudPersistenceError(
        "Encrypted cloud writes are disabled on this preview or development origin. Open the official Hibi site.",
      );
    }
  }

  async function requireUser(expectedOwnerId) {
    const { data, error } = await cloud().auth.getUser();
    if (error) throw new CloudAuthenticationError(error.message, { cause: error });
    if (!data?.user) throw new CloudAuthenticationError();
    if (expectedOwnerId && data.user.id !== expectedOwnerId) {
      throw new CloudAuthenticationError("The active account changed before this encrypted operation completed.");
    }
    return data.user;
  }

  async function loadBootstrapOnce(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const [profileResult, wrappersResult, rolloutResult] = await Promise.all([
      cloud().from(E2EE_PROFILE_TABLE).select("*").eq("owner_id", ownerId).maybeSingle(),
      cloud().from(E2EE_WRAPPERS_TABLE).select("*").eq("owner_id", ownerId).order("created_at"),
      cloud().rpc(E2EE_ROLLOUT_STATUS_RPC, { p_expected_owner_id: ownerId }),
    ]);
    if (profileResult.error) throw persistenceFailure("Encryption status could not be loaded.", profileResult.error);
    if (wrappersResult.error) throw persistenceFailure("Workspace keys could not be loaded.", wrappersResult.error);
    if (rolloutResult.error)
      throw persistenceFailure("Encryption rollout status could not be loaded.", rolloutResult.error);
    const rollout = firstRow(rolloutResult.data);
    return {
      profile: normalizeProfile(profileResult.data),
      wrappers: (wrappersResult.data || []).map(normalizeWrapper),
      rolloutEnabled: Boolean(rollout?.enabled || profileResult.data),
      rolloutMode: rollout?.rollout_mode || "disabled",
    };
  }

  async function loadBootstrap(expectedOwnerId) {
    return retryJwtClockSkew(() => loadBootstrapOnce(expectedOwnerId), {
      refreshSession: async () => {
        const { error } = await cloud().auth.refreshSession();
        if (error)
          throw new CloudAuthenticationError(error.message || "The secure session could not be renewed.", {
            cause: error,
          });
      },
    });
  }

  async function workspaceFromRpcRow(row, session, { minimumRevision = 0, expectedPreviousRoot } = {}) {
    if (!row) throw new CloudPersistenceError("The encrypted workspace response was empty.");
    if (row.workspace_crypto_id !== session.workspaceCryptoId) {
      throw new WorkspaceCryptoError("The downloaded workspace does not match the unlocked workspace key.");
    }
    const envelopes = (row.envelopes || []).map(normalizeEnvelope);
    await verifyManifest({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      envelopes,
      manifest: row.manifest,
      minimumRevision,
      expectedPreviousRoot,
    });
    const decrypted = await decryptWorkspace({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      envelopes,
    });
    const workspace = {
      state: canonicalState(decrypted.state),
      versions: decrypted.versions,
      revision: normalizeRevision(row.workspace_revision),
      updatedAt: row.updated_at || null,
      envelopes,
      manifest: row.manifest,
      workspaceCryptoId: row.workspace_crypto_id,
      keyVersion: Number(row.active_key_version),
    };
    cache = workspace;
    return workspace;
  }

  async function loadWorkspace(session, expectedOwnerId, integrity = {}) {
    const user = await requireUser(expectedOwnerId);
    const { data, error } = await cloud().rpc(LOAD_E2EE_WORKSPACE_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
    });
    if (error) throw persistenceFailure("Encrypted cloud records could not be loaded.", error);
    const row = firstRow(data);
    if (!row) return null;
    if (row.migration_status !== "active") {
      const migration = new CloudPersistenceError("Workspace encryption migration is incomplete.");
      migration.code = "migration_incomplete";
      throw migration;
    }
    const workspace = await workspaceFromRpcRow(row, session, { minimumRevision: integrity.revision || 0 });
    if (integrity.revision === workspace.revision && integrity.root && integrity.root !== workspace.manifest.root) {
      throw new WorkspaceCryptoError("The server returned a different root for an already verified revision.", {
        code: "rollback_detected",
      });
    }
    if (integrity.revision > 0 && integrity.revision < workspace.revision) {
      const { data: events, error: chainError } = await cloud()
        .from(E2EE_EVENTS_TABLE)
        .select("workspace_revision, manifest")
        .eq("owner_id", expectedOwnerId || user.id)
        .gt("workspace_revision", integrity.revision)
        .lte("workspace_revision", workspace.revision)
        .order("workspace_revision", { ascending: true })
        .limit(101);
      if (chainError) throw persistenceFailure("The encrypted revision chain could not be checked.", chainError);
      let expectedRevision = integrity.revision + 1;
      let previousRoot = integrity.root;
      for (const event of events || []) {
        if (
          normalizeRevision(event.workspace_revision) !== expectedRevision ||
          event.manifest?.previousRoot !== previousRoot
        ) {
          throw new WorkspaceCryptoError("The encrypted workspace revision chain has a gap or fork.", {
            code: "revision_chain_mismatch",
          });
        }
        await verifyManifestMac({
          masterKey: session.masterKey,
          workspaceCryptoId: session.workspaceCryptoId,
          manifest: event.manifest,
        });
        previousRoot = event.manifest.root;
        expectedRevision += 1;
      }
      if (expectedRevision !== workspace.revision + 1 || previousRoot !== workspace.manifest.root) {
        throw new WorkspaceCryptoError("Hibi cannot prove continuity from this device's last verified revision.", {
          code: "revision_chain_mismatch",
        });
      }
    }
    return workspace;
  }

  async function prepareMutation({ state, previousState, workspace, session, operationId = createOperationId() }) {
    const nextState = canonicalState(state);
    const baseState = canonicalState(previousState || workspace.state);
    const { patch, empty } = buildWorkspacePatch(baseState, nextState, workspace.versions);
    if (empty) return { empty: true, state: nextState };
    const upserts = [];
    const deletes = [];
    if (patch.settings) {
      upserts.push(
        await encryptEntity({
          masterKey: session.masterKey,
          workspaceCryptoId: session.workspaceCryptoId,
          collection: "settings",
          entityId: "__settings__",
          entityRevision: Number(workspace.versions.settings?.__settings__ || 0) + 1,
          keyVersion: session.keyVersion,
          value: { workspaceVersion: nextState.version, settings: nextState.settings },
        }),
      );
    }
    for (const collection of ENCRYPTED_COLLECTIONS) {
      for (const { data } of patch[collection]?.upserts || []) {
        upserts.push(
          await encryptEntity({
            masterKey: session.masterKey,
            workspaceCryptoId: session.workspaceCryptoId,
            collection,
            entityId: String(data.id),
            entityRevision: Number(workspace.versions[collection]?.[data.id] || 0) + 1,
            keyVersion: session.keyVersion,
            value: data,
          }),
        );
      }
      for (const entityId of patch[collection]?.deletes || []) {
        deletes.push({
          collection,
          entityId,
          expectedRevision: Number(workspace.versions[collection]?.[entityId] || 0),
        });
      }
    }
    const envelopes = envelopesAfterMutation(workspace.envelopes, upserts, deletes);
    const manifest = await createManifest({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      envelopes,
      workspaceRevision: workspace.revision + 1,
      previousRoot: workspace.manifest.root,
      operationId,
      keyVersion: session.keyVersion,
    });
    const mutation = {
      operationId,
      upserts,
      deletes,
      manifest,
      state: nextState,
      previousState: baseState,
      empty: false,
    };
    if (byteLength(mutation) > MAX_MUTATION_BYTES) {
      throw new CloudPersistenceError("This single encrypted change is too large. Save it in smaller batches.");
    }
    return mutation;
  }

  async function submitMutation(mutation, workspace, session, ownerId) {
    const { data, error } = await cloud().rpc(APPLY_E2EE_MUTATION_RPC, {
      p_expected_owner_id: ownerId,
      p_expected_workspace_revision: workspace.revision,
      p_operation_id: mutation.operationId,
      p_upserts: mutation.upserts,
      p_deletes: mutation.deletes,
      p_manifest: mutation.manifest,
    });
    if (error) throw error;
    const row = firstRow(data);
    if (row?.already_applied) return loadWorkspace(session, ownerId);
    const envelopes = envelopesAfterMutation(workspace.envelopes, mutation.upserts, mutation.deletes);
    const next = {
      state: mutation.state,
      versions: versionsFromEnvelopes(envelopes),
      revision: normalizeRevision(row?.result_revision),
      updatedAt: row?.updated_at || null,
      envelopes,
      manifest: mutation.manifest,
      workspaceCryptoId: workspace.workspaceCryptoId,
      keyVersion: session.keyVersion,
    };
    cache = next;
    return next;
  }

  async function applyMutation(mutation, session, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    if (mutation.empty) return cache;
    const base = cache || (await loadWorkspace(session, ownerId));
    try {
      return await submitMutation(mutation, base, session, ownerId);
    } catch (error) {
      const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
      if (
        error?.code !== "40001" &&
        !text.includes("workspace_revision_conflict") &&
        !text.includes("workspace_entity_conflict")
      ) {
        throw persistenceFailure("Encrypted cloud records could not be saved.", error);
      }
      const latest = await loadWorkspace(session, ownerId);
      if (!touchedEntitiesStillCurrent(mutation, latest)) {
        throw new WorkspaceConflictError({
          latestState: latest.state,
          latestRevision: latest.revision,
          latestUpdatedAt: latest.updatedAt,
          cause: error,
        });
      }
      const rebasedEnvelopes = envelopesAfterMutation(latest.envelopes, mutation.upserts, mutation.deletes);
      const rebased = {
        ...mutation,
        state: applyWorkspacePatch(
          latest.state,
          buildWorkspacePatch(mutation.previousState, mutation.state, latest.versions).patch,
        ),
        previousState: latest.state,
        manifest: await createManifest({
          masterKey: session.masterKey,
          workspaceCryptoId: session.workspaceCryptoId,
          envelopes: rebasedEnvelopes,
          workspaceRevision: latest.revision + 1,
          previousRoot: latest.manifest.root,
          operationId: mutation.operationId,
          keyVersion: session.keyVersion,
        }),
      };
      return submitMutation(rebased, latest, session, ownerId).catch((retryError) => {
        throw persistenceFailure("The encrypted change conflicted again while rebasing.", retryError);
      });
    }
  }

  function optimisticWorkspace(workspace, mutation, session) {
    const envelopes = envelopesAfterMutation(workspace.envelopes, mutation.upserts, mutation.deletes);
    return {
      ...workspace,
      state: mutation.state,
      versions: versionsFromEnvelopes(envelopes),
      revision: workspace.revision + 1,
      envelopes,
      manifest: mutation.manifest,
      keyVersion: session.keyVersion,
    };
  }

  async function replaceWorkspace(state, session, expectedOwnerId, reason = "replace", importMetadata = null) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const current = cache || (await loadWorkspace(session, ownerId));
    const nextState = canonicalState(state);
    const envelopes = await encryptWorkspace({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      state: nextState,
      keyVersion: session.keyVersion,
    });
    assertBackupSize(envelopes);
    const operationId = createOperationId();
    const manifest = await createManifest({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      envelopes,
      workspaceRevision: current.revision + 1,
      previousRoot: current.manifest.root,
      operationId,
      keyVersion: session.keyVersion,
    });
    let importReceipt = null;
    if (reason === "import") {
      const fingerprint = await createImportFingerprint({
        masterKey: session.masterKey,
        workspaceCryptoId: session.workspaceCryptoId,
        fileHash: importMetadata?.fileHash,
        keyVersion: session.keyVersion,
      });
      importReceipt = {
        ...(await encryptImportReceipt({
          masterKey: session.masterKey,
          workspaceCryptoId: session.workspaceCryptoId,
          fingerprint,
          keyVersion: session.keyVersion,
          value: {
            fileHash: importMetadata.fileHash,
            sourceName: String(importMetadata.sourceName || "").slice(0, 255),
            summary: importMetadata.summary && typeof importMetadata.summary === "object" ? importMetadata.summary : {},
            baseRevision: current.revision,
            resultRevision: current.revision + 1,
            createdAt: new Date().toISOString(),
          },
        })),
        resultRevision: current.revision + 1,
      };
    }
    const { data, error } = await cloud().rpc(REPLACE_E2EE_WORKSPACE_RPC, {
      p_expected_owner_id: ownerId,
      p_expected_workspace_revision: current.revision,
      p_operation_id: operationId,
      p_reason: reason,
      p_envelopes: envelopes,
      p_manifest: manifest,
      p_import_receipt: importReceipt,
    });
    if (error) {
      const text = `${error.code || ""} ${error.message || ""}`.toLowerCase();
      if (error.code === "40001" || text.includes("workspace_revision_conflict")) {
        const latest = await loadWorkspace(session, ownerId);
        throw new WorkspaceConflictError({
          latestState: latest.state,
          latestRevision: latest.revision,
          latestUpdatedAt: latest.updatedAt,
          cause: error,
        });
      }
      throw persistenceFailure("The encrypted workspace could not be replaced.", error);
    }
    const row = firstRow(data);
    if (row?.already_applied) {
      cache = null;
      return { ...(await loadWorkspace(session, ownerId)), alreadyImported: true };
    }
    cache = {
      state: nextState,
      versions: versionsFromEnvelopes(envelopes),
      revision: normalizeRevision(row?.result_revision),
      updatedAt: row?.updated_at || null,
      envelopes,
      manifest,
      workspaceCryptoId: session.workspaceCryptoId,
      keyVersion: session.keyVersion,
    };
    return cache;
  }

  async function findImportJob(fileHash, session, expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const fingerprint = await createImportFingerprint({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      fileHash,
      keyVersion: session.keyVersion,
    });
    const { data, error } = await cloud()
      .from(E2EE_IMPORT_RECEIPTS_TABLE)
      .select(
        "owner_id, import_fingerprint, result_revision, key_version, nonce, ciphertext, original_created_at, created_at",
      )
      .eq("owner_id", ownerId)
      .eq("import_fingerprint", fingerprint)
      .maybeSingle();
    if (error) throw persistenceFailure("Encrypted import history could not be checked.", error);
    if (!data) return null;
    const details = await decryptImportReceipt({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      receipt: {
        fingerprint: data.import_fingerprint,
        keyVersion: Number(data.key_version),
        nonce: data.nonce,
        ciphertext: data.ciphertext,
      },
    });
    return {
      ...details,
      ownerId: data.owner_id,
      resultRevision: normalizeRevision(data.result_revision),
      createdAt: data.original_created_at || details.createdAt || data.created_at,
    };
  }

  async function listSnapshots(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const { data, error } = await cloud()
      .from(E2EE_SNAPSHOTS_TABLE)
      .select("id, owner_id, source_revision, reason, original_created_at, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw persistenceFailure("Encrypted recovery history could not be loaded.", error);
    return (data || []).map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      revision: normalizeRevision(row.source_revision),
      reason: row.reason,
      capturedAt: row.original_created_at || row.created_at,
      source: "encrypted-cloud-snapshot",
      encrypted: true,
    }));
  }

  async function loadSnapshot(snapshotId, session, expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const { data, error } = await cloud()
      .from(E2EE_SNAPSHOTS_TABLE)
      .select("*")
      .eq("owner_id", ownerId)
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) throw persistenceFailure("The encrypted recovery copy could not be loaded.", error);
    if (!data) return null;
    const envelopes = (data.envelopes || []).map(normalizeEnvelope);
    await verifyManifest({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      envelopes,
      manifest: data.manifest,
    });
    const { state } = await decryptWorkspace({
      masterKey: session.masterKey,
      workspaceCryptoId: session.workspaceCryptoId,
      envelopes,
    });
    return {
      id: data.id,
      state: canonicalState(state),
      revision: normalizeRevision(data.source_revision),
      reason: data.reason,
      capturedAt: data.original_created_at || data.created_at,
      source: "encrypted-cloud-snapshot",
      encrypted: true,
    };
  }

  async function addWrapper(wrapper, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const { data, error } = await cloud().rpc(ADD_WRAPPER_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_wrapper: wrapper,
    });
    if (error) throw persistenceFailure("The workspace key could not be added.", error);
    return data;
  }

  async function revokeWrapper(wrapperId, expectedOwnerId) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const { error } = await cloud().rpc(REVOKE_WRAPPER_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_wrapper_id: wrapperId,
    });
    if (error) throw persistenceFailure("The workspace key could not be revoked.", error);
  }

  async function replacePasswordWrapper(currentWrapperId, wrapper, expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const { error } = await cloud().rpc(REPLACE_PASSWORD_WRAPPER_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_current_wrapper_id: currentWrapperId,
      p_wrapper: wrapper,
    });
    if (error) throw persistenceFailure("The encryption password could not be changed.", error);
  }

  async function touchWrapper(wrapperId, expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const { error } = await cloud().rpc(TOUCH_WRAPPER_RPC, {
      p_expected_owner_id: expectedOwnerId || user.id,
      p_wrapper_id: wrapperId,
    });
    if (error) throw persistenceFailure("The workspace key usage date could not be updated.", error);
  }

  async function abortMigration(expectedOwnerId) {
    const user = await requireUser(expectedOwnerId);
    const { error } = await cloud().rpc(ABORT_MIGRATION_RPC, { p_expected_owner_id: expectedOwnerId || user.id });
    if (error) throw persistenceFailure("The interrupted encrypted migration could not be reset.", error);
    cache = null;
  }

  async function migrateLegacyWorkspace({ user, masterKey, workspaceCryptoId, keyWrapper, onProgress }) {
    requireWritesEnabled();
    const queued = await deviceStore.listMutations(user.id);
    if (queued.length) {
      const currentBootstrap = await loadBootstrap(user.id).catch(() => null);
      if (currentBootstrap?.profile?.migrationStatus === "migration_started") {
        const { error: abortError } = await cloud().rpc(ABORT_MIGRATION_RPC, { p_expected_owner_id: user.id });
        if (abortError)
          throw persistenceFailure("The interrupted encrypted migration could not be restarted.", abortError);
      }
      if (globalThis.navigator?.onLine === false) {
        const offline = new CloudPersistenceError("Reconnect so pending changes can sync before encryption starts.");
        offline.code = "legacy_outbox_pending";
        throw offline;
      }
      onProgress?.("syncing", { total: queued.length });
      const flushed = await flushWorkspaceOutbox({
        ownerId: user.id,
        store: deviceStore,
        repository: legacyRepository,
      });
      if (flushed.status !== "saved" || (await deviceStore.listMutations(user.id)).length) {
        const conflict = new CloudPersistenceError(
          "Resolve the pending workspace conflict before enabling end-to-end encryption.",
        );
        conflict.code = "legacy_outbox_conflict";
        throw conflict;
      }
    }
    const [legacy, legacySnapshots, localPoints, legacyImports] = await Promise.all([
      legacyRepository.loadOrCreateWorkspace(user.id),
      legacyRepository.listRecoverySnapshots(user.id),
      deviceStore.list(user.id).catch(() => []),
      cloud()
        .from("workspace_import_jobs")
        .select("file_hash, source_name, base_revision, result_revision, summary, created_at")
        .eq("owner_id", user.id)
        .then(({ data, error }) => {
          if (error) throw persistenceFailure("Import history could not be prepared for encryption.", error);
          return data || [];
        }),
    ]);
    const [cloudCopies, localCopies] = await Promise.all([
      Promise.all(legacySnapshots.map((point) => legacyRepository.loadRecoverySnapshot(point.id, user.id))),
      Promise.all(localPoints.map((point) => deviceStore.load(user.id, point.id))),
    ]);
    const migrationSnapshots = [
      ...cloudCopies.filter(Boolean),
      ...localCopies.filter(Boolean).map((copy) => ({
        ...copy,
        id: createOperationId(),
        revision: Number.isSafeInteger(copy.revision) ? copy.revision : legacy.revision,
        reason: copy.source || "device-recovery",
      })),
    ];
    const sourceHash = canonicalWorkspaceHash(legacy.state);
    const envelopes = await encryptWorkspace({
      masterKey,
      workspaceCryptoId,
      state: legacy.state,
      versions: legacy.versions,
    });
    const operationId = createOperationId();
    const manifest = await createManifest({
      masterKey,
      workspaceCryptoId,
      envelopes,
      workspaceRevision: 1,
      previousRoot: null,
      operationId,
    });
    onProgress?.("starting");
    const { error: beginError } = await cloud().rpc(BEGIN_MIGRATION_RPC, {
      p_expected_owner_id: user.id,
      p_workspace_crypto_id: workspaceCryptoId,
      p_protocol_version: CRYPTO_PROTOCOL_VERSION,
      p_schema_version: CRYPTO_SCHEMA_VERSION,
      p_wrapper: keyWrapper,
    });
    if (beginError) throw persistenceFailure("Encrypted migration could not start.", beginError);
    try {
      for (let index = 0; index < envelopes.length; index += 100) {
        onProgress?.("uploading", { completed: index, total: envelopes.length });
        const { error } = await cloud().rpc(STAGE_ENTITIES_RPC, {
          p_expected_owner_id: user.id,
          p_workspace_crypto_id: workspaceCryptoId,
          p_envelopes: envelopes.slice(index, index + 100),
        });
        if (error) throw persistenceFailure("Encrypted records could not be staged.", error);
      }
      const expectedSnapshots = new Map();
      for (const snapshot of migrationSnapshots) {
        expectedSnapshots.set(snapshot.id, {
          hash: canonicalWorkspaceHash(canonicalState(snapshot.state)),
          revision: snapshot.revision,
          capturedAt: snapshot.capturedAt,
        });
        const snapshotEnvelopes = await encryptWorkspace({
          masterKey,
          workspaceCryptoId,
          state: snapshot.state,
        });
        const snapshotManifest = await createManifest({
          masterKey,
          workspaceCryptoId,
          envelopes: snapshotEnvelopes,
          workspaceRevision: snapshot.revision,
          previousRoot: null,
          operationId: createOperationId(),
        });
        const { error } = await cloud().rpc(STAGE_SNAPSHOT_RPC, {
          p_expected_owner_id: user.id,
          p_workspace_crypto_id: workspaceCryptoId,
          p_snapshot: {
            id: snapshot.id,
            sourceRevision: snapshot.revision,
            envelopes: snapshotEnvelopes,
            manifest: snapshotManifest,
          },
          p_original_created_at: snapshot.capturedAt,
        });
        if (error) throw persistenceFailure("An encrypted recovery snapshot could not be staged.", error);
      }
      const expectedImports = new Map();
      for (const job of legacyImports) {
        const value = {
          fileHash: job.file_hash,
          sourceName: job.source_name || "",
          baseRevision: normalizeRevision(job.base_revision),
          resultRevision: normalizeRevision(job.result_revision),
          summary: job.summary || {},
          createdAt: job.created_at,
        };
        const fingerprint = await createImportFingerprint({ masterKey, workspaceCryptoId, fileHash: job.file_hash });
        const receipt = {
          ...(await encryptImportReceipt({ masterKey, workspaceCryptoId, fingerprint, value })),
          resultRevision: value.resultRevision,
        };
        expectedImports.set(fingerprint, canonicalWorkspaceHash(value));
        const { error } = await cloud().rpc(STAGE_IMPORT_RECEIPT_RPC, {
          p_expected_owner_id: user.id,
          p_workspace_crypto_id: workspaceCryptoId,
          p_receipt: receipt,
          p_original_created_at: job.created_at,
        });
        if (error) throw persistenceFailure("Encrypted import history could not be staged.", error);
      }
      onProgress?.("verifying");
      const { data: stagedData, error: stagedError } = await cloud().rpc(LOAD_STAGING_RPC, {
        p_expected_owner_id: user.id,
      });
      if (stagedError) throw persistenceFailure("Encrypted migration staging could not be verified.", stagedError);
      const staged = firstRow(stagedData);
      const stagedEnvelopes = (staged?.envelopes || []).map(normalizeEnvelope);
      await verifyManifest({ masterKey, workspaceCryptoId, envelopes: stagedEnvelopes, manifest });
      const decrypted = await decryptWorkspace({ masterKey, workspaceCryptoId, envelopes: stagedEnvelopes });
      if (canonicalWorkspaceHash(canonicalState(decrypted.state)) !== sourceHash) {
        throw new WorkspaceCryptoError("Encrypted migration verification did not reproduce the original workspace.");
      }
      for (const snapshot of staged?.snapshots || []) {
        const expected = expectedSnapshots.get(snapshot.id);
        if (!expected || Number(snapshot.sourceRevision) !== expected.revision) {
          throw new WorkspaceCryptoError(
            "An encrypted recovery snapshot changed identity or revision during migration.",
          );
        }
        if (Date.parse(snapshot.originalCreatedAt || "") !== Date.parse(expected.capturedAt || "")) {
          throw new WorkspaceCryptoError("An encrypted recovery snapshot changed its original date during migration.");
        }
        const snapshotEnvelopes = (snapshot.envelopes || []).map(normalizeEnvelope);
        await verifyManifest({
          masterKey,
          workspaceCryptoId,
          envelopes: snapshotEnvelopes,
          manifest: snapshot.manifest,
        });
        const snapshotPlaintext = await decryptWorkspace({
          masterKey,
          workspaceCryptoId,
          envelopes: snapshotEnvelopes,
        });
        if (canonicalWorkspaceHash(canonicalState(snapshotPlaintext.state)) !== expected.hash) {
          throw new WorkspaceCryptoError("Encrypted migration did not reproduce an original recovery snapshot.");
        }
        expectedSnapshots.delete(snapshot.id);
      }
      if (expectedSnapshots.size) {
        throw new WorkspaceCryptoError("Encrypted migration staging is missing one or more recovery snapshots.");
      }
      for (const receipt of staged?.import_receipts || []) {
        const expectedHash = expectedImports.get(receipt.fingerprint);
        if (!expectedHash) throw new WorkspaceCryptoError("Encrypted migration returned unexpected import history.");
        const details = await decryptImportReceipt({ masterKey, workspaceCryptoId, receipt });
        if (canonicalWorkspaceHash(details) !== expectedHash) {
          throw new WorkspaceCryptoError("Encrypted migration did not reproduce the original import history.");
        }
        expectedImports.delete(receipt.fingerprint);
      }
      if (expectedImports.size)
        throw new WorkspaceCryptoError("Encrypted migration staging is missing import history.");
      onProgress?.("finalizing");
      const { error: finalizeError } = await cloud().rpc(FINALIZE_MIGRATION_RPC, {
        p_expected_owner_id: user.id,
        p_workspace_crypto_id: workspaceCryptoId,
        p_expected_entity_count: envelopes.length,
        p_manifest: manifest,
      });
      if (finalizeError) throw persistenceFailure("Encrypted migration could not be finalized.", finalizeError);
      cache = null;
      onProgress?.("complete");
      return { sourceState: legacy.state, sourceRevision: legacy.revision, envelopes, manifest };
    } catch (error) {
      const bootstrap = await loadBootstrap(user.id).catch(() => null);
      if (bootstrap?.profile?.migrationStatus !== "active") {
        try {
          await cloud().rpc(ABORT_MIGRATION_RPC, { p_expected_owner_id: user.id });
        } catch {
          // Cleanup is best-effort. Preserve the migration error that explains why activation failed.
        }
      }
      throw error;
    }
  }

  async function rotateWorkspaceKey({ oldSession, newMasterKey, wrappers, expectedOwnerId, onProgress }) {
    requireWritesEnabled();
    const user = await requireUser(expectedOwnerId);
    const ownerId = expectedOwnerId || user.id;
    const current = cache || (await loadWorkspace(oldSession, ownerId));
    const keyVersion = current.keyVersion + 1;
    const operationId = createOperationId();
    onProgress?.("Encrypting active records with the new master key…");
    const envelopes = await encryptWorkspace({
      masterKey: newMasterKey,
      workspaceCryptoId: oldSession.workspaceCryptoId,
      state: current.state,
      keyVersion,
    });
    const manifest = await createManifest({
      masterKey: newMasterKey,
      workspaceCryptoId: oldSession.workspaceCryptoId,
      envelopes,
      workspaceRevision: current.revision + 1,
      previousRoot: current.manifest.root,
      operationId,
      keyVersion,
    });
    const { error: beginError } = await cloud().rpc(BEGIN_STAGED_ROTATION_RPC, {
      p_expected_owner_id: ownerId,
      p_expected_workspace_revision: current.revision,
      p_operation_id: operationId,
      p_manifest: manifest,
    });
    if (beginError) throw persistenceFailure("Emergency workspace key rotation could not start.", beginError);
    let data;
    try {
      for (let index = 0; index < envelopes.length; index += 100) {
        onProgress?.(`Staging rotated records ${index}/${envelopes.length}…`);
        const { error } = await cloud().rpc(STAGE_ROTATION_ENTITIES_RPC, {
          p_expected_owner_id: ownerId,
          p_operation_id: operationId,
          p_envelopes: envelopes.slice(index, index + 100),
        });
        if (error) throw persistenceFailure("Rotated records could not be staged.", error);
      }

      const points = await listSnapshots(ownerId);
      let completed = 0;
      for (const point of points) {
        onProgress?.(`Re-encrypting recovery snapshots ${completed}/${points.length + 1}…`);
        const copy = await loadSnapshot(point.id, oldSession, ownerId);
        if (!copy) continue;
        const snapshotEnvelopes = await encryptWorkspace({
          masterKey: newMasterKey,
          workspaceCryptoId: oldSession.workspaceCryptoId,
          state: copy.state,
          keyVersion,
        });
        const snapshot = {
          id: copy.id,
          sourceRevision: copy.revision,
          originalCreatedAt: copy.capturedAt,
          keyVersion,
          envelopes: snapshotEnvelopes,
          manifest: await createManifest({
            masterKey: newMasterKey,
            workspaceCryptoId: oldSession.workspaceCryptoId,
            envelopes: snapshotEnvelopes,
            workspaceRevision: copy.revision,
            previousRoot: null,
            operationId: createOperationId(),
            keyVersion,
          }),
        };
        const { error } = await cloud().rpc(STAGE_ROTATION_SNAPSHOT_RPC, {
          p_expected_owner_id: ownerId,
          p_operation_id: operationId,
          p_snapshot: snapshot,
        });
        if (error) throw persistenceFailure("A rotated recovery snapshot could not be staged.", error);
        completed += 1;
      }
      const currentSnapshotEnvelopes = await encryptWorkspace({
        masterKey: newMasterKey,
        workspaceCryptoId: oldSession.workspaceCryptoId,
        state: current.state,
        keyVersion,
      });
      const { error: currentSnapshotError } = await cloud().rpc(STAGE_ROTATION_SNAPSHOT_RPC, {
        p_expected_owner_id: ownerId,
        p_operation_id: operationId,
        p_snapshot: {
          id: createOperationId(),
          sourceRevision: current.revision,
          originalCreatedAt: new Date().toISOString(),
          keyVersion,
          envelopes: currentSnapshotEnvelopes,
          manifest: await createManifest({
            masterKey: newMasterKey,
            workspaceCryptoId: oldSession.workspaceCryptoId,
            envelopes: currentSnapshotEnvelopes,
            workspaceRevision: current.revision,
            previousRoot: null,
            operationId: createOperationId(),
            keyVersion,
          }),
        },
      });
      if (currentSnapshotError)
        throw persistenceFailure("The current pre-rotation snapshot could not be staged.", currentSnapshotError);

      const { data: importRows, error: importError } = await cloud()
        .from(E2EE_IMPORT_RECEIPTS_TABLE)
        .select("import_fingerprint, result_revision, key_version, nonce, ciphertext, original_created_at, created_at")
        .eq("owner_id", ownerId);
      if (importError)
        throw persistenceFailure("Encrypted import history could not be prepared for rotation.", importError);
      const importReceipts = [];
      for (const source of importRows || []) {
        const details = await decryptImportReceipt({
          masterKey: oldSession.masterKey,
          workspaceCryptoId: oldSession.workspaceCryptoId,
          receipt: {
            fingerprint: source.import_fingerprint,
            keyVersion: Number(source.key_version),
            nonce: source.nonce,
            ciphertext: source.ciphertext,
          },
        });
        const fingerprint = await createImportFingerprint({
          masterKey: newMasterKey,
          workspaceCryptoId: oldSession.workspaceCryptoId,
          fileHash: details.fileHash,
          keyVersion,
        });
        importReceipts.push({
          receipt: {
            ...(await encryptImportReceipt({
              masterKey: newMasterKey,
              workspaceCryptoId: oldSession.workspaceCryptoId,
              fingerprint,
              keyVersion,
              value: details,
            })),
            resultRevision: normalizeRevision(source.result_revision),
          },
          originalCreatedAt: source.original_created_at || source.created_at,
        });
      }
      for (let index = 0; index < importReceipts.length; index += 100) {
        const { error } = await cloud().rpc(STAGE_ROTATION_IMPORTS_RPC, {
          p_expected_owner_id: ownerId,
          p_operation_id: operationId,
          p_items: importReceipts.slice(index, index + 100),
        });
        if (error) throw persistenceFailure("Rotated import history could not be staged.", error);
      }
      const { error: wrapperError } = await cloud().rpc(STAGE_ROTATION_WRAPPERS_RPC, {
        p_expected_owner_id: ownerId,
        p_operation_id: operationId,
        p_wrappers: wrappers,
      });
      if (wrapperError) throw persistenceFailure("Rotated password wrappers could not be staged.", wrapperError);

      onProgress?.("Publishing the rotated key and encrypted history atomically…");
      const { data: finalized, error } = await cloud().rpc(FINALIZE_STAGED_ROTATION_RPC, {
        p_expected_owner_id: ownerId,
        p_operation_id: operationId,
      });
      if (error) throw persistenceFailure("Emergency workspace key rotation could not be completed.", error);
      data = finalized;
    } catch (error) {
      try {
        await cloud().rpc(ABORT_STAGED_ROTATION_RPC, { p_expected_owner_id: ownerId, p_operation_id: operationId });
      } catch {
        // Cleanup is best-effort. Preserve the primary rotation error.
      }
      throw error;
    }
    const row = firstRow(data);
    if (row?.already_applied) return loadWorkspace({ ...oldSession, masterKey: newMasterKey, keyVersion }, ownerId);
    cache = {
      state: current.state,
      versions: versionsFromEnvelopes(envelopes),
      revision: normalizeRevision(row?.result_revision),
      updatedAt: row?.updated_at || null,
      envelopes,
      manifest,
      workspaceCryptoId: oldSession.workspaceCryptoId,
      keyVersion,
    };
    return cache;
  }

  async function loadMissedEvents(session, ownerId) {
    if (!cache) return loadWorkspace(session, ownerId);
    const { data, error } = await cloud()
      .from(E2EE_EVENTS_TABLE)
      .select("workspace_revision, owner_id, upserts, deleted_entities, manifest, created_at")
      .eq("owner_id", ownerId)
      .gt("workspace_revision", cache.revision)
      .order("workspace_revision", { ascending: true })
      .limit(101);
    if (error) throw persistenceFailure("Encrypted live updates could not be loaded.", error);
    if ((data || []).length > 100) return loadWorkspace(session, ownerId, { minimumRevision: cache.revision });
    for (const event of data || []) {
      const upserts = (event.upserts || []).map(normalizeEnvelope);
      const deletes = (event.deleted_entities || []).map((item) => ({
        collection: item.collection,
        entityId: item.entityId,
      }));
      const envelopes = envelopesAfterMutation(cache.envelopes, upserts, deletes);
      await verifyManifest({
        masterKey: session.masterKey,
        workspaceCryptoId: session.workspaceCryptoId,
        envelopes,
        manifest: event.manifest,
        minimumRevision: cache.revision + 1,
        expectedPreviousRoot: cache.manifest.root,
      });
      const decrypted = await decryptWorkspace({
        masterKey: session.masterKey,
        workspaceCryptoId: session.workspaceCryptoId,
        envelopes,
      });
      cache = {
        ...cache,
        state: canonicalState(decrypted.state),
        versions: decrypted.versions,
        revision: normalizeRevision(event.workspace_revision),
        updatedAt: event.created_at,
        envelopes,
        manifest: event.manifest,
      };
    }
    return cache;
  }

  async function subscribe(session, onChange, { userId, onStatus, onError } = {}) {
    const ownerId = (await requireUser(userId)).id;
    let active = true;
    let refreshTask;
    const refresh = () => {
      if (!active || refreshTask) return refreshTask;
      refreshTask = loadMissedEvents(session, ownerId)
        .then((latest) => {
          if (active && latest) onChange(latest);
        })
        .catch((error) => active && onError?.(error))
        .finally(() => {
          refreshTask = null;
        });
      return refreshTask;
    };
    const channel = cloud()
      .channel(`encrypted-workspace-events:${ownerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: E2EE_EVENTS_TABLE, filter: `owner_id=eq.${ownerId}` },
        () => void refresh(),
      )
      .subscribe((status, error) => {
        onStatus?.(status);
        if (status === "SUBSCRIBED") void refresh();
        if (error) onError?.(persistenceFailure("Encrypted live updates disconnected.", error));
      });
    return async () => {
      active = false;
      await cloud().removeChannel(channel);
    };
  }

  async function exportBackup(workspace, wrappers, session) {
    const encryptedSnapshot = await encryptBackupPayload({
      masterKey: session.masterKey,
      workspaceCryptoId: workspace.workspaceCryptoId,
      keyVersion: workspace.keyVersion,
      value: { sourceRevision: workspace.revision, envelopes: workspace.envelopes, manifest: workspace.manifest },
    });
    return JSON.stringify({
      format: "hibi-encrypted-backup",
      formatVersion: 2,
      protocolVersion: CRYPTO_PROTOCOL_VERSION,
      workspaceCryptoId: workspace.workspaceCryptoId,
      exportedAt: new Date().toISOString(),
      encryptedSnapshot,
      wrappers: wrappers.filter((wrapper) => !wrapper.revokedAt),
    });
  }

  async function decryptBackup(text, session, { recoveryKey = "", sourceMasterKey = null } = {}) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch (error) {
      throw new CloudPersistenceError("The .hibi file is not valid JSON.", { cause: error });
    }
    const legacyFormat = backup?.formatVersion === 1;
    const currentFormat = backup?.formatVersion === 2;
    if (backup?.format !== "hibi-encrypted-backup" || (!legacyFormat && !currentFormat)) {
      throw new CloudPersistenceError("This encrypted backup uses an unsupported format.");
    }
    let decryptionKey = session.masterKey;
    let temporaryMasterKey = null;
    if (backup.workspaceCryptoId !== session.workspaceCryptoId) {
      if (sourceMasterKey) {
        decryptionKey = sourceMasterKey;
      } else if (!recoveryKey) {
        const required = new CloudPersistenceError(
          "Enter the source workspace recovery key to restore this backup into a different account.",
        );
        required.code = "backup_recovery_required";
        throw required;
      }
      const secret = await parseRecoveryKey(recoveryKey);
      try {
        const fingerprint = await recoveryKeyFingerprint(secret);
        const wrapper = (backup.wrappers || []).find(
          (candidate) => candidate.type === "recovery" && candidate.recoveryFingerprint === fingerprint,
        );
        if (!wrapper) throw new CloudPersistenceError("That recovery key does not match this encrypted backup.");
        temporaryMasterKey = await unwrapMasterKey({
          wrapper,
          wrappingSecret: secret,
          workspaceCryptoId: backup.workspaceCryptoId,
        });
        decryptionKey = temporaryMasterKey;
      } finally {
        wipeBytes(secret);
      }
    }
    try {
      const snapshot = currentFormat
        ? await decryptBackupPayload({
            masterKey: decryptionKey,
            workspaceCryptoId: backup.workspaceCryptoId,
            payload: backup.encryptedSnapshot,
          })
        : backup.snapshot;
      if (!Array.isArray(snapshot?.envelopes) || !snapshot?.manifest) {
        throw new CloudPersistenceError("This encrypted backup does not contain a valid workspace snapshot.");
      }
      const envelopes = snapshot.envelopes.map(normalizeEnvelope);
      await verifyManifest({
        masterKey: decryptionKey,
        workspaceCryptoId: backup.workspaceCryptoId,
        envelopes,
        manifest: snapshot.manifest,
      });
      const { state } = await decryptWorkspace({
        masterKey: decryptionKey,
        workspaceCryptoId: backup.workspaceCryptoId,
        envelopes,
      });
      return canonicalState(state);
    } finally {
      if (temporaryMasterKey) wipeBytes(temporaryMasterKey);
    }
  }

  return {
    loadBootstrap,
    loadWorkspace,
    prepareMutation,
    optimisticWorkspace,
    applyMutation,
    replaceWorkspace,
    findImportJob,
    listSnapshots,
    loadSnapshot,
    addWrapper,
    replacePasswordWrapper,
    revokeWrapper,
    touchWrapper,
    abortMigration,
    migrateLegacyWorkspace,
    rotateWorkspaceKey,
    subscribe,
    exportBackup,
    decryptBackup,
  };
}

export const encryptedWorkspaceRepository = createEncryptedWorkspaceRepository();
