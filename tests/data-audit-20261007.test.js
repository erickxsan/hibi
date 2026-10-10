// Regression coverage for the data lifecycle audit.
import { expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { createDeviceKeyStore } from "../src/crypto/deviceKeyStore.js";
import { createManifest, verifyManifest } from "../src/crypto/workspaceCrypto.js";
import {
  createAccountDeletionService,
  ACCOUNT_DELETION_CONFIRMATION,
  PENDING_ACCOUNT_DELETION_KEY,
} from "../src/cloud/accountDeletion.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

it("remembering the same device again preserves its existing rollback witness", async () => {
  const store = createDeviceKeyStore(new IDBFactory(), webcrypto);
  const options = {
    ownerId: "synthetic-audit-owner",
    workspaceCryptoId: "synthetic-workspace",
    masterKey: webcrypto.getRandomValues(new Uint8Array(32)),
  };
  await store.remember(options);
  await store.writeIntegrity({ ...options, revision: 120, root: "synthetic-root-120" });
  expect(await store.readIntegrity(options)).toEqual({ revision: 120, root: "synthetic-root-120" });
  await store.remember(options);
  expect(await store.readIntegrity(options)).toEqual({ revision: 120, root: "synthetic-root-120" });
  expect(await store.unlock(options)).toEqual(options.masterKey);
  const witness = await store.readIntegrity(options);
  const historicalManifest = await createManifest({
    ...options,
    envelopes: [],
    workspaceRevision: 119,
    previousRoot: null,
    operationId: webcrypto.randomUUID(),
    cryptoApi: webcrypto,
  });
  await expect(
    verifyManifest({
      ...options,
      envelopes: [],
      manifest: historicalManifest,
      minimumRevision: witness.revision,
      cryptoApi: webcrypto,
    }),
  ).rejects.toMatchObject({ code: "rollback_detected" });
});

it("after Auth deletion and an outage, a new service resumes the durable receipt without Auth", async () => {
  let authDeleted = false;
  const requests = [];
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: authDeleted ? null : { id: "synthetic-owner" } } })) },
    functions: {
      invoke: vi.fn(async (_name, { body }) => {
        requests.push(body.action);
        if (body.action === "delete") authDeleted = true;
        return requests.length > 2
          ? { data: { status: "completed", verified: true } }
          : { error: { message: "Synthetic network outage" }, data: null };
      }),
    },
  };
  const storage = memoryStorage();
  const service = createAccountDeletionService(client, webcrypto, storage);
  await expect(service.removeAccount({ confirmation: ACCOUNT_DELETION_CONFIRMATION })).rejects.toMatchObject({
    code: "receipt_verification_failed",
  });
  const reopened = createAccountDeletionService(client, webcrypto, storage);
  await expect(reopened.removeAccount({ confirmation: ACCOUNT_DELETION_CONFIRMATION })).resolves.toMatchObject({
    ownerId: "synthetic-owner",
    status: "completed",
    verified: true,
  });
  expect(client.auth.getUser).toHaveBeenCalledOnce();
  expect(requests).toEqual(["delete", "verify", "verify"]);
  expect(storage.getItem(PENDING_ACCOUNT_DELETION_KEY)).toBeTruthy();
});

it("a resumed deletion persists and verifies the effective server request ID", async () => {
  const existingRequestId = "11111111-1111-4111-8111-111111111111";
  const nextRequestId = "22222222-2222-4222-8222-222222222222";
  const receiptSecret = "33333333-3333-4333-8333-333333333333";
  const ids = [nextRequestId, receiptSecret];
  let verifiedId;
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "synthetic-owner" } } })) },
    functions: {
      invoke: vi.fn(async (_name, { body }) => {
        if (body.action === "delete")
          return {
            error: {
              context: {
                json: async () => ({
                  code: "account_auth_deletion_failed",
                  status: "data_erased",
                  requestId: existingRequestId,
                  retryable: true,
                }),
              },
            },
          };
        verifiedId = body.requestId;
        return body.requestId === existingRequestId
          ? { data: { status: "completed", verified: true } }
          : { error: { context: { json: async () => ({ code: "deletion_receipt_not_found" }) } } };
      }),
    },
  };
  const storage = memoryStorage();
  const service = createAccountDeletionService(client, { randomUUID: () => ids.shift() }, storage);
  await expect(service.removeAccount({ confirmation: ACCOUNT_DELETION_CONFIRMATION })).resolves.toMatchObject({
    requestId: existingRequestId,
    verified: true,
  });
  expect(verifiedId).toBe(existingRequestId);
  expect(service.getPending().requestId).toBe(existingRequestId);
});

it("does not send a deletion if its receipt cannot be saved durably", async () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    functions: { invoke: vi.fn() },
  };
  const service = createAccountDeletionService(client, webcrypto, {
    getItem: () => null,
    setItem: () => {
      throw new Error("Storage blocked");
    },
  });
  await expect(service.removeAccount({ confirmation: ACCOUNT_DELETION_CONFIRMATION })).rejects.toMatchObject({
    code: "deletion_receipt_storage_failed",
  });
  expect(client.functions.invoke).not.toHaveBeenCalled();
});

it("simultaneous remembering and AMK rotation preserve the highest witness and newest wrapper", async () => {
  const indexedDb = new IDBFactory();
  const first = createDeviceKeyStore(indexedDb, webcrypto);
  const second = createDeviceKeyStore(indexedDb, webcrypto);
  const options = {
    ownerId: "owner",
    workspaceCryptoId: "workspace",
    masterKey: webcrypto.getRandomValues(new Uint8Array(32)),
  };
  await Promise.all([first.remember(options), second.remember(options)]);
  await Promise.all([
    first.writeIntegrity({ ...options, revision: 120, root: "root-120" }),
    second.writeIntegrity({ ...options, revision: 121, root: "root-121" }),
  ]);
  const rotated = webcrypto.getRandomValues(new Uint8Array(32));
  await first.remember({ ...options, masterKey: rotated, keyVersion: 2 });
  await second.remember({ ...options, keyVersion: 1 });
  expect(await second.unlock({ ...options, expectedKeyVersion: 2 })).toEqual(rotated);
  expect(await first.readIntegrity(options)).toEqual({ revision: 121, root: "root-121" });
});

it("fails closed when an existing integrity witness cannot be authenticated", async () => {
  const indexedDb = new IDBFactory();
  const store = createDeviceKeyStore(indexedDb, webcrypto);
  const options = {
    ownerId: "owner",
    workspaceCryptoId: "workspace",
    masterKey: webcrypto.getRandomValues(new Uint8Array(32)),
  };
  await store.remember(options);
  await store.writeIntegrity({ ...options, revision: 120, root: "root" });
  await expect(store.readIntegrity({ ...options, workspaceCryptoId: "wrong-workspace" })).rejects.toMatchObject({
    code: "integrity_witness_invalid",
  });
});
