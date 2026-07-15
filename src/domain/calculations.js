import { DEFAULT_SETTINGS, PAYMENT_STATUSES } from "./constants.js";
import {
  addDays,
  addMonths,
  daysInMonth,
  endOfMonth,
  isDateOnly,
  isDateInRange,
  minDateOnly,
  startOfMonth,
  startOfWeek,
  todayDateOnly,
} from "./dates.js";
import { generateScheduledOccurrences, resolveHourlyRate } from "./schedule.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrZero(value) {
  return finiteNumber(value) ? value : 0;
}

function average(values) {
  const numbers = values.filter(finiteNumber);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function arrays(state) {
  return {
    groups: Array.isArray(state?.groups) ? state.groups : [],
    students: Array.isArray(state?.students) ? state.students : [],
    grades: Array.isArray(state?.grades) ? state.grades : [],
    classLog: Array.isArray(state?.classLog) ? state.classLog : [],
  };
}

function settings(state) {
  return { ...DEFAULT_SETTINGS, ...(isRecord(state?.settings) ? state.settings : {}) };
}

function resolveAsOf(state, requested) {
  if (isDateOnly(requested)) return requested;
  if (isDateOnly(state?.settings?.asOfDate)) return state.settings.asOfDate;
  return todayDateOnly();
}

function resolveSelectedMonth(state) {
  const value = state?.settings?.selectedMonth;
  return startOfMonth(isDateOnly(value) ? value : resolveAsOf(state));
}

function findById(items, id) {
  return items.find((item) => item?.id === id) ?? null;
}

function studentGroupIds(student) {
  if (Array.isArray(student?.groupIds)) return student.groupIds;
  return student?.groupId ? [student.groupId] : [];
}

function sum(items, selector) {
  return items.reduce((total, item) => total + numberOrZero(selector(item)), 0);
}

function validPaymentAmount(row) {
  return numberOrZero(row?.amountPaid);
}

function amountCollectedInRange(rows, start, end) {
  if (!isDateOnly(start) || !isDateOnly(end) || start > end) return 0;
  return sum(
    rows.filter((row) => isDateOnly(row?.paymentDate) && isDateInRange(row.paymentDate, start, end)),
    validPaymentAmount,
  );
}

export function gradePercentage(row) {
  // Null/undefined/"" is intentionally different from zero: 0 is a real score.
  if (!finiteNumber(row?.score) || !finiteNumber(row?.maxScore) || row.maxScore <= 0) return null;
  return row.score / row.maxScore;
}

export function deriveGradeRow(state, row) {
  const { students, groups } = arrays(state);
  const student = findById(students, row?.studentId);
  const studentGroups = student ? studentGroupIds(student).map((id) => findById(groups, id)).filter(Boolean) : [];
  const group = studentGroups[0] ?? null;
  return {
    ...row,
    // `maximum` is a view-model alias used by the compact grade editor.
    maximum: row?.maxScore,
    student,
    studentName: student?.fullName ?? "",
    studentCode: student?.code ?? "",
    group,
    groupId: group?.id ?? "",
    groupName: group?.name ?? "",
    groups: studentGroups,
    groupNames: studentGroups.map((item) => item.name),
    percentage: gradePercentage(row),
  };
}

export function calculateCharge(state, row) {
  const config = settings(state);
  if (!row?.classDate || !row?.studentId || !row?.classStatus) return null;
  if (row.classStatus === "Cancelled") return 0;
  if (finiteNumber(row.appliedCharge)) return row.appliedCharge;

  // Blank hours use the default; an explicit 0 waives the charge.
  const effectiveHours = finiteNumber(row.hours) ? row.hours : config.defaultClassHours;
  const hourlyRate = finiteNumber(row.appliedHourlyRate)
    ? row.appliedHourlyRate
    : resolveHourlyRate(state, row.studentId, row.groupId);
  if (!finiteNumber(effectiveHours) || !finiteNumber(hourlyRate)) return null;
  return effectiveHours * hourlyRate;
}

export function calculatePaymentStatus(state, row, asOfDate) {
  const { students } = arrays(state);
  const asOf = resolveAsOf(state, asOfDate);
  if (!row?.classDate || !row?.studentId) return "";

  const student = findById(students, row.studentId);
  if (!student) return PAYMENT_STATUSES.UNKNOWN_STUDENT;

  const charge = calculateCharge(state, row);
  const paid = validPaymentAmount(row);
  const hasPaymentDate = isDateOnly(row.paymentDate);

  if (row.classStatus === "Cancelled") {
    return paid > 0 ? PAYMENT_STATUSES.REVIEW_CANCELLED : PAYMENT_STATUSES.CANCELLED;
  }
  if (charge === 0) {
    return paid > 0 ? PAYMENT_STATUSES.REVIEW_NO_CHARGE : PAYMENT_STATUSES.NO_CHARGE;
  }
  if (paid > 0 && !hasPaymentDate) return PAYMENT_STATUSES.DATE_NEEDED;
  if (hasPaymentDate && paid === 0) return PAYMENT_STATUSES.AMOUNT_NEEDED;
  if (hasPaymentDate && row.paymentDate > asOf) return PAYMENT_STATUSES.FUTURE_PAYMENT_DATE;
  if (paid === 0) {
    return row.classDate > asOf ? PAYMENT_STATUSES.SCHEDULED : PAYMENT_STATUSES.PENDING;
  }
  if (finiteNumber(charge) && paid < charge) return PAYMENT_STATUSES.PARTIAL;
  if (finiteNumber(charge) && paid > charge) return PAYMENT_STATUSES.OVERPAID;
  if (hasPaymentDate && (row.paymentDate < row.classDate || row.classDate > asOf)) {
    return PAYMENT_STATUSES.PAID_IN_ADVANCE;
  }
  return PAYMENT_STATUSES.PAID;
}

export function calculateOutstanding(state, row, asOfDate) {
  const { students } = arrays(state);
  const asOf = resolveAsOf(state, asOfDate);
  if (!row?.classDate || !row?.studentId || !findById(students, row.studentId)) return null;

  const charge = calculateCharge(state, row);
  if (row.classDate > asOf || row.classStatus === "Cancelled" || charge === 0) return 0;
  if (!finiteNumber(charge)) return null;

  const recognizedPayment = isDateOnly(row.paymentDate) && row.paymentDate <= asOf
    ? validPaymentAmount(row)
    : 0;
  return Math.max(charge - recognizedPayment, 0);
}

export function deriveClassLogRow(state, row, asOfDate) {
  const { students, groups } = arrays(state);
  const asOf = resolveAsOf(state, asOfDate);
  const student = findById(students, row?.studentId);
  const group = findById(groups, row?.groupId) ?? (student ? findById(groups, studentGroupIds(student)[0]) : null);
  const config = settings(state);
  const effectiveHours = row?.classStatus === "Cancelled"
    ? 0
    : finiteNumber(row?.hours)
      ? row.hours
      : config.defaultClassHours;
  const recognizedPaid = isDateOnly(row?.paymentDate) && row.paymentDate <= asOf
    ? validPaymentAmount(row)
    : 0;

  return {
    ...row,
    student,
    studentName: student?.fullName ?? "",
    studentCode: student?.code ?? "",
    group,
    groupId: group?.id ?? "",
    groupName: group?.name ?? "",
    effectiveHours,
    appliedHourlyRate: finiteNumber(row?.appliedHourlyRate)
      ? row.appliedHourlyRate
      : resolveHourlyRate(state, student, group),
    charge: calculateCharge(state, row),
    recognizedPaid,
    paymentStatus: calculatePaymentStatus(state, row, asOf),
    outstanding: calculateOutstanding(state, row, asOf),
  };
}

export function deriveStudent(state, studentId, asOfDate) {
  const data = arrays(state);
  const asOf = resolveAsOf(state, asOfDate);
  const student = findById(data.students, studentId);
  if (!student) return null;
  const studentGroups = studentGroupIds(student).map((id) => findById(data.groups, id)).filter(Boolean);
  const group = studentGroups[0] ?? null;
  const gradeRows = data.grades.filter((row) => row?.studentId === studentId);
  const logRows = data.classLog.filter((row) => row?.studentId === studentId);
  const percentages = gradeRows.map(gradePercentage).filter(finiteNumber);

  const attendanceRows = logRows.filter(
    (row) => row?.classStatus === "Completed" && ["P", "L", "A"].includes(row.attendance),
  );
  const attended = attendanceRows.filter((row) => row.attendance === "P" || row.attendance === "L").length;
  const attendance = attendanceRows.length ? attended / attendanceRows.length : null;
  const missingAssignments = gradeRows.filter((row) => row?.workStatus === "Missing").length;
  const outstanding = sum(logRows, (row) => calculateOutstanding(state, row, asOf));
  const paidThroughToday = sum(
    logRows.filter((row) => isDateOnly(row?.paymentDate) && row.paymentDate <= asOf),
    validPaymentAmount,
  );

  let latestFeedback = "";
  for (const row of gradeRows) {
    if (typeof row?.feedback === "string" && row.feedback.trim()) latestFeedback = row.feedback.trim();
  }

  const gradeAverage = average(percentages);
  const config = settings(state);
  const alerts = [];
  if (finiteNumber(gradeAverage) && gradeAverage < config.lowGradeThreshold) alerts.push("Low grade");
  if (finiteNumber(attendance) && attendance < config.lowAttendanceThreshold) alerts.push("Low attendance");
  if (missingAssignments > 0) alerts.push("Missing work");
  if (outstanding > 0) alerts.push("Balance due");

  return {
    ...student,
    group,
    groupName: group?.name ?? "",
    groups: studentGroups,
    groupNames: studentGroups.map((item) => item.name),
    gradeAverage,
    attendance,
    attendedClasses: attended,
    attendanceClasses: attendanceRows.length,
    missingAssignments,
    outstanding,
    paidThroughToday,
    latestFeedback,
    alerts,
    alertText: alerts.join("; "),
  };
}

export function deriveGroup(state, groupId, asOfDate) {
  const data = arrays(state);
  const asOf = resolveAsOf(state, asOfDate);
  const group = findById(data.groups, groupId);
  if (!group) return null;
  const selectedMonth = resolveSelectedMonth(state);
  const selectedMonthEnd = minDateOnly(endOfMonth(selectedMonth), asOf);
  const students = data.students.filter((student) => studentGroupIds(student).includes(groupId));
  const activeStudentRecords = students.filter((student) => student?.status === "Active");
  const derivedStudents = activeStudentRecords.map((student) => deriveStudent(state, student.id, asOf));
  const activeStudents = activeStudentRecords.length;
  const groupStudentIds = new Set(students.map((student) => student.id));
  const groupLog = data.classLog.filter((row) => row?.groupId === groupId || (!row?.groupId && groupStudentIds.has(row?.studentId)));
  const config = settings(state);
  const collectedSelectedMonth = selectedMonth <= selectedMonthEnd
    ? amountCollectedInRange(groupLog, selectedMonth, selectedMonthEnd)
    : 0;

  const scheduledOccurrences = group.weeklySchedule?.length
    ? generateScheduledOccurrences(state, selectedMonth, endOfMonth(selectedMonth))
      .filter((item) => item.groupId === groupId && item.status !== "Cancelled")
    : [];
  const idealRevenue = scheduledOccurrences.length
    ? sum(scheduledOccurrences, (occurrence) => sum(activeStudentRecords, (student) => (
      numberOrZero(resolveHourlyRate(state, student, group)) * numberOrZero(occurrence.durationHours)
    )))
    : sum(activeStudentRecords, (student) => (
      numberOrZero(group.plannedSessionsPerMonth)
      * numberOrZero(config.defaultClassHours)
      * numberOrZero(resolveHourlyRate(state, student, group))
    ));

  return {
    ...group,
    group,
    studentCount: students.length,
    activeStudents,
    activeStudentCount: activeStudents,
    averageGrade: average(derivedStudents.map((student) => student.gradeAverage)),
    attendance: average(derivedStudents.map((student) => student.attendance)),
    missingAssignments: sum(derivedStudents, (student) => student.missingAssignments),
    collectedSelectedMonth,
    outstanding: sum(derivedStudents, (student) => student.outstanding),
    idealRevenue,
    scheduledOccurrences: scheduledOccurrences.length,
    effectiveHourlyRate: finiteNumber(group.hourlyRate) ? group.hourlyRate : config.hourlyRate,
  };
}

export function deriveUnassignedGroup(state, asOfDate) {
  const data = arrays(state);
  const asOf = resolveAsOf(state, asOfDate);
  const students = data.students.filter((student) => student?.isIndividual || studentGroupIds(student).length === 0);
  if (!students.length) return null;

  const selectedMonth = resolveSelectedMonth(state);
  const selectedMonthEnd = minDateOnly(endOfMonth(selectedMonth), asOf);
  const activeStudentRecords = students.filter((student) => student?.status === "Active");
  const derivedStudents = activeStudentRecords.map((student) => deriveStudent(state, student.id, asOf));
  const activeStudents = activeStudentRecords.length;
  const studentIds = new Set(students.map((student) => student.id));
  const groupLog = data.classLog.filter((row) => !row?.groupId && studentIds.has(row?.studentId));

  return {
    id: "__unassigned__",
    name: "Unassigned",
    group: null,
    isUnassigned: true,
    studentCount: students.length,
    activeStudents,
    activeStudentCount: activeStudents,
    averageGrade: average(derivedStudents.map((student) => student.gradeAverage)),
    attendance: average(derivedStudents.map((student) => student.attendance)),
    missingAssignments: sum(derivedStudents, (student) => student.missingAssignments),
    collectedSelectedMonth:
      selectedMonth <= selectedMonthEnd
        ? amountCollectedInRange(groupLog, selectedMonth, selectedMonthEnd)
        : 0,
    outstanding: sum(derivedStudents, (student) => student.outstanding),
    idealRevenue: 0,
    projectionExcluded: true,
  };
}

function weeklyCollections(rows, asOf, count = 8) {
  const currentWeek = startOfWeek(asOf, 1);
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(currentWeek, -7 * (count - 1 - index));
    const naturalEnd = addDays(start, 6);
    const end = minDateOnly(naturalEnd, asOf);
    return {
      start,
      end,
      collected: amountCollectedInRange(rows, start, end),
    };
  });
}

