import { canonicalStringify } from "../crypto/canonical.js";

// Field-level synchronization for the decrypted workspace. The server only sees
// opaque envelopes, so every combination happens here, after authentication.

export const SYNC_COLLECTIONS = Object.freeze([
  "groups",
  "students",
  "grades",
  "classLog",
  "classSchedules",
  "scheduleExceptions",
  "scheduleChanges",
]);

export const SETTINGS_ENTITY_KEY = "settings/__settings__";

// apply_encrypted_workspace_mutation rejects more than 500 upserts + deletions.
export const MAX_SYNC_CHANGES = 500;

// View position and tutorial progress are per-device preferences stored with
// the settings. Concurrent values are not records, so the newest local value wins.
const PREFERENCE_SETTINGS = new Set([
  "selectedMonth",
  "asOfDate",
  "onboardingStep",
  "onboardingVersion",
  "onboardingGroupId",
]);

// Unordered ID lists. Additions and removals from both sides can be combined.
const SET_FIELDS = new Set(["groupIds", "participantIds", "daysOfWeek"]);

function canonical(value) {
  try {
    return canonicalStringify(value ?? null);
  } catch {
    return JSON.stringify(value ?? null);
  }
}

export function sameValue(left, right) {
  if (left === right) return true;
  if ((left === undefined || left === null) !== (right === undefined || right === null)) return false;
  const leftJson = JSON.stringify(left ?? null);
  const rightJson = JSON.stringify(right ?? null);
  return leftJson === rightJson || canonical(left) === canonical(right);
}

function entityKey(collection, entityId) {
  return `${collection}/${entityId}`;
}

function byId(items) {
  return new Map((items || []).map((item) => [String(item.id), item]));
}

function settingsValue(state) {
  return { version: state?.version, settings: state?.settings };
}

export function indexOrderKeys(state) {
  return Object.fromEntries(
    SYNC_COLLECTIONS.map((collection) => [
      collection,
      Object.fromEntries((state?.[collection] || []).map((item, position) => [String(item.id), position])),
    ]),
  );
}

/**
 * Stored order keys of a verified or projected workspace. Positions are sparse
 * sort keys: a deletion leaves a gap instead of rewriting every later record.
 * Workspaces cached by earlier releases have no key map; their positions were
 * contiguous, so list indexes describe them.
 */
export function orderKeysFor(workspace) {
  const stored = workspace?.positions;
  if (!stored || typeof stored !== "object") return indexOrderKeys(workspace?.state);
  return Object.fromEntries(
    SYNC_COLLECTIONS.map((collection) => {
      const keys = {};
      for (const item of workspace.state?.[collection] || []) {
        const key = stored[collection]?.[String(item.id)];
        // A missing or malformed key is planned again like a new record.
        if (Number.isSafeInteger(key) && key >= 0) keys[String(item.id)] = key;
      }
      return [collection, keys];
    }),
  );
}

// Keep every stored key that still increases along the list. Only new or
// displaced records receive a new key, so deleting a record rewrites nothing else.
function planOrder(items, previousKeys = {}) {
  const keys = {};
  let last = -1;
  for (const item of items) {
    const id = String(item.id);
    const stored = previousKeys[id];
    const key = Number.isSafeInteger(stored) && stored > last ? stored : last + 1;
    keys[id] = key;
    last = key;
  }
  return keys;
}

/**
 * Entity changes from one complete state to another. Content changes and order
 * changes are reported separately: a record that only receives a new sort key is
 * still re-encrypted, but it is not part of the user's edit.
 */
