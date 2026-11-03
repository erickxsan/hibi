import { attendanceBilling } from "../domain/attendanceBilling.js";
import { addDays, endOfMonth, addMonths, startOfMonth } from "../domain/dates";
import { deriveMonthlyCharges, nextPeriod, periodOf } from "../domain/monthlyBilling";
import { buildClassWorkspaceSessionsForRange, rosterForClassSession } from "./classesWorkspaceModel";
import { assignmentsIn, matchesGroup } from "./homeDashboardModel";
import { studentGroupIdsOf } from "./groupLabels";
import { trackingKpis, trackingRecords } from "./trackingModel";

/*
 * Seguimiento's student sheet on the phone: the three figures double as tabs; attendance is a month
 * calendar, grades a trend against the group, payments the monthly fees as stamps.
 */

/**
 * «P» present (or late), «A» absent, «E» excused, «U» saved without a mark, «C» cancelled,
 * «N» a class nobody recorded yet, «F» still to come.
 */
export function attendanceCode(row) {
  if (row.classStatus === "Cancelled") return "C";
  if (row.attendance === "A") return "A";
  if (row.attendance === "E") return "E";
  if (attendanceBilling(row) === "unmarked") return "U";
  return "P";
}

// A day with several classes takes the color of the one that most needs a look.
const CODE_WEIGHT = { A: 6, N: 5, U: 4, E: 3, P: 2, F: 1, C: 0 };

export function dayCode(entries) {
  return entries.reduce((worst, entry) => (CODE_WEIGHT[entry.code] > CODE_WEIGHT[worst] ? entry.code : worst), "C");
}

/**
 * The group the student is compared with: the filtered group, or their only group. Anything else
 * (all groups for a student in several, or one with no group) compares with everyone in the view.
 * A student's own figure in a group view also counts their individual classes; the comparison is
 * still that group's, which is what a teacher reads it against.
 */
export function comparisonScope(student, scope) {
  if (scope !== "all") return scope;
  const groups = studentGroupIdsOf(student);
  return groups.length === 1 ? groups[0] : "all";
}

/** Every month the calendar can show: from the first month of the range to the report date's. */
export function sheetMonths(range, asOf) {
  const last = startOfMonth(asOf);
  const months = [];
  for (let month = startOfMonth(range.start || asOf); month <= last; month = addMonths(month, 1)) months.push(month);
  return months.length ? months : [last];
}

function sessionEntry(session, code) {
  return {
    key: session.key,
    date: session.classDate,
    startTime: session.startTime || "",
    title: session.title || "",
    rowId: "",
    code,
  };
}

/**
 * The days with a class: the range's records, plus the classes nobody recorded yet (up to the report
 * date or today, whichever is earlier) and the ones still to come in the report month (after both).
 * Unrecorded classes are looked for from the month before the report date's on (a week or 30 days
 * can span two months); a longer range keeps that bound so «all records» stays cheap.
 */
export function classDays(state, records, { range, scope, student, asOf, liveDate }) {
  const days = new Map();
  const add = (date, entry) => days.set(date, [...(days.get(date) || []), entry]);
  for (const record of [...records].reverse()) {
    add(record.row.classDate, {
      key: record.key,
      date: record.row.classDate,
      startTime: record.row.startTime || "",
      title: record.className || record.row.classTitle || "",
      rowId: record.row.id,
      code: attendanceCode(record.row),
    });
  }
  const now = liveDate || asOf;
  const monthStart = addMonths(startOfMonth(asOf), -1);
  const from = range.start && range.start > monthStart ? range.start : monthStart;
  const lastPast = asOf < now ? asOf : now;
  const firstFuture = addDays(asOf > now ? asOf : now, 1);
  const end = endOfMonth(asOf);
  if (from > end) return days;
  const known = new Set(records.map((record) => record.key));
  for (const session of buildClassWorkspaceSessionsForRange(state, from, end, now)) {
    if (known.has(session.key) || !matchesGroup(scope, session.groupId || "")) continue;
    // A class moved to another day counts on its new day, like everywhere else in the app.
    const past = session.classDate <= lastPast && ["Pending", "Scheduled", "Rescheduled"].includes(session.statusLabel);
    const future = session.classDate >= firstFuture && ["Scheduled", "Rescheduled"].includes(session.statusLabel);
    if (!past && !future) continue;
    if (!rosterForClassSession(state, session).some((item) => item.id === student.id)) continue;
    add(session.classDate, sessionEntry(session, past ? "N" : "F"));
  }
  for (const entries of days.values()) entries.sort((left, right) => left.startTime.localeCompare(right.startTime));
  return days;
}

