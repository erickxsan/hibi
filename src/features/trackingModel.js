import { sumMoney } from "../domain/money.js";
import { isBillableAttendance } from "../domain/attendanceBilling.js";
import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek } from "../domain/dates";
import { deriveMonthlyCharges, isMonthlyGroup, normalizeGroupBilling, periodOf } from "../domain/monthlyBilling";
import { buildClassWorkspaceSessionsForRange } from "./classesWorkspaceModel";
import {
  assignmentsIn,
  debtSummary,
  debtsThrough,
  matchesGroup,
  paymentsBetween,
  sessionAttendance,
} from "./homeDashboardModel";
import { studentGroupIdsOf } from "./groupLabels";

/*
 * Seguimiento: one period and one scope (all, a group or individual classes) feed the KPIs,
 * the chart, the linked student list, the student's history and the breakdown table.
 */
export const TRACKING_PERIODS = Object.freeze(["week", "month", "thirty", "all"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function daysBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

function earliestRecord(state) {
  const dates = [
    ...(state.classLog || []).map((row) => row.classDate),
    ...(state.grades || []).map((grade) => grade.date),
  ].filter(Boolean);
  return dates.length ? dates.sort()[0] : "";
}

/** The consulted range up to the report date and the comparable range before it. */
export function trackingRange(asOf, period = "month", state = null) {
  if (period === "week") {
    const start = startOfWeek(asOf, 1);
    const span = daysBetween(start, asOf);
    return { period, start, end: asOf, previousStart: addDays(start, -7), previousEnd: addDays(start, span - 7) };
  }
  if (period === "thirty") {
    return {
      period,
      start: addDays(asOf, -29),
      end: asOf,
      previousStart: addDays(asOf, -59),
      previousEnd: addDays(asOf, -30),
    };
  }
  if (period === "all") {
    const first = state ? earliestRecord(state) : "";
    return { period, start: first && first < asOf ? first : asOf, end: asOf, previousStart: "", previousEnd: "" };
  }
  const start = startOfMonth(asOf);
  const previousStart = addMonths(start, -1);
  const sameDay = addDays(previousStart, Number(asOf.slice(8, 10)) - 1);
  return {
    period: "month",
    start,
    end: asOf,
    previousStart,
    previousEnd: sameDay > endOfMonth(previousStart) ? endOfMonth(previousStart) : sameDay,
  };
}

/** Recorded and unrecorded classes of the range, each with its attendance and its assignment. */
export function trackingSessions(state, range, scope = "all") {
  if (!range.start) return [];
  const assignments = assignmentsIn(state, range.start, range.end, scope);
  return buildClassWorkspaceSessionsForRange(state, range.start, range.end, range.end)
    .filter(
      (session) =>
        matchesGroup(scope, session.groupId || "") &&
        !["Cancelled", "Scheduled", "Rescheduled"].includes(session.statusLabel),
    )
    .map((session) => {
      const attendance = sessionAttendance(session);
      return {
        session,
        key: session.key,
        date: session.classDate,
        startTime: session.startTime,
        title: session.title,
        groupId: session.groupId || "",
        kind: attendance ? "reg" : "unreg",
        value: attendance?.ratio ?? null,
        present: attendance?.present ?? 0,
        total: attendance?.total ?? 0,
        absentIds: attendance?.absentIds ?? [],
        studentIds: (session.rows || []).map((row) => row.studentId),
        assignment: assignments.find((item) => item.sessionKey === session.key) || null,
      };
    });
}

function attendanceOf(sessions) {
  const present = sessions.reduce((sum, item) => sum + item.present, 0);
  const total = sessions.reduce((sum, item) => sum + item.total, 0);
  return { present, total, value: total ? present / total : null };
}

function gradeValues(assignments) {
  return assignments.flatMap((item) => item.grades.map((grade) => grade.value));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function inScope(student, scope) {
  if (scope === "all") return true;
  if (scope === "individual") return Boolean(student.isIndividual) || !studentGroupIdsOf(student).length;
  return studentGroupIdsOf(student).includes(scope);
}

/** Every active student of the scope with their figures for the range. */
export function trackingStudents(state, derived, range, scope = "all") {
  const derivedRows = derived?.classLog || [];
  const assignments = range.start ? assignmentsIn(state, range.start, range.end, scope) : [];
  const debts = new Map(debtsThrough(state, derivedRows, range.end, scope).map((item) => [item.studentId, item]));
  const payments = range.start ? paymentsBetween(state, derivedRows, range.start, range.end, scope) : [];
  const charges = deriveMonthlyCharges(state, range.end, { includeArchived: false });
  return (state.students || [])
    .filter((student) => student.status !== "Inactive" && inScope(student, scope))
    .map((student) => {
      const rows = derivedRows
        .filter(
          (row) =>
            row.studentId === student.id &&
            row.classStatus === "Completed" &&
            row.classDate >= range.start &&
            row.classDate <= range.end &&
            ["P", "L", "A"].includes(row.attendance) &&
            matchesGroup(scope, row.groupId || ""),
        )
        .sort((left, right) => left.classDate.localeCompare(right.classDate));
      const absences = rows.filter((row) => row.attendance === "A").length;
      const grades = assignments.flatMap((item) =>
        item.grades.filter((grade) => grade.studentId === student.id).map((grade) => ({ ...grade, item })),
      );
      const own = payments.filter((item) => item.studentId === student.id);
      const debt = debts.get(student.id);
      const monthlyDue = charges.filter(
        (charge) =>
          charge.studentId === student.id &&
          matchesGroup(scope, charge.groupId) &&
          ["pending", "overdue"].includes(charge.status) &&
          charge.dueDate <= range.end,
      );
      return {
        student,
        classes: rows.length,
        absences,
        attendance: rows.length ? (rows.length - absences) / rows.length : null,
        sequence: rows.map((row) => ({ date: row.classDate, code: row.attendance === "A" ? "A" : "P" })),
        grades: grades.map((grade) => grade.value),
        gradeItems: grades,
        average: average(grades.map((grade) => grade.value)),
        ungraded: assignments.filter((item) => item.missing.includes(student.id)).map((item) => item.assessment),
        paid: sumMoney(own, (item) => item.amount),
        payments: own,
        owed: debt?.amount || 0,
        overdue: debt?.overdue || 0,
        overdueThisMonth: debt?.overdueThisMonth || 0,
        overdueEarlier: debt?.overdueEarlier || 0,
        reasons: debt?.reasons || [],
        monthlyDue,
      };
    });
}

/** Payment buckets for the bars: days for a short range, weeks for a month, months for longer ones. */
export function trackingBuckets(range) {
  if (!range.start) return [];
  const length = daysBetween(range.start, range.end);
  const buckets = [];
  if (length <= 13) {
    for (let date = range.start; date <= range.end; date = addDays(date, 1))
      buckets.push({ start: date, end: date, label: date, kind: "day", future: false });
    return buckets;
  }
  if (length <= 92) {
    let cursor = range.start;
    while (cursor <= range.end) {
      const weekEnd = addDays(startOfWeek(cursor, 1), 6);
      const end = weekEnd > range.end ? range.end : weekEnd;
      buckets.push({ start: cursor, end, label: cursor, kind: "week", future: false });
      cursor = addDays(end, 1);
    }
    return buckets;
  }
  for (let month = startOfMonth(range.start); month <= range.end; month = addMonths(month, 1)) {
    const start = month < range.start ? range.start : month;
    const end = endOfMonth(month) > range.end ? range.end : endOfMonth(month);
    buckets.push({ start, end, label: month, kind: "month", future: false });
  }
  return buckets;
}

/**
 * The three charts in the shape the shared plots read.
 * @returns {{ metric: string, period: string, points: any[] }}
 */
export function trackingMetric(state, derived, range, scope, tab) {
  if (tab === "attendance") {
    return { metric: "attendance", period: range.period, points: trackingSessions(state, range, scope) };
  }
  if (tab === "grades") {
    const points = (range.start ? assignmentsIn(state, range.start, range.end, scope) : [])
      .filter((item) => item.average !== null)
      .map((item) => ({
        kind: "reg",
        key: item.key,
        date: item.date,
        value: item.average,
        assignment: item,
        groupId: item.groupId,
      }));
    return { metric: "grade", period: range.period, points };
  }
  const derivedRows = derived?.classLog || [];
  const points = trackingBuckets(range).map((bucket) => {
    const payments = paymentsBetween(state, derivedRows, bucket.start, bucket.end, scope);
    return { ...bucket, key: bucket.start, payments, value: sumMoney(payments, (item) => item.amount) };
  });
  return { metric: "collections", period: range.period, points };
}

/** Headline figures of each tab, with the comparison against the previous range. */
export function trackingKpis(state, derived, range, scope, students) {
  const sessions = trackingSessions(state, range, scope);
  const registered = sessions.filter((item) => item.kind === "reg");
  const attendance = attendanceOf(registered);
  const previousAttendance = range.previousStart
    ? attendanceOf(trackingSessions(state, { start: range.previousStart, end: range.previousEnd }, scope))
    : { value: null };
  const threshold = finite(state.settings?.lowAttendanceThreshold) ? state.settings.lowAttendanceThreshold : 0.8;
  const gradeThreshold = (finite(state.settings?.lowGradeThreshold) ? state.settings.lowGradeThreshold : 0.7) * 10;
  const assignments = range.start ? assignmentsIn(state, range.start, range.end, scope) : [];
  const values = gradeValues(assignments);
  const previousValues = range.previousStart
    ? gradeValues(assignmentsIn(state, range.previousStart, range.previousEnd, scope))
    : [];
  const derivedRows = derived?.classLog || [];
  const payments = range.start ? paymentsBetween(state, derivedRows, range.start, range.end, scope) : [];
  const previousPayments = range.previousStart
    ? paymentsBetween(state, derivedRows, range.previousStart, range.previousEnd, scope)
    : [];
  const charged = derivedRows.filter(
    (row) =>
      row.classStatus === "Completed" &&
      row.classDate >= range.start &&
      row.classDate <= range.end &&
      matchesGroup(scope, row.groupId || "") &&
      finite(row.charge) &&
      row.charge > 0,
  );
  const collected = sumMoney(payments, (item) => item.amount);
  const previousCollected = sumMoney(previousPayments, (item) => item.amount);
  return {
    threshold,
    gradeThreshold,
    attendance: {
      value: attendance.value,
      delta:
        finite(attendance.value) && finite(previousAttendance.value)
          ? attendance.value - previousAttendance.value
          : null,
      present: attendance.present,
      records: attendance.total,
      absences: attendance.total - attendance.present,
      registered: registered.length,
      unregistered: sessions.length - registered.length,
      low: students.filter((row) => row.classes && row.attendance < threshold),
      withAbsences: students.filter((row) => row.absences > 0),
    },
    grades: {
      value: average(values),
      delta: values.length && previousValues.length ? average(values) - average(previousValues) : null,
      count: values.length,
      graded: assignments.filter((item) => item.average !== null).length,
      low: students.filter((row) => row.grades.some((value) => value < gradeThreshold)),
      ungraded: students.filter((row) => row.ungraded.length),
    },
    payments: {
      collected,
      delta: previousCollected ? (collected - previousCollected) / previousCollected : null,
      monthlyCount: payments.filter((item) => item.kind === "monthly").length,
      paymentCount: payments.length,
      owed: sumMoney(students, (row) => row.owed),
      overdue: sumMoney(students, (row) => row.overdue),
      // Same scope words as Inicio: overdue money of this month and of earlier months, inactive students apart.
      period: periodOf(range.end),
      overdueThisMonth: sumMoney(students, (row) => row.overdueThisMonth),
      overdueEarlier: sumMoney(students, (row) => row.overdueEarlier),
      inactiveOwed: range.end ? debtSummary(state, derivedRows, range.end, scope).inactive.owed : 0,
      previousStart: range.previousStart,
      previousEnd: range.previousEnd,
      overdueStudents: students.filter((row) => row.overdue > 0),
      pendingStudents: students.filter((row) => row.owed > 0 && !row.overdue),
      paidClasses: charged.filter((row) => !(Number(row.outstanding) > 0)).length,
      unpaidClasses: charged.filter((row) => Number(row.outstanding) > 0).length,
    },
  };
}

/** «Mensualidades · mes» per monthly group of the scope: who paid, who owes and the progress. */
export function monthlyBlocks(state, asOf, scope = "all") {
  const period = periodOf(asOf);
  const charges = deriveMonthlyCharges(state, asOf, { includeArchived: false }).filter(
    (charge) => charge.period === period,
  );
  return (state.groups || [])
    .filter(
      (group) =>
        group.status !== "Inactive" && isMonthlyGroup(group, period) && (scope === "all" || scope === group.id),
    )
    .map((group) => {
      const rows = charges
        .filter((charge) => charge.groupId === group.id)
        .map((charge) => ({
          charge,
          student: (state.students || []).find((student) => student.id === charge.studentId),
        }))
        .filter((item) => item.student)
        .sort((left, right) => (left.charge.status === "paid" ? 0 : 1) - (right.charge.status === "paid" ? 0 : 1));
      const counted = rows.filter((item) => item.charge.status !== "waived");
      const paid = counted.filter((item) => item.charge.status === "paid");
      const perClass = (state.students || []).filter(
        (student) =>
          student.status !== "Inactive" &&
          studentGroupIdsOf(student).includes(group.id) &&
          !rows.some((item) => item.student.id === student.id),
      );
      return {
        group,
        billing: normalizeGroupBilling(group.billing),
        period,
        dueDate: rows[0]?.charge.groupDueDate || "",
        rows,
        paidCount: paid.length,
        total: counted.length,
        paidAmount: sumMoney(paid, (item) => item.charge.amount),
        expectedAmount: sumMoney(counted, (item) => item.charge.amount),
        perClass,
      };
    })
    .filter((block) => block.rows.length);
}

/** Breakdown: one row per student and class in the range, newest first. */
export function trackingRecords(state, derived, range, scope = "all", studentId = "") {
  const studentsById = new Map((state.students || []).map((student) => [student.id, student]));
  const groupsById = new Map((state.groups || []).map((group) => [group.id, group]));
  return (derived?.classLog || [])
    .filter(
      (row) =>
        row.classDate >= range.start &&
        row.classDate <= range.end &&
        ["Completed", "Cancelled"].includes(row.classStatus) &&
        matchesGroup(scope, row.groupId || "") &&
        (!studentId || row.studentId === studentId) &&
        studentsById.has(row.studentId),
    )
    .sort(
      (left, right) =>
        right.classDate.localeCompare(left.classDate) ||
        String(right.startTime).localeCompare(String(left.startTime)) ||
        String(studentsById.get(left.studentId)?.fullName).localeCompare(
          String(studentsById.get(right.studentId)?.fullName),
        ),
    )
    .map((row) => {
      const key = `${row.classDate}|${row.groupId ? `g:${row.groupId}` : `s:${row.studentId}`}|${row.startTime}`;
      const grade = (state.grades || []).find(
        (item) => item.studentId === row.studentId && item.classSessionKey === key,
      );
      const value =
        grade && finite(grade.score) && finite(grade.maxScore) && grade.maxScore > 0
          ? (grade.score / grade.maxScore) * 10
          : null;
      return {
        row,
        key,
        student: studentsById.get(row.studentId),
        className: row.groupId ? groupsById.get(row.groupId)?.name || "" : "",
        assessment: grade?.assessment || "",
        grade: value,
        ungraded: Boolean(grade) && value === null,
        payment:
          row.classStatus === "Cancelled" || !isBillableAttendance(row)
            ? "none"
            : Number(row.outstanding) > 0
              ? "pending"
              : Number(row.amountPaid) > 0
                ? "paid"
                : Number(row.charge) === 0
                  ? "covered"
                  : "none",
      };
    });
}
