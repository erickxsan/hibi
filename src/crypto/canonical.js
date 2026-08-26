import { utf8 } from "./encoding.js";

function normalize(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  if (typeof value !== "object") throw new TypeError("Canonical JSON supports only JSON values.");
  if (seen.has(value)) throw new TypeError("Canonical JSON does not support circular values.");
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    output[key] = normalize(value[key], seen);
  }
  seen.delete(value);
  return output;
}

export function canonicalStringify(value) {
  return JSON.stringify(normalize(value, new Set()));
}

export function canonicalBytes(value) {
  return utf8(canonicalStringify(value));
}
