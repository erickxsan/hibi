import { canonicalBytes, canonicalStringify } from "./canonical.js";
import {
  asBytes,
  concatBytes,
  decodeUtf8,
  equalBytes,
  fromBase64Url,
  toBase64Url,
  utf8,
  wipeBytes,
} from "./encoding.js";

export const CRYPTO_PROTOCOL_VERSION = 1;
export const CRYPTO_SCHEMA_VERSION = 2;
export const MASTER_KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const ENCRYPTED_COLLECTIONS = Object.freeze([
  "groups",
  "students",
  "grades",
  "classLog",
  "classSchedules",
  "scheduleExceptions",
  "scheduleChanges",
]);

const SETTINGS_COLLECTION = "settings";
const SETTINGS_ID = "__settings__";

export class WorkspaceCryptoError extends Error {
  constructor(message = "The encrypted workspace could not be verified.", options) {
    super(message, options);
    this.name = "WorkspaceCryptoError";
    this.code = options?.code || "crypto_failure";
  }
}

function requireCrypto(cryptoApi) {
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) {
    throw new WorkspaceCryptoError("This browser does not provide the Web Crypto features required by Hibi.", {
      code: "crypto_unavailable",
    });
  }
  return cryptoApi;
}

function randomBytes(length, cryptoApi = globalThis.crypto) {
  const output = new Uint8Array(length);
  requireCrypto(cryptoApi).getRandomValues(output);
  return output;
}

async function sha256(value, cryptoApi = globalThis.crypto) {
  return new Uint8Array(await requireCrypto(cryptoApi).subtle.digest("SHA-256", asBytes(value)));
}

async function deriveBits(masterKey, purpose, context, cryptoApi = globalThis.crypto) {
  const crypto = requireCrypto(cryptoApi);
  const inputKey = await crypto.subtle.importKey("raw", asBytes(masterKey), "HKDF", false, ["deriveBits"]);
  const salt = await sha256(utf8(`hibi:${CRYPTO_PROTOCOL_VERSION}:${purpose}`), crypto);
  const info = canonicalBytes({ application: "hibi", context, protocolVersion: CRYPTO_PROTOCOL_VERSION, purpose });
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, inputKey, 256));
}

async function deriveAesKey(masterKey, purpose, context, usages, cryptoApi = globalThis.crypto) {
  const bits = await deriveBits(masterKey, purpose, context, cryptoApi);
  try {
    return await cryptoApi.subtle.importKey("raw", bits, { name: "AES-GCM", length: 256 }, false, usages);
  } finally {
    wipeBytes(bits);
  }
}

async function deriveHmacKey(masterKey, purpose, context, cryptoApi = globalThis.crypto) {
  const bits = await deriveBits(masterKey, purpose, context, cryptoApi);
  try {
    return await cryptoApi.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256", length: 256 }, false, [
      "sign",
      "verify",
    ]);
  } finally {
    wipeBytes(bits);
  }
}

export function generateAccountMasterKey(cryptoApi = globalThis.crypto) {
  return randomBytes(MASTER_KEY_BYTES, cryptoApi);
}

export function generateWorkspaceCryptoId(cryptoApi = globalThis.crypto) {
  return toBase64Url(randomBytes(18, cryptoApi));
}

export function envelopeKey(collection, entityId) {
  return `${collection}\u0000${entityId}`;
}

function entityAad({ workspaceCryptoId, collection, entityId, entityRevision, schemaVersion, keyVersion }) {
  return canonicalBytes({
    workspaceCryptoId,
    collection,
    entityId,
    entityRevision,
    schemaVersion,
    keyVersion,
  });
}

export async function encryptEntity({
  masterKey,
  workspaceCryptoId,
  collection,
  entityId,
  entityRevision,
  value,
  schemaVersion = CRYPTO_SCHEMA_VERSION,
  keyVersion = 1,
  cryptoApi = globalThis.crypto,
}) {
  if (!collection || !entityId || !Number.isSafeInteger(entityRevision) || entityRevision < 1) {
    throw new TypeError("An encrypted entity needs a collection, stable ID, and positive revision.");
  }
  const key = await deriveAesKey(
    masterKey,
    "entity",
    { workspaceCryptoId, collection, entityId, keyVersion },
    ["encrypt"],
    cryptoApi,
  );
  const nonce = randomBytes(NONCE_BYTES, cryptoApi);
  const aad = entityAad({ workspaceCryptoId, collection, entityId, entityRevision, schemaVersion, keyVersion });
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    canonicalBytes(value),
  );
  return {
    collection,
    entityId,
    entityRevision,
    schemaVersion,
    keyVersion,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(ciphertext),
  };
}

