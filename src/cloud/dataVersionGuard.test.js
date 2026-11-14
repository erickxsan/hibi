import { describe, expect, it } from "vitest";
import { createStarterState, createStudent, DATA_VERSION, NewerDataVersionError } from "../domain/index.js";
import { createManifest, decryptEntity, encryptWorkspace } from "../crypto/index.js";
import { APPLY_E2EE_MUTATION_RPC, REPLACE_E2EE_WORKSPACE_RPC } from "./encryptedWorkspaceRepository.js";
import { createEncryptedSyncServer, twoDevices } from "../test/encryptedSyncServer.js";
import { describeOperation, diffWorkspaceStates, mergeWorkspaceStates } from "./workspaceMerge.js";

const NEWER = DATA_VERSION + 1;
const student = (id) => createStudent({ id, code: id, fullName: `Student ${id}`, isIndividual: true });

/** A workspace written before the guard existed: no data version at all. */
function legacyState(students = [student("a"), student("b")]) {
  const { dataVersion: _stamp, ...settings } = createStarterState().settings;
  return { ...createStarterState(), settings, students };
}

/** Records as a newer Hibi writes them: a higher data version and a field this build does not know. */
function newerState(base = legacyState()) {
  return {
    ...base,
    settings: { ...base.settings, dataVersion: NEWER },
    students: base.students.map((item) => ({ ...item, fieldFromTheFuture: [{ kept: true }] })),
  };
}

async function storedStudent(server, id) {
  const envelope = server.current().envelopes.find((item) => item.collection === "students" && item.entityId === id);
  return (await decryptEntity({ ...server.session, envelope })).data;
}

async function storedSettings(server) {
  const envelope = server.current().envelopes.find((item) => item.collection === "settings");
  return (await decryptEntity({ ...server.session, envelope })).settings;
}

/** A newer build replacing the cloud records (its own envelopes, never normalized by this build). */
async function publishFromNewerBuild(server, state) {
  const row = server.current();
  const envelopes = await encryptWorkspace({ ...server.session, state, versions: {} });
  const manifest = await createManifest({
    ...server.session,
    envelopes,
    workspaceRevision: row.workspace_revision + 1,
    previousRoot: row.manifest.root,
    operationId: "newer-build",
  });
  const { error } = await server.client.rpc(REPLACE_E2EE_WORKSPACE_RPC, {
    p_expected_workspace_revision: row.workspace_revision,
    p_reason: "replace",
    p_envelopes: envelopes,
    p_manifest: manifest,
  });
  if (error) throw new Error(error.message);
}

const writes = (server) =>
  server.client.rpc.mock.calls.filter(([name]) => [APPLY_E2EE_MUTATION_RPC, REPLACE_E2EE_WORKSPACE_RPC].includes(name));

describe("a tab running an older Hibi", () => {
  it("reads records written by a newer Hibi but never saves over them", async () => {
    const server = await createEncryptedSyncServer(newerState());
    const device = server.device();
    const workspace = await device.loadWorkspace(server.session, "owner");
    // This is the defect being guarded: reading drops the field this build does not know.
    expect(workspace.state.students[0]).not.toHaveProperty("fieldFromTheFuture");
    expect(workspace.state.settings.dataVersion).toBe(NEWER);
    const edit = { ...workspace.state, students: [{ ...workspace.state.students[0], notes: "Edited" }] };

    await expect(device.prepareMutation({ state: edit, workspace, session: server.session })).rejects.toBeInstanceOf(
      NewerDataVersionError,
    );
    await expect(device.replaceWorkspace(edit, server.session, "owner", "restore")).rejects.toMatchObject({
      code: "newer_data_version",
    });
    await expect(device.replaceWorkspace(legacyState(), server.session, "owner", "reset")).rejects.toBeInstanceOf(
      NewerDataVersionError,
    );

    expect(writes(server)).toHaveLength(0);
    expect(server.current().workspace_revision).toBe(1);
    expect(await storedStudent(server, "a")).toMatchObject({ notes: "", fieldFromTheFuture: [{ kept: true }] });
  });

  it("keeps an edit queued before newer records arrived on the device instead of uploading it", async () => {
    const devices = await twoDevices(createStarterState());
    const base = await devices.first.replaceWorkspace(legacyState(), devices.session, "owner");
    const offline = await devices.second.prepareMutation({
      state: { ...base.state, students: [base.state.students[0], { ...base.state.students[1], notes: "Offline" }] },
      workspace: await devices.second.loadWorkspace(devices.session, "owner"),
      session: devices.session,
    });
    await publishFromNewerBuild(devices, newerState(base.state));
    const revision = devices.current().workspace_revision;

    // The edit is first sent on its own (older) base, which the server refuses; nothing is rebased onto the
    // newer records or sent again.
    await expect(devices.second.applyMutation(offline, devices.session, "owner")).rejects.toBeInstanceOf(
      NewerDataVersionError,
    );
    const sent = devices.client.rpc.mock.calls.filter(([name]) => name === APPLY_E2EE_MUTATION_RPC);
    expect(sent).toHaveLength(1);
    expect(sent[0][1].p_expected_workspace_revision).toBe(revision - 1);
    expect(devices.current().workspace_revision).toBe(revision);
    expect(await storedStudent(devices, "b")).toMatchObject({ notes: "", fieldFromTheFuture: [{ kept: true }] });

    // The interface still shows the newer records (and asks for a reload); the queued edit is left untouched.
    const latest = await devices.second.loadWorkspace(devices.session, "owner");
    const entries = [{ id: offline.operationId, mutation: offline, status: "pending" }];
    const projection = await devices.second.projectPendingWorkspace(latest, entries, devices.session);
    expect(projection.workspace).toBe(latest);
    expect(projection.entries).toBe(entries);
    await expect(devices.second.resolveMutation(offline, latest, devices.session)).rejects.toBeInstanceOf(
      NewerDataVersionError,
    );
  });

  it("refuses to rotate the key over records it cannot keep whole", async () => {
    const server = await createEncryptedSyncServer(newerState());
    const device = server.device();
    await device.loadWorkspace(server.session, "owner");
    await expect(
      device.rotateWorkspaceKey({
        oldSession: server.session,
        newMasterKey: server.session.masterKey,
        wrappers: [],
        expectedOwnerId: "owner",
      }),
    ).rejects.toBeInstanceOf(NewerDataVersionError);
    expect(server.client.rpc).not.toHaveBeenCalledWith("begin_staged_workspace_key_rotation", expect.anything());
  });
});

