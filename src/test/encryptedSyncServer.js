import { vi } from "vitest";
import {
  createManifest,
  encryptWorkspace,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
  verifyManifest,
} from "../crypto/index.js";
import {
  APPLY_E2EE_MUTATION_RPC,
  createEncryptedWorkspaceRepository,
  E2EE_EVENTS_TABLE,
  E2EE_SNAPSHOTS_TABLE,
  LOAD_E2EE_WORKSPACE_RPC,
  REPLACE_E2EE_WORKSPACE_RPC,
} from "../cloud/encryptedWorkspaceRepository.js";

const conflict = (message) => ({ data: null, error: { code: "PT409", message } });
const invalid = (message) => ({ data: null, error: { code: "22023", message } });

/**
 * A synthetic Supabase backend that follows the order of checks in
 * apply_encrypted_workspace_mutation and replace_encrypted_workspace:
 * receipt, revision, size, entity revisions, then the manifest chain. It also
 * verifies every manifest cryptographically as a test oracle.
 */
export async function createEncryptedSyncServer(state, versions = {}, transformEnvelopes = null) {
  const session = {
    masterKey: generateAccountMasterKey(),
    workspaceCryptoId: generateWorkspaceCryptoId(),
    keyVersion: 1,
  };
  const original = await encryptWorkspace({ ...session, state, versions });
  const envelopes = transformEnvelopes ? await transformEnvelopes(original, session) : original;
  let row = {
    workspace_crypto_id: session.workspaceCryptoId,
    workspace_revision: 1,
    active_key_version: 1,
    migration_status: "active",
    envelopes,
    manifest: await createManifest({ ...session, envelopes, workspaceRevision: 1, operationId: "initial" }),
  };
  const events = [];
  const snapshots = [];
  const receipts = new Map();
  // Requests that a correct client never sends (for example stale entity revisions).
  const violations = [];
  let notify;
  const channel = {
    on: (_type, _filter, callback) => {
      notify = callback;
      return channel;
    },
    subscribe: () => channel,
  };

  function query(table) {
    const filters = [];
    let maximum = Infinity;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      gt: (column, value) => {
        filters.push((item) => item[column] > value);
        return builder;
      },
      gte: (column, value) => {
        filters.push((item) => item[column] >= value);
        return builder;
      },
      lte: (column, value) => {
        filters.push((item) => item[column] <= value);
        return builder;
      },
      in: (column, values) => {
        filters.push((item) => values.includes(item[column]));
        return builder;
      },
      limit: async (count) => {
        maximum = count;
        const source = table === E2EE_SNAPSHOTS_TABLE ? snapshots : events;
        return {
          data: source.filter((item) => filters.every((filter) => filter(item))).slice(0, maximum),
          error: null,
        };
      },
    };
    if (![E2EE_EVENTS_TABLE, E2EE_SNAPSHOTS_TABLE].includes(table)) throw new Error(`Unexpected table: ${table}`);
    return builder;
  }

  async function apply(args) {
    if (receipts.has(args.p_operation_id)) {
      return { data: [{ result_revision: receipts.get(args.p_operation_id), already_applied: true }], error: null };
    }
    if (args.p_expected_workspace_revision !== row.workspace_revision) return conflict("workspace_revision_conflict");
    if (args.p_upserts.length + args.p_deletes.length > 500) return invalid("invalid_encrypted_mutation");
    if (new TextEncoder().encode(JSON.stringify(args.p_upserts)).byteLength > 5 * 1024 * 1024)
      return invalid("invalid_encrypted_mutation");
    const next = new Map(row.envelopes.map((item) => [`${item.collection}/${item.entityId}`, item]));
    for (const item of args.p_deletes) {
      const key = `${item.collection}/${item.entityId}`;
      if (next.get(key)?.entityRevision !== item.expectedRevision) {
        violations.push({ kind: "deletion", key });
        return conflict("workspace_entity_conflict");
      }
      next.delete(key);
    }
    for (const item of args.p_upserts) {
      const key = `${item.collection}/${item.entityId}`;
      if (item.entityRevision !== (next.get(key)?.entityRevision || 0) + 1) {
        violations.push({ kind: "upsert", key });
        return conflict("workspace_entity_conflict");
      }
      next.set(key, item);
    }
    if (
      args.p_manifest.workspaceRevision !== row.workspace_revision + 1 ||
      args.p_manifest.previousRoot !== row.manifest.root ||
      args.p_manifest.entityCount !== next.size
    ) {
      return invalid("invalid_workspace_manifest");
    }
    await verifyManifest({
      ...session,
      envelopes: [...next.values()],
      manifest: args.p_manifest,
      expectedPreviousRoot: row.manifest.root,
    });
    row = {
      ...row,
      envelopes: [...next.values()],
      manifest: args.p_manifest,
      workspace_revision: row.workspace_revision + 1,
    };
    events.push({
      workspace_revision: row.workspace_revision,
      upserts: args.p_upserts,
      deleted_entities: args.p_deletes,
      manifest: args.p_manifest,
    });
    receipts.set(args.p_operation_id, row.workspace_revision);
    return { data: [{ result_revision: row.workspace_revision }], error: null };
  }

  function replace(args) {
    if (args.p_expected_workspace_revision !== row.workspace_revision) return conflict("workspace_revision_conflict");
    if (
      args.p_manifest.workspaceRevision !== row.workspace_revision + 1 ||
      args.p_manifest.previousRoot !== row.manifest.root
    )
      return invalid("invalid_workspace_manifest");
    snapshots.push({ source_revision: row.workspace_revision, reason: args.p_reason });
    events.push({
      workspace_revision: row.workspace_revision + 1,
      upserts: args.p_envelopes,
      deleted_entities: row.envelopes
        .filter(
          (old) =>
            !args.p_envelopes.some((item) => item.collection === old.collection && item.entityId === old.entityId),
        )
        .map(({ collection, entityId }) => ({ collection, entityId })),
      manifest: args.p_manifest,
    });
    row = {
      ...row,
      envelopes: args.p_envelopes,
      manifest: args.p_manifest,
      workspace_revision: row.workspace_revision + 1,
    };
    return { data: [{ result_revision: row.workspace_revision }], error: null };
  }

  const client = {
    channel: () => channel,
    removeChannel: vi.fn(),
    from: (table) => query(table),
    auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    rpc: vi.fn(async (name, args) => {
      if (name === LOAD_E2EE_WORKSPACE_RPC) return { data: [row], error: null };
      if (name === APPLY_E2EE_MUTATION_RPC) return apply(args);
      if (name === REPLACE_E2EE_WORKSPACE_RPC) return replace(args);
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  };
  const device = () => createEncryptedWorkspaceRepository(client, { allowWrites: true, retryDelay: () => 0 });
  return {
    session,
    client,
    events,
    snapshots,
    violations,
    device,
    notify: () => notify(),
    current: () => row,
  };
}

/** Two independent devices (separate repository caches) on one synthetic server. */
export async function twoDevices(state, versions = {}, transformEnvelopes = null) {
  const server = await createEncryptedSyncServer(state, versions, transformEnvelopes);
  const first = server.device();
  const second = server.device();
  const firstBase = await first.loadWorkspace(server.session, "owner");
  const secondBase = await second.loadWorkspace(server.session, "owner");
  return { ...server, first, second, firstBase, secondBase };
}
