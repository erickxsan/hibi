import { describe, expect, it, vi } from "vitest";
import { createGroup, createStarterState, createStudent } from "../domain/index.js";
import {
  createManifest,
  decryptEntity,
  encryptWorkspace,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
} from "../crypto/index.js";
import {
  APPLY_E2EE_MUTATION_RPC,
  LOAD_E2EE_WORKSPACE_RPC,
  createEncryptedWorkspaceRepository,
} from "./encryptedWorkspaceRepository.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";

async function twoDevices(state) {
  const session = {
    masterKey: generateAccountMasterKey(),
    workspaceCryptoId: generateWorkspaceCryptoId(),
    keyVersion: 1,
  };
  const envelopes = await encryptWorkspace({ ...session, state });
  let row = {
    workspace_crypto_id: session.workspaceCryptoId,
    workspace_revision: 1,
    active_key_version: 1,
    migration_status: "active",
    envelopes,
    manifest: await createManifest({ ...session, envelopes, workspaceRevision: 1, operationId: "initial" }),
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) },
    rpc: vi.fn(async (name, args) => {
      if (name === LOAD_E2EE_WORKSPACE_RPC) return { data: [row], error: null };
      if (name !== APPLY_E2EE_MUTATION_RPC) throw new Error(`Unexpected RPC: ${name}`);
      if (args.p_expected_workspace_revision !== row.workspace_revision) {
        return { data: null, error: { code: "40001", message: "workspace_revision_conflict" } };
      }
      const next = new Map(row.envelopes.map((item) => [`${item.collection}/${item.entityId}`, item]));
      for (const item of args.p_deletes) next.delete(`${item.collection}/${item.entityId}`);
      for (const item of args.p_upserts) {
        expect(item.entityRevision).toBe((next.get(`${item.collection}/${item.entityId}`)?.entityRevision || 0) + 1);
        next.set(`${item.collection}/${item.entityId}`, item);
      }
      row = {
        ...row,
        envelopes: [...next.values()],
        manifest: args.p_manifest,
        workspace_revision: row.workspace_revision + 1,
      };
      return { data: [{ result_revision: row.workspace_revision }], error: null };
    }),
  };
  const first = createEncryptedWorkspaceRepository(client, { allowWrites: true });
  const second = createEncryptedWorkspaceRepository(client, { allowWrites: true });
  const firstBase = await first.loadWorkspace(session, "owner");
  const secondBase = await second.loadWorkspace(session, "owner");
  return { first, second, firstBase, secondBase, session, client };
}

function student(id, code = id) {
  return createStudent({ id, code, fullName: `Student ${id}`, isIndividual: true });
}

async function concurrentMutations(devices, firstState, secondState) {
  const { first, second, firstBase, secondBase, session } = devices;
  const firstMutation = await first.prepareMutation({ state: firstState, workspace: firstBase, session });
  const secondMutation = await second.prepareMutation({ state: secondState, workspace: secondBase, session });
  await first.applyMutation(firstMutation, session, "owner");
  return secondMutation;
}

describe("encrypted workspace mutation rebasing", () => {
  it.each([
    ["student-a", "student-z"],
    ["student-z", "student-a"],
  ])("re-encrypts coherent positions for concurrent additions %s / %s", async (firstId, secondId) => {
    const state = createStarterState();
    const devices = await twoDevices(state);
    const mutation = await concurrentMutations(
      devices,
      { ...state, students: [student(firstId)] },
      { ...state, students: [student(secondId)] },
    );
    const result = await devices.second.applyMutation(mutation, devices.session, "owner");
    expect(result.state.students.map(({ id }) => id)).toEqual(["student-a", "student-z"]);
    expect(result.manifest.operationId).toBe(mutation.operationId);
    const positions = await Promise.all(
      result.envelopes
        .filter((item) => item.collection === "students")
        .map(async (envelope) => {
          const value = await decryptEntity({ ...devices.session, envelope });
          return value.position;
        }),
    );
    expect(positions.sort()).toEqual([0, 1]);
    const reloaded = await devices.first.loadWorkspace(devices.session, "owner");
    expect(reloaded.state).toEqual(result.state);
    expect(reloaded.revision).toBe(3);
  });

  it("rejects duplicate codes across different IDs without publishing the combination", async () => {
    const state = { ...createStarterState(), students: [student("student-a"), student("student-b")] };
    const devices = await twoDevices(state);
    const firstState = { ...state, students: [student("student-a", "NEW"), state.students[1]] };
    const secondState = { ...state, students: [state.students[0], student("student-b", "NEW")] };
    const mutation = await concurrentMutations(devices, firstState, secondState);
    await expect(devices.second.applyMutation(mutation, devices.session, "owner")).rejects.toBeInstanceOf(
      WorkspaceConflictError,
    );
    expect(devices.client.rpc.mock.calls.filter(([name]) => name === APPLY_E2EE_MUTATION_RPC)).toHaveLength(2);
    const reloaded = await devices.second.loadWorkspace(devices.session, "owner");
    expect(reloaded.state.students.map(({ code }) => code)).toEqual(["NEW", "student-b"]);
    expect(reloaded.revision).toBe(2);
  });

  it("rejects a concurrent reference to a deleted group before publishing", async () => {
    const state = { ...createStarterState(), groups: [createGroup({ id: "group-a", name: "Group A" })] };
    const devices = await twoDevices(state);
    const mutation = await concurrentMutations(
      devices,
      { ...state, groups: [] },
      { ...state, students: [{ ...student("student-a"), groupIds: ["group-a"] }] },
    );
    await expect(devices.second.applyMutation(mutation, devices.session, "owner")).rejects.toMatchObject({
      name: "WorkspaceConflictError",
      latestRevision: 2,
      latestState: { groups: [], students: [] },
    });
    expect(devices.client.rpc.mock.calls.filter(([name]) => name === APPLY_E2EE_MUTATION_RPC)).toHaveLength(2);
    const reloaded = await devices.second.loadWorkspace(devices.session, "owner");
    expect(reloaded.state.groups).toEqual([]);
    expect(reloaded.state.students).toEqual([]);
    expect(reloaded.revision).toBe(2);
  });
});
