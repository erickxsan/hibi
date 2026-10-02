import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain/index.js";
import {
  createPasswordWrapper,
  unlockWithPassword,
  recoveryKeyFingerprints,
  createManifest,
  encryptWorkspace,
  generateAccountMasterKey,
  generateRecoveryKey,
  generateWorkspaceCryptoId,
  recoveryKeyFingerprint,
  wrapMasterKey,
} from "../crypto/index.js";
import { createEncryptedWorkspaceRepository } from "./encryptedWorkspaceRepository.js";
import { createOperationId } from "./workspaceRepository.js";

describe("encrypted .hibi backups", () => {
  it("exports format v2 without exposing entity envelopes or domain plaintext", async () => {
    const repository = createEncryptedWorkspaceRepository(null, { allowWrites: false });
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const state = createStarterState();
    state.settings.hourlyRate = 987654;
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state });
    const manifest = await createManifest({
      masterKey,
      workspaceCryptoId,
      envelopes,
      workspaceRevision: 1,
      previousRoot: null,
      operationId: createOperationId(),
    });
    const text = await repository.exportBackup(
      { workspaceCryptoId, keyVersion: 1, revision: 1, envelopes, manifest },
      [],
      { masterKey },
    );
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ formatVersion: 2, encryptedSnapshot: { keyVersion: 1 } });
    expect(parsed.snapshot).toBeUndefined();
    expect(text).not.toContain("987654");
    expect(text).not.toContain('"collection"');
    await expect(repository.decryptBackup(text, { masterKey, workspaceCryptoId })).resolves.toMatchObject({
      settings: { hourlyRate: 987654 },
    });
  });

  it("restores a different workspace locally through its recovery wrapper", async () => {
    const repository = createEncryptedWorkspaceRepository(null, { allowWrites: false });
    const sourceMasterKey = generateAccountMasterKey();
    const sourceWorkspaceId = generateWorkspaceCryptoId();
    const state = createStarterState();
    state.students.push({
      id: "student-1",
      code: "A-1",
      fullName: "Source Student",
      avatarId: "cat",
      groupIds: [],
      isIndividual: true,
      customHourlyRate: null,
      studentEmail: "",
      guardianPhone: "",
      phone: "",
      guardianContact: "",
      notes: "",
      status: "Active",
    });
    const envelopes = await encryptWorkspace({
      masterKey: sourceMasterKey,
      workspaceCryptoId: sourceWorkspaceId,
      state,
    });
    const manifest = await createManifest({
      masterKey: sourceMasterKey,
      workspaceCryptoId: sourceWorkspaceId,
      envelopes,
      workspaceRevision: 7,
      previousRoot: null,
      operationId: createOperationId(),
    });
    const recovery = await generateRecoveryKey();
    const wrapperId = createOperationId();
    const wrapped = await wrapMasterKey({
      masterKey: sourceMasterKey,
      wrappingSecret: recovery.secret,
      workspaceCryptoId: sourceWorkspaceId,
      wrapperId,
    });
    const backup = JSON.stringify({
      format: "hibi-encrypted-backup",
      formatVersion: 1,
      workspaceCryptoId: sourceWorkspaceId,
      snapshot: { envelopes, manifest },
      wrappers: [
        {
          wrapperId,
          type: "recovery",
          recoveryFingerprint: await recoveryKeyFingerprint(recovery.secret),
          ...wrapped,
        },
      ],
    });
    const destination = {
      masterKey: generateAccountMasterKey(),
      workspaceCryptoId: generateWorkspaceCryptoId(),
      keyVersion: 1,
    };

    await expect(repository.decryptBackup(backup, destination)).rejects.toMatchObject({
      code: "backup_recovery_required",
    });
    await expect(
      repository.decryptBackup(backup, destination, { recoveryKey: recovery.formatted }),
    ).resolves.toMatchObject({ students: [expect.objectContaining({ fullName: "Source Student" })] });
  });
});

