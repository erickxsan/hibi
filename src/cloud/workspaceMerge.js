import { canonicalStringify } from "../crypto/canonical.js";
import { settingsDataVersion } from "../domain/dataVersion.js";
import { lostKey, normalizeLostPayments } from "../domain/lostPayments.js";
import { monthlyBalance, normalizeBillingByGroup, normalizeMonthlyPayments } from "../domain/monthlyBilling.js";
import { isBlankTwin, TWIN_COLLECTIONS, twinKey } from "../domain/recordTwins.js";

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

// The newest build that wrote the workspace (domain/dataVersion.js). It only ever goes up: concurrent
// values merge to the highest, never to a conflict, and it is not an edit a person reviews.
const DATA_VERSION_FIELD = "dataVersion";

// Unordered ID lists. Additions and removals from both sides can be combined.
const SET_FIELDS = new Set(["groupIds", "participantIds", "daysOfWeek"]);
// Keyed maps where each device adds or removes its own keys (the «Antes de empezar» notes marked as seen).
const MAP_FIELDS = new Set(["dismissedNotes"]);

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

function settingsContent(state) {
  const { [DATA_VERSION_FIELD]: _stamp, ...settings } = state?.settings || {};
  return { version: state?.version, settings };
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
  // Stamping the data version alone rewrites the settings record but is not the user's edit.
  const entityKeys =
    settings && !sameValue(settingsContent(previous), settingsContent(next)) ? [SETTINGS_ENTITY_KEY] : [];
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
  const items = {};
  for (const field of orderedKeys(remote, local, base)) {
    const baseValue = base?.[field];
    const localValue = local?.[field];
    const remoteValue = remote?.[field];
    const localChanged = !sameValue(baseValue, localValue);
    const remoteChanged = !sameValue(baseValue, remoteValue);
    const structured = STRUCTURED_FIELDS[field];
    let value = remoteValue;
    if (localChanged && (!remoteChanged || sameValue(localValue, remoteValue))) value = localValue;
    else if (localChanged) {
      if (SET_FIELDS.has(field) && [baseValue ?? [], localValue ?? [], remoteValue ?? []].every(Array.isArray)) {
        value = mergeSet(baseValue, localValue, remoteValue);
      } else if (MAP_FIELDS.has(field) && [baseValue, localValue, remoteValue].every(isPlainMap)) {
        value = mergeMap(baseValue, localValue, remoteValue);
      } else if (structured && [baseValue, localValue, remoteValue].every(structured.accepts)) {
        const merged = structured.merge(baseValue, localValue, remoteValue, prefer);
        value = merged.value;
        if (merged.collisions.length) {
          conflicts.push(field);
          items[field] = merged.collisions;
        }
      } else if (preferences?.has(field)) {
        value = localValue;
      } else {
        conflicts.push(field);
        value = prefer === "local" ? localValue : remoteValue;
      }
    }
    if (value !== undefined) output[field] = value;
  }
  return { value: output, conflicts, items };
}

function isPlainMap(value) {
  return value === undefined || value === null || (typeof value === "object" && !Array.isArray(value));
}

function isList(value) {
  return value === undefined || value === null || Array.isArray(value);
}

/*
 * A student's money (audit B3): receipts, lost marks and per-group billing are merged element by
 * element, so two devices that record different payments, marks or groups keep both. Only the same
 * element changed differently on both sides is a conflict, and then only on that element.
 */

/**
 * Three-way merge of a list keyed by `keyOf`: additions from both sides are kept and a removal on one
 * side removes the element unless the other side changed it. `yields(before, after)` says when a
 * change is too small to keep an element the other side removed, and also when both sides hold the
 * same element: changed on both, but only in that way, it is no collision and the remote one stays
 * (the local one with prefer "local").
 * @param {(before: any, after: any) => boolean} [yields]
 */
