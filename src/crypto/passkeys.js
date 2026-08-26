import { fromBase64Url, toBase64Url } from "./encoding.js";
import { wrapMasterKey, unwrapMasterKey, WorkspaceCryptoError } from "./workspaceCrypto.js";

export const HIBI_PRODUCTION_ORIGIN = "https://usehibi.pages.dev";
export const HIBI_RP_ID = "usehibi.pages.dev";

function randomBytes(length, cryptoApi) {
  return cryptoApi.getRandomValues(new Uint8Array(length));
}

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function requirePasskeyEnvironment({ credentials, PublicKeyCredentialApi, origin, cryptoApi }) {
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues || !credentials || !PublicKeyCredentialApi) {
    throw new WorkspaceCryptoError("Passkeys with PRF are not available in this browser.", {
      code: "passkey_unavailable",
    });
  }
  if (origin !== HIBI_PRODUCTION_ORIGIN) {
    throw new WorkspaceCryptoError("Production passkeys can only be managed on the official Hibi origin.", {
      code: "invalid_passkey_origin",
    });
  }
}

function prfResult(credential) {
  const first = credential?.getClientExtensionResults?.()?.prf?.results?.first;
  if (!first) {
    throw new WorkspaceCryptoError("This passkey provider did not return a WebAuthn PRF secret.", {
      code: "passkey_prf_unavailable",
    });
  }
  return new Uint8Array(first);
}

function optionalPrfResult(credential) {
  const first = credential?.getClientExtensionResults?.()?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

export function canAttemptPasskeyPrf({
  credentials = globalThis.navigator?.credentials,
  PublicKeyCredentialApi = globalThis.PublicKeyCredential,
  origin = globalThis.location?.origin,
} = {}) {
  return Boolean(credentials && PublicKeyCredentialApi && origin === HIBI_PRODUCTION_ORIGIN);
}

export async function registerPasskey({
  user,
  masterKey,
  workspaceCryptoId,
  existingCredentialIds = [],
  label = "Passkey",
  credentials = globalThis.navigator?.credentials,
  PublicKeyCredentialApi = globalThis.PublicKeyCredential,
  origin = globalThis.location?.origin,
  cryptoApi = globalThis.crypto,
}) {
  requirePasskeyEnvironment({ credentials, PublicKeyCredentialApi, origin, cryptoApi });
  const wrapperId = cryptoApi.randomUUID();
  const prfSalt = randomBytes(32, cryptoApi);
  const credential = await credentials.create({
    publicKey: {
      challenge: asArrayBuffer(randomBytes(32, cryptoApi)),
      rp: { id: HIBI_RP_ID, name: "Hibi" },
      user: {
        id: asArrayBuffer(new TextEncoder().encode(user.id)),
        name: user.email || user.id,
        displayName: user.email || "Hibi user",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      timeout: 120000,
      excludeCredentials: existingCredentialIds.map((id) => ({
        type: "public-key",
        id: asArrayBuffer(fromBase64Url(id)),
      })),
      extensions: { prf: { eval: { first: asArrayBuffer(prfSalt) } } },
    },
  });
  if (!credential) throw new WorkspaceCryptoError("Passkey registration was cancelled.", { code: "passkey_cancelled" });
  let secret = optionalPrfResult(credential);
  if (!secret) {
    const assertion = await credentials.get({
      publicKey: {
        challenge: asArrayBuffer(randomBytes(32, cryptoApi)),
        rpId: HIBI_RP_ID,
        allowCredentials: [{ type: "public-key", id: credential.rawId }],
        userVerification: "required",
        timeout: 120000,
        extensions: { prf: { eval: { first: asArrayBuffer(prfSalt) } } },
      },
    });
    secret = prfResult(assertion);
  }
  const wrapped = await wrapMasterKey({ masterKey, wrappingSecret: secret, workspaceCryptoId, wrapperId, cryptoApi });
  secret.fill(0);
  return {
    wrapperId,
    type: "passkey",
    label,
    credentialId: toBase64Url(credential.rawId),
    prfSalt: toBase64Url(prfSalt),
    transports: credential.response?.getTransports?.() || [],
    ...wrapped,
  };
}

export async function unlockWithPasskey({
  wrapper,
  workspaceCryptoId,
  credentials = globalThis.navigator?.credentials,
  PublicKeyCredentialApi = globalThis.PublicKeyCredential,
  origin = globalThis.location?.origin,
  cryptoApi = globalThis.crypto,
}) {
  requirePasskeyEnvironment({ credentials, PublicKeyCredentialApi, origin, cryptoApi });
  const salt = fromBase64Url(wrapper.prfSalt);
  const assertion = await credentials.get({
    publicKey: {
      challenge: asArrayBuffer(randomBytes(32, cryptoApi)),
      rpId: HIBI_RP_ID,
      allowCredentials: [
        {
          type: "public-key",
          id: asArrayBuffer(fromBase64Url(wrapper.credentialId)),
          transports: wrapper.transports || undefined,
        },
      ],
      userVerification: "required",
      timeout: 120000,
      extensions: { prf: { eval: { first: asArrayBuffer(salt) } } },
    },
  });
  if (!assertion) throw new WorkspaceCryptoError("Passkey unlock was cancelled.", { code: "passkey_cancelled" });
  if (toBase64Url(assertion.rawId) !== wrapper.credentialId) {
    throw new WorkspaceCryptoError("The passkey response did not match the selected key.");
  }
  const secret = prfResult(assertion);
  try {
    return await unwrapMasterKey({ wrapper, wrappingSecret: secret, workspaceCryptoId, cryptoApi });
  } finally {
    secret.fill(0);
  }
}

export async function rewrapPasskey({
  wrapper,
  newMasterKey,
  workspaceCryptoId,
  keyVersion,
  credentials = globalThis.navigator?.credentials,
  PublicKeyCredentialApi = globalThis.PublicKeyCredential,
  origin = globalThis.location?.origin,
  cryptoApi = globalThis.crypto,
}) {
  requirePasskeyEnvironment({ credentials, PublicKeyCredentialApi, origin, cryptoApi });
  const salt = fromBase64Url(wrapper.prfSalt);
  const assertion = await credentials.get({
    publicKey: {
      challenge: asArrayBuffer(randomBytes(32, cryptoApi)),
      rpId: HIBI_RP_ID,
      allowCredentials: [
        {
          type: "public-key",
          id: asArrayBuffer(fromBase64Url(wrapper.credentialId)),
          transports: wrapper.transports || undefined,
        },
      ],
      userVerification: "required",
      timeout: 120000,
      extensions: { prf: { eval: { first: asArrayBuffer(salt) } } },
    },
  });
  if (!assertion || toBase64Url(assertion.rawId) !== wrapper.credentialId) {
    throw new WorkspaceCryptoError("The selected passkey could not authorize key rotation.");
  }
  const secret = prfResult(assertion);
  try {
    const wrapped = await wrapMasterKey({
      masterKey: newMasterKey,
      wrappingSecret: secret,
      workspaceCryptoId,
      wrapperId: wrapper.wrapperId,
      keyVersion,
      cryptoApi,
    });
    return { ...wrapper, keyVersion, ...wrapped, revokedAt: null };
  } finally {
    secret.fill(0);
  }
}
