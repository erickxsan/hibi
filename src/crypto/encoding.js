const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(value) {
  return encoder.encode(String(value));
}

export function decodeUtf8(value) {
  return decoder.decode(asBytes(value));
}

export function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("Expected binary data.");
}

export function concatBytes(...values) {
  const parts = values.map(asBytes);
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function toBase64Url(value) {
  const bytes = asBytes(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return globalThis.btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) throw new TypeError("Invalid base64url data.");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = globalThis.atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function equalBytes(left, right) {
  const first = asBytes(left);
  const second = asBytes(right);
  let difference = first.byteLength ^ second.byteLength;
  const length = Math.max(first.byteLength, second.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (first[index] || 0) ^ (second[index] || 0);
  }
  return difference === 0;
}

export function wipeBytes(value) {
  if (value instanceof Uint8Array) value.fill(0);
}
