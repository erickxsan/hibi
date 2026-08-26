import { concatBytes, equalBytes, toBase64Url } from "./encoding.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LOOKUP = new Map([...ALPHABET].map((character, index) => [character, index]));
const RECOVERY_SECRET_BYTES = 32;
const CHECKSUM_BYTES = 4;

function encodeBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(text) {
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of text) {
    const digit = LOOKUP.get(character);
    if (digit === undefined) throw new TypeError("The recovery key contains an invalid character.");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

async function checksum(secret, cryptoApi) {
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", secret));
  return digest.slice(0, CHECKSUM_BYTES);
}

export async function generateRecoveryKey(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle || !cryptoApi?.getRandomValues) throw new Error("Secure recovery keys are unavailable.");
  const secret = cryptoApi.getRandomValues(new Uint8Array(RECOVERY_SECRET_BYTES));
  const encoded = encodeBase32(concatBytes(secret, await checksum(secret, cryptoApi)));
  return { secret, formatted: `HIBI1-${encoded.match(/.{1,8}/gu).join("-")}` };
}

export async function parseRecoveryKey(value, cryptoApi = globalThis.crypto) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^HIBI1-/u, "")
    .replaceAll("-", "")
    .replaceAll("O", "0")
    .replaceAll("I", "1")
    .replaceAll("L", "1");
  const decoded = decodeBase32(normalized);
  if (decoded.byteLength !== RECOVERY_SECRET_BYTES + CHECKSUM_BYTES) {
    throw new TypeError("The recovery key has an invalid length.");
  }
  const secret = decoded.slice(0, RECOVERY_SECRET_BYTES);
  const actualChecksum = decoded.slice(RECOVERY_SECRET_BYTES);
  if (!equalBytes(actualChecksum, await checksum(secret, cryptoApi))) {
    throw new TypeError("The recovery key checksum is invalid.");
  }
  return secret;
}

export async function recoveryKeyFingerprint(secret, cryptoApi = globalThis.crypto) {
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", secret));
  return toBase64Url(digest.slice(0, 10));
}
