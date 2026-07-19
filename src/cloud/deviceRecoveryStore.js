import { deserializeState } from "../domain/index.js";

const DATABASE_NAME = "hibi-device-recovery-v1";
const STORE_NAME = "workspace-copies";
const DATABASE_VERSION = 1;
const MAX_COPIES_PER_ACCOUNT = 8;

export function workspaceCounts(state) {
  return {
    students: Array.isArray(state?.students) ? state.students.length : 0,
    groups: Array.isArray(state?.groups) ? state.groups.length : 0,
    grades: Array.isArray(state?.grades) ? state.grades.length : 0,
    classes: Array.isArray(state?.classLog) ? state.classLog.length : 0,
  };
}

function canonicalState(state) {
  return deserializeState(JSON.stringify(state));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Device recovery storage failed."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Device recovery transaction was aborted."));
    transaction.onerror = () => reject(transaction.error || new Error("Device recovery transaction failed."));
  });
}

function publicMetadata(copy) {
  const { state: _state, ...metadata } = copy;
  return metadata;
}

export function createDeviceRecoveryStore(indexedDb = globalThis.indexedDB) {
  let databasePromise = null;

  function openDatabase() {
    if (!indexedDb?.open) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Device recovery storage is unavailable."));
      request.onblocked = () => reject(new Error("Device recovery storage upgrade was blocked."));
    });
    return databasePromise;
  }

  async function capture({ ownerId, state, revision = null, source = "cloud", updatedAt = null }) {
    if (!ownerId) throw new TypeError("A recovery copy must belong to an account.");
    const database = await openDatabase();
    if (!database) return null;
    const capturedAt = new Date().toISOString();
    const safeState = canonicalState(state);
    const stableRevision = Number.isSafeInteger(Number(revision)) ? Number(revision) : null;
    const id = stableRevision !== null && source !== "pending-save"
      ? `${ownerId}:revision:${stableRevision}`
      : `${ownerId}:${source}:${capturedAt}:${Math.random().toString(36).slice(2)}`;
    const copy = {
      id,
      ownerId,
      state: safeState,
      revision: stableRevision,
      source,
      updatedAt,
      capturedAt,
      counts: workspaceCounts(safeState),
    };

    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const all = await requestResult(store.getAll());
    store.put(copy);
    const owned = all
      .filter((item) => item.ownerId === ownerId && item.id !== id)
      .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)));
    owned.slice(MAX_COPIES_PER_ACCOUNT - 1).forEach((item) => store.delete(item.id));
    await done;
    return publicMetadata(copy);
  }

  async function list(ownerId) {
    const database = await openDatabase();
    if (!database) return [];
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const all = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await done;
    return all
      .filter((copy) => copy.ownerId === ownerId)
      .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))
      .map(publicMetadata);
  }

  async function load(ownerId, copyId) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    const copy = await requestResult(transaction.objectStore(STORE_NAME).get(copyId));
    await done;
    if (!copy || copy.ownerId !== ownerId) return null;
    return { ...publicMetadata(copy), state: canonicalState(copy.state) };
  }

  return { capture, list, load };
}

export const deviceRecoveryStore = createDeviceRecoveryStore();
