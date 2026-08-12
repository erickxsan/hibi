import { deserializeState } from "../domain/index.js";

const DATABASE_NAME = "hibi-device-recovery-v1";
const RECOVERY_STORE = "workspace-copies";
const CACHE_STORE = "workspace-cache";
const OUTBOX_STORE = "workspace-outbox";
const KEY_STORE = "encryption-keys";
const DATABASE_VERSION = 2;
const MAX_COPIES_PER_ACCOUNT = 8;
const MAX_OUTBOX_OPERATIONS = 100;
const AUTOMATIC_BACKUP_SOURCE = "automatic-local";

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

function canonicalWorkspace(workspace) {
  return {
    state: canonicalState(workspace?.state),
    versions: workspace?.versions && typeof workspace.versions === "object" ? workspace.versions : {},
    revision: Number.isSafeInteger(Number(workspace?.revision)) ? Number(workspace.revision) : 0,
    updatedAt: workspace?.updatedAt ?? null,
  };
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
  const { state: _state, payload: _payload, ...metadata } = copy;
  return metadata;
}

export function createDeviceRecoveryStore(indexedDb = globalThis.indexedDB, cryptoApi = globalThis.crypto) {
  let databasePromise = null;
  const keyPromises = new Map();

  function openDatabase() {
    if (!indexedDb?.open) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECOVERY_STORE))
          database.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(CACHE_STORE))
          database.createObjectStore(CACHE_STORE, { keyPath: "ownerId" });
        if (!database.objectStoreNames.contains(OUTBOX_STORE))
          database.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(KEY_STORE))
          database.createObjectStore(KEY_STORE, { keyPath: "ownerId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Device recovery storage is unavailable."));
      request.onblocked = () => reject(new Error("Device recovery storage upgrade was blocked."));
    });
    return databasePromise;
  }

  async function encryptionKey(database, ownerId) {
    if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues)
      throw new Error("Encrypted device storage is unavailable in this browser.");
    if (keyPromises.has(ownerId)) return keyPromises.get(ownerId);
    const keyPromise = (async () => {
      const read = database.transaction(KEY_STORE, "readonly");
      const readDone = transactionDone(read);
      const existing = await requestResult(read.objectStore(KEY_STORE).get(ownerId));
      await readDone;
      if (existing?.key) return existing.key;
      const key = await cryptoApi.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      const write = database.transaction(KEY_STORE, "readwrite");
      const writeDone = transactionDone(write);
      write.objectStore(KEY_STORE).put({ ownerId, key });
      await writeDone;
      return key;
    })();
    keyPromises.set(ownerId, keyPromise);
    try {
      return await keyPromise;
    } catch (error) {
      keyPromises.delete(ownerId);
      throw error;
    }
  }

  async function seal(database, ownerId, value) {
    const key = await encryptionKey(database, ownerId);
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(ownerId);
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, plaintext);
    return { version: 1, iv, ciphertext };
  }

  async function unseal(database, ownerId, payload) {
    if (!payload || payload.version !== 1) throw new Error("This encrypted device copy uses an unsupported format.");
    const key = await encryptionKey(database, ownerId);
    const additionalData = new TextEncoder().encode(ownerId);
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: payload.iv, additionalData },
      key,
      payload.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  async function capture({ ownerId, state, revision = null, source = "cloud", updatedAt = null }) {
    if (!ownerId) throw new TypeError("A recovery copy must belong to an account.");
    const database = await openDatabase();
    if (!database) return null;
    const capturedAt = new Date().toISOString();
    const safeState = canonicalState(state);
    const stableRevision = Number.isSafeInteger(Number(revision)) ? Number(revision) : null;
    const id =
      source === AUTOMATIC_BACKUP_SOURCE
        ? `${ownerId}:${AUTOMATIC_BACKUP_SOURCE}`
        : stableRevision !== null
          ? `${ownerId}:revision:${stableRevision}`
          : `${ownerId}:${source}:${capturedAt}:${Math.random().toString(36).slice(2)}`;
    const copy = {
      id,
      ownerId,
      payload: await seal(database, ownerId, safeState),
      revision: stableRevision,
      source,
      updatedAt,
      capturedAt,
      counts: workspaceCounts(safeState),
      encrypted: true,
    };

    const transaction = database.transaction(RECOVERY_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(RECOVERY_STORE);
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
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const done = transactionDone(transaction);
    const all = await requestResult(transaction.objectStore(RECOVERY_STORE).getAll());
    await done;
    const owned = all
      .filter((copy) => copy.ownerId === ownerId)
      .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)));
    await Promise.all(
      owned.map(async (copy) => canonicalState(copy.state || (await unseal(database, ownerId, copy.payload)))),
    );
    return owned.map(publicMetadata);
  }

  async function load(ownerId, copyId) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction(RECOVERY_STORE, "readonly");
    const done = transactionDone(transaction);
    const copy = await requestResult(transaction.objectStore(RECOVERY_STORE).get(copyId));
    await done;
    if (!copy || copy.ownerId !== ownerId) return null;
    const state = copy.state
      ? canonicalState(copy.state)
      : canonicalState(await unseal(database, ownerId, copy.payload));
    return { ...publicMetadata(copy), state };
  }

  async function cacheWorkspace(ownerId, workspace) {
    const database = await openDatabase();
    if (!database) return null;
    const safeWorkspace = canonicalWorkspace(workspace);
    const payload = await seal(database, ownerId, safeWorkspace);
    const transaction = database.transaction(CACHE_STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(CACHE_STORE).put({
      ownerId,
      payload,
      cachedAt: new Date().toISOString(),
      encrypted: true,
    });
    await done;
    return safeWorkspace;
  }

  async function loadWorkspaceCache(ownerId) {
    const database = await openDatabase();
    if (!database) return null;
    const transaction = database.transaction(CACHE_STORE, "readonly");
    const done = transactionDone(transaction);
    const cached = await requestResult(transaction.objectStore(CACHE_STORE).get(ownerId));
    await done;
    if (!cached) return null;
    return canonicalWorkspace(await unseal(database, ownerId, cached.payload));
  }

  async function stageMutation({ ownerId, workspace, mutation }) {
    if (!ownerId || !mutation?.operationId) throw new TypeError("A queued mutation needs an owner and operation ID.");
    const database = await openDatabase();
    if (!database) throw new Error("Encrypted offline storage is unavailable. The change was not applied.");
    const safeWorkspace = canonicalWorkspace(workspace);
    const createdAt = new Date().toISOString();
    const operationPayload = await seal(database, ownerId, { mutation, workspace: safeWorkspace });
    const cachePayload = await seal(database, ownerId, safeWorkspace);
    const backupPayload = await seal(database, ownerId, safeWorkspace.state);
    const transaction = database.transaction([OUTBOX_STORE, CACHE_STORE, RECOVERY_STORE], "readwrite");
    const done = transactionDone(transaction);
    const outbox = transaction.objectStore(OUTBOX_STORE);
    const all = await requestResult(outbox.getAll());
    const pending = all.filter((item) => item.ownerId === ownerId);
    if (pending.length >= MAX_OUTBOX_OPERATIONS) {
      transaction.abort();
      await done.catch(() => {});
      throw new Error("Too many offline changes are waiting. Reconnect before editing more records.");
    }
    outbox.put({
      id: mutation.operationId,
      ownerId,
      status: "pending",
      createdAt,
      payload: operationPayload,
      encrypted: true,
    });
    transaction.objectStore(CACHE_STORE).put({ ownerId, payload: cachePayload, cachedAt: createdAt, encrypted: true });
    transaction.objectStore(RECOVERY_STORE).put({
      id: `${ownerId}:${AUTOMATIC_BACKUP_SOURCE}`,
      ownerId,
      payload: backupPayload,
      revision: safeWorkspace.revision,
      source: AUTOMATIC_BACKUP_SOURCE,
      updatedAt: safeWorkspace.updatedAt,
      capturedAt: createdAt,
      counts: workspaceCounts(safeWorkspace.state),
      encrypted: true,
    });
    await done;
    return { id: mutation.operationId, ownerId, status: "pending", createdAt };
  }

  async function listMutations(ownerId) {
    const database = await openDatabase();
    if (!database) return [];
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const done = transactionDone(transaction);
    const all = await requestResult(transaction.objectStore(OUTBOX_STORE).getAll());
    await done;
    const owned = all
      .filter((item) => item.ownerId === ownerId)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    return Promise.all(
      owned.map(async (item) => ({
        ...publicMetadata(item),
        ...(await unseal(database, ownerId, item.payload)),
      })),
    );
  }

  async function markMutationConflict(ownerId, operationId, message) {
    const database = await openDatabase();
    if (!database) return false;
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const item = await requestResult(store.get(operationId));
    if (!item || item.ownerId !== ownerId) {
      await done;
      return false;
    }
    store.put({
      ...item,
      status: "conflict",
      conflictMessage: String(message || "Cloud conflict"),
      conflictAt: new Date().toISOString(),
    });
    await done;
    return true;
  }

  async function completeMutation(ownerId, operationId) {
    const database = await openDatabase();
    if (!database) return false;
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const item = await requestResult(store.get(operationId));
    if (item?.ownerId === ownerId) store.delete(operationId);
    await done;
    return Boolean(item?.ownerId === ownerId);
  }

  async function clearMutations(ownerId) {
    const database = await openDatabase();
    if (!database) return;
    const transaction = database.transaction(OUTBOX_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const all = await requestResult(store.getAll());
    all.filter((item) => item.ownerId === ownerId).forEach((item) => store.delete(item.id));
    await done;
  }

  return {
    capture,
    list,
    load,
    cacheWorkspace,
    loadWorkspaceCache,
    stageMutation,
    listMutations,
    markMutationConflict,
    completeMutation,
    clearMutations,
  };
}

export const deviceRecoveryStore = createDeviceRecoveryStore();