function mergeKeyed(base, local, remote, keyOf, prefer, yields = () => false) {
  const index = (list) => new Map((list || []).map((item) => [keyOf(item), item]));
  const [before, mine, theirs] = [index(base), index(local), index(remote)];
  const value = [];
  const collisions = [];
  for (const key of new Set([...theirs.keys(), ...mine.keys(), ...before.keys()])) {
    const [baseItem, localItem, remoteItem] = [before.get(key), mine.get(key), theirs.get(key)];
    // One side took the element back and the other only rewrote its bookkeeping: it stays removed.
    const removed =
      localItem === undefined ? yields(baseItem, remoteItem) : remoteItem === undefined && yields(baseItem, localItem);
    let item;
    if (sameValue(baseItem, localItem)) item = remoteItem;
    else if (sameValue(baseItem, remoteItem) || sameValue(localItem, remoteItem)) item = localItem;
    else if (removed) item = undefined;
    else if (yields(localItem, remoteItem)) item = prefer === "local" ? localItem : remoteItem;
    else {
      collisions.push(key);
      item = prefer === "local" ? localItem : remoteItem;
    }
    if (item !== undefined) value.push(item);
  }
  return { value, collisions };
}

/** The month a receipt pays: group and period. */
function monthOf(payment) {
  return `${payment?.groupId}|${payment?.period}`;
}

// Undo rewrites `settledTotal` and `partial` on the receipts left in its month, and a merge that
// settles a month rewrites them on its last receipt. That bookkeeping alone never keeps a receipt the
// other device took back, and two copies of one receipt that differ only in it are the same receipt
// (merging an operation again over its own result is no conflict).
function onlyBookkeeping(before, after) {
  if (!before || !after) return false;
  const { settledTotal: _beforeTotal, partial: _beforePartial, ...beforeRest } = before;
  const { settledTotal: _afterTotal, partial: _afterPartial, ...afterRest } = after;
  return sameValue(beforeRest, afterRest);
}

/** `payments` with the receipts of `months` taken from `source` instead. */
function withMonths(payments, months, source) {
  const replaced = new Set(months);
  return [
    ...(payments || []).filter((item) => !replaced.has(monthOf(item))),
    ...(source || []).filter((item) => replaced.has(monthOf(item))),
  ];
}

function receiptsOrNone(payments) {
  const value = normalizeMonthlyPayments(payments);
  return value.length ? value : undefined;
}

/**
 * Receipts by id. A month is the unit of review: when one of its receipts collides, the whole month
 * comes from one side (this device's with prefer "local"), so a month is never paid twice by mixing
 * both sides' receipts. Collisions are reported as months ("groupId|period").
 */
function mergeReceipts(base, local, remote, prefer) {
  const months = new Map((base || []).concat(local || [], remote || []).map((item) => [String(item?.id), item]));
  const merged = mergeKeyed(base, local, remote, (item) => String(item?.id), prefer, onlyBookkeeping);
  const collisions = [...new Set(merged.collisions.map((id) => monthOf(months.get(id))))];
  const value = collisions.length
    ? withMonths(merged.value, collisions, prefer === "local" ? local : remote)
    : merged.value;
  return { value: receiptsOrNone(value), collisions };
}

/** Lost marks by debt (lostKey). */
function mergeLostMarks(base, local, remote, prefer) {
  const merged = mergeKeyed(base, local, remote, lostKey, prefer);
  const value = normalizeLostPayments(merged.value);
  return { value: value.length ? value : undefined, collisions: merged.collisions };
}

// How the student pays in a group (mode, fee, due, their own price per hour and the earlier adjustments)
// is one timeline: mixing one device's fee with the other's start month would invent an adjustment nobody
// chose. Their stay (joinedOn, firstMonthAmount, leftOn, away) is another: leaving turns into an away
// stretch on return. The two parts are written by different screens («Editar cobro», «Cambiar
// integrantes»), so they merge separately.
const ADJUSTMENT_FIELDS = new Set(["mode", "fee", "due", "effectiveFrom", "history", "hourlyRate"]);