export async function decryptEntity({ masterKey, workspaceCryptoId, envelope, cryptoApi = globalThis.crypto }) {
  try {
    const key = await deriveAesKey(
      masterKey,
      "entity",
      {
        workspaceCryptoId,
        collection: envelope.collection,
        entityId: envelope.entityId,
        keyVersion: envelope.keyVersion,
      },
      ["decrypt"],
      cryptoApi,
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(envelope.nonce),
        additionalData: entityAad({ workspaceCryptoId, ...envelope }),
        tagLength: 128,
      },
      key,
      fromBase64Url(envelope.ciphertext),
    );
    return JSON.parse(decodeUtf8(plaintext));
  } catch (error) {
    throw new WorkspaceCryptoError(
      `The encrypted ${String(envelope?.collection || "workspace")} record failed authentication.`,
      { code: "entity_authentication_failed", cause: error },
    );
  }
}

function workspaceEntries(state, schemaVersion) {
  const entries = [
    {
      collection: SETTINGS_COLLECTION,
      entityId: SETTINGS_ID,
      value: { workspaceVersion: state.version, settings: state.settings },
    },
  ];
  for (const collection of ENCRYPTED_COLLECTIONS) {
    (state[collection] || []).forEach((item, position) => {
      entries.push({
        collection,
        entityId: String(item.id),
        value: schemaVersion >= 2 ? { data: item, position } : item,
      });
    });
  }
  return entries;
}

export async function encryptWorkspace({
  masterKey,
  workspaceCryptoId,
  state,
  versions = {},
  schemaVersion = CRYPTO_SCHEMA_VERSION,
  keyVersion = 1,
  cryptoApi = globalThis.crypto,
}) {
  return Promise.all(
    workspaceEntries(state, schemaVersion).map(({ collection, entityId, value }) =>
      encryptEntity({
        masterKey,
        workspaceCryptoId,
        collection,
        entityId,
        entityRevision: Number(versions?.[collection]?.[entityId] || 1),
        schemaVersion,
        keyVersion,
        value,
        cryptoApi,
      }),
    ),
  );
}

export async function decryptWorkspace({ masterKey, workspaceCryptoId, envelopes, cryptoApi = globalThis.crypto }) {
  const state = Object.fromEntries(ENCRYPTED_COLLECTIONS.map((collection) => [collection, []]));
  const positions = Object.fromEntries(ENCRYPTED_COLLECTIONS.map((collection) => [collection, new Map()]));
  const occupiedPositions = Object.fromEntries(ENCRYPTED_COLLECTIONS.map((collection) => [collection, new Set()]));
  const versions = Object.fromEntries(
    [SETTINGS_COLLECTION, ...ENCRYPTED_COLLECTIONS].map((collection) => [collection, {}]),
  );
  const seen = new Set();
  for (const envelope of envelopes || []) {
    const key = envelopeKey(envelope.collection, envelope.entityId);
    if (seen.has(key)) throw new WorkspaceCryptoError("The encrypted workspace contains a duplicate entity envelope.");
    seen.add(key);
    if (envelope.collection !== SETTINGS_COLLECTION && !ENCRYPTED_COLLECTIONS.includes(envelope.collection)) {
      throw new WorkspaceCryptoError("The encrypted workspace contains an unsupported collection.");
    }
    const value = await decryptEntity({ masterKey, workspaceCryptoId, envelope, cryptoApi });
    versions[envelope.collection][envelope.entityId] = envelope.entityRevision;
    if (envelope.collection === SETTINGS_COLLECTION) {
      if (envelope.entityId !== SETTINGS_ID) throw new WorkspaceCryptoError("The settings envelope has an invalid ID.");
      state.settings = value?.settings || value;
      if (Number.isSafeInteger(value?.workspaceVersion)) state.version = value.workspaceVersion;
    } else {
      let item = value;
      if (Number(envelope.schemaVersion) >= 2) {
        if (
          !value ||
          typeof value !== "object" ||
          !Number.isSafeInteger(value.position) ||
          value.position < 0 ||
          !value.data ||
          typeof value.data !== "object"
        ) {
          throw new WorkspaceCryptoError("An encrypted entity has invalid ordering metadata.");
        }
        if (occupiedPositions[envelope.collection].has(value.position)) {
          throw new WorkspaceCryptoError("Encrypted workspace ordering contains a duplicate position.");
        }
        occupiedPositions[envelope.collection].add(value.position);
        positions[envelope.collection].set(envelope.entityId, value.position);
        item = value.data;
      }
      if (String(item?.id) !== envelope.entityId) {
        throw new WorkspaceCryptoError("An encrypted entity does not match its authenticated identifier.");
      }
      state[envelope.collection].push(item);
    }
  }
  if (!state.settings) throw new WorkspaceCryptoError("The encrypted workspace is missing its settings envelope.");
  for (const collection of ENCRYPTED_COLLECTIONS) {
    state[collection].sort((left, right) => {
      const leftPosition = positions[collection].get(String(left.id));
      const rightPosition = positions[collection].get(String(right.id));
      if (leftPosition === undefined && rightPosition === undefined) return 0;
      if (leftPosition === undefined) return 1;
      if (rightPosition === undefined) return -1;
      return leftPosition - rightPosition || String(left.id).localeCompare(String(right.id));
    });
  }
  return { state, versions };
}