async function passwordBackup(keyVersion = 1) {
  const repository = createEncryptedWorkspaceRepository(null, { allowWrites: false });
  const masterKey = generateAccountMasterKey();
  const workspaceCryptoId = generateWorkspaceCryptoId();
  const password = "synthetic violet canyon lantern";
  const wrapper = await createPasswordWrapper({ masterKey, workspaceCryptoId, keyVersion, password });
  const recovery = await generateRecoveryKey();
  const wrapperId = crypto.randomUUID();
  const recoveryWrapper = {
    wrapperId,
    type: "recovery",
    recoveryFingerprint: await recoveryKeyFingerprint(recovery.secret),
    ...(await wrapMasterKey({ masterKey, workspaceCryptoId, keyVersion, wrapperId, wrappingSecret: recovery.secret })),
  };
  const state = createStarterState();
  state.settings.hourlyRate = 99.9;
  const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, keyVersion, state });
  const manifest = await createManifest({
    masterKey,
    workspaceCryptoId,
    keyVersion,
    envelopes,
    workspaceRevision: 1,
    operationId: crypto.randomUUID(),
  });
  const text = await repository.exportBackup(
    { masterKey, workspaceCryptoId, keyVersion, envelopes, manifest, revision: 1 },
    [wrapper, recoveryWrapper],
    { masterKey },
  );
  return { repository, masterKey, workspaceCryptoId, text, wrapper, password, recovery };
}
describe("backup credential selection after rotation", () => {
  it.each(["other-account", "same-account-rotated", "same-account-current"])(
    "restores using the supplied password AMK: %s",
    async (scenario) => {
      const source = await passwordBackup();
      const session = {
        masterKey: scenario === "same-account-current" ? source.masterKey : generateAccountMasterKey(),
        workspaceCryptoId: scenario === "other-account" ? generateWorkspaceCryptoId() : source.workspaceCryptoId,
        keyVersion: scenario === "same-account-rotated" ? 2 : 1,
      };
      const sourceMasterKey = await unlockWithPassword({
        wrapper: source.wrapper,
        password: source.password,
        workspaceCryptoId: source.workspaceCryptoId,
      });
      await expect(source.repository.decryptBackup(source.text, session, { sourceMasterKey })).resolves.toMatchObject({
        settings: { hourlyRate: 99.9 },
      });
      if (scenario !== "same-account-current")
        await expect(source.repository.decryptBackup(source.text, session)).rejects.toMatchObject({
          code: "backup_recovery_required",
        });
      await expect(
        source.repository.decryptBackup(source.text, session, { sourceMasterKey: generateAccountMasterKey() }),
      ).rejects.toMatchObject({ code: "backup_authentication_failed" });
      await expect(
        unlockWithPassword({ wrapper: source.wrapper, password: "wrong", workspaceCryptoId: source.workspaceCryptoId }),
      ).rejects.toMatchObject({ code: "invalid_password" });
    },
  );
  it("unlocks old-key backups with a recovery key even on the same workspace and preserves legacy fingerprints", async () => {
    const source = await passwordBackup();
    const session = {
      masterKey: generateAccountMasterKey(),
      workspaceCryptoId: source.workspaceCryptoId,
      keyVersion: 2,
    };
    const backup = JSON.parse(source.text);
    backup.wrappers.find((wrapper) => wrapper.type === "recovery").recoveryFingerprint = (
      await recoveryKeyFingerprints(source.recovery.secret)
    )[1];
    await expect(
      source.repository.decryptBackup(JSON.stringify(backup), session, { recoveryKey: source.recovery.formatted }),
    ).resolves.toMatchObject({ settings: { hourlyRate: 99.9 } });
    const wrong = await generateRecoveryKey();
    await expect(
      source.repository.decryptBackup(source.text, session, { recoveryKey: wrong.formatted }),
    ).rejects.toThrow(/does not match/);
    backup.encryptedSnapshot.ciphertext = backup.encryptedSnapshot.ciphertext.slice(0, -3) + "AAA";
    await expect(
      source.repository.decryptBackup(JSON.stringify(backup), session, { recoveryKey: source.recovery.formatted }),
    ).rejects.toMatchObject({ code: "backup_authentication_failed" });
  });
});
