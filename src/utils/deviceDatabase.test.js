import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createDeviceDatabase } from "./deviceDatabase.js";

function connection(indexedDb) {
  return createDeviceDatabase(indexedDb, {
    name: "connection-test",
    version: 1,
    upgrade: (database) => database.createObjectStore("rows"),
    unavailableMessage: "Unavailable",
    blockedMessage: "Blocked",
  });
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("device database connection recovery", () => {
  for (const failure of ["sync", "async"]) {
    it(`does not cache a failed ${failure} opening attempt`, async () => {
      const factory = new IDBFactory();
      const error = new DOMException("Temporarily unavailable", "UnknownError");
      const indexedDb = {
        open: vi
          .fn()
          .mockImplementationOnce(() => {
            if (failure === "sync") throw error;
            const request = { error, onerror: null };
            queueMicrotask(() => request.onerror());
            return request;
          })
          .mockImplementation((...args) => factory.open(...args)),
      };
      const store = connection(indexedDb);
      await expect(store.open()).rejects.toBe(error);
      await expect(store.open()).resolves.toHaveProperty("transaction");
      expect(indexedDb.open).toHaveBeenCalledTimes(2);
    });
  }

  it("limits reconnects to one retry when every new connection is also closed", async () => {
    const factory = new IDBFactory();
    const indexedDb = {
      open: vi.fn((...args) => {
        const request = factory.open(...args);
        request.addEventListener("success", () => request.result.close());
        return request;
      }),
    };
    const store = connection(indexedDb);
    const read = store.retry(async () => {
      const database = await store.open();
      return database.transaction("rows", "readonly");
    });
    await expect(read()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(indexedDb.open).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated errors even if their name is InvalidStateError", async () => {
    const store = connection(new IDBFactory());
    const error = new DOMException("Not a connection error", "InvalidStateError");
    const operation = vi.fn(async () => {
      throw error;
    });
    await expect(store.retry(operation)()).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("closes its old connection so another tab can upgrade without being blocked", async () => {
    const factory = new IDBFactory();
    await connection(factory).open();
    const upgrade = factory.open("connection-test", 2);
    const database = await new Promise((resolve, reject) => {
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
      upgrade.onblocked = () => reject(new Error("The old tab blocked the upgrade"));
    });
    database.close();
  });

  it("closes a late successful open after a blocked attempt and allows subsequent recovery", async () => {
    const factory = new IDBFactory();
    const blocker = await result(factory.open("connection-test", 1));
    let lateSuccess;
    const succeeded = new Promise((resolve) => {
      lateSuccess = resolve;
    });
    const indexedDb = {
      open(...args) {
        const request = factory.open(...args);
        request.addEventListener("success", lateSuccess, { once: true });
        return request;
      },
    };
    const store = createDeviceDatabase(indexedDb, {
      name: "connection-test",
      version: 2,
      upgrade: (database) => database.createObjectStore("rows"),
      unavailableMessage: "Unavailable",
      blockedMessage: "Blocked",
    });
    await expect(store.open()).rejects.toThrow("Blocked");
    blocker.close();
    await succeeded;
    // The rejected request must not leave a hidden connection blocking deletion.
    const deletion = factory.deleteDatabase("connection-test");
    await new Promise((resolve, reject) => {
      deletion.onsuccess = resolve;
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(new Error("An orphan connection blocked deletion"));
    });
    await expect(store.open()).resolves.toHaveProperty("transaction");
  });
});