function overridePart(override, adjustment) {
  return Object.fromEntries(
    Object.entries(override || {}).filter(([field]) => ADJUSTMENT_FIELDS.has(field) === adjustment),
  );
}

// What a part means once normalized, so `{ mode: "group" }` and no entry at all compare equal.
function partMeaning(part) {
  return normalizeBillingByGroup({ group: part })?.group ?? null;
}

/** Per-group billing by group id; inside one group, the adjustment and the stay merge on their own. */
function mergeBillingByGroup(base, local, remote, prefer) {
  const output = {};
  const collisions = [];
  for (const groupId of orderedKeys(remote, local, base)) {
    const merged = {};
    for (const adjustment of [true, false]) {
      const [before, mine, theirs] = [base, local, remote].map((map) => overridePart(map?.[groupId], adjustment));
      const same = (left, right) => sameValue(partMeaning(left), partMeaning(right));
      let part;
      if (same(before, mine)) part = theirs;
      else if (same(before, theirs) || same(mine, theirs)) part = mine;
      else {
        if (!collisions.includes(groupId)) collisions.push(groupId);
        part = prefer === "local" ? mine : theirs;
      }
      Object.assign(merged, part);
    }
    if (Object.keys(merged).length) output[groupId] = merged;
  }
  return { value: normalizeBillingByGroup(output) ?? undefined, collisions };
}

const STRUCTURED_FIELDS = {
  monthlyPayments: { accepts: isList, merge: mergeReceipts },
  lostPayments: { accepts: isList, merge: mergeLostMarks },
  billingByGroup: { accepts: isPlainMap, merge: mergeBillingByGroup },
};

/** Applies the keys local added, changed or removed since base onto the remote map. */
function mergeMap(base, local, remote) {
  const output = { ...(remote || {}) };
  for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local || {})])) {
    if (sameValue(base?.[key], local?.[key])) continue;
    if (local?.[key] === undefined) delete output[key];
    else output[key] = local[key];
  }
  return output;
}

/**
 * A conflict on one record. `items` names, for a student's money fields, the elements that collide:
 * months ("groupId|period") of `monthlyPayments`, debts (lostKey) of `lostPayments`, group ids of
 * `billingByGroup`. The rest of those fields merged and is never part of the decision.
 * `twinId` names the cloud's record of a "duplicate" (foldTwins).
 * @typedef {{ collection: string, entityId: string, kind: string, fields: string[],
 *   items?: Record<string, string[]>, twinId?: string }} MergeConflict
 * @returns {MergeConflict}
 */
function conflict(collection, entityId, kind, fields = [], items = {}) {
  return {
    collection,
    entityId: String(entityId),
    kind,
    fields,
    ...(Object.keys(items).length ? { items } : {}),
  };
}

function withoutId(record) {
  const { id: _id, ...fields } = record || {};
  return fields;
}

/**
 * Twin records (domain/recordTwins.js): this operation saved a class, or a grade, that the cloud already
 * holds under another id, because the two devices had not seen each other's save. Keeping both would show
 * one and count both, so the operation's record is folded into the cloud's and only the cloud's id stays.
 * Identical records, or a side with nothing recorded yet, fold silently; different values on both sides
 * are a "duplicate" conflict on the fields that differ (prefer "local" applies this device's values).
 * An edit of a record the cloud no longer has lands on its twin when there is one: an earlier fold of
 * this device's own record, or a duplicate another device cleaned up.
 * Only twins this operation could not see are folded: duplicates already stored on either side stay.
 */
