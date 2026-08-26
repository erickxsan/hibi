import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createDeviceKeyStore } from "./deviceKeyStore.js";
import { generateAccountMasterKey, generateWorkspaceCryptoId } from "./workspaceCrypto.js";

describe("remembered-device AMK storage", () => {
  it("keeps a non-extractable device key and binds the wrapped AMK to the account and workspace", async () => {
    const indexedDb = new IDBFactory();
    const store = createDeviceKeyStore(indexedDb, globalThis.crypto);
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    await store.remember({ ownerId: "owner-a", workspaceCryptoId, masterKey });

    await expect(store.unlock({ ownerId: "owner-a", workspaceCryptoId })).resolves.toEqual(masterKey);
    await expect(store.unlock({ ownerId: "owner-b", workspaceCryptoId })).resolves.toBeNull();
    await expect(store.unlock({ ownerId: "owner-a", workspaceCryptoId: "other-workspace" })).resolves.toBeNull();

    const database = await new Promise((resolve, reject) => {
      const request = indexedDb.open("hibi-workspace-keys-v1", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise((resolve, reject) => {
      const request = database.transaction("device-keys", "readonly").objectStore("device-keys").get("owner-a");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stored.key.extractable).toBe(false);
    await store.writeIntegrity({ ownerId: "owner-a", workspaceCryptoId, revision: 9, root: "verified-root" });
    await expect(store.readIntegrity({ ownerId: "owner-a", workspaceCryptoId })).resolves.toEqual({
      revision: 9,
      root: "verified-root",
    });
  });

  it("forgets only the selected account", async () => {
    const indexedDb = new IDBFactory();
    const store = createDeviceKeyStore(indexedDb, globalThis.crypto);
    const workspaceCryptoId = generateWorkspaceCryptoId();
    await store.remember({ ownerId: "owner-a", workspaceCryptoId, masterKey: generateAccountMasterKey() });
    await store.remember({ ownerId: "owner-b", workspaceCryptoId, masterKey: generateAccountMasterKey() });
    await store.forget("owner-a");
    await expect(store.describe("owner-a")).resolves.toBeNull();
    await expect(store.describe("owner-b")).resolves.toMatchObject({ ownerId: "owner-b" });
  });
});