export function diffWorkspaceStates(previous, next, previousKeys = indexOrderKeys(previous)) {
  const settings = !sameValue(settingsValue(previous), settingsValue(next));
  const collections = {};
  const positions = {};
  const entityKeys = settings ? [SETTINGS_ENTITY_KEY] : [];
  let changeCount = settings ? 1 : 0;
  for (const collection of SYNC_COLLECTIONS) {
    const before = byId(previous?.[collection]);
    const after = next?.[collection] || [];
    const storedKeys = previousKeys?.[collection] || {};
    const keys = planOrder(after, storedKeys);
    const upserts = [];
    for (const item of after) {
      const id = String(item.id);
      const old = before.get(id);
      const contentChanged = !old || !sameValue(old, item);
      if (contentChanged) entityKeys.push(entityKey(collection, id));
      if (contentChanged || storedKeys[id] !== keys[id]) upserts.push({ data: item, position: keys[id] });
    }
    const nextIds = new Set(after.map((item) => String(item.id)));
    const deletes = [...before.keys()].filter((id) => !nextIds.has(id));
    for (const id of deletes) entityKeys.push(entityKey(collection, id));
    positions[collection] = keys;
    changeCount += upserts.length + deletes.length;
    if (upserts.length || deletes.length) collections[collection] = { upserts, deletes };
  }
  return { settings, collections, positions, entityKeys, changeCount };
}

