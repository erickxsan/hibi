import { describe, expect, it, vi } from "vitest";
import { REAL_ROSTER_BACKUP_KEY, REAL_ROSTER_MIGRATION_KEY, STORAGE_KEY } from "../domain/index.js";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  createAccountDeletionService,
  LEGACY_DATA_CLAIM_KEY,
  MIGRATION_MARKER_PREFIX,
  purgeLocalAccountData,
} from "./accountDeletion.js";

function memoryStorage(entries) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    removeItem: vi.fn((key) => values.delete(key)),
    values,
  };
}

describe("account deletion client", () => {
  it("requests a hard deletion with high-entropy receipt IDs", async () => {
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const invoke = vi.fn(async (_name, { body }) => ({
      data: {
        status: "completed",
        requestId: body.requestId,
        receiptSecret: body.receiptSecret,
        completedAt: "2026-08-12T12:00:00Z",
        verified: true,
      },
      error: null,
    }));
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-a" } }, error: null })) },
      functions: { invoke },
    };
    const service = createAccountDeletionService(client, { randomUUID: vi.fn(() => ids.shift()) });

    await expect(service.removeAccount({ confirmation: ACCOUNT_DELETION_CONFIRMATION })).resolves.toEqual({
      ownerId: "user-a",
      requestId: "11111111-1111-4111-8111-111111111111",
      receiptSecret: "22222222-2222-4222-8222-222222222222",
      completedAt: "2026-08-12T12:00:00Z",
      status: "completed",
      verified: true,
    });
    expect(invoke).toHaveBeenCalledWith("delete-account", {
      body: {
        action: "delete",
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
        requestId: "11111111-1111-4111-8111-111111111111",
        receiptSecret: "22222222-2222-4222-8222-222222222222",
      },
    });
  });

  it("purges only browser data claimed by the deleted account", async () => {
    const storage = memoryStorage({
      [LEGACY_DATA_CLAIM_KEY]: "user-a",
      [STORAGE_KEY]: "private-a",
      [REAL_ROSTER_BACKUP_KEY]: "backup-a",
      [REAL_ROSTER_MIGRATION_KEY]: "migrated-a",
      [`${MIGRATION_MARKER_PREFIX}user-a`]: "3",
      [`${MIGRATION_MARKER_PREFIX}user-b`]: "8",
      "minimal-class-manager:ui:v1:user-a": "ui-a",
      "minimal-class-manager:ui:v1:user-b": "ui-b",
    });
    const recoveryStore = { purgeAccount: vi.fn(async () => undefined) };

    await purgeLocalAccountData("user-a", { storage, recoveryStore });

    expect(recoveryStore.purgeAccount).toHaveBeenCalledWith("user-a");
    expect(storage.values.has(STORAGE_KEY)).toBe(false);
    expect(storage.values.has(REAL_ROSTER_BACKUP_KEY)).toBe(false);
    expect(storage.values.has(REAL_ROSTER_MIGRATION_KEY)).toBe(false);
    expect(storage.values.has(LEGACY_DATA_CLAIM_KEY)).toBe(false);
    expect(storage.values.has(`${MIGRATION_MARKER_PREFIX}user-a`)).toBe(false);
    expect(storage.values.has("minimal-class-manager:ui:v1:user-a")).toBe(false);
    expect(storage.values.get(`${MIGRATION_MARKER_PREFIX}user-b`)).toBe("8");
    expect(storage.values.get("minimal-class-manager:ui:v1:user-b")).toBe("ui-b");
  });

  it("does not remove an unclaimed legacy copy while purging another account", async () => {
    const storage = memoryStorage({
      [LEGACY_DATA_CLAIM_KEY]: "user-b",
      [STORAGE_KEY]: "private-b",
    });
    await purgeLocalAccountData("user-a", {
      storage,
      recoveryStore: { purgeAccount: vi.fn(async () => undefined) },
    });
    expect(storage.values.get(STORAGE_KEY)).toBe("private-b");
    expect(storage.values.get(LEGACY_DATA_CLAIM_KEY)).toBe("user-b");
  });

  it("still purges localStorage when IndexedDB cleanup fails", async () => {
    const storage = memoryStorage({
      [LEGACY_DATA_CLAIM_KEY]: "user-a",
      [STORAGE_KEY]: "private-a",
      [`${MIGRATION_MARKER_PREFIX}user-a`]: "3",
      "minimal-class-manager:ui:v1:user-a": "ui-a",
    });
    const indexedDbError = new Error("IndexedDB blocked");

    await expect(
      purgeLocalAccountData("user-a", {
        storage,
        recoveryStore: { purgeAccount: vi.fn(async () => Promise.reject(indexedDbError)) },
      }),
    ).rejects.toThrow("Some browser data could not be purged.");

    expect(storage.values.has(STORAGE_KEY)).toBe(false);
    expect(storage.values.has(`${MIGRATION_MARKER_PREFIX}user-a`)).toBe(false);
    expect(storage.values.has("minimal-class-manager:ui:v1:user-a")).toBe(false);
  });
});
