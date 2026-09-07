import { describe, expect, it, vi } from "vitest";
import { createStarterState, createStudent } from "../domain/index.js";
import { generateAccountMasterKey, generateWorkspaceCryptoId } from "../crypto/index.js";
import { createEncryptedWorkspaceRepository } from "./encryptedWorkspaceRepository.js";

function thenable(result, rejection = null) {
  return {
    then(resolve, reject) {
      return rejection ? Promise.resolve(reject(rejection)) : Promise.resolve(resolve(result));
    },
  };
}

describe("encrypted workspace migration cleanup", () => {
  it("preserves the primary migration failure when the Supabase RPC builder has no catch method", async () => {
    const user = { id: "33333333-3333-4333-8333-333333333333" };
    const rpcCalls = [];
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
      },
      from(table) {
        if (table === "workspace_import_jobs") {
          return {
            select() {
              return { eq: () => Promise.resolve({ data: [], error: null }) };
            },
          };
        }
        if (table === "workspace_encryption_profiles") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          owner_id: user.id,
                          workspace_crypto_id: "workspace_crypto_A1",
                          protocol_version: 1,
                          schema_version: 1,
                          active_key_version: 1,
                          workspace_revision: 0,
                          migration_status: "migration_started",
                        },
                        error: null,
                      }),
                  };
                },
              };
            },
          };
        }
        if (table === "workspace_key_wrappers") {
          return {
            select() {
              return { eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      rpc(name) {
        rpcCalls.push(name);
        if (name === "begin_workspace_e2ee_migration") return thenable({ data: null, error: null });
        if (name === "stage_workspace_e2ee_entities") {
          return thenable({ data: null, error: { message: "staging failed" } });
        }
        if (name === "workspace_e2ee_rollout_status") {
          return thenable({ data: [{ enabled: true, rollout_mode: "required" }], error: null });
        }
        if (name === "abort_workspace_e2ee_migration") {
          return thenable(null, new Error("abort unavailable"));
        }
        throw new Error(`Unexpected RPC: ${name}`);
      },
    };
    const legacyRepository = {
      loadOrCreateWorkspace: vi.fn(async () => ({ state: createStarterState(), revision: 0, versions: {} })),
      listRecoverySnapshots: vi.fn(async () => []),
    };
    const deviceStore = {
      listMutations: vi.fn(async () => []),
      list: vi.fn(async () => []),
    };
    const repository = createEncryptedWorkspaceRepository(client, {
      allowWrites: true,
      legacyRepository,
      deviceStore,
    });

    await expect(
      repository.migrateLegacyWorkspace({
        user,
        masterKey: generateAccountMasterKey(),
        workspaceCryptoId: generateWorkspaceCryptoId(),
        keyWrapper: { type: "password" },
      }),
    ).rejects.toThrow("staging failed");

    expect(rpcCalls).toContain("abort_workspace_e2ee_migration");
  });
});

function migrationFixture({ conflict = false, failFrozenRead = false, corruptStaging = false } = {}) {
  const user = { id: "33333333-3333-4333-8333-333333333333" };
  const state = createStarterState();
  state.students.push(
    createStudent({ id: "student-a", code: "A001", fullName: "Latest server name", isIndividual: true }),
  );
  const calls = [];
  const staged = [];
  let reads = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      calls.push(table);
      if (table !== "workspace_import_jobs") throw new Error("Bootstrap unavailable");
      return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
    },
    async rpc(name, args) {
      calls.push(name);
      if (name === "begin_workspace_e2ee_migration") {
        expect(args.p_expected_legacy_revision).toBe(7);
        return { error: conflict ? { code: "40001", message: "legacy_revision_conflict" } : null };
      }
      if (name === "stage_workspace_e2ee_entities") staged.push(...args.p_envelopes);
      if (name === "load_workspace_e2ee_migration_staging") {
        return { data: { envelopes: corruptStaging ? [] : staged, snapshots: [], import_receipts: [] }, error: null };
      }
      if (name === "finalize_workspace_e2ee_migration") expect(args.p_expected_legacy_revision).toBe(7);
      return { data: null, error: null };
    },
  };
  const legacyRepository = {
    async loadOrCreateWorkspace() {
      reads += 1;
      calls.push(`read-${reads}`);
      if (reads === 2 && failFrozenRead) throw new Error("frozen read unavailable");
      // The initial payload must never be used to encrypt or verify staging.
      return { state: reads === 1 ? createStarterState() : state, revision: 7, versions: {} };
    },
    async listRecoverySnapshots() {
      calls.push("snapshots");
      return [];
    },
  };
  const repository = createEncryptedWorkspaceRepository(client, {
    allowWrites: true,
    legacyRepository,
    deviceStore: { listMutations: async () => [], list: async () => [] },
  });
  return {
    calls,
    state,
    run: () =>
      repository.migrateLegacyWorkspace({
        user,
        masterKey: generateAccountMasterKey(),
        workspaceCryptoId: generateWorkspaceCryptoId(),
        keyWrapper: { type: "password" },
      }),
  };
}

describe("migration source write barrier", () => {
  it("reloads all server sources after begin and verifies staging against the frozen payload", async () => {
    const fixture = migrationFixture();
    const result = await fixture.run();
    expect(result.sourceState).toEqual(fixture.state);
    expect(result.sourceRevision).toBe(7);
    const begin = fixture.calls.indexOf("begin_workspace_e2ee_migration");
    for (const call of ["read-2", "snapshots", "workspace_import_jobs", "stage_workspace_e2ee_entities"]) {
      expect(fixture.calls.indexOf(call)).toBeGreaterThan(begin);
    }
    expect(fixture.calls).toContain("finalize_workspace_e2ee_migration");
    expect(fixture.calls).not.toContain("abort_workspace_e2ee_migration");
  });

  it("stops before staging when another device changes the revision before begin", async () => {
    const fixture = migrationFixture({ conflict: true });
    await expect(fixture.run()).rejects.toThrow("legacy_revision_conflict");
    expect(fixture.calls).not.toContain("read-2");
    expect(fixture.calls).not.toContain("stage_workspace_e2ee_entities");
    expect(fixture.calls).not.toContain("finalize_workspace_e2ee_migration");
    expect(fixture.calls).not.toContain("abort_workspace_e2ee_migration");
  });

  it("still rejects staging that fails verification against the frozen source", async () => {
    const fixture = migrationFixture({ corruptStaging: true });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.calls).toContain("abort_workspace_e2ee_migration");
    expect(fixture.calls).not.toContain("finalize_workspace_e2ee_migration");
  });

  it("releases the barrier when reading the frozen source fails", async () => {
    const fixture = migrationFixture({ failFrozenRead: true });
    await expect(fixture.run()).rejects.toThrow("frozen read unavailable");
    expect(fixture.calls).toContain("abort_workspace_e2ee_migration");
    expect(fixture.calls).not.toContain("finalize_workspace_e2ee_migration");
  });
});