function orderedKeys(...objects) {
  const keys = [];
  const seen = new Set();
  for (const object of objects) {
    for (const key of Object.keys(object || {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function mergeSet(base, local, remote) {
  const baseSet = new Set((base || []).map(canonical));
  const localSet = new Set((local || []).map(canonical));
  const remoteSet = new Set((remote || []).map(canonical));
  const removed = new Set([...baseSet].filter((item) => !localSet.has(item) || !remoteSet.has(item)));
  const output = [];
  const seen = new Set();
  for (const item of [...(remote || []), ...(local || [])]) {
    const key = canonical(item);
    if (seen.has(key) || removed.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function mergeFields(base, local, remote, { prefer, preferences = null }) {
  const output = {};
  const conflicts = [];
  for (const field of orderedKeys(remote, local, base)) {
    const baseValue = base?.[field];
    const localValue = local?.[field];
    const remoteValue = remote?.[field];
    const localChanged = !sameValue(baseValue, localValue);
    const remoteChanged = !sameValue(baseValue, remoteValue);
    let value = remoteValue;
    if (localChanged && (!remoteChanged || sameValue(localValue, remoteValue))) value = localValue;
    else if (localChanged) {
      if (SET_FIELDS.has(field) && [baseValue ?? [], localValue ?? [], remoteValue ?? []].every(Array.isArray)) {
        value = mergeSet(baseValue, localValue, remoteValue);
      } else if (preferences?.has(field)) {
        value = localValue;
      } else {
        conflicts.push(field);
        value = prefer === "local" ? localValue : remoteValue;
      }
    }
    if (value !== undefined) output[field] = value;
  }
  return { value: output, conflicts };
}

function conflict(collection, entityId, kind, fields = []) {
  return { collection, entityId: String(entityId), kind, fields };
}

/**
 * Three-way merge of one queued operation (base -> local) onto the newest state.
 * Only fields changed by the operation are applied. A field changed to different
 * values on both sides, an edit of a removed record, or a removal of an edited
 * record is a conflict. prefer: "local" applies the local side of those
 * conflicts (an explicit user decision or a display-only overlay).
 */
export function mergeWorkspaceStates({ base, local, remote, prefer = "none" }) {
  const conflicts = [];
  let state = { ...remote };

  for (const key of orderedKeys(remote, local, base)) {
    if (key === "settings" || SYNC_COLLECTIONS.includes(key)) continue;
    const merged = mergeFields({ value: base?.[key] }, { value: local?.[key] }, { value: remote?.[key] }, { prefer });
    if (merged.conflicts.length) conflicts.push(conflict("settings", "__settings__", "field", [key]));
    if (merged.value.value === undefined) delete state[key];
    else state[key] = merged.value.value;
  }

  const settings = mergeFields(base?.settings || {}, local?.settings || {}, remote?.settings || {}, {
    prefer,
    preferences: PREFERENCE_SETTINGS,
  });
  if (settings.conflicts.length) conflicts.push(conflict("settings", "__settings__", "field", settings.conflicts));
  state.settings = settings.value;

  for (const collection of SYNC_COLLECTIONS) {
    const baseItems = byId(base?.[collection]);
    const localItems = byId(local?.[collection]);
    const remoteList = remote?.[collection] || [];
    const remoteItems = byId(remoteList);
    const result = new Map();
    for (const id of new Set([...baseItems.keys(), ...localItems.keys(), ...remoteItems.keys()])) {
      const inBase = baseItems.has(id);
      const inLocal = localItems.has(id);
      const inRemote = remoteItems.has(id);
      const baseItem = baseItems.get(id);
      const localItem = localItems.get(id);
      const remoteItem = remoteItems.get(id);
      if (inBase === inLocal && (!inBase || sameValue(baseItem, localItem))) {
        if (inRemote) result.set(id, remoteItem);
        continue;
      }
      if (!inBase) {
        // Created by this operation. An identical remote record already satisfies it.
        if (!inRemote || sameValue(localItem, remoteItem)) {
          result.set(id, inRemote ? remoteItem : localItem);
          continue;
        }
        const merged = mergeFields({}, localItem, remoteItem, { prefer });
        if (merged.conflicts.length) conflicts.push(conflict(collection, id, "create", merged.conflicts));
        result.set(id, merged.value);
        continue;
      }
      if (!inLocal) {
        // Deleted by this operation.
        if (!inRemote) continue;
        if (sameValue(baseItem, remoteItem)) continue;
        conflicts.push(conflict(collection, id, "delete-edit"));
        if (prefer !== "local") result.set(id, remoteItem);
        continue;
      }
      if (!inRemote) {
        conflicts.push(conflict(collection, id, "edit-delete"));
        if (prefer === "local") result.set(id, localItem);
        continue;
      }
      const merged = mergeFields(baseItem, localItem, remoteItem, { prefer });
      if (merged.conflicts.length) conflicts.push(conflict(collection, id, "field", merged.conflicts));
      result.set(id, merged.value);
    }
    const ordered = [];
    for (const item of remoteList) {
      const id = String(item.id);
      if (result.has(id)) ordered.push(result.get(id));
    }
    for (const item of local?.[collection] || []) {
      const id = String(item.id);
      if (!remoteItems.has(id) && result.has(id)) ordered.push(result.get(id));
    }
    state = { ...state, [collection]: ordered };
  }

  return { state, conflicts };
}

/** Entity keys whose content an operation changes, without order-only rewrites. */
export function operationEntityKeys(mutation) {
  if (Array.isArray(mutation?.entityKeys)) return mutation.entityKeys;
  if (mutation?.previousState && mutation?.state) {
    return diffWorkspaceStates(mutation.previousState, mutation.state).entityKeys;
  }
  return [...(mutation?.upserts || []), ...(mutation?.deletes || [])].map((item) =>
    entityKey(item.collection, item.entityId),
  );
}

function recordFor(state, collection, entityId) {
  if (collection === "settings") return state?.settings ?? null;
  return (state?.[collection] || []).find((item) => String(item.id) === String(entityId)) ?? null;
}

/**
 * A reviewable description of one queued operation: for every record it
 * changes, the value before the edit, on this device, and in the cloud now.
 */
export function describeOperation(mutation, remoteState) {
  const base = mutation?.previousState;
  const local = mutation?.state;
  if (!base || !local) return { changes: [], conflicts: [] };
  const conflicts = remoteState ? mergeWorkspaceStates({ base, local, remote: remoteState }).conflicts : [];
  const conflictFields = new Map(conflicts.map((item) => [entityKey(item.collection, item.entityId), item]));
  const changes = operationEntityKeys(mutation).map((key) => {
    const separator = key.indexOf("/");
    const collection = key.slice(0, separator);
    const entityId = key.slice(separator + 1);
    const before = recordFor(base, collection, entityId);
    const after = recordFor(local, collection, entityId);
    const cloud = remoteState ? recordFor(remoteState, collection, entityId) : undefined;
    const kind = !before ? "create" : !after ? "delete" : "edit";
    const fields = orderedKeys(before, after)
      .filter((field) => field !== "id" && !sameValue(before?.[field], after?.[field]))
      .map((field) => ({
        field,
        before: before?.[field],
        local: after?.[field],
        cloud: cloud === undefined ? undefined : cloud?.[field],
        conflict: Boolean(conflictFields.get(key)?.fields.includes(field)),
      }));
    const entityConflict = conflictFields.get(key);
    return {
      collection,
      entityId,
      kind,
      before,
      local: after,
      cloud,
      fields,
      conflict: entityConflict ? entityConflict.kind : null,
    };
  });
  return { changes, conflicts };
}