function studentGrades(assignments, studentId) {
  return assignments.flatMap((item) => {
    const base = { key: item.key, date: item.date, sessionKey: item.sessionKey, assessment: item.assessment };
    const grade = item.grades.find((entry) => entry.studentId === studentId);
    if (grade) return [{ ...base, value: grade.value }];
    return item.missing.includes(studentId) ? [{ ...base, value: null }] : [];
  });
}

function averageOf(items) {
  const values = items.map((item) => item.value).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * The fees shown as stamps: every one still owed and due (none hides behind a cap), then this
 * month's and next month's (paying ahead is allowed), in month order.
 */
export function monthlyStamps(state, asOf, scope, studentId) {
  const current = periodOf(asOf);
  return deriveMonthlyCharges(state, asOf, { includeArchived: false, through: nextPeriod(current) }).filter(
    (charge) =>
      charge.studentId === studentId &&
      matchesGroup(scope, charge.groupId) &&
      ((["pending", "overdue"].includes(charge.status) && charge.dueDate <= asOf) || charge.period >= current),
  );
}

/** The fee the sheet opens on: the oldest one still owed that is due, else this month's, else the latest. */
export function defaultChargeId(charges, asOf) {
  const owed = charges.find((charge) => ["overdue", "pending"].includes(charge.status) && charge.dueDate <= asOf);
  const current = charges.find((charge) => charge.period === periodOf(asOf));
  return (owed || current || charges.at(-1))?.id || "";
}

/**
 * Classes still owed up to the report date, with no lower bound: the same debt the Payments figure
 * counts, so the list never reads «up to date» under an amount owed.
 */
export function classDebts(state, derived, { scope, studentId, asOf }) {
  const groups = new Map((state.groups || []).map((group) => [group.id, group]));
  return (derived?.classLog || [])
    .filter(
      (row) =>
        row.studentId === studentId &&
        row.classDate <= asOf &&
        Number(row.outstanding) > 0 &&
        matchesGroup(scope, row.groupId || ""),
    )
    .sort((left, right) => right.classDate.localeCompare(left.classDate))
    .map((row) => ({
      row,
      key: `${row.classDate}|${row.groupId ? `g:${row.groupId}` : `s:${row.studentId}`}|${row.startTime}`,
      className: row.groupId ? groups.get(row.groupId)?.name || "" : "",
    }));
}

/** `scopeKpis` are the page's own figures, reused when the student is compared with the same scope. */
export function studentSheetModel(state, derived, { student, range, scope, asOf, liveDate, scopeKpis = null }) {
  const compare = comparisonScope(student, scope);
  const groupKpis = compare === scope && scopeKpis ? scopeKpis : trackingKpis(state, derived, range, compare, []);
  const grades = range.start ? studentGrades(assignmentsIn(state, range.start, range.end, scope), student.id) : [];
  const previousAverage = range.previousStart
    ? averageOf(studentGrades(assignmentsIn(state, range.previousStart, range.previousEnd, scope), student.id))
    : null;
  const currentAverage = averageOf(grades);
  const records = trackingRecords(state, derived, range, scope, student.id);
  return {
    compare: { scope: compare, attendance: groupKpis.attendance.value, grade: groupKpis.grades.value },
    days: classDays(state, records, { range, scope, student, asOf, liveDate }),
    months: sheetMonths(range, asOf),
    grades,
    gradeDelta: currentAverage !== null && previousAverage !== null ? currentAverage - previousAverage : null,
    charges: monthlyStamps(state, asOf, scope, student.id),
    classDebts: classDebts(state, derived, { scope, studentId: student.id, asOf: range.end }),
  };
}
