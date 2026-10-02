import { describe, expect, it } from "vitest";
import { generateAccountMasterKey, generateWorkspaceCryptoId, wrapMasterKey } from "./workspaceCrypto.js";
import { toBase64Url, wipeBytes } from "./encoding.js";
import {
  createPasswordWrapper,
  derivePasswordSecret,
  getNewPasswordWarning,
  PASSWORD_KDF_ALGORITHM,
  PASSWORD_KDF_ITERATIONS,
  rewrapPassword,
  unlockWithPassword,
} from "./passwords.js";

describe("password-protected workspace keys", () => {
  it.each([
    "a",
    "              a",
    "abcdefghijklm😀",
    "aaaaaaaaaaaaaaa",
    "abcabcabcabcabcabc",
    "12345678901234567890",
    "abcdefghijklmnop",
    "Password123456789!",
    "password password",
    "!!!!!!!!!!!!!!!",
  ])("blocks weak new secrets: %s", async (password) => {
    expect(getNewPasswordWarning(password)).toContain("easy to guess");
    await expect(createPasswordWrapper({ password })).rejects.toMatchObject({ code: "password_too_weak" });
  });

  it.each([
    ["", "password_required"],
    ["a".repeat(1025), "password_too_long"],
  ])("retains basic input validation", async (password, code) => {
    await expect(createPasswordWrapper({ password, cryptoApi: {} })).rejects.toMatchObject({ code });
  });

  it("accepts length boundaries and Unicode without changing the secret", () => {
    for (const password of [
      "luna bosque mar faro",
      "luna bosque mar😀",
      "  río nube árbol faro  ",
      "violet canyon ".repeat(73) + "xy",
    ]) {
      expect(getNewPasswordWarning(password)).toBe("");
    }
  });

  it("unlocks a legacy one-character password and replaces it with a strong one", async () => {
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const secret = await derivePasswordSecret({ password: "a", salt });
    const wrapperId = crypto.randomUUID();
    const wrapper = {
      type: "password",
      wrapperId,
      kdfAlgorithm: PASSWORD_KDF_ALGORITHM,
      kdfIterations: PASSWORD_KDF_ITERATIONS,
      kdfSalt: toBase64Url(salt),
      ...(await wrapMasterKey({ masterKey, wrappingSecret: secret, workspaceCryptoId, wrapperId, keyVersion: 1 })),
    };
    wipeBytes(secret);
    await expect(unlockWithPassword({ wrapper, password: "a", workspaceCryptoId })).resolves.toEqual(masterKey);
    await expect(createPasswordWrapper({ masterKey, password: "b", workspaceCryptoId })).rejects.toMatchObject({
      code: "password_too_weak",
    });
    const replacement = await createPasswordWrapper({ masterKey, password: "luna bosque mar faro", workspaceCryptoId });
    await expect(
      unlockWithPassword({ wrapper: replacement, password: "luna bosque mar faro", workspaceCryptoId }),
    ).resolves.toEqual(masterKey);
  });

  it("wraps and unlocks an AMK without retaining the password", async () => {
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const wrapper = await createPasswordWrapper({
      masterKey,
      password: "violet canyon paper lantern",
      workspaceCryptoId,
    });

    expect(wrapper).toMatchObject({
      type: "password",
      kdfAlgorithm: PASSWORD_KDF_ALGORITHM,
      kdfIterations: PASSWORD_KDF_ITERATIONS,
    });
    expect(JSON.stringify(wrapper)).not.toContain("violet canyon paper lantern");
    await expect(
      unlockWithPassword({ wrapper, password: "violet canyon paper lantern", workspaceCryptoId }),
    ).resolves.toEqual(masterKey);
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
