// Several screens ask the same question of the same workspace (this month's classes, the pending fees). Answers are
// remembered per state object and reused while every top-level collection is still the same array or object, so
// a section revisited or a sibling calculation costs nothing. Edits replace records; they never change one in place.
const RANGES_PER_STATE = 12;

// A collection counts as unchanged while it is the same array holding the same records.
function snapshot(state) {
  return Object.keys(state).map((key) => [key, state[key], Array.isArray(state[key]) ? state[key].slice() : null]);
}

function sameItems(value, items) {
  return !items || (value.length === items.length && items.every((item, index) => value[index] === item));
}

function unchanged(state, parts) {
  const keys = Object.keys(state);
  return (
    keys.length === parts.length &&
    parts.every(([key, value, items]) => state[key] === value && sameItems(value, items))
  );
}

/**
 * @template {unknown[]} A
 * @template R
 * @param {(state: any, ...args: A) => R} compute
 * @param {(...args: A) => string} keyOf
 * @returns {(state: any, ...args: A) => R}
 */
export function memoizeOnState(compute, keyOf) {
  const cache = new WeakMap();
  return (state, ...args) => {
    if (!state || typeof state !== "object") return compute(state, ...args);
    const key = keyOf(...args);
    let entries = cache.get(state);
    const hit = entries?.get(key);
    // Callers may sort what they receive, so each one gets its own array of the shared (unchanged) items.
    if (hit && unchanged(state, hit.parts)) return Array.isArray(hit.result) ? hit.result.slice() : hit.result;
    const result = compute(state, ...args);
    if (!entries) cache.set(state, (entries = new Map()));
    if (entries.size >= RANGES_PER_STATE) entries.delete(entries.keys().next().value);
    entries.set(key, { parts: snapshot(state), result });
    return Array.isArray(result) ? result.slice() : result;
  };
}

/**
 * Remembers the last few results of a screen model by the identity of its arguments, outside any component, so a
 * section shown again with the same workspace reuses what it computed instead of starting over on mount.
 * @template {(...args: any[]) => any} F
 * @param {F} compute
 * @returns {F}
 */
export function memoizeRecent(compute, size = 4) {
  const recent = [];
  return /** @type {F} */ (
    (...args) => {
      const hit = recent.find(
        (entry) => entry.args.length === args.length && entry.args.every((value, index) => value === args[index]),
      );
      if (hit) return hit.result;
      const result = compute(...args);
      recent.unshift({ args, result });
      if (recent.length > size) recent.pop();
      return result;
    }
  );
}
