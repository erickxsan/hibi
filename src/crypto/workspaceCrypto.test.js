import { describe, expect, it } from "vitest";
import { createSeedState, createStarterState, deriveAll } from "../domain/index.js";
import { canonicalStringify } from "./canonical.js";
import { generateRecoveryKey, parseRecoveryKey } from "./recoveryKeys.js";
import {
  createManifest,
  createImportFingerprint,
  decryptBackupPayload,
  decryptEntity,
  decryptImportReceipt,
  decryptWorkspace,
  encryptWorkspace,
  encryptBackupPayload,
  encryptImportReceipt,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
  unwrapMasterKey,
  verifyManifest,
  wrapMasterKey,
} from "./workspaceCrypto.js";

function privateFixture() {
  const state = createStarterState();
  state.students.push({
    id: "student-1",
    code: "PRIVATE-001",
    fullName: "Private Student",
    avatarId: "cat",
    groupIds: [],
    isIndividual: true,
    customHourlyRate: null,
    studentEmail: "student@example.test",
    guardianPhone: "5551234567",
    phone: "",
    guardianContact: "Guardian",
    notes: "Sensitive note",
    status: "Active",
  });
  return state;
}

describe("workspace encryption protocol", () => {
  it("canonicalizes object keys without changing array order", () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, x: [3, 1] } })).toBe('{"a":{"x":[3,1],"y":2},"z":1}');
  });

  it("round-trips every domain collection without exposing plaintext", async () => {
    const state = privateFixture();
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state });

    expect(JSON.stringify(envelopes)).not.toContain("Private Student");
    expect(JSON.stringify(envelopes)).not.toContain("student@example.test");
    const decrypted = await decryptWorkspace({ masterKey, workspaceCryptoId, envelopes });
    expect(decrypted).toMatchObject({ state });
    expect(deriveAll(decrypted.state, state.settings.asOfDate)).toEqual(deriveAll(state, state.settings.asOfDate));
  });

  it("authenticates entity identity, revision, collection, and workspace", async () => {
    const state = privateFixture();
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state });
    const student = envelopes.find((envelope) => envelope.collection === "students");

    await expect(
      decryptEntity({ masterKey, workspaceCryptoId, envelope: { ...student, entityId: "student-2" } }),
    ).rejects.toMatchObject({ code: "entity_authentication_failed" });
    await expect(
      decryptEntity({ masterKey, workspaceCryptoId, envelope: { ...student, entityRevision: 2 } }),
    ).rejects.toMatchObject({ code: "entity_authentication_failed" });
    await expect(
      decryptEntity({ masterKey, workspaceCryptoId: generateWorkspaceCryptoId(), envelope: student }),
    ).rejects.toMatchObject({ code: "entity_authentication_failed" });
  });

  it("preserves dashboard, schedule, academic, attendance, and payment calculations for the full fixture", async () => {
    const state = createSeedState();
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state });
    const { state: decrypted } = await decryptWorkspace({ masterKey, workspaceCryptoId, envelopes });
    expect(canonicalStringify(decrypted)).toBe(canonicalStringify(state));
    expect(deriveAll(decrypted, state.settings.asOfDate)).toEqual(deriveAll(state, state.settings.asOfDate));
  });

  it("detects omitted entities, tampering, rollback, and chain changes", async () => {
    const state = privateFixture();
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state });
    const manifest = await createManifest({
      masterKey,
      workspaceCryptoId,
      envelopes,
      workspaceRevision: 4,
      previousRoot: "previous-root",
      operationId: "11111111-1111-4111-8111-111111111111",
    });

    await expect(
      verifyManifest({ masterKey, workspaceCryptoId, envelopes, manifest, minimumRevision: 4 }),
    ).resolves.toBe(true);
    await expect(
      verifyManifest({ masterKey, workspaceCryptoId, envelopes: envelopes.slice(1), manifest }),
    ).rejects.toMatchObject({ code: "manifest_mismatch" });
    await expect(
      verifyManifest({ masterKey, workspaceCryptoId, envelopes, manifest, minimumRevision: 5 }),
    ).rejects.toMatchObject({ code: "rollback_detected" });
    await expect(
      verifyManifest({ masterKey, workspaceCryptoId, envelopes, manifest, expectedPreviousRoot: "other" }),
    ).rejects.toMatchObject({ code: "revision_chain_mismatch" });
  });

  it("wraps one stable AMK with independent secrets", async () => {
    const masterKey = generateAccountMasterKey();
    const wrappingSecret = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const wrapperId = crypto.randomUUID();
    const wrapped = await wrapMasterKey({ masterKey, wrappingSecret, workspaceCryptoId, wrapperId });

    await expect(
      unwrapMasterKey({ wrapper: { ...wrapped, wrapperId }, wrappingSecret, workspaceCryptoId }),
    ).resolves.toEqual(masterKey);
    await expect(
      unwrapMasterKey({
        wrapper: { ...wrapped, wrapperId },
        wrappingSecret: generateAccountMasterKey(),
        workspaceCryptoId,
      }),
    ).rejects.toMatchObject({ code: "unlock_failed" });
  });

  it("derives independent authenticated keys for backups and import identifiers", async () => {
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const payload = await encryptBackupPayload({
      masterKey,
      workspaceCryptoId,
      value: { privateValue: "not visible" },
    });
    expect(JSON.stringify(payload)).not.toContain("not visible");
    await expect(decryptBackupPayload({ masterKey, workspaceCryptoId, payload })).resolves.toEqual({
      privateValue: "not visible",
    });
    await expect(
      decryptEntity({
        masterKey,
        workspaceCryptoId,
        envelope: { ...payload, collection: "settings", entityId: "__settings__", entityRevision: 1, schemaVersion: 1 },
      }),
    ).rejects.toMatchObject({ code: "entity_authentication_failed" });

    const fileHash = "a".repeat(64);
    const fingerprint = await createImportFingerprint({ masterKey, workspaceCryptoId, fileHash });
    expect(fingerprint).not.toContain(fileHash);
    const receipt = await encryptImportReceipt({
      masterKey,
      workspaceCryptoId,
      fingerprint,
      value: { fileHash, sourceName: "private.json" },
    });
    expect(JSON.stringify(receipt)).not.toContain("private.json");
    await expect(decryptImportReceipt({ masterKey, workspaceCryptoId, receipt })).resolves.toEqual({
      fileHash,
      sourceName: "private.json",
    });
  });
});

describe("recovery keys", () => {
  it("round-trips a formatted key and rejects a checksum change", async () => {
    const recovery = await generateRecoveryKey();
    await expect(parseRecoveryKey(recovery.formatted)).resolves.toEqual(recovery.secret);
    // The final Base32 character contains padding bits, so corrupt the preceding checksum character.
    const checksumIndex = recovery.formatted.length - 2;
    const checksumCharacter = recovery.formatted[checksumIndex];
    const corrupted = `${recovery.formatted.slice(0, checksumIndex)}${checksumCharacter === "0" ? "1" : "0"}${recovery.formatted.slice(checksumIndex + 1)}`;
    await expect(parseRecoveryKey(corrupted)).rejects.toThrow(/checksum/u);
  });
});