describe("a tab running this Hibi", () => {
  it("stamps its data version with its first save, without counting it as the user's edit", async () => {
    const devices = await twoDevices(legacyState());
    expect(devices.firstBase.state.settings).not.toHaveProperty("dataVersion");

    const untouched = await devices.first.prepareMutation({
      state: devices.firstBase.state,
      workspace: devices.firstBase,
      session: devices.session,
    });
    expect(untouched.empty).toBe(true);

    const state = devices.firstBase.state;
    const first = await devices.first.prepareMutation({
      state: { ...state, students: [{ ...state.students[0], notes: "First" }, state.students[1]] },
      workspace: devices.firstBase,
      session: devices.session,
    });
    expect(first.upserts.map((item) => item.collection).sort()).toEqual(["settings", "students"]);
    expect(first.entityKeys).toEqual(["students/a"]);
    expect(first.state.settings.dataVersion).toBe(DATA_VERSION);
    const saved = await devices.first.applyMutation(first, devices.session, "owner");
    expect(await storedSettings(devices)).toMatchObject({ dataVersion: DATA_VERSION });

    const second = await devices.first.prepareMutation({
      state: { ...saved.state, students: [{ ...saved.state.students[0], notes: "Second" }, saved.state.students[1]] },
      workspace: saved,
      session: devices.session,
    });
    expect(second.upserts.map((item) => item.collection)).toEqual(["students"]);

    // Another device that saved on the unstamped base merges onto the stamp without a conflict.
    const other = await devices.second.prepareMutation({
      state: { ...state, students: [state.students[0], { ...state.students[1], notes: "Other" }] },
      workspace: devices.secondBase,
      session: devices.session,
    });
    const merged = await devices.second.applyMutation(other, devices.session, "owner");
    expect(merged.state.settings.dataVersion).toBe(DATA_VERSION);
    expect(merged.state.students.map((item) => item.notes)).toEqual(["First", "Other"]);
  });

  it("restoring an older backup does not lower the data version", async () => {
    const devices = await twoDevices(createStarterState());
    expect(devices.firstBase.state.settings.dataVersion).toBe(DATA_VERSION);
    const restored = await devices.first.replaceWorkspace(legacyState(), devices.session, "owner", "restore");
    expect(restored.state.settings.dataVersion).toBe(DATA_VERSION);
    expect(await storedSettings(devices)).toMatchObject({ dataVersion: DATA_VERSION });
  });
});

describe("data version merge", () => {
  const settings = (dataVersion) => ({ ...legacyState().settings, ...(dataVersion ? { dataVersion } : {}) });
  const state = (dataVersion, extra = {}) => ({ ...legacyState([]), settings: { ...settings(dataVersion), ...extra } });

  it("takes the highest version and never reports it as a conflict", () => {
    for (const [base, local, remote, expected] of [
      [0, 1, 2, 2],
      [0, 2, 1, 2],
      [1, 1, 0, 1],
      [0, 0, 1, 1],
      [0, 0, 0, undefined],
    ]) {
      const merged = mergeWorkspaceStates({ base: state(base), local: state(local), remote: state(remote) });
      expect(merged.conflicts).toEqual([]);
      expect(merged.state.settings.dataVersion).toBe(expected);
    }
  });

  it("still reports real settings conflicts next to a version change", () => {
    const merged = mergeWorkspaceStates({
      base: state(0, { hourlyRate: 50 }),
      local: state(1, { hourlyRate: 60 }),
      remote: state(2, { hourlyRate: 70 }),
    });
    expect(merged.conflicts).toEqual([
      { collection: "settings", entityId: "__settings__", kind: "field", fields: ["hourlyRate"] },
    ]);
    expect(merged.state.settings.dataVersion).toBe(2);
  });

  it("does not show the stamp as a change to review", () => {
    const before = state(0);
    const after = state(1, { hourlyRate: 60 });
    const diff = diffWorkspaceStates(state(0), state(1));
    expect(diff.settings).toBe(true);
    expect(diff.entityKeys).toEqual([]);
    const { changes } = describeOperation({ previousState: before, state: after }, null);
    expect(changes).toHaveLength(1);
    expect(changes[0].fields.map((item) => item.field)).toEqual(["hourlyRate"]);
  });
});