async function envelopeLeaf(envelope, cryptoApi) {
  return sha256(
    canonicalBytes({
      collection: envelope.collection,
      entityId: envelope.entityId,
      entityRevision: envelope.entityRevision,
      keyVersion: envelope.keyVersion,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
    }),
    cryptoApi,
  );
}

async function merkleRoot(envelopes, cryptoApi) {
  const sorted = [...envelopes].sort((left, right) =>
    envelopeKey(left.collection, left.entityId).localeCompare(envelopeKey(right.collection, right.entityId)),
  );
  let level = await Promise.all(sorted.map((envelope) => envelopeLeaf(envelope, cryptoApi)));
  if (!level.length) return sha256(new Uint8Array(), cryptoApi);
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(await sha256(concatBytes(level[index], level[index + 1] || level[index]), cryptoApi));
    }
    level = next;
  }
  return level[0];
}

function manifestBody(manifest) {
  const { mac: _mac, ...body } = manifest;
  return body;
}

function backupAad({ workspaceCryptoId, keyVersion }) {
  return canonicalBytes({
    workspaceCryptoId,
    keyVersion,
    protocolVersion: CRYPTO_PROTOCOL_VERSION,
    purpose: "backup",
  });
}

export async function encryptBackupPayload({
  masterKey,
  workspaceCryptoId,
  keyVersion = 1,
  value,
  cryptoApi = globalThis.crypto,
}) {
  const key = await deriveAesKey(masterKey, "backup", { workspaceCryptoId, keyVersion }, ["encrypt"], cryptoApi);
  const nonce = randomBytes(NONCE_BYTES, cryptoApi);
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: backupAad({ workspaceCryptoId, keyVersion }), tagLength: 128 },
    key,
    canonicalBytes(value),
  );
  return { keyVersion, nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) };
}

export async function decryptBackupPayload({ masterKey, workspaceCryptoId, payload, cryptoApi = globalThis.crypto }) {
  try {
    const key = await deriveAesKey(
      masterKey,
      "backup",
      { workspaceCryptoId, keyVersion: payload.keyVersion },
      ["decrypt"],
      cryptoApi,
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(payload.nonce),
        additionalData: backupAad({ workspaceCryptoId, keyVersion: payload.keyVersion }),
        tagLength: 128,
      },
      key,
      fromBase64Url(payload.ciphertext),
    );
    return JSON.parse(decodeUtf8(plaintext));
  } catch (error) {
    throw new WorkspaceCryptoError("The encrypted backup failed authentication.", {
      code: "backup_authentication_failed",
      cause: error,
    });
  }
}