function foldTwins(collection, { base, local, remote, result, vanished, prefer, conflicts, renamed }) {
  const baseItems = byId(base?.[collection]);
  const remoteItems = byId(remote?.[collection]);
  const residentKey = (id) => {
    if (!remoteItems.has(id) || !result.has(id)) return null;
    const key = twinKey(collection, result.get(id));
    return key && key === twinKey(collection, remoteItems.get(id)) ? key : null;
  };
  // Cloud records at their cloud identity, first in cloud order; `unseen` only those this operation did not know.
  const residents = new Map();
  const unseen = new Map();
  for (const item of remote?.[collection] || []) {
    const id = String(item.id);
    const key = residentKey(id);
    if (!key) continue;
    if (!residents.has(key)) residents.set(key, id);
    if (!unseen.has(key) && twinKey(collection, baseItems.get(id)) !== key) unseen.set(key, id);
  }
  const fold = (id, twinId, merged, fields, forced = false) => {
    result.delete(id);
    result.set(twinId, merged);
    renamed.set(id, twinId);
    if (fields.length || forced) conflicts.push({ ...conflict(collection, id, "duplicate", fields), twinId });
  };

  // Records this operation added, or moved onto another class.
  for (const item of local?.[collection] || []) {
    const id = String(item.id);
    if (!result.has(id) || residentKey(id)) continue;
    const mine = result.get(id);
    const twinId = unseen.get(twinKey(collection, mine));
    if (!twinId) continue;
    const theirs = result.get(twinId);
    // Moving a cloud record away deletes it there: always a decision.
    const moved = remoteItems.has(id);
    if (sameValue(withoutId(mine), withoutId(theirs)) || isBlankTwin(collection, mine)) {
      fold(id, twinId, theirs, [], moved);
    } else if (isBlankTwin(collection, theirs)) {
      fold(id, twinId, { id: theirs.id, ...withoutId(mine) }, [], moved);
    } else {
      const merged = mergeFields({}, withoutId(mine), withoutId(theirs), { prefer });
      fold(id, twinId, { id: theirs.id, ...merged.value }, merged.conflicts, moved);
    }
  }

  // Records this operation edited that the cloud no longer has.
  for (const { id, baseItem, localItem } of vanished) {
    const twinId = residents.get(twinKey(collection, localItem));
    if (!twinId) {
      conflicts.push(conflict(collection, id, "edit-delete"));
      if (prefer === "local") result.set(id, localItem);
      continue;
    }
    const merged = mergeFields(withoutId(baseItem), withoutId(localItem), withoutId(result.get(twinId)), { prefer });
    fold(id, twinId, { id: result.get(twinId).id, ...merged.value }, merged.conflicts);
  }
}

/**
 * Classes folded by an earlier merge: this device still names its own record, which the cloud never
 * kept, in a lost mark it set without editing the class. The mark belongs to the cloud's record of the
 * same class (same twin key), so it is added to `renamed` to follow it there.
 */
function renameFoldedMarks(state, sources, renamed) {
  const kept = new Set((state.classLog || []).map((row) => String(row.id)));
  const orphans = new Set(
    (state.students || []).flatMap((student) =>
      markList(student)
        .filter((mark) => mark?.kind === "class")
        .map((mark) => String(mark.classId))
        .filter((classId) => !kept.has(classId) && !renamed.has(classId)),
    ),
  );
  if (!orphans.size) return;
  const residents = new Map();
  for (const row of state.classLog || []) {
    const key = twinKey("classLog", row);
    if (key && !residents.has(key)) residents.set(key, String(row.id));
  }
  for (const source of sources)
    for (const row of source?.classLog || []) {
      const classId = String(row.id);
      if (!orphans.has(classId) || renamed.has(classId)) continue;
      const twinId = residents.get(twinKey("classLog", row));
      if (twinId) renamed.set(classId, twinId);
    }
}

