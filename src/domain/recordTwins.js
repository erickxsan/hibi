import { classRecordIdentity, gradeIdentity } from "./semanticIdentity.js";

// Records that describe one real event. Each is created with a random id, so two devices (or two tabs) that
// save the same class without seeing each other's save create two records for it. The screens show one per
// student and the hidden twin still counts in debts, attendance and averages, so sync never keeps both.
export const TWIN_COLLECTIONS = Object.freeze(["classLog", "grades"]);

function text(value) {
  return String(value ?? "").trim();
}

/**
 * The event a record describes, or null when it cannot be told apart from another one.
 * A class row: student + date + start time (a row without a start time has no identity).
 * A grade: student + class session + assignment. A session can hold several assignments
 * (the charts count them apart), so only the same assignment's grade is a twin.
 */
export function twinKey(collection, record) {
  if (!record) return null;
  if (collection === "classLog") return classRecordIdentity(record);
  if (collection === "grades") {
    const identity = gradeIdentity(record);
    return identity ? `${identity}\u0000${text(record.assessment).toLowerCase()}` : null;
  }
  return null;
}

/** Nothing recorded on it yet: an unmarked class without money or notes, or a grade without a score or note. */
export function isBlankTwin(collection, record) {
  if (!record) return true;
  if (collection === "classLog") {
    return (
      (record.classStatus || "Completed") === "Completed" &&
      !record.attendance &&
      !(Number(record.amountPaid) > 0) &&
      !record.paymentDate &&
      record.paymentState !== "Paid" &&
      !text(record.paymentReference) &&
      !text(record.notes)
    );
  }
  if (collection === "grades") {
    return record.score == null && !text(record.feedback) && (!record.workStatus || record.workStatus === "On time");
  }
  return false;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value ?? null;
}

/** Same content apart from the id. */
export function sameTwinContent(left, right) {
  const { id: _left, ...leftFields } = left || {};
  const { id: _right, ...rightFields } = right || {};
  return JSON.stringify(stable(leftFields)) === JSON.stringify(stable(rightFields));
}

export class DuplicateRecordError extends Error {
  constructor(collection, record) {
    super("This class was just saved with different marks. Review it before saving again.");
    this.name = "DuplicateRecordError";
    this.code = "duplicate_record";
    this.collection = collection;
    this.recordId = record?.id || "";
  }
}

/**
 * New records an edit is about to add, matched against the stored ones. A record built without seeing its
 * twin (the same class saved a moment earlier by another tab or device) takes the twin's id when both agree
 * or one of them is still blank, so the save edits that record instead of adding a second one. Different
 * marks on both stop the save: nothing recorded on either side is overwritten without a person looking.
 * A class row only matches a row of the same group; rows of different groups at the same time stay as they
 * were (validation flags them).
 */
export function adoptStoredTwins(collection, stored = [], items = []) {
  if (!TWIN_COLLECTIONS.includes(collection)) return items;
  const storedIds = new Set(stored.map((record) => record.id));
  const claimed = new Set(items.map((item) => item.id).filter(Boolean));
  const byKey = new Map();
  for (const record of stored) {
    const key = twinKey(collection, record);
    if (key && !claimed.has(record.id) && !byKey.has(key)) byKey.set(key, record);
  }
  return items.map((item) => {
    if (storedIds.has(item.id)) return item;
    const key = twinKey(collection, item);
    const twin = key ? byKey.get(key) : null;
    if (!twin) return item;
    if (collection === "classLog" && text(twin.groupId) !== text(item.groupId)) return item;
    byKey.delete(key);
    if (sameTwinContent(twin, item) || isBlankTwin(collection, item)) return twin;
    if (isBlankTwin(collection, twin)) return { ...item, id: twin.id };
    throw new DuplicateRecordError(collection, twin);
  });
}