export async function createImportFingerprint({
  masterKey,
  workspaceCryptoId,
  fileHash,
  keyVersion = 1,
  cryptoApi = globalThis.crypto,
}) {
  if (!/^[0-9a-f]{64}$/u.test(String(fileHash || ""))) throw new TypeError("A valid SHA-256 file hash is required.");
  const key = await deriveHmacKey(
    masterKey,
    "identifier",
    { workspaceCryptoId, keyVersion, kind: "import" },
    cryptoApi,
  );
  const fingerprint = await cryptoApi.subtle.sign(
    "HMAC",
    key,
    canonicalBytes({ kind: "import", fileHash, workspaceCryptoId }),
  );
  return toBase64Url(fingerprint);
}

function importReceiptAad({ workspaceCryptoId, fingerprint, keyVersion }) {
  return canonicalBytes({
    workspaceCryptoId,
    fingerprint,
    keyVersion,
    protocolVersion: CRYPTO_PROTOCOL_VERSION,
    purpose: "import-receipt",
  });
}

export async function encryptImportReceipt({
  masterKey,
  workspaceCryptoId,
  fingerprint,
  keyVersion = 1,
  value,
  cryptoApi = globalThis.crypto,
}) {
  const key = await deriveAesKey(
    masterKey,
    "import-receipt",
    { workspaceCryptoId, fingerprint, keyVersion },
    ["encrypt"],
    cryptoApi,
  );
  const nonce = randomBytes(NONCE_BYTES, cryptoApi);
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: importReceiptAad({ workspaceCryptoId, fingerprint, keyVersion }),
      tagLength: 128,
    },
    key,
    canonicalBytes(value),
  );
  return { fingerprint, keyVersion, nonce: toBase64Url(nonce), ciphertext: toBase64Url(ciphertext) };
}

export async function decryptImportReceipt({ masterKey, workspaceCryptoId, receipt, cryptoApi = globalThis.crypto }) {
  try {
    const key = await deriveAesKey(
      masterKey,
      "import-receipt",
      { workspaceCryptoId, fingerprint: receipt.fingerprint, keyVersion: receipt.keyVersion },
      ["decrypt"],
      cryptoApi,
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(receipt.nonce),
        additionalData: importReceiptAad({
          workspaceCryptoId,
          fingerprint: receipt.fingerprint,
          keyVersion: receipt.keyVersion,
        }),
        tagLength: 128,
      },
      key,
      fromBase64Url(receipt.ciphertext),
    );
    return JSON.parse(decodeUtf8(plaintext));
  } catch (error) {
    throw new WorkspaceCryptoError("The encrypted import receipt failed authentication.", {
      code: "import_receipt_authentication_failed",
      cause: error,
    });
  }
}

export async function createManifest({
  masterKey,
  workspaceCryptoId,
  envelopes,
  workspaceRevision,
  previousRoot = null,
  operationId,
  schemaVersion = CRYPTO_SCHEMA_VERSION,
  keyVersion = 1,
  cryptoApi = globalThis.crypto,
}) {
  const root = toBase64Url(await merkleRoot(envelopes, cryptoApi));
  const body = {
    protocolVersion: CRYPTO_PROTOCOL_VERSION,
    workspaceCryptoId,
    workspaceRevision,
    root,
    previousRoot,
    entityCount: envelopes.length,
    schemaVersion,
    keyVersion,
    operationId,
  };
  const macKey = await deriveHmacKey(masterKey, "manifest", { workspaceCryptoId, keyVersion }, cryptoApi);
  const mac = await cryptoApi.subtle.sign("HMAC", macKey, canonicalBytes(body));
  return { ...body, mac: toBase64Url(mac) };
}

