import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain/index.js";
import {
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
