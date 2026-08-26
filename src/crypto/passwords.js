import { equalBytes, fromBase64Url, toBase64Url, utf8, wipeBytes } from "./encoding.js";
import { unwrapMasterKey, WorkspaceCryptoError, wrapMasterKey } from "./workspaceCrypto.js";

export const PASSWORD_KDF_ALGORITHM = "pbkdf2-sha256";
export const PASSWORD_KDF_ITERATIONS = 600_000;
export const PASSWORD_KDF_SALT_BYTES = 32;
const MAX_PASSWORD_CHARACTERS = 1_024;

function requirePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new WorkspaceCryptoError("Enter your encryption password.", { code: "password_required" });
  }
  if (password.length > MAX_PASSWORD_CHARACTERS) {
    throw new WorkspaceCryptoError("The encryption password is too long.", { code: "password_too_long" });
  }
  return password;
}

function requirePasswordWrapper(wrapper) {
  if (
    wrapper?.type !== "password" ||
    wrapper.kdfAlgorithm !== PASSWORD_KDF_ALGORITHM ||
    !Number.isSafeInteger(wrapper.kdfIterations) ||
    wrapper.kdfIterations < PASSWORD_KDF_ITERATIONS ||
    !wrapper.kdfSalt
  ) {
    throw new WorkspaceCryptoError("This password wrapper uses unsupported key-derivation parameters.", {
      code: "password_kdf_unsupported",
    });
  }
  return wrapper;
}

export async function derivePasswordSecret({
  password,
  salt,
  iterations = PASSWORD_KDF_ITERATIONS,
  cryptoApi = globalThis.crypto,
}) {
  const passwordBytes = utf8(requirePassword(password));
  let inputKey;
  try {
    inputKey = await cryptoApi.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(
      await cryptoApi.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, inputKey, 256),
    );
  } finally {
    wipeBytes(passwordBytes);
  }
}

export async function createPasswordWrapper({
  masterKey,
  password,
  workspaceCryptoId,
  keyVersion = 1,
  label = "Encryption password",
  cryptoApi = globalThis.crypto,
}) {
  const wrapperId = cryptoApi.randomUUID();
  const salt = cryptoApi.getRandomValues(new Uint8Array(PASSWORD_KDF_SALT_BYTES));
  const secret = await derivePasswordSecret({ password, salt, cryptoApi });
  try {
    return {
      wrapperId,
      type: "password",
      label,
      kdfAlgorithm: PASSWORD_KDF_ALGORITHM,
      kdfIterations: PASSWORD_KDF_ITERATIONS,
      kdfSalt: toBase64Url(salt),
      ...(await wrapMasterKey({
        masterKey,
        wrappingSecret: secret,
        workspaceCryptoId,
        wrapperId,
        keyVersion,
        cryptoApi,
      })),
    };
  } finally {
    wipeBytes(secret);
    wipeBytes(salt);
  }
}

export async function unlockWithPassword({ wrapper, password, workspaceCryptoId, cryptoApi = globalThis.crypto }) {
  requirePasswordWrapper(wrapper);
  const secret = await derivePasswordSecret({
    password,
    salt: fromBase64Url(wrapper.kdfSalt),
    iterations: wrapper.kdfIterations,
    cryptoApi,
  });
  try {
    return await unwrapMasterKey({ wrapper, wrappingSecret: secret, workspaceCryptoId, cryptoApi });
  } catch (error) {
    throw new WorkspaceCryptoError("That encryption password is incorrect.", {
      code: "invalid_password",
      cause: error,
    });
  } finally {
    wipeBytes(secret);
  }
}

export async function rewrapPassword({
  wrapper,
  password,
  currentMasterKey,
  newMasterKey,
  workspaceCryptoId,
  keyVersion,
  cryptoApi = globalThis.crypto,
}) {
  requirePasswordWrapper(wrapper);
  const secret = await derivePasswordSecret({
    password,
    salt: fromBase64Url(wrapper.kdfSalt),
    iterations: wrapper.kdfIterations,
    cryptoApi,
  });
  let unwrapped;
  try {
    unwrapped = await unwrapMasterKey({ wrapper, wrappingSecret: secret, workspaceCryptoId, cryptoApi });
    if (!equalBytes(unwrapped, currentMasterKey)) {
      throw new WorkspaceCryptoError("That encryption password is incorrect.", { code: "invalid_password" });
    }
    return {
      ...wrapper,
      keyVersion,
      ...(await wrapMasterKey({
        masterKey: newMasterKey,
        wrappingSecret: secret,
        workspaceCryptoId,
        wrapperId: wrapper.wrapperId,
        keyVersion,
        cryptoApi,
      })),
      revokedAt: null,
    };
  } catch (error) {
    if (error?.code === "invalid_password") throw error;
    throw new WorkspaceCryptoError("That encryption password is incorrect.", {
      code: "invalid_password",
      cause: error,
    });
  } finally {
    if (unwrapped) wipeBytes(unwrapped);
    wipeBytes(secret);
  }
}