// Lost-payment marks name class ids: a mark on a folded record follows it to the record that stays.
function followRenamedClasses(students, renamed) {
  if (!renamed.size) return students;
  return students.map((student) => {
    if (!student?.lostPayments?.some((mark) => mark?.kind === "class" && renamed.has(String(mark.classId))))
      return student;
    const seen = new Set();
    const lostPayments = student.lostPayments.flatMap((mark) => {
      const next =
        mark?.kind === "class" && renamed.has(String(mark.classId))
          ? { ...mark, classId: renamed.get(String(mark.classId)) }
          : mark;
      const key = next?.kind === "class" ? `class|${next.classId}` : null;
      if (key && seen.has(key)) return [];
      if (key) seen.add(key);
      return [next];
    });
    // In canonical order again (by debt), so equal marks compare equal.
    return { ...student, lostPayments: lostPayments.sort((a, b) => lostKey(a).localeCompare(lostKey(b))) };
  });
}

const receiptList = (record) => (Array.isArray(record?.monthlyPayments) ? record.monthlyPayments : []);
const markList = (record) => (Array.isArray(record?.lostPayments) ? record.lostPayments : []);

/** Months whose receipts `side` added, removed or changed since `base`. */
function monthsTouched(base, side) {
  const before = byId(receiptList(base));
  const after = byId(receiptList(side));
  const months = new Set();
  for (const id of new Set([...before.keys(), ...after.keys()]))
    if (!sameValue(before.get(id), after.get(id))) months.add(monthOf(after.get(id) || before.get(id)));
  return months;
}

/** The conflict of one student after the money rules: fields and items added or settled. */
function amendConflict(conflicts, entry, id, { add = {}, settled = {} }) {
  const fields = [...(entry?.fields || [])];
  const items = { ...(entry?.items || {}) };
  for (const [field, keys] of Object.entries(add)) {
    if (!keys.length) continue;
    if (!fields.includes(field)) fields.push(field);
    items[field] = [...new Set([...(items[field] || []), ...keys])];
  }
  for (const [field, keys] of Object.entries(settled)) {
    if (!keys.length || !items[field] || !fields.includes(field)) continue;
    items[field] = items[field].filter((key) => !keys.includes(key));
    if (items[field].length) continue;
    delete items[field];
    fields.splice(fields.indexOf(field), 1);
  }
  const next = fields.length ? conflict("students", id, "field", fields, items) : null;
  const position = entry ? conflicts.indexOf(entry) : -1;
  if (position >= 0) {
    if (next) conflicts[position] = next;
    else conflicts.splice(position, 1);
  } else if (next) conflicts.push(next);
}

/**
 * The money rules a merge by element cannot see (audit B3), for a student both sides changed:
 * - Each device pays the balance it saw, so a month that received receipts from both may now be paid
 *   above what it costs (the same fee recorded twice, two abonos over the balance, an abono and a full
 *   payment). That month is a conflict and its receipts come from one side, as for a collision. A month
 *   both devices paid that does not go over keeps every receipt; when together they settle it, the last
 *   receipt this device added records the agreed total, as it would have on a single device.
 * - Money coming in means the fee is no longer given up, also when the other device marked it lost
 *   without seeing the payment: a monthly mark goes away when its month has a new receipt from a device
 *   that did not hold the mark.
 */
