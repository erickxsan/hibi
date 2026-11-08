import { IDBFactory, forceCloseDatabase } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createDeviceKeyStore } from "./deviceKeyStore.js";
import { generateAccountMasterKey, generateWorkspaceCryptoId } from "./workspaceCrypto.js";

describe("remembered-device AMK storage", () => {
  for (const phase of ["idle", "encrypt", "decrypt"]) {
    it(`recovers a connection closed during ${phase} without replacing keys or losing integrity witnesses`, async () => {
      const factory = new IDBFactory();
      let database;
      let opens = 0;
      let armed = false;
      const indexedDb = {
        open(...args) {
          opens++;
          const request = factory.open(...args);
          request.addEventListener("success", () => (database = request.result));
          return request;
        },
      };
      const cryptoApi = {
        getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        randomUUID: globalThis.crypto.randomUUID.bind(globalThis.crypto),
        subtle: {
          generateKey: globalThis.crypto.subtle.generateKey.bind(globalThis.crypto.subtle),
          encrypt(...args) {
            if (armed && phase === "encrypt") {
              armed = false;
              database.close();
            }
            return globalThis.crypto.subtle.encrypt(...args);
          },
          decrypt(...args) {
            if (armed && phase === "decrypt") {
              armed = false;
              database.close();
            }
            return globalThis.crypto.subtle.decrypt(...args);
          },
        },
      };
      const store = createDeviceKeyStore(indexedDb, cryptoApi);
      const masterKey = generateAccountMasterKey();
      const workspaceCryptoId = generateWorkspaceCryptoId();
      const account = { ownerId: "owner", workspaceCryptoId };
      await store.remember({ ...account, masterKey });
      await store.writeIntegrity({ ...account, revision: 7, root: "verified-root" });
      const remembered = await store.describe("owner");
      armed = true;
      if (phase === "idle") forceCloseDatabase(database);
      if (phase === "encrypt") await store.remember({ ...account, masterKey });
      await expect(store.unlock(account)).resolves.toEqual(masterKey);
      expect(opens).toBe(2);
      await expect(store.describe("owner")).resolves.toMatchObject({ deviceId: remembered.deviceId });
      await expect(store.readIntegrity(account)).resolves.toEqual({ revision: 7, root: "verified-root" });
      await store.writeIntegrity({ ...account, revision: 8, root: "new-root" });
      const reopened = createDeviceKeyStore(factory, globalThis.crypto);
      await expect(reopened.unlock(account)).resolves.toEqual(masterKey);
      await expect(reopened.readIntegrity(account)).resolves.toEqual({ revision: 8, root: "new-root" });
    });
  }

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
