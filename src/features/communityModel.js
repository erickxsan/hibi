import { calculateOutstanding } from "../domain/calculations.js";
import { roundMoney, sumMoney } from "../domain/money.js";
import { addDays, startOfMonth } from "../domain/dates";
import { gradeGroupId } from "../domain/semanticIdentity";
import { validateStudent } from "../domain/validation.js";
import {
  adjustmentFor,
  backdatedJoins,
  changeGroupBilling,
  changeStudentAdjustment,
  deriveMonthlyCharges,
  groupBillingFor,
  groupClassDates,
  groupFirstPeriod,
  isMonthlyGroup,
  isPeriod,
  joiningAmounts,
  moveBillingStart,
  nextPeriod,
  normalizeBillingByGroup,
  normalizeGroupBilling,
  perClassStart,
  periodOf,
  studentMonthlyPlan,
  suggestedMonthlyFee,
  switchToPerClass,
} from "../domain/monthlyBilling";
import { buildClassWorkspaceSessionsForRange } from "./classesWorkspaceModel";
import { debtsThrough, isOverdueClassDebt } from "./homeDashboardModel";
import { studentGroupIdsOf } from "./groupLabels";

/*
 * Figures for Comunidad: who has something pending, each student's month, each group's month,
 * the attendance grid, the archived history and the monthly-billing editor.
 */

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function attendanceRows(rows) {
  return rows.filter((row) => row.classStatus === "Completed" && ["P", "L", "A"].includes(row.attendance));
}

function ratio(rows) {
  const counted = attendanceRows(rows);
  if (!counted.length) return null;
  return counted.filter((row) => row.attendance !== "A").length / counted.length;
}