export async function verifyManifest({
  masterKey,
  workspaceCryptoId,
  envelopes,
  manifest,
  minimumRevision = 0,
  expectedPreviousRoot,
  cryptoApi = globalThis.crypto,
}) {
  if (!manifest || manifest.workspaceCryptoId !== workspaceCryptoId) {
    throw new WorkspaceCryptoError("The workspace integrity manifest belongs to a different workspace.");
  }
  if (manifest.workspaceRevision < minimumRevision) {
    throw new WorkspaceCryptoError("A rollback to an older encrypted workspace revision was detected.", {
      code: "rollback_detected",
    });
  }
  if (expectedPreviousRoot !== undefined && manifest.previousRoot !== expectedPreviousRoot) {
    throw new WorkspaceCryptoError("The encrypted workspace revision chain is inconsistent.", {
      code: "revision_chain_mismatch",
    });
  }
  const calculatedRoot = await merkleRoot(envelopes, cryptoApi);
  if (!equalBytes(calculatedRoot, fromBase64Url(manifest.root)) || manifest.entityCount !== envelopes.length) {
    throw new WorkspaceCryptoError("The encrypted workspace entity manifest does not match the downloaded records.", {
      code: "manifest_mismatch",
    });
  }
  await verifyManifestMac({ masterKey, workspaceCryptoId, manifest, cryptoApi });
  return true;
}

export async function verifyManifestMac({ masterKey, workspaceCryptoId, manifest, cryptoApi = globalThis.crypto }) {
  if (!manifest || manifest.workspaceCryptoId !== workspaceCryptoId) {
    throw new WorkspaceCryptoError("The workspace integrity manifest belongs to a different workspace.");
  }
  const macKey = await deriveHmacKey(
    masterKey,
    "manifest",
    { workspaceCryptoId, keyVersion: manifest.keyVersion },
    cryptoApi,
  );
  const valid = await cryptoApi.subtle.verify(
    "HMAC",
    macKey,
    fromBase64Url(manifest.mac),
    canonicalBytes(manifestBody(manifest)),
  );
  if (!valid) throw new WorkspaceCryptoError("The workspace integrity manifest has an invalid authentication code.");
  return true;
}

export async function wrapMasterKey({
  masterKey,
  wrappingSecret,
  workspaceCryptoId,
  wrapperId,
  keyVersion = 1,
  cryptoApi = globalThis.crypto,
}) {
  const key = await deriveAesKey(
    wrappingSecret,
    "amk-wrapper",
    { workspaceCryptoId, wrapperId, keyVersion },
    ["encrypt"],
    cryptoApi,
  );
  const nonce = randomBytes(NONCE_BYTES, cryptoApi);
  const aad = canonicalBytes({ workspaceCryptoId, wrapperId, keyVersion, protocolVersion: CRYPTO_PROTOCOL_VERSION });
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    asBytes(masterKey),
  );
  return { wrapperVersion: 1, keyVersion, nonce: toBase64Url(nonce), wrappedKey: toBase64Url(ciphertext) };
}

export async function unwrapMasterKey({ wrapper, wrappingSecret, workspaceCryptoId, cryptoApi = globalThis.crypto }) {
  try {
    const key = await deriveAesKey(
      wrappingSecret,
      "amk-wrapper",
      { workspaceCryptoId, wrapperId: wrapper.wrapperId, keyVersion: wrapper.keyVersion },
      ["decrypt"],
      cryptoApi,
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64Url(wrapper.nonce),
        additionalData: canonicalBytes({
          workspaceCryptoId,
          wrapperId: wrapper.wrapperId,
          keyVersion: wrapper.keyVersion,
          protocolVersion: CRYPTO_PROTOCOL_VERSION,
        }),
        tagLength: 128,
      },
      key,
      fromBase64Url(wrapper.wrappedKey),
    );
    const masterKey = new Uint8Array(plaintext);
    if (masterKey.byteLength !== MASTER_KEY_BYTES) throw new Error("Invalid AMK length.");
    return masterKey;
  } catch (error) {
    throw new WorkspaceCryptoError("This credential could not unlock the workspace key.", {
      code: "unlock_failed",
      cause: error,
    });
  }
}

export function createCryptoSession({ ownerId, workspaceCryptoId, masterKey, keyVersion = 1, method }) {
  const secret = new Uint8Array(asBytes(masterKey));
  let active = true;
  return Object.freeze({
    ownerId,
    workspaceCryptoId,
    keyVersion,
    method,
    get masterKey() {
      if (!active) throw new WorkspaceCryptoError("The workspace has been locked.", { code: "workspace_locked" });
      return secret;
    },
    lock() {
      if (!active) return;
      active = false;
      wipeBytes(secret);
    },
  });
}

export function canonicalWorkspaceHash(state) {
  return canonicalStringify(state);
}