function monthlyCollections(rows, selectedMonth, asOf, count = 6) {
  return Array.from({ length: count }, (_, index) => {
    const month = addMonths(selectedMonth, -(count - 1 - index));
    const end = minDateOnly(endOfMonth(month), asOf);
    return {
      month,
      start: month,
      end,
      collected: month <= end ? amountCollectedInRange(rows, month, end) : 0,
    };
  });
}

export function deriveDashboard(state, asOfDate) {
  const data = arrays(state);
  const config = settings(state);
  const asOf = resolveAsOf(state, asOfDate);
  const selectedMonth = resolveSelectedMonth(state);
  const students = data.students.map((student) => deriveStudent(state, student.id, asOf));
  const active = students.filter((student) => student.status === "Active");
  const unassignedGroup = deriveUnassignedGroup(state, asOf);
  const groups = [
    ...data.groups.map((group) => deriveGroup(state, group.id, asOf)),
    ...(unassignedGroup ? [unassignedGroup] : []),
  ];

  const weekStart = startOfWeek(asOf, 1);
  const selectedMonthEnd = minDateOnly(endOfMonth(selectedMonth), asOf);
  const recentWeeks = Number.isInteger(config.recentProjectionWeeks) && config.recentProjectionWeeks > 0
    ? config.recentProjectionWeeks
    : DEFAULT_SETTINGS.recentProjectionWeeks;
  const recentStart = addDays(asOf, -7 * recentWeeks + 1);
  const recentCollections = amountCollectedInRange(data.classLog, recentStart, asOf);

  const paidForFutureClasses = sum(
    data.classLog.filter(
      (row) =>
        isDateOnly(row?.classDate) &&
        row.classDate > asOf &&
        isDateOnly(row.paymentDate) &&
        row.paymentDate <= asOf,
    ),
    validPaymentAmount,
  );

  const dashboard = {
    asOfDate: asOf,
    selectedMonth,
    activeStudents: active.length,
    overallGrade: average(active.map((student) => student.gradeAverage)),
    overallAttendance: average(active.map((student) => student.attendance)),
    missingAssignments: sum(active, (student) => student.missingAssignments),
    collectedThisWeek: amountCollectedInRange(data.classLog, weekStart, asOf),
    collectedSelectedMonth:
      selectedMonth <= selectedMonthEnd
        ? amountCollectedInRange(data.classLog, selectedMonth, selectedMonthEnd)
        : 0,
    outstandingThroughToday: sum(active, (student) => student.outstanding),
    paidForFutureClasses,
    idealRevenue: sum(groups, (group) => group.idealRevenue),
    recentProjection:
      (recentCollections / recentWeeks) * (daysInMonth(selectedMonth) / 7),
    recentCollections,
    recentWeeklyAverage: recentCollections / recentWeeks,
    groupSummaries: groups,
    studentSnapshots: students,
    studentSummaries: students,
    weeklyCollections: weeklyCollections(data.classLog, asOf),
    monthlyCollections: monthlyCollections(data.classLog, selectedMonth, asOf),
  };
  return dashboard;
}

