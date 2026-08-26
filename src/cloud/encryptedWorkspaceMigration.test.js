import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain/index.js";
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
