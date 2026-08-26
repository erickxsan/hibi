import { canonicalBytes } from "./canonical.js";
import { decodeUtf8, fromBase64Url, toBase64Url } from "./encoding.js";

const DATABASE_NAME = "hibi-workspace-keys-v1";
const DATABASE_VERSION = 2;
const KEY_STORE = "device-keys";
const WRAPPER_STORE = "device-wrappers";
const INTEGRITY_STORE = "integrity-witnesses";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Device key storage failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Device key transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("Device key transaction failed."));
  });
}

export function createDeviceKeyStore(indexedDb = globalThis.indexedDB, cryptoApi = globalThis.crypto) {
  let databasePromise;

  function openDatabase() {
    if (!indexedDb?.open) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(KEY_STORE))
          database.createObjectStore(KEY_STORE, { keyPath: "ownerId" });
        if (!database.objectStoreNames.contains(WRAPPER_STORE))
          database.createObjectStore(WRAPPER_STORE, { keyPath: "ownerId" });
        if (!database.objectStoreNames.contains(INTEGRITY_STORE))
          database.createObjectStore(INTEGRITY_STORE, { keyPath: "ownerId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Device key storage is unavailable."));
      request.onblocked = () => reject(new Error("Close other Hibi tabs before changing remembered-device access."));
    });
    return databasePromise;
  }

  async function remember({ ownerId, workspaceCryptoId, masterKey, keyVersion = 1 }) {
    const database = await openDatabase();
    if (!database || !cryptoApi?.subtle) throw new Error("This browser cannot remember the workspace securely.");
    const key = await cryptoApi.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const nonce = cryptoApi.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: canonicalBytes({ ownerId, workspaceCryptoId }) },
      key,
      masterKey,
    );
    const now = new Date().toISOString();
    const transaction = database.transaction([KEY_STORE, WRAPPER_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(KEY_STORE).put({ ownerId, key });
    transaction.objectStore(WRAPPER_STORE).put({
      ownerId,
      workspaceCryptoId,
      keyVersion,
      nonce: toBase64Url(nonce),
      wrappedKey: toBase64Url(ciphertext),
      deviceId: cryptoApi.randomUUID(),
      createdAt: now,
      lastUsedAt: now,
    });
    await done;
    return true;
  }

  async function unlock({ ownerId, workspaceCryptoId, expectedKeyVersion }) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction([KEY_STORE, WRAPPER_STORE], "readonly");
    const done = transactionDone(transaction);
    const [storedKey, wrapper] = await Promise.all([
      requestResult(transaction.objectStore(KEY_STORE).get(ownerId)),
      requestResult(transaction.objectStore(WRAPPER_STORE).get(ownerId)),
    ]);
    await done;
    if (
      !storedKey?.key ||
      !wrapper ||
      wrapper.workspaceCryptoId !== workspaceCryptoId ||
      (expectedKeyVersion && Number(wrapper.keyVersion || 1) !== Number(expectedKeyVersion))
    )
      return null;
    try {
      const plaintext = await cryptoApi.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(wrapper.nonce),
          additionalData: canonicalBytes({ ownerId, workspaceCryptoId }),
        },
        storedKey.key,
        fromBase64Url(wrapper.wrappedKey),
      );
      const masterKey = new Uint8Array(plaintext);
      if (masterKey.byteLength !== 32) return null;
      const write = database.transaction(WRAPPER_STORE, "readwrite");
      const writeDone = transactionDone(write);
      write.objectStore(WRAPPER_STORE).put({ ...wrapper, lastUsedAt: new Date().toISOString() });
      await writeDone;
      return masterKey;
    } catch {
      return null;
    }
  }

  async function describe(ownerId) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction(WRAPPER_STORE, "readonly");
    const done = transactionDone(transaction);
    const wrapper = await requestResult(transaction.objectStore(WRAPPER_STORE).get(ownerId));
    await done;
    return wrapper || null;
  }

  async function writeIntegrity({ ownerId, workspaceCryptoId, revision, root }) {
    const database = await openDatabase();
    if (!database) return false;
    const read = database.transaction(KEY_STORE, "readonly");
    const readDone = transactionDone(read);
    const storedKey = await requestResult(read.objectStore(KEY_STORE).get(ownerId));
    await readDone;
    if (!storedKey?.key) return false;
    const nonce = cryptoApi.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoApi.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: canonicalBytes({ ownerId, workspaceCryptoId, purpose: "integrity-witness" }),
      },
      storedKey.key,
      new TextEncoder().encode(JSON.stringify({ revision, root })),
    );
    const write = database.transaction(INTEGRITY_STORE, "readwrite");
    const done = transactionDone(write);
    write.objectStore(INTEGRITY_STORE).put({
      ownerId,
      workspaceCryptoId,
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(ciphertext),
    });
    await done;
    return true;
  }

  async function readIntegrity({ ownerId, workspaceCryptoId }) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction([KEY_STORE, INTEGRITY_STORE], "readonly");
    const done = transactionDone(transaction);
    const [storedKey, witness] = await Promise.all([
      requestResult(transaction.objectStore(KEY_STORE).get(ownerId)),
      requestResult(transaction.objectStore(INTEGRITY_STORE).get(ownerId)),
    ]);
    await done;
    if (!storedKey?.key || !witness || witness.workspaceCryptoId !== workspaceCryptoId) return null;
    try {
      const plaintext = await cryptoApi.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(witness.nonce),
          additionalData: canonicalBytes({ ownerId, workspaceCryptoId, purpose: "integrity-witness" }),
        },
        storedKey.key,
        fromBase64Url(witness.ciphertext),
      );
      return JSON.parse(decodeUtf8(plaintext));
    } catch {
      return null;
    }
  }

  async function forget(ownerId) {
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction([KEY_STORE, WRAPPER_STORE, INTEGRITY_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(KEY_STORE).delete(ownerId);
    transaction.objectStore(WRAPPER_STORE).delete(ownerId);
    transaction.objectStore(INTEGRITY_STORE).delete(ownerId);
    await done;
  }

  return { remember, unlock, describe, writeIntegrity, readIntegrity, forget };
}

export const deviceKeyStore = createDeviceKeyStore();
