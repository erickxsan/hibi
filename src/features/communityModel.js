import { roundMoney, sumMoney } from "../domain/money.js";
import { addDays, startOfMonth } from "../domain/dates";
import { gradeGroupId } from "../domain/semanticIdentity";
import {
  deriveMonthlyCharges,
  groupClassDates,
  isMonthlyGroup,
  joiningAmounts,
  nextPeriod,
  normalizeBillingByGroup,
  normalizeGroupBilling,
  perClassCharge,
  periodOf,
  studentMonthlyPlan,
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
  const monthlyDue = (charges || deriveMonthlyCharges(state, asOf, { includeArchived: false })).filter(
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
    flag,
  };
}

/** Every student's month at once, sharing the monthly charges. */
export function studentMonths(state, derived, asOf, students = state.students || []) {
  const charges = deriveMonthlyCharges(state, asOf, { includeArchived: false });
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

/** Editable billing for the group detail. Students' adjustments come from their billingByGroup. */
export function billingDraftFor(group, members) {
  const billing = normalizeGroupBilling(group?.billing);
  return {
    mode: billing?.mode === "monthly" ? "monthly" : "perClass",
    monthlyFee: billing?.mode === "monthly" ? billing.monthlyFee : null,
    due: billing?.mode === "monthly" ? billing.due : { type: "dayOfMonth", day: 5 },
    effectiveFrom: billing?.mode === "monthly" ? billing.effectiveFrom : "",
    creditFirstMonth: Boolean(billing?.creditFirstMonth),
    hourlyRate: Number.isFinite(group?.hourlyRate) ? group.hourlyRate : null,
    adjustments: Object.fromEntries(
      members
        .map((student) => [student.id, normalizeBillingByGroup(student.billingByGroup)?.[group?.id]])
        .filter(([, override]) => override && override.mode !== "group")
        .map(([id, override]) => [id, { mode: override.mode, fee: override.fee ?? null }]),
    ),
  };
}

/**
 * Turns the billing draft into the saved group and the per-student overrides for saveGroupBilling.
 * Switching an existing per-class group starts next month, or this month crediting what was already paid per class.
 */
export function billingChanges(group, members, draft, asOf, applyFrom = "next") {
  const before = normalizeGroupBilling(group?.billing);
  const period = periodOf(asOf);
  let billing = { mode: "perClass" };
  if (draft.mode === "monthly") {
    const switching = !before || before.mode !== "monthly";
    const effectiveFrom = switching
      ? applyFrom === "current" || !group?.id
        ? period
        : nextPeriod(period)
      : before.effectiveFrom || period;
    billing = {
      mode: "monthly",
      monthlyFee: roundMoney(Number(draft.monthlyFee) || 0),
      due: draft.due,
      effectiveFrom,
      creditFirstMonth: switching ? applyFrom === "current" && Boolean(group?.id) : Boolean(before.creditFirstMonth),
    };
  }
  const overrides = {};
  members.forEach((student) => {
    const current = normalizeBillingByGroup(student.billingByGroup)?.[group?.id] || null;
    const wanted = draft.mode === "monthly" ? draft.adjustments[student.id] || null : null;
    const joined = current?.joinedOn ? { joinedOn: current.joinedOn, firstMonthAmount: current.firstMonthAmount } : {};
    const next = wanted
      ? {
          mode: wanted.mode,
          ...(wanted.mode === "customFee" ? { fee: roundMoney(Number(wanted.fee) || 0) } : {}),
          ...joined,
        }
      : current?.joinedOn
        ? { mode: "group", ...joined }
        : null;
    const same =
      JSON.stringify(current || null) === JSON.stringify(next ? normalizeBillingByGroup({ x: next })?.x || null : null);
    if (!same) overrides[student.id] = next;
  });
  return { billing, overrides };
}

/** What each student owes in the first month when a group switches to monthly this month. */
export function switchCredits(state, group, members, draft, asOf) {
  const period = periodOf(asOf);
  const preview = {
    ...group,
    billing: {
      mode: "monthly",
      monthlyFee: Number(draft.monthlyFee) || 0,
      due: draft.due,
      effectiveFrom: period,
      creditFirstMonth: true,
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
  const billing = normalizeGroupBilling(group.billing);
  const override = normalizeBillingByGroup(student?.billingByGroup)?.[group.id];
  const fee = override?.mode === "customFee" ? override.fee : billing.monthlyFee;
  const amounts = joiningAmounts(state, group, fee, asOf);
  if (!amounts.total || amounts.remaining === amounts.total) return { started: false, fee, amounts };
  return { started: true, fee, amounts };
}

/** The student record after joining a group, with the first-month choice when the group is monthly. */
export function joinGroup(student, group, asOf, choice = null) {
  const groupIds = [...new Set([...studentGroupIdsOf(student), group.id])];
  if (!choice) return { ...student, groupIds };
  const billingByGroup = { ...(student.billingByGroup || {}) };
  billingByGroup[group.id] = {
    ...(billingByGroup[group.id] || { mode: "group" }),
    joinedOn: asOf,
    firstMonthAmount: choice.amount,
  };
  return { ...student, groupIds, billingByGroup };
}

/** Suggested monthly fee for the «Usar» link. */
export function feeSuggestion(state, group, asOf) {
  const period = periodOf(asOf);
  const classes =
    groupClassDates(state, group, period).length || groupClassDates(state, group, nextPeriod(period)).length;
  const perClass = perClassCharge(state, group);
  return { classes, perClass, fee: roundMoney(classes * perClass) };
}
