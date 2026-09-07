import { describe, expect, it, vi } from "vitest";
import { createGroup, createStarterState, createStudent } from "../domain/index.js";
import {
  createManifest,
  decryptEntity,
  encryptWorkspace,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
  verifyManifest,
} from "../crypto/index.js";
import {
  APPLY_E2EE_MUTATION_RPC,
  LOAD_E2EE_WORKSPACE_RPC,
  REPLACE_E2EE_WORKSPACE_RPC,
  createEncryptedWorkspaceRepository,
} from "./encryptedWorkspaceRepository.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";

async function twoDevices(state, versions = {}) {
  const session = {
    masterKey: generateAccountMasterKey(),
    workspaceCryptoId: generateWorkspaceCryptoId(),
    keyVersion: 1,
  };
  const envelopes = await encryptWorkspace({ ...session, state, versions });
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
      if (![APPLY_E2EE_MUTATION_RPC, REPLACE_E2EE_WORKSPACE_RPC].includes(name)) {
        throw new Error(`Unexpected RPC: ${name}`);
      }
      if (args.p_expected_workspace_revision !== row.workspace_revision) {
        return { data: null, error: { code: "40001", message: "workspace_revision_conflict" } };
      }
      if (
        args.p_manifest.workspaceRevision !== row.workspace_revision + 1 ||
        args.p_manifest.previousRoot !== row.manifest.root
      ) {
        return { data: null, error: { code: "22023", message: "invalid_workspace_manifest" } };
      }
      if (name === REPLACE_E2EE_WORKSPACE_RPC) {
        row = {
          ...row,
          envelopes: args.p_envelopes,
          manifest: args.p_manifest,
          workspace_revision: row.workspace_revision + 1,
        };
        return { data: [{ result_revision: row.workspace_revision }], error: null };
      }
      const next = new Map(row.envelopes.map((item) => [`${item.collection}/${item.entityId}`, item]));
      for (const item of args.p_deletes) next.delete(`${item.collection}/${item.entityId}`);
      for (const item of args.p_upserts) {
        expect(item.entityRevision).toBe((next.get(`${item.collection}/${item.entityId}`)?.entityRevision || 0) + 1);
        next.set(`${item.collection}/${item.entityId}`, item);
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

describe("encrypted workspace replacements", () => {
  it("rebases consecutive offline edits of one student after another student changes", async () => {
    const state = { ...createStarterState(), students: [student("a"), student("b")] };
    const devices = await twoDevices(state);
    const one = { ...state, students: [{ ...state.students[0], notes: "One" }, state.students[1]] };
    const first = await devices.first.prepareMutation({
      state: one,
      workspace: devices.firstBase,
      session: devices.session,
    });
    const optimistic = devices.first.optimisticWorkspace(devices.firstBase, first, devices.session);
    const second = await devices.first.prepareMutation({
      state: { ...one, students: [{ ...one.students[0], notes: "Two" }, one.students[1]] },
      workspace: optimistic,
      session: devices.session,
    });
    const remote = await devices.second.prepareMutation({
      state: { ...state, students: [state.students[0], { ...state.students[1], notes: "Remote" }] },
      workspace: devices.secondBase,
      session: devices.session,
    });
    await devices.second.applyMutation(remote, devices.session, "owner");
    await devices.first.loadWorkspace(devices.session, "owner");
    await devices.first.applyMutation(first, devices.session, "owner");
    const result = await devices.first.applyMutation(second, devices.session, "owner");
    expect(result.state.students.map((item) => item.notes)).toEqual(["Two", "Remote"]);
  });
  it("rebases an offline operation after downloading unrelated changes", async () => {
    const state = { ...createStarterState(), students: [student("a"), student("b")] };
    const devices = await twoDevices(state);
    const mutation = await concurrentMutations(
      devices,
      { ...state, students: [{ ...state.students[0], notes: "Cloud A" }, state.students[1]] },
      { ...state, students: [state.students[0], { ...state.students[1], notes: "Offline B" }] },
    );
    expect(mutation.baseRevision).toBe(1);
    expect(mutation.baseRoot).toBe(devices.secondBase.manifest.root);
    await devices.second.loadWorkspace(devices.session, "owner");
    const result = await devices.second.applyMutation(mutation, devices.session, "owner");
    expect(result.state.students.map((item) => item.notes)).toEqual(["Cloud A", "Offline B"]);
    expect(result.manifest.workspaceRevision).toBe(3);
  });

  it("resolves only the chosen operation against the latest cloud state", async () => {
    const state = { ...createStarterState(), students: [student("a"), student("b")] };
    const devices = await twoDevices(state);
    const mutation = await concurrentMutations(
      devices,
      {
        ...state,
        students: [
          { ...state.students[0], notes: "Cloud A" },
          { ...state.students[1], notes: "Cloud B" },
        ],
      },
      { ...state, students: [{ ...state.students[0], notes: "Local A" }, state.students[1]] },
    );
    const latest = await devices.second.loadWorkspace(devices.session, "owner");
    await expect(devices.second.applyMutation(mutation, devices.session, "owner")).rejects.toBeInstanceOf(
      WorkspaceConflictError,
    );
    const replacement = await devices.second.resolveMutation(mutation, latest, devices.session);
    expect(replacement.operationId).not.toBe(mutation.operationId);
    const result = await devices.second.applyMutation(replacement, devices.session, "owner");
    expect(result.state.students.map((item) => item.notes)).toEqual(["Local A", "Cloud B"]);
  });

  it("retries a committed operation without applying it twice", async () => {
    const state = { ...createStarterState(), students: [student("a")] };
    const devices = await twoDevices(state);
    const mutation = await devices.first.prepareMutation({
      state: { ...state, students: [{ ...state.students[0], notes: "Once" }] },
      workspace: devices.firstBase,
      session: devices.session,
    });
    await devices.first.applyMutation(mutation, devices.session, "owner");
    const result = await devices.first.applyMutation(mutation, devices.session, "owner");
    expect(result.revision).toBe(2);
  });
  it.each(["replace", "restore", "import"])("rejects an edit prepared before a full %s", async (reason) => {
    const state = { ...createStarterState(), students: [student("student-a")] };
    const devices = await twoDevices(state);
    const mutation = await devices.first.prepareMutation({
      state: { ...state, students: [{ ...state.students[0], notes: "Pending notes" }] },
      workspace: devices.firstBase,
      session: devices.session,
    });
    const restored = { ...state, students: [{ ...state.students[0], fullName: "Updated name" }] };
    await devices.second.replaceWorkspace(restored, devices.session, "owner", reason, { fileHash: "a".repeat(64) });

    // The first device has not loaded the replacement before submitting its old edit.
    await expect(devices.first.applyMutation(mutation, devices.session, "owner")).rejects.toMatchObject({
      name: "WorkspaceConflictError",
      latestRevision: 2,
      latestState: { students: [{ fullName: "Updated name" }] },
    });
    expect(devices.client.rpc.mock.calls.filter(([name]) => name === APPLY_E2EE_MUTATION_RPC)).toHaveLength(1);
    const reloaded = await devices.first.loadWorkspace(devices.session, "owner");
    expect(reloaded.state).toEqual(restored);
    expect(reloaded.versions.students["student-a"]).toBe(2);
    expect(reloaded.revision).toBe(2);
  });

  it("advances existing revisions on every replacement, including unchanged settings and records", async () => {
    const state = {
      ...createStarterState(),
      students: [student("student-a"), student("removed")],
      groups: [createGroup({ id: "group-a", name: "Group A" })],
    };
    const devices = await twoDevices(state, {
      settings: { __settings__: 7 },
      students: { "student-a": 12, removed: 3 },
      groups: { "group-a": 4 },
    });
    const replacement = { ...state, students: [state.students[0], student("new")] };
    for (let count = 1; count <= 2; count += 1) {
      const result = await devices.second.replaceWorkspace(replacement, devices.session, "owner");
      expect(result.versions.settings.__settings__).toBe(7 + count);
      expect(result.versions.students).toEqual({ "student-a": 12 + count, new: count });
      expect(result.versions.groups["group-a"]).toBe(4 + count);
      const reloaded = await devices.first.loadWorkspace(devices.session, "owner");
      expect(reloaded.state).toEqual(replacement);
      expect(reloaded.versions).toEqual(result.versions);
      expect(reloaded.revision).toBe(1 + count);
    }
  });
});

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
