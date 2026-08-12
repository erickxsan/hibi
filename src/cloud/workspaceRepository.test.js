import { describe, expect, it, vi } from "vitest";
import { createStarterState, createStudent } from "../domain/index.js";
import {
  APPLY_IMPORT_RPC,
  createWorkspaceRepository,
  LOAD_WORKSPACE_RPC,
  REPLACE_WORKSPACE_RPC,
  RESET_WORKSPACE_RPC,
  RESTORE_WORKSPACE_RPC,
  SAVE_WORKSPACE_RPC,
  WORKSPACE_CHANGE_EVENTS_TABLE,
  WorkspaceConflictError,
} from "./workspaceRepository.js";

function workspaceRow(state = createStarterState(), revision = 4, versions = {}) {
  return {
    owner_id: "user-1",
    state,
    versions: { settings: { __settings__: 1 }, ...versions },
    revision,
    updated_at: "2026-08-12T12:00:00Z",
  };
}

function authenticatedClient(overrides = {}) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })) },
    ...overrides,
  };
}

function eventQuery(result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(async () => result),
  };
  return query;
}

describe("normalized workspace repository", () => {
  it("loads and validates the reconstructed workspace through one RPC", async () => {
    const state = createStarterState();
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({ data: [workspaceRow(state)], error: null })),
    });

    const result = await createWorkspaceRepository(client).loadWorkspace("user-1");

    expect(client.rpc).toHaveBeenCalledWith(LOAD_WORKSPACE_RPC, { p_expected_owner_id: "user-1" });
    expect(result).toMatchObject({ state, revision: 4 });
  });

  it("sends only a changed entity and its own expected revision", async () => {
    const before = createStarterState();
    before.students = [createStudent({ id: "s1", code: "A-1", fullName: "Ana", groupIds: [] })];
    const after = { ...before, students: [{ ...before.students[0], fullName: "Ana P." }] };
    const rpc = vi.fn(async (name) =>
      name === LOAD_WORKSPACE_RPC
        ? { data: [workspaceRow(before, 8, { students: { s1: 6 } })], error: null }
        : { data: [{ event_id: 9, updated_at: "2026-08-12T12:01:00Z" }], error: null },
    );
    const repository = createWorkspaceRepository(authenticatedClient({ rpc }));
    await repository.loadWorkspace("user-1");

    const operationId = "33333333-3333-4333-8333-333333333333";
    const result = await repository.saveWorkspace(after, 8, "user-1", before, operationId);

    expect(rpc).toHaveBeenLastCalledWith(SAVE_WORKSPACE_RPC, {
      p_expected_owner_id: "user-1",
      p_operation_id: operationId,
      p_patch: {
        students: { upserts: [{ data: after.students[0], position: 0 }], deletes: [] },
      },
      p_expected_versions: { students: { s1: 6 } },
    });
    expect(result).toMatchObject({ state: after, revision: 9 });
  });

  it("does not contact the write RPC for a no-op", async () => {
    const state = createStarterState();
    const rpc = vi.fn(async () => ({ data: [workspaceRow(state)], error: null }));
    const repository = createWorkspaceRepository(authenticatedClient({ rpc }));
    await repository.loadWorkspace("user-1");

    await repository.saveWorkspace(state, 4, "user-1", state);

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reloads canonical state only when the same entity conflicts", async () => {
    const before = createStarterState();
    const latest = createStarterState();
    latest.settings.hourlyRate = 80;
    let loads = 0;
    const rpc = vi.fn(async (name) => {
      if (name === LOAD_WORKSPACE_RPC) {
        loads += 1;
        return { data: [workspaceRow(loads === 1 ? before : latest, loads === 1 ? 2 : 3)], error: null };
      }
      return { data: null, error: { code: "40001", message: "workspace_entity_conflict" } };
    });
    const repository = createWorkspaceRepository(authenticatedClient({ rpc }));
    await repository.loadWorkspace("user-1");

    const error = await repository.saveWorkspace(latest, 2, "user-1", before).catch((caught) => caught);

    expect(error).toBeInstanceOf(WorkspaceConflictError);
    expect(error.latestState.settings.hourlyRate).toBe(80);
    expect(error.latestRevision).toBe(3);
  });

  it("keeps full replacement, import, restore, and reset as explicit RPCs", async () => {
    const state = createStarterState();
    const rpc = vi.fn(async (name) => {
      if (name === RESTORE_WORKSPACE_RPC || name === RESET_WORKSPACE_RPC) {
        return { data: [workspaceRow(state, name === RESET_WORKSPACE_RPC ? 13 : 12)], error: null };
      }
      return { data: [{ event_id: 11, updated_at: null, versions: {}, already_imported: false }], error: null };
    });
    const repository = createWorkspaceRepository(authenticatedClient({ rpc }));

    await repository.replaceWorkspace(state, 10, "user-1");
    await repository.applyWorkspaceImport(state, 10, "user-1", {
      fileHash: "a".repeat(64),
      sourceName: "backup.json",
      summary: {},
    });
    await repository.restoreRecoverySnapshot("snapshot-1", 11, "user-1");
    await repository.resetWorkspace(12, "user-1");

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      REPLACE_WORKSPACE_RPC,
      APPLY_IMPORT_RPC,
      RESTORE_WORKSPACE_RPC,
      RESET_WORKSPACE_RPC,
    ]);
    expect(rpc).toHaveBeenLastCalledWith(RESET_WORKSPACE_RPC, {
      p_expected_owner_id: "user-1",
      p_expected_revision: 12,
      p_confirmation: "reset:12",
    });
  });

  it("replays small ordered patches after a Realtime event", async () => {
    const initial = createStarterState();
    const query = eventQuery({
      data: [
        {
          owner_id: "user-1",
          revision: 2,
          patch: { settings: { ...initial.settings, hourlyRate: 75 } },
          updated_at: "2026-08-12T12:02:00Z",
        },
      ],
      error: null,
    });
    let handler;
    const channel = {
      on: vi.fn((_kind, _filter, callback) => {
        handler = callback;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const client = authenticatedClient({
      rpc: vi.fn(async () => ({ data: [workspaceRow(initial, 1)], error: null })),
      from: vi.fn(() => query),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    });
    const repository = createWorkspaceRepository(client);
    await repository.loadWorkspace("user-1");
    const onChange = vi.fn();
    const unsubscribe = await repository.subscribeToWorkspace(onChange, { userId: "user-1" });

    handler({ new: { owner_id: "user-1", revision: 2 } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(onChange.mock.calls.at(-1)[0].state.settings.hourlyRate).toBe(75);
    expect(query.gt).toHaveBeenCalledWith("revision", 1);
    expect(client.from).toHaveBeenCalledWith(WORKSPACE_CHANGE_EVENTS_TABLE);
    await unsubscribe();
  });

  it("falls back to one full reload for a destructive reload event", async () => {
    const initial = createStarterState();
    const replaced = createStarterState();
    replaced.settings.hourlyRate = 90;
    let loadCount = 0;
    const query = eventQuery({
      data: [{ owner_id: "user-1", revision: 2, patch: { reload: true }, updated_at: null }],
      error: null,
    });
    let statusCallback;
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn((callback) => {
        statusCallback = callback;
        return channel;
      }),
    };
    const client = authenticatedClient({
      rpc: vi.fn(async () => {
        loadCount += 1;
        return { data: [workspaceRow(loadCount === 1 ? initial : replaced, loadCount)], error: null };
      }),
      from: vi.fn(() => query),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    });
    const repository = createWorkspaceRepository(client);
    await repository.loadWorkspace("user-1");
    const onChange = vi.fn();
    const unsubscribe = await repository.subscribeToWorkspace(onChange, { userId: "user-1" });

    statusCallback("SUBSCRIBED");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)[0].state.settings.hourlyRate).toBe(90);
    expect(loadCount).toBe(2);
    await unsubscribe();
  });

  it("blocks preview writes before contacting Supabase", async () => {
    const client = authenticatedClient({ rpc: vi.fn() });
    await expect(
      createWorkspaceRepository(client, { allowWrites: false }).saveWorkspace(createStarterState(), 0, "user-1"),
    ).rejects.toThrow("Cloud writes are disabled");
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });
});
