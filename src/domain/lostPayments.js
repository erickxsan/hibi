import { isDateOnly } from "./dates.js";

/*
 * Debts the teacher gave up on, stored as optional marks on the student (the cloud schema accepts a
 * fixed set of collections, so no new collection):
 *
 *   student.lostPayments = [{ kind: "monthly", groupId, period: "YYYY-MM", lostAt }
 *                         | { kind: "class", classId, lostAt }]
 *
 * A mark only says «this debt is no longer expected» from `lostAt` on. It stores no amount: what was
 * lost is always what the debt still owes, so abonos stay collected and taking the mark away brings
 * the debt back exactly as it was. A report dated before `lostAt` still shows it as owed. Marks are
 * inert once the debt has no balance, which is why a class that ends up paid simply stops being lost.
 *
 * A paid class keeps its mark on purpose: correcting that payment puts the class back as it was, lost.
 * A fee drops its mark as soon as money comes in, because an abono leaves a balance that is owed again.
 */
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Identifies one debt inside a student's marks. */
export function lostKey(item) {
  return item?.kind === "class" ? `class|${item.classId}` : `monthly|${item?.groupId}|${item?.period}`;
}

function normalizeMark(value) {
  const lostAt = isDateOnly(value?.lostAt) ? value.lostAt : "";
  if (!lostAt) return null;
  if (value.kind === "class") {
    const classId = text(value.classId);
    return classId ? { kind: "class", classId, lostAt } : null;
  }
  const groupId = text(value.groupId);
  const period = text(value.period);
  return value.kind === "monthly" && groupId && PERIOD_RE.test(period)
    ? { kind: "monthly", groupId, period, lostAt }
    : null;
}

/** Canonical marks: valid ones only, one per debt, in a stable order. */
export function normalizeLostPayments(value) {
  if (!Array.isArray(value)) return [];
  const byKey = new Map();
  value.forEach((item) => {
    const mark = normalizeMark(item);
    if (mark && !byKey.has(lostKey(mark))) byKey.set(lostKey(mark), mark);
  });
  return [...byKey.values()].sort((left, right) => lostKey(left).localeCompare(lostKey(right)));
}

// Derivations ask once per class and month, and most students have no marks at all.
const indexes = new WeakMap();
function indexOf(student) {
  const marks = student?.lostPayments;
  if (!Array.isArray(marks) || !marks.length) return null;
  let index = indexes.get(marks);
  if (!index) {
    index = new Map(normalizeLostPayments(marks).map((mark) => [lostKey(mark), mark.lostAt]));
    indexes.set(marks, index);
  }
  return index;
}

function lostAtFor(student, key, asOf) {
  const lostAt = indexOf(student)?.get(key) || "";
  return lostAt && (!asOf || lostAt <= asOf) ? lostAt : "";
}

/** The day this month's fee was given up, or "" when it is not lost as of `asOf`. */
export function feeLostAt(student, groupId, period, asOf = "") {
  return lostAtFor(student, lostKey({ kind: "monthly", groupId, period }), asOf);
}

/** The day this class's debt was given up, or "" when it is not lost as of `asOf`. */
export function classLostAt(student, classId, asOf = "") {
  return classId ? lostAtFor(student, lostKey({ kind: "class", classId }), asOf) : "";
}

function changeMarks(state, items, change) {
  const byStudent = new Map();
  items.forEach((item) => byStudent.set(item.studentId, [...(byStudent.get(item.studentId) || []), item]));
  if (!byStudent.size) return state;
  return {
    ...state,
    students: (state.students || []).map((student) => {
      const own = byStudent.get(student.id);
      if (!own) return student;
      const next = normalizeLostPayments(change(normalizeLostPayments(student.lostPayments), own));
      const { lostPayments: _previous, ...rest } = student;
      return next.length ? { ...rest, lostPayments: next } : rest;
    }),
  };
}

/**
 * Gives up on debts ({ studentId, kind, groupId, period } or { studentId, kind, classId }). A mark
 * keeps its own `lostAt` when it has one, which is how undoing a recovery restores it untouched.
 */
export function markLost(state, items, lostAt) {
  return changeMarks(state, items, (marks, own) => [
    ...own.map(({ studentId: _studentId, ...item }) => ({ ...item, lostAt: item.lostAt || lostAt })),
    ...marks,
  ]);
}

/** Takes the marks away: the debts are owed again, exactly as they were. */
export function recoverLost(state, items) {
  return changeMarks(state, items, (marks, own) => {
    const keys = new Set(own.map(lostKey));
    return marks.filter((mark) => !keys.has(lostKey(mark)));
  });
}

/** Structural problems for the import validator. Empty when the optional field is absent or valid. */
export function lostPaymentsIssues(student) {
  if (student?.lostPayments === undefined) return [];
  if (!Array.isArray(student.lostPayments)) return [["lostPayments", "Lost payments must be an array."]];
  return student.lostPayments.flatMap((item, index) =>
    normalizeMark(item)
      ? []
      : [[`lostPayments[${index}]`, "A lost payment needs a monthly fee or a class and the day it was given up."]],
  );
}