function settleStudentMoney(state, { id, baseItem, localItem, remoteItem, entry }, prefer, conflicts) {
  const position = (state.students || []).findIndex((item) => String(item.id) === id);
  if (position < 0) return state;
  const student = state.students[position];
  const baseIds = new Set(receiptList(baseItem).map((item) => String(item.id)));
  const added = (side) =>
    new Set(
      receiptList(side)
        .filter((item) => !baseIds.has(String(item.id)))
        .map(monthOf),
    );
  const [localAdded, remoteAdded] = [added(localItem), added(remoteItem)];
  const remoteTouched = monthsTouched(baseItem, remoteItem);
  const collided = new Set(entry?.items?.monthlyPayments || []);
  const sample = new Map(
    [...receiptList(baseItem), ...receiptList(localItem), ...receiptList(remoteItem)].map((item) => [
      monthOf(item),
      item,
    ]),
  );
  let receipts = receiptList(student);
  const over = [];
  for (const month of monthsTouched(baseItem, localItem)) {
    if (!remoteTouched.has(month) || collided.has(month)) continue;
    const { groupId, period } = sample.get(month);
    const both = localAdded.has(month) && remoteAdded.has(month);
    const balance = monthlyBalance(
      { ...state, students: [{ ...student, monthlyPayments: receipts }] },
      { studentId: student.id, groupId, period },
    );
    // Without a monthly plan there is no total to check against: receipts from both sides need a decision.
    if (balance ? balance.paid - balance.total > 0.005 : both) {
      over.push(month);
      continue;
    }
    const inMonth = normalizeMonthlyPayments(receipts).filter((item) => monthOf(item) === month);
    const last = inMonth.findLast((item) => receiptList(localItem).some((mine) => String(mine.id) === item.id));
    if (both && balance?.settled && last && inMonth.every((item) => item.partial && item.settledTotal === undefined)) {
      const { partial: _partial, ...settling } = last;
      receipts = receipts.map((item) =>
        String(item.id) === last.id ? { ...settling, settledTotal: balance.total } : item,
      );
    }
  }
  if (over.length) receipts = withMonths(receipts, over, receiptList(prefer === "local" ? localItem : remoteItem));

  const fresh = receipts.filter((item) => !baseIds.has(String(item.id)));
  const holds = (side, key) => markList(side).some((mark) => lostKey(mark) === key);
  const brings = (side, receipt) => receiptList(side).some((item) => String(item.id) === String(receipt.id));
  const recovered = markList(student)
    .filter((mark) => mark?.kind === "monthly")
    .map(lostKey)
    .filter((key) =>
      fresh.some(
        (receipt) =>
          lostKey({ kind: "monthly", groupId: receipt.groupId, period: receipt.period }) === key &&
          [localItem, remoteItem].some((side) => brings(side, receipt) && !holds(side, key)),
      ),
    );

  if (receipts === receiptList(student) && !recovered.length) return state;
  const next = { ...student };
  const payments = receipts === receiptList(student) ? student.monthlyPayments : receiptsOrNone(receipts);
  const marks = markList(student).filter((mark) => !recovered.includes(lostKey(mark)));
  if (payments?.length) next.monthlyPayments = payments;
  else delete next.monthlyPayments;
  if (marks.length) next.lostPayments = marks;
  else delete next.lostPayments;
  amendConflict(conflicts, entry, id, { add: { monthlyPayments: over }, settled: { lostPayments: recovered } });
  return { ...state, students: state.students.map((item, index) => (index === position ? next : item)) };
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
  const dataVersion = Math.max(
    settingsDataVersion(base?.settings),
    settingsDataVersion(local?.settings),
    settingsDataVersion(remote?.settings),
  );
  if (dataVersion) settings.value[DATA_VERSION_FIELD] = dataVersion;
  else delete settings.value[DATA_VERSION_FIELD];
  const settingsConflicts = settings.conflicts.filter((field) => field !== DATA_VERSION_FIELD);
  if (settingsConflicts.length) conflicts.push(conflict("settings", "__settings__", "field", settingsConflicts));
  state.settings = settings.value;

  const renamedClasses = new Map();
  // Students both sides changed: their money rules need the merged groups and classes (settleStudentMoney).
  const moneyChecks = [];
  for (const collection of SYNC_COLLECTIONS) {
    const baseItems = byId(base?.[collection]);
    const localItems = byId(local?.[collection]);
    const remoteList = remote?.[collection] || [];
    const remoteItems = byId(remoteList);
    const result = new Map();
    const twins = TWIN_COLLECTIONS.includes(collection);
    const vanished = [];
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
        if (twins) {
          // Decided with the twins below: the edit may belong to a record that survived elsewhere.
          vanished.push({ id, baseItem, localItem });
          continue;
        }
        conflicts.push(conflict(collection, id, "edit-delete"));
        if (prefer === "local") result.set(id, localItem);
        continue;
      }
      const merged = mergeFields(baseItem, localItem, remoteItem, { prefer });
      const entry = merged.conflicts.length ? conflict(collection, id, "field", merged.conflicts, merged.items) : null;
      if (entry) conflicts.push(entry);
      if (collection === "students") moneyChecks.push({ id, baseItem, localItem, remoteItem, entry });
      result.set(id, merged.value);
    }
    if (twins) {
      const renamed = collection === "classLog" ? renamedClasses : new Map();
      foldTwins(collection, { base, local, remote, result, vanished, prefer, conflicts, renamed });
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
  renameFoldedMarks(state, [local, base], renamedClasses);
  if (renamedClasses.size) state.students = followRenamedClasses(state.students || [], renamedClasses);
  for (const check of moneyChecks) state = settleStudentMoney(state, check, prefer, conflicts);

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

// The element a review row of a student's money field is about: a month of receipts, a debt, a group.
const REVIEW_KEYS = { monthlyPayments: monthOf, lostPayments: lostKey };

/** Keys of the money elements that differ between two values of `field`. */
function changedElements(field, before, after) {
  if (field === "billingByGroup")
    return new Set(orderedKeys(before, after).filter((key) => !sameValue(before?.[key], after?.[key])));
  const keyOf = REVIEW_KEYS[field];
  const ids = (list) => new Map((Array.isArray(list) ? list : []).map((item) => [canonical(item), keyOf(item)]));
  const [left, right] = [ids(before), ids(after)];
  return new Set([
    ...[...left].filter(([item]) => !right.has(item)).map(([, key]) => key),
    ...[...right].filter(([item]) => !left.has(item)).map(([, key]) => key),
  ]);
}

/** Only the money elements in `keys`, so a review compares the payments that matter, not the whole history. */
function moneyElements(field, value, keys) {
  if (field === "billingByGroup") {
    if (!isPlainMap(value) || !value) return value;
    const picked = Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)));
    return Object.keys(picked).length ? picked : undefined;
  }
  if (!Array.isArray(value)) return value;
  const picked = value.filter((item) => keys.has(REVIEW_KEYS[field](item)));
  return picked.length ? picked : undefined;
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
    const entityConflict = conflictFields.get(key);
    // A twin conflict compares this device's record with the cloud's record of the same class.
    const twin =
      remoteState && entityConflict?.twinId ? recordFor(remoteState, collection, entityConflict.twinId) : null;
    const cloud = remoteState ? (twin ?? recordFor(remoteState, collection, entityId)) : undefined;
    const kind = !before ? "create" : !after ? "delete" : "edit";
    const fields = orderedKeys(before, after, twin)
      .filter((field) => field !== "id" && !(collection === "settings" && field === DATA_VERSION_FIELD))
      .filter((field) => (twin ? !sameValue(twin[field], after?.[field]) : !sameValue(before?.[field], after?.[field])))
      .map((field) => {
        const row = {
          field,
          before: before?.[field],
          local: after?.[field],
          cloud: cloud === undefined ? undefined : cloud?.[field],
          conflict: Boolean(entityConflict?.fields.includes(field)),
        };
        if (collection !== "students" || !STRUCTURED_FIELDS[field]) return row;
        // A student's money: the colliding elements, otherwise the ones this device changed.
        const colliding = entityConflict?.items?.[field];
        const keys = colliding ? new Set(colliding) : changedElements(field, row.before, row.local);
        return {
          ...row,
          before: moneyElements(field, row.before, keys),
          local: moneyElements(field, row.local, keys),
          cloud: row.cloud === undefined ? undefined : moneyElements(field, row.cloud, keys),
        };
      });
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
