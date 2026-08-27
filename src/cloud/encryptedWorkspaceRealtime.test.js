import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain/index.js";
import {
  createManifest,
  encryptWorkspace,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
} from "../crypto/index.js";
import { createEncryptedWorkspaceRepository, E2EE_EVENTS_TABLE } from "./encryptedWorkspaceRepository.js";

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("encrypted workspace live synchronization", () => {
  afterEach(() => vi.useRealTimers());

  it("retries a failed live refresh and reports synchronization recovery", async () => {
    vi.useFakeTimers();
    const user = { id: "44444444-4444-4444-8444-444444444444" };
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const state = createStarterState();
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state });
    const manifest = await createManifest({
      masterKey,
      workspaceCryptoId,
      envelopes,
      workspaceRevision: 1,
      operationId: "55555555-5555-4555-8555-555555555555",
    });
    const eventResponses = [
      { data: null, error: { message: "temporary live query failure" } },
      { data: [], error: null },
    ];
    let eventQueryCount = 0;
    let statusCallback;
    const channel = {
      on: vi.fn(function on() {
        return this;
      }),
      subscribe: vi.fn(function subscribe(callback) {
        statusCallback = callback;
        return this;
      }),
    };
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
        refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      },
      rpc: vi.fn(async (name) => {
        if (name !== "load_encrypted_workspace") throw new Error(`Unexpected RPC: ${name}`);
        return {
          data: [
            {
              workspace_crypto_id: workspaceCryptoId,
              workspace_revision: 1,
              active_key_version: 1,
              migration_status: "active",
              envelopes,
              manifest,
              updated_at: "2026-08-26T00:00:00.000Z",
            },
          ],
          error: null,
        };
      }),
      from(table) {
        expect(table).toBe(E2EE_EVENTS_TABLE);
        const query = {
          select: () => query,
          eq: () => query,
          gt: () => query,
          order: () => query,
          limit: async () => {
            eventQueryCount += 1;
            return eventResponses.shift();
          },
        };
        return query;
      },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
    };
    const session = { masterKey, workspaceCryptoId, keyVersion: 1 };
    const repository = createEncryptedWorkspaceRepository(client, { allowWrites: true });
    await repository.loadWorkspace(session, user.id);
    const statuses = [];
    const errors = [];
    const changes = [];
    const unsubscribe = await repository.subscribe(session, (workspace) => changes.push(workspace), {
      userId: user.id,
      onStatus: (status) => statuses.push(status),
      onError: (error) => errors.push(error),
    });

    statusCallback("SUBSCRIBED");
    await flushMicrotasks();

    expect(eventQueryCount).toBe(1);
    expect(errors).toHaveLength(1);
    expect(statuses).toEqual(["SUBSCRIBED"]);

    await vi.advanceTimersByTimeAsync(2_000);
    await flushMicrotasks();

    expect(eventQueryCount).toBe(2);
    expect(changes).toHaveLength(1);
    expect(statuses).toEqual(["SUBSCRIBED", "SYNCED"]);

    await unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
  });
});
