import { deserializeState } from "../domain/index.js";

// The strict round trip normalizes a workspace state and validates every record. A state that already came out
// of it (the workspace an edit starts from, the optimistic copy staged on this device) is returned as is instead of
// being checked again on every edit. Workspace states are replaced on each change, never edited in place.
const canonicalStates = new WeakSet();

export function canonicalWorkspaceState(value) {
  if (value && typeof value === "object" && canonicalStates.has(value)) return value;
  const state = deserializeState(JSON.stringify(value));
  canonicalStates.add(state);
  return state;
}
