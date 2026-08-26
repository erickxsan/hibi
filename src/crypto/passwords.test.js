import { describe, expect, it } from "vitest";
import { generateAccountMasterKey, generateWorkspaceCryptoId } from "./workspaceCrypto.js";
import {
  createPasswordWrapper,
  PASSWORD_KDF_ALGORITHM,
  PASSWORD_KDF_ITERATIONS,
  rewrapPassword,
  unlockWithPassword,
} from "./passwords.js";

describe("password-protected workspace keys", () => {
  it("wraps and unlocks an AMK without retaining the password", async () => {
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const wrapper = await createPasswordWrapper({ masterKey, password: "correct horse", workspaceCryptoId });

    expect(wrapper).toMatchObject({
      type: "password",
      kdfAlgorithm: PASSWORD_KDF_ALGORITHM,
      kdfIterations: PASSWORD_KDF_ITERATIONS,
    });
    expect(JSON.stringify(wrapper)).not.toContain("correct horse");
    await expect(unlockWithPassword({ wrapper, password: "correct horse", workspaceCryptoId })).resolves.toEqual(
      masterKey,
    );
    await expect(unlockWithPassword({ wrapper, password: "wrong", workspaceCryptoId })).rejects.toMatchObject({
      code: "invalid_password",
    });
  });

  it("rewraps a rotated AMK only after verifying the current password", async () => {
    const currentMasterKey = generateAccountMasterKey();
    const newMasterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const wrapper = await createPasswordWrapper({
      masterKey: currentMasterKey,
      password: "rotation password",
      workspaceCryptoId,
    });

    await expect(
      rewrapPassword({
        wrapper,
        password: "wrong",
        currentMasterKey,
        newMasterKey,
        workspaceCryptoId,
        keyVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "invalid_password" });

    const rotated = await rewrapPassword({
      wrapper,
      password: "rotation password",
      currentMasterKey,
      newMasterKey,
      workspaceCryptoId,
      keyVersion: 2,
    });
    expect(rotated.keyVersion).toBe(2);
    await expect(
      unlockWithPassword({ wrapper: rotated, password: "rotation password", workspaceCryptoId }),
    ).resolves.toEqual(newMasterKey);
  });
});
