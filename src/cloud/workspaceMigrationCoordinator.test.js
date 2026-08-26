import { describe, expect, it, vi } from "vitest";
import { runExclusiveWorkspaceMigration, WorkspaceMigrationInProgressError } from "./workspaceMigrationCoordinator.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

class FakeChannel {
  static messages = [];
  postMessage(value) {
    FakeChannel.messages.push(value);
  }
  close() {}
}

describe("workspace migration coordination", () => {
  it("runs once, signals other tabs, and releases its fallback lease", async () => {
    FakeChannel.messages = [];
    const storage = memoryStorage();
    await expect(
      runExclusiveWorkspaceMigration("owner-1", async () => "done", {
        navigatorApi: {},
        BroadcastChannelApi: FakeChannel,
        storage,
        now: () => 100,
        randomUUID: () => "token-1",
      }),
    ).resolves.toBe("done");
    expect(storage.values.size).toBe(0);
    expect(FakeChannel.messages.map((message) => message.type)).toEqual(["started", "finished"]);
  });

  it("rejects a second tab while the first migration is running", async () => {
    const storage = memoryStorage();
    let release;
    const first = runExclusiveWorkspaceMigration("owner-2", () => new Promise((resolve) => (release = resolve)), {
      navigatorApi: {},
      BroadcastChannelApi: null,
      storage,
      randomUUID: () => "first",
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(
      runExclusiveWorkspaceMigration("owner-2", async () => true, {
        navigatorApi: {},
        BroadcastChannelApi: null,
        storage,
        randomUUID: () => "second",
      }),
    ).rejects.toBeInstanceOf(WorkspaceMigrationInProgressError);
    release("finished");
    await expect(first).resolves.toBe("finished");
  });

  it("uses the Web Locks API without waiting behind an existing tab", async () => {
    const locks = { request: vi.fn((_name, options, callback) => callback(null)) };
    await expect(
      runExclusiveWorkspaceMigration("owner-3", async () => true, {
        navigatorApi: { locks },
        BroadcastChannelApi: null,
        storage: memoryStorage(),
      }),
    ).rejects.toMatchObject({ code: "migration_in_progress" });
    expect(locks.request).toHaveBeenCalledWith(
      expect.stringContaining("owner-3"),
      expect.objectContaining({ ifAvailable: true, mode: "exclusive" }),
      expect.any(Function),
    );
  });
});