/** A convenient one-pass shape for a React hook. Raw state is never mutated. */
export function deriveAll(state, asOfDate) {
  const asOf = resolveAsOf(state, asOfDate);
  const data = arrays(state);
  const students = data.students.map((student) => deriveStudent(state, student.id, asOf));
  const unassignedGroup = deriveUnassignedGroup(state, asOf);
  const groups = [
    ...data.groups.map((group) => deriveGroup(state, group.id, asOf)),
    ...(unassignedGroup ? [unassignedGroup] : []),
  ];
  const grades = data.grades.map((row) => deriveGradeRow(state, row));
  const classLog = data.classLog.map((row) => deriveClassLogRow(state, row, asOf));
  const upcomingClasses = generateScheduledOccurrences(state, asOf, addDays(asOf, 42));
  return {
    dashboard: deriveDashboard(state, asOf),
    students,
    groups,
    grades,
    classLog,
    upcomingClasses,
    studentSummaries: students,
    groupSummaries: groups,
    gradeRows: grades,
    classLogRows: classLog,
    studentsById: new Map(data.students.map((student) => [student.id, student])),
    groupsById: new Map(data.groups.map((group) => [group.id, group])),
  };
}

export const __private__ = Object.freeze({ average, amountCollectedInRange, finiteNumber });
