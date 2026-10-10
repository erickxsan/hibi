import { describe, expect, it } from "vitest";
import { createStarterState, createStudent } from "../domain/index.js";
import { createEncryptedSyncServer } from "../test/encryptedSyncServer.js";

describe("server-controlled staged recovery retention", () => {
  it("lists and decrypts an old recovery copy while server policy still permits it", async () => {
    const state = {
      ...createStarterState(),
      students: [createStudent({ id: "historical", code: "H", fullName: "Historical student", isIndividual: true })],
    };
    const server = await createEncryptedSyncServer(state);
    const capturedAt = new Date(Date.now() - 45 * 86400000).toISOString();
    server.snapshots.push({
      ...server.current(),
      id: "historical-copy",
      owner_id: "owner",
      source_revision: 1,
      reason: "reset",
      original_created_at: capturedAt,
      created_at: capturedAt,
      expires_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    });
    const repository = server.device();
    expect(await repository.listSnapshots("owner")).toMatchObject([{ id: "historical-copy", capturedAt }]);
    const restored = await repository.loadSnapshot("historical-copy", server.session, "owner");
    expect(restored.state.students[0].fullName).toBe("Historical student");
  });

  it("returns no copy when the server's activated policy denies access", async () => {
    const server = await createEncryptedSyncServer(createStarterState());
    expect(await server.device().listSnapshots("owner")).toEqual([]);
    expect(await server.device().loadSnapshot("expired-copy", server.session, "owner")).toBeNull();
  });
});