function gradeValue(grade) {
  return finite(grade.score) && finite(grade.maxScore) && grade.maxScore > 0
    ? (grade.score / grade.maxScore) * 10
    : null;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** One student's month: attendance, grades, money and the single thing that needs attention. */
export function studentMonth(state, derived, student, asOf, { groupId = "", charges = null } = {}) {
  const monthStart = startOfMonth(asOf);
  const derivedRows = (derived?.classLog || []).filter(
    (row) => row.studentId === student.id && (!groupId || row.groupId === groupId),
  );
  const monthRows = derivedRows.filter((row) => row.classDate >= monthStart && row.classDate <= asOf);
  const counted = attendanceRows(monthRows).sort((left, right) => left.classDate.localeCompare(right.classDate));
  const absences = counted.filter((row) => row.attendance === "A").length;
  const grades = (state.grades || []).filter(
    (grade) =>
      grade.studentId === student.id &&
      grade.date >= monthStart &&
      grade.date <= asOf &&
      (!groupId || gradeGroupId(grade) === groupId),
  );
  const values = grades.map(gradeValue).filter((value) => value !== null);
  const paidClasses = sumMoney(
    derivedRows.filter((row) => row.paymentDate && row.paymentDate >= monthStart && row.paymentDate <= asOf),
    (row) => row.amountPaid,
  );
  const paidMonthly = sumMoney(
    (student.monthlyPayments || []).filter(
      (item) => item.paidAt >= monthStart && item.paidAt <= asOf && (!groupId || item.groupId === groupId),
    ),
    (item) => item.amount,
  );
  const owedRows = derivedRows.filter((row) => row.classDate <= asOf && finite(row.outstanding) && row.outstanding > 0);
  const monthlyDue = (charges || deriveMonthlyCharges(state, asOf)).filter(
    (charge) =>
      charge.studentId === student.id &&
      (!groupId || charge.groupId === groupId) &&
      ["pending", "overdue"].includes(charge.status) &&
      charge.dueDate <= asOf,
  );
  const owed = roundMoney(
    sumMoney(owedRows, (row) => row.outstanding) + sumMoney(monthlyDue, (charge) => charge.amount),
  );
  const overdue =
    owedRows.some((row) => isOverdueClassDebt(row.classDate, asOf)) ||
    monthlyDue.some((charge) => charge.status === "overdue");
  const oldestDebt = owedRows.map((row) => row.classDate).sort()[0] || "";
  const lost = roundMoney(
    sumMoney(derivedRows, (row) => row.lostAmount || 0) +
      sumMoney(
        (charges || deriveMonthlyCharges(state, asOf)).filter(
          (charge) =>
            charge.studentId === student.id && (!groupId || charge.groupId === groupId) && charge.status === "lost",
        ),
        (charge) => charge.balance,
      ),
  );
  const attendance = counted.length ? (counted.length - absences) / counted.length : null;
  const threshold = finite(state.settings?.lowAttendanceThreshold) ? state.settings.lowAttendanceThreshold : 0.8;
  let flag = { kind: "ok", tone: "" };
  if (owed > 0 && overdue) flag = { kind: "overdue", tone: "bad", amount: owed };
  else if (counted.length >= 2 && attendance < threshold) flag = { kind: "lowAttendance", tone: "bad" };
  else if (owed > 0) flag = { kind: "owes", tone: "pend", amount: owed, date: oldestDebt, monthly: !owedRows.length };
  const ungraded = (state.grades || []).filter(
    (grade) =>
      grade.studentId === student.id && grade.score == null && grade.workStatus !== "Excused" && grade.date <= asOf,
  );
  return {
    student,
    classes: counted.length,
    absences,
    attendance,
    sequence: counted.map((row) => (row.attendance === "A" ? "A" : "P")),
    average: average(values),
    graded: values.length,
    ungraded: ungraded.length,
    paid: roundMoney(paidClasses + paidMonthly),
    owed,
    overdue,
    oldestDebt,
    lost,
    flag,
  };
}

/** Every student's month at once, sharing the monthly charges. */
export function studentMonths(state, derived, asOf, students = state.students || []) {
  const charges = deriveMonthlyCharges(state, asOf);
  return new Map(students.map((student) => [student.id, studentMonth(state, derived, student, asOf, { charges })]));
}

/** Students with something pending first (overdue, low attendance, then pending), then everyone else by name. */
export function sortStudentsByAttention(months) {
  const rank = { overdue: 0, lowAttendance: 1, owes: 2, ok: 3 };
  return [...months].sort(
    (left, right) =>
      rank[left.flag.kind] - rank[right.flag.kind] ||
      (left.flag.kind === "lowAttendance" ? (left.attendance ?? 1) - (right.attendance ?? 1) : 0) ||
      right.owed - left.owed ||
      left.student.fullName.localeCompare(right.student.fullName),
  );
}

/** Latest recorded classes of a student, newest first, with the grade of that class. */
export function studentRecentClasses(state, derived, studentId, limit = 5) {
  const groupsById = new Map((state.groups || []).map((group) => [group.id, group]));
  return (derived?.classLog || [])
    .filter((row) => row.studentId === studentId && ["Completed", "Cancelled"].includes(row.classStatus))
    .sort(
      (left, right) =>
        right.classDate.localeCompare(left.classDate) || String(right.startTime).localeCompare(left.startTime),
    )
    .slice(0, limit)
    .map((row) => {
      const key = `${row.classDate}|${row.groupId ? `g:${row.groupId}` : `s:${row.studentId}`}|${row.startTime}`;
      const grade = (state.grades || []).find((item) => item.studentId === studentId && item.classSessionKey === key);
      return {
        row,
        groupName: row.groupId ? groupsById.get(row.groupId)?.name || "" : "",
        grade,
        gradeValue: grade ? gradeValue(grade) : null,
      };
    });
}

/** A group's month: attendance, grades, what is owed and by whom. */
export function groupMonth(state, derived, group, asOf, members) {
  const monthStart = startOfMonth(asOf);
  const rows = (derived?.classLog || []).filter(
    (row) => row.groupId === group.id && row.classDate >= monthStart && row.classDate <= asOf,
  );
  const counted = attendanceRows(rows);
  const absences = counted.filter((row) => row.attendance === "A").length;
  const sessions = new Set(counted.map((row) => `${row.classDate}|${row.startTime}`)).size;
  const grades = (state.grades || []).filter(
    (grade) => gradeGroupId(grade) === group.id && grade.date >= monthStart && grade.date <= asOf,
  );
  const values = grades.map(gradeValue).filter((value) => value !== null);
  const ungraded = grades.filter((grade) => grade.score == null && grade.workStatus !== "Excused").length;
  const debts = debtsThrough(state, derived?.classLog || [], asOf, group.id).filter((item) =>
    members.some((student) => student.id === item.studentId),
  );
  const owed = sumMoney(debts, (item) => item.amount);
  const overdue = sumMoney(debts, (item) => item.overdue);
  const allRows = (derived?.classLog || []).filter((row) => row.groupId === group.id);
  return {
    attendance: ratio(rows) ?? ratio(allRows),
    monthAttendance: ratio(rows),
    absences,
    sessions,
    average: average(values),
    ungraded,
    debts,
    owed,
    overdue,
  };
}

/** Attendance grid: the latest recorded classes of the group plus today's class if it is still open. */
export function groupAttendanceGrid(state, group, members, asOf, limit = 6) {
  const sessions = buildClassWorkspaceSessionsForRange(state, addDays(asOf, -120), asOf, asOf).filter(
    (session) => session.groupId === group.id && session.statusLabel !== "Cancelled",
  );
  const recorded = sessions.filter((session) => (session.rows || []).some((row) => row.classStatus === "Completed"));
  const today = sessions.find((session) => session.classDate === asOf && !(session.rows || []).length);
  const columns = [...recorded.slice(-limit), ...(today ? [today] : [])];
  return {
    columns: columns.map((session) => ({
      key: session.key,
      date: session.classDate,
      today: session.classDate === asOf && !(session.rows || []).length,
    })),
    rows: members.map((student) => ({
      student,
      cells: columns.map((session) => {
        const row = (session.rows || []).find(
          (item) => item.studentId === student.id && item.classStatus === "Completed",
        );
        if (!row || !["P", "L", "A"].includes(row.attendance)) return { key: session.key, code: "U" };
        return { key: session.key, code: row.attendance === "A" ? "A" : "P" };
      }),
    })),
  };
}

/** History of an archived group: classes, attendance, collected, average, balance left and per-student lines. */
export function archivedGroupHistory(state, derived, group, members) {
  const asOf = state.settings?.asOfDate;
  const rows = (derived?.classLog || []).filter((row) => row.groupId === group.id);
  const recorded = rows.filter((row) => row.classStatus === "Completed" && row.classDate <= asOf);
  const counted = attendanceRows(recorded);
  const sessions = new Map();
  recorded.forEach((row) => {
    const key = `${row.classDate}|${row.startTime}`;
    const current = sessions.get(key) || {
      key,
      date: row.classDate,
      title: row.classTitle || "",
      present: 0,
      total: 0,
      collected: 0,
    };
    if (["P", "L", "A"].includes(row.attendance)) current.total += 1;
    if (["P", "L"].includes(row.attendance)) current.present += 1;
    current.collected = roundMoney(
      current.collected + (row.paymentDate && row.paymentDate <= asOf ? row.amountPaid || 0 : 0),
    );
    sessions.set(key, current);
  });
  const grades = (state.grades || []).filter((grade) => gradeGroupId(grade) === group.id);
  const values = grades.map(gradeValue).filter((value) => value !== null);
  return {
    classes: sessions.size,
    attendance: ratio(recorded),
    absences: counted.filter((row) => row.attendance === "A").length,
    collected: sumMoney(recorded, (row) => (row.paymentDate && row.paymentDate <= asOf ? row.amountPaid : 0)),
    average: average(values),
    assignments: new Set(grades.map((grade) => `${grade.classSessionKey}|${grade.assessment}`)).size,
    outstanding: sumMoney(rows, (row) => row.outstanding),
    owing: members
      .map((student) => ({
        student,
        amount: sumMoney(
          rows.filter((row) => row.studentId === student.id),
          (row) => row.outstanding,
        ),
      }))
      .filter((item) => item.amount > 0),
    sessions: [...sessions.values()].sort((left, right) => right.date.localeCompare(left.date)),
    members: members.map((student) => {
      const own = attendanceRows(recorded.filter((row) => row.studentId === student.id));
      const studentGrades = grades
        .filter((grade) => grade.studentId === student.id)
        .map(gradeValue)
        .filter((value) => value !== null);
      return {
        student,
        attended: own.filter((row) => row.attendance !== "A").length,
        missed: own.filter((row) => row.attendance === "A").length,
        total: own.length,
        average: average(studentGrades),
        owed: sumMoney(
          rows.filter((row) => row.studentId === student.id),
          (row) => row.outstanding,
        ),
      };
    }),
  };
}

/**
 * Editable billing for the group detail. Students' adjustments come from their billingByGroup:
 * another fee or per class, and for monthly payers optionally their own due date (`due`, null = the group's).
 */
export function billingDraftFor(group, members) {
  const billing = groupBillingFor(group);
  return {
    // The month the arrangement applies from; null keeps its start, or next month when it changes.
    applyFrom: null,
    mode: billing?.mode === "monthly" ? "monthly" : "perClass",
    monthlyFee: billing?.mode === "monthly" ? billing.monthlyFee : null,
    due: billing?.mode === "monthly" ? billing.due : { type: "dayOfMonth", day: 5 },
    effectiveFrom: billing?.mode === "monthly" ? billing.effectiveFrom : "",
    creditFirstMonth: Boolean(billing?.creditFirstMonth),
    hourlyRate: Number.isFinite(group?.hourlyRate) ? group.hourlyRate : null,
    adjustments: Object.fromEntries(
      members
        .map((student) => [student.id, normalizeBillingByGroup(student.billingByGroup)?.[group?.id]])
        .filter(([, override]) => override && (override.mode !== "group" || override.due))
        .map(([id, override]) => [id, { mode: override.mode, fee: override.fee ?? null, due: override.due ?? null }]),
    ),
  };
}

// The arrangement the draft describes, without its start.
function draftTerm(draft) {
  return draft.mode === "monthly"
    ? {
        mode: "monthly",
        monthlyFee: roundMoney(Number(draft.monthlyFee) || 0),
        due: draft.due,
        creditFirstMonth: false,
      }
    : { mode: "perClass" };
}

/** True when the draft changes the group's mode, fee or due rule (not just its start). */
export function billingTermChanged(group, draft) {
  const latest = groupBillingFor(group);
  const term = normalizeGroupBilling(draftTerm(draft));
  if ((latest?.mode || "perClass") !== term.mode) return true;
  return (
    term.mode === "monthly" &&
    (latest.monthlyFee !== term.monthlyFee || JSON.stringify(latest.due) !== JSON.stringify(term.due))
  );
}

/**
 * The month a group's arrangement applies from: the one chosen («current», «next» or YYYY-MM), else
 * its current start while unchanged, else next month (never before an arrangement still to come).
 */
export function applyFromFor(group, draft, asOf, applyFrom = draft?.applyFrom ?? null) {
  const period = periodOf(asOf);
  if (applyFrom === "current") return period;
  if (applyFrom === "next") return nextPeriod(period);
  if (isPeriod(applyFrom)) return applyFrom;
  const start = groupBillingFor(group)?.effectiveFrom || "";
  if (!billingTermChanged(group, draft)) return start;
  return start > nextPeriod(period) ? start : nextPeriod(period);
}

// The saved billing for a draft starting in `from`.
function billingFrom(group, draft, from) {
  if (!billingTermChanged(group, draft))
    return from === (groupBillingFor(group)?.effectiveFrom || "")
      ? normalizeGroupBilling(group.billing) || { mode: "perClass" }
      : moveBillingStart(group.billing, from);
  return changeGroupBilling(group.billing, draftTerm(draft), from);
}

/**
 * Months the arrangement may start in, six back to six ahead. A month already lived through that
 * had a monthly fee keeps it: its classes were recorded as covered, so they cannot turn per class.
 * With the workspace (`state`), never a month before the group is on record (see groupFirstPeriod).
 */
export function applyFromOptions(group, draft, asOf, state = null) {
  const period = periodOf(asOf);
  let first = period;
  for (let step = 0; step < 6; step += 1) first = periodOf(addDays(`${first}-01`, -1));
  const floor = state ? groupFirstPeriod(state, group, asOf) : "";
  const options = [];
  for (let month = first, step = 0; step < 13; step += 1, month = nextPeriod(month)) {
    if (month < floor) continue;
    const after = { billing: billingFrom(group, draft, month) };
    let lived = month;
    let keeps = true;
    for (; lived <= period; lived = nextPeriod(lived))
      if (isMonthlyGroup(group, lived) && !isMonthlyGroup(after, lived)) keeps = false;
    if (keeps) options.push(month);
  }
  // Its current start stays listed while only the start is being chosen.
  const start = groupBillingFor(group)?.effectiveFrom;
  if (start && !options.includes(start) && !billingTermChanged(group, draft)) options.push(start);
  return options.sort();
}

/**
 * Turns the billing draft into the saved group and the per-student overrides for saveGroupBilling.
 * An existing group's change applies from `applyFrom` (see applyFromFor): earlier months keep the
 * arrangement they had. A new group starts this month (startGroupBilling may move it to the next).
 * `starts` is the month each student's change applies from: adjustmentStart, or later for a switch
 * to per class, which never turns a month they already lived paying monthly (see perClassStart; with
 * the workspace, only months the records show lived that way count).
 * With the workspace (`state`), a start before the group is on record moves to its first month, and
 * a backdated start saves the join date (or, after an earlier monthly term that already billed
 * them, an away stretch) of each student it would otherwise bill for months before they were in the
 * group (see backdatedJoins); each override stays the student's whole entry.
 */
export function billingChanges(group, members, draft, asOf, applyFrom = draft?.applyFrom ?? null, state = null) {
  if (state && group?.id && isPeriod(applyFrom) && applyFrom !== (groupBillingFor(group)?.effectiveFrom || "")) {
    const floor = groupFirstPeriod(state, group, asOf);
    if (applyFrom < floor) applyFrom = floor;
  }
  const billing = group?.id
    ? billingFrom(group, draft, applyFromFor(group, draft, asOf, applyFrom))
    : draft.mode === "monthly"
      ? { ...draftTerm(draft), effectiveFrom: periodOf(asOf) }
      : { mode: "perClass" };
  const overrides = {};
  const starts = {};
  // Per class from some month on: the adjustments stay for the monthly months before it.
  if (draft.mode !== "monthly") return { billing, overrides, starts };
  const from = adjustmentStart(group, draft, asOf, applyFrom);
  members.forEach((student) => {
    const current = normalizeBillingByGroup(student.billingByGroup)?.[group?.id] || null;
    const wanted = draft.adjustments[student.id] || null;
    const term = wanted
      ? {
          mode: wanted.mode,
          fee: roundMoney(Number(wanted.fee) || 0),
          due: wanted.mode !== "perClass" ? wanted.due || null : null,
        }
      : { mode: "group" };
    const latest = adjustmentFor(current) || { mode: "group" };
    /** @param {{ mode: string, fee?: number, due?: object | null }} value */
    const termKey = ({ mode, fee, due }) => JSON.stringify(adjustmentFor({ mode, fee, due }) || { mode: "group" });
    // Unchanged (including a change already planned for a later month): nothing to save.
    if (termKey(latest) === termKey(term)) return;
    starts[student.id] = term.mode === "perClass" ? perClassStart(student, group, asOf, from, state) : from;
    // Per class keeps per class the months a backdated start in the same save would make monthly.
    overrides[student.id] =
      term.mode === "perClass"
        ? switchToPerClass(student, group, { ...group, billing }, starts[student.id])
        : changeStudentAdjustment(current, term, starts[student.id]);
  });
  if (state && group?.id) {
    const joins = backdatedJoins(state, group, { ...group, billing }, asOf, overrides);
    for (const [id, stayFields] of Object.entries(joins)) {
      const student = (state.students || []).find((item) => item.id === id);
      const entry = Object.hasOwn(overrides, id)
        ? overrides[id]
        : normalizeBillingByGroup(student?.billingByGroup)?.[group.id];
      overrides[id] = { ...(entry || { mode: "group" }), ...stayFields };
    }
  }
  return { billing, overrides, starts };
}

// The workspace with a group's billing saved as saveGroupBilling stores it, limited to that group.
function groupScope(state, group, billing, overrides = {}) {
  const classLog = (state.classLog || []).filter((row) => row.groupId === group.id);
  const withClasses = new Set(classLog.map((row) => row.studentId));
  const students = (state.students || [])
    .filter(
      (student) =>
        studentGroupIdsOf(student).includes(group.id) ||
        student.billingByGroup?.[group.id] ||
        Object.hasOwn(overrides, student.id) ||
        withClasses.has(student.id),
    )
    .map((student) => {
      if (!Object.hasOwn(overrides, student.id)) return student;
      const next = { ...(student.billingByGroup || {}) };
      if (overrides[student.id]) next[group.id] = overrides[student.id];
      else delete next[group.id];
      return { ...student, billingByGroup: normalizeBillingByGroup(next) || undefined };
    });
  return {
    ...state,
    groups: [{ ...group, billing }],
    students,
    classLog,
  };
}

/**
 * What saving the draft does on `asOf` to the months already lived, for the «Aplica desde» hint: the
 * fees it creates already overdue (`count`, their balance `total`), the unpaid per-class debt a fee
 * now covers instead (`stopped`) and the fees owed before saving that it takes away (`dropped`, their
 * balance `droppedTotal`; a per-class switch saved with it, say). Uses what the save stores.
 */
export function backdatedEffects(state, group, members, draft, asOf) {
  const { billing, overrides } = billingChanges(group, members, draft, asOf, draft?.applyFrom ?? null, state);
  const before = groupScope(state, group, group.billing);
  const after = groupScope(state, group, billing, overrides);
  const owing = (charge) => ["overdue", "pending"].includes(charge.status) && charge.balance > 0;
  const beforeCharges = deriveMonthlyCharges(before, asOf);
  const afterCharges = deriveMonthlyCharges(after, asOf);
  const existing = new Set(beforeCharges.map((charge) => charge.id));
  const kept = new Set(afterCharges.map((charge) => charge.id));
  const created = afterCharges.filter((charge) => charge.status === "overdue" && !existing.has(charge.id));
  const dropped = beforeCharges.filter((charge) => owing(charge) && !kept.has(charge.id));
  const owed = (scope, row) => Math.max(0, calculateOutstanding(scope, row, asOf) || 0);
  return {
    count: created.length,
    total: sumMoney(created, (charge) => charge.balance),
    stopped: sumMoney(before.classLog, (row) => Math.max(0, owed(before, row) - owed(after, row))),
    dropped: dropped.length,
    droppedTotal: sumMoney(dropped, (charge) => charge.balance),
  };
}

/**
 * The month a change to students' adjustments applies from: the group's «Aplica desde» when its
 * arrangement changes too, otherwise this month. Earlier months keep the adjustment they had.
 * A switch to per class may start later (see perClassStart).
 */
export function adjustmentStart(group, draft, asOf, applyFrom = draft?.applyFrom ?? null) {
  if (!group?.id || !billingTermChanged(group, draft)) return periodOf(asOf);
  return applyFromFor(group, draft, asOf, applyFrom) || periodOf(asOf);
}

/** What each student owes in `period` (this month by default) when the group bills monthly from it. */
export function switchCredits(state, group, members, draft, asOf, period = periodOf(asOf)) {
  const preview = {
    ...group,
    billing: {
      mode: "monthly",
      monthlyFee: Number(draft.monthlyFee) || 0,
      due: draft.due,
      effectiveFrom: period,
    },
  };
  const previewState = {
    ...state,
    groups: (state.groups || []).map((item) => (item.id === group.id ? preview : item)),
  };
  return members
    .map((student) => {
      const adjusted = draft.adjustments[student.id];
      if (adjusted?.mode === "perClass") return null;
      const studentPreview =
        adjusted?.mode === "customFee"
          ? { ...student, billingByGroup: { ...(student.billingByGroup || {}), [group.id]: adjusted } }
          : student;
      const plan = studentMonthlyPlan(previewState, studentPreview, preview, period);
      return plan ? { student, fee: plan.fee, paid: roundMoney(plan.fee - plan.amount), amount: plan.amount } : null;
    })
    .filter(Boolean);
}

/** Month total for a monthly group: fees of the students who pay monthly and how many still pay per class. */
export function monthlyTotal(state, group, members, draft) {
  let total = 0;
  let monthly = 0;
  let perClass = 0;
  members.forEach((student) => {
    const adjusted = draft.adjustments[student.id];
    if (adjusted?.mode === "perClass") perClass += 1;
    else {
      monthly += 1;
      total += adjusted?.mode === "customFee" ? Number(adjusted.fee) || 0 : Number(draft.monthlyFee) || 0;
    }
  });
  return { total: roundMoney(total), monthly, perClass };
}

/** The next due dates of a monthly group, for the «Vence» hint. */
export function nextDueDates(state, group, draft, asOf, count = 2) {
  const preview = { ...group, billing: { mode: "monthly", monthlyFee: Number(draft.monthlyFee) || 0, due: draft.due } };
  const previewState = {
    ...state,
    groups: (state.groups || []).map((item) => (item.id === group.id ? preview : item)),
  };
  const dates = [];
  let period = periodOf(asOf);
  for (let guard = 0; dates.length < count && guard < 14; guard += 1, period = nextPeriod(period)) {
    let due;
    if (draft.due.type === "dayOfMonth") due = `${period}-${String(draft.due.day).padStart(2, "0")}`;
    else {
      const classes = groupClassDates(previewState, preview, period);
      if (!classes.length) continue;
      due = draft.due.nth === "last" ? classes.at(-1) : classes[Math.min(Number(draft.due.nth), classes.length) - 1];
    }
    if (due >= asOf) dates.push(due);
  }
  return dates;
}

/** Options for a student who joins a monthly group after the month started. */
export function joiningOptions(state, group, student, asOf) {
  if (!isMonthlyGroup(group, periodOf(asOf))) return null;
  const billing = groupBillingFor(group, periodOf(asOf));
  const override = adjustmentFor(student?.billingByGroup?.[group.id], periodOf(asOf));
  const fee = override?.mode === "customFee" ? override.fee : billing.monthlyFee;
  const amounts = joiningAmounts(state, group, fee, asOf);
  if (!amounts.total || amounts.remaining === amounts.total) return { started: false, fee, amounts };
  return { started: true, fee, amounts };
}

/** The student record after joining a group, with the first-month choice when the group is monthly. */
export function joinGroup(student, group, asOf, choice = null) {
  const groupIds = [...new Set([...studentGroupIdsOf(student), group.id])];
  // A student coming back keeps the day they first joined: saving records their return.
  if (!choice || student.billingByGroup?.[group.id]?.leftOn) return { ...student, groupIds };
  const billingByGroup = { ...(student.billingByGroup || {}) };
  billingByGroup[group.id] = {
    ...(billingByGroup[group.id] || { mode: "group" }),
    joinedOn: asOf,
    firstMonthAmount: choice.amount,
  };
  return { ...student, groupIds, billingByGroup };
}

/** Suggested monthly fee for the «Usar» link (a full month of classes, shared with the tutorial). */
export function feeSuggestion(state, group, asOf) {
  return suggestedMonthlyFee(state, group, periodOf(asOf));
}

// The messages name the field by its label, so they read right under it.
const STUDENT_FIELD_MESSAGES = Object.freeze({
  fullName: { required: "Full name is required." },
  code: { required: "Student ID is required.", duplicate: "Student ID is already in use." },
  studentEmail: { invalid_email: "Student email must be a valid email address." },
});

/**
 * What the student editor must say under its fields before saving: the same rules the save applies
 * (validateStudent), mapped to the field each one belongs to. Anything else is left to the save.
 */
export function studentFieldErrors(draft, state) {
  const { errors } = validateStudent({ ...draft, id: draft.id || "new-student" }, state);
  const fields = /** @type {Record<string, string>} */ ({});
  for (const error of errors) {
    const message = STUDENT_FIELD_MESSAGES[error.path]?.[error.code];
    if (message && !fields[error.path]) fields[error.path] = message;
  }
  return fields;
}
