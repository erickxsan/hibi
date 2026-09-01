import {
  addDays,
  addMonths,
  endOfMonth,
  isDateInRange,
  parseDateOnly,
  startOfMonth,
  startOfWeek,
} from "../domain/dates";
import { generateScheduledOccurrences, resolveHourlyRate } from "../domain/schedule";
import { classWorkspaceSessionKey, rosterForClassSession } from "./classesWorkspaceModel";

export const HOME_PERIODS = Object.freeze(["today", "weekly", "monthly", "yearly"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sum(items, selector) {
  return items.reduce((total, item) => {
    const value = selector(item);
    return total + (finite(value) ? value : 0);
  }, 0);
}

function dayCount(start, end) {
  return Math.round((parseDateOnly(end) - parseDateOnly(start)) / 86_400_000) + 1;
}

function yearStart(value) {
  return `${value.slice(0, 4)}-01-01`;
}

function rangeFor(asOf, period) {
  const start =
    period === "today"
      ? asOf
      : period === "weekly"
        ? startOfWeek(asOf, 1)
        : period === "monthly"
          ? startOfMonth(asOf)
          : yearStart(asOf);
  const length = dayCount(start, asOf);
  const previousStart =
    period === "today"
      ? addDays(asOf, -1)
      : period === "weekly"
        ? addDays(start, -7)
        : period === "monthly"
          ? addMonths(start, -1)
          : `${Number(asOf.slice(0, 4)) - 1}-01-01`;
  const naturalPreviousEnd = addDays(previousStart, length - 1);
  const previousEnd =
    period === "monthly" && naturalPreviousEnd > endOfMonth(previousStart)
      ? endOfMonth(previousStart)
      : naturalPreviousEnd;
  return {
    start,
    end: asOf,
    previousStart,
    previousEnd,
  };
}

function inRange(value, range, previous = false) {
  const start = previous ? range.previousStart : range.start;
  const end = previous ? range.previousEnd : range.end;
  return isDateInRange(value, start, end);
}

function attendanceFor(rows, range, previous = false) {
  const applicable = rows.filter(
    (row) =>
      row.classStatus === "Completed" &&
      ["P", "L", "A"].includes(row.attendance) &&
      inRange(row.classDate, range, previous),
  );
  if (!applicable.length) return null;
  return applicable.filter((row) => row.attendance === "P" || row.attendance === "L").length / applicable.length;
}

function attendanceSessionsFor(rows, range, groupsById, studentsById, previous = false) {
  const sessions = new Map();
  for (const row of rows) {
    if (
      row.classStatus !== "Completed" ||
      !["P", "L", "A"].includes(row.attendance) ||
      !inRange(row.classDate, range, previous)
    ) {
      continue;
    }

    const groupId = row.groupId || "";
    const studentId = groupId ? "" : row.studentId || "";
    const key = classWorkspaceSessionKey({ ...row, groupId, studentId });
    const group = groupsById.get(groupId);
    const student = studentsById.get(row.studentId);
    const current = sessions.get(key) || {
      key,
      classDate: row.classDate,
      startTime: row.startTime || "",
      groupId,
      scopeId: groupId ? `group:${groupId}` : "individual",
      title: group?.name || row.groupName || student?.fullName || row.studentName || "Individual class",
      attended: 0,
      expected: 0,
    };
    current.expected += 1;
    if (row.attendance === "P" || row.attendance === "L") current.attended += 1;
    sessions.set(key, current);
  }

  return [...sessions.values()]
    .map((session) => ({ ...session, attendance: session.attended / session.expected }))
    .sort((left, right) =>
      `${left.classDate}|${left.startTime}|${left.title}`.localeCompare(
        `${right.classDate}|${right.startTime}|${right.title}`,
      ),
    );
}

function gradeFor(rows, range, previous = false) {
  const values = rows
    .filter(
      (row) => inRange(row.date, range, previous) && finite(row.score) && finite(row.maxScore) && row.maxScore > 0,
    )
    .map((row) => row.score / row.maxScore);
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function collectedFor(rows, range, previous = false) {
  return sum(
    rows.filter((row) => inRange(row.paymentDate, range, previous)),
    (row) => row.amountPaid,
  );
}

function generatedFor(rows, range, previous = false) {
  return sum(
    rows.filter((row) => inRange(row.classDate, range, previous)),
    (row) => row.charge,
  );
}

function delta(current, previous) {
  if (!finite(current) || !finite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

function metricDelta(current, previous) {
  if (!finite(current) || !finite(previous)) return null;
  return current - previous;
}

function chartWindows(asOf, period) {
  if (period === "today") {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(asOf, index - 6);
      return { start: date, end: date, label: date };
    });
  }
  if (period === "weekly") {
    const start = startOfWeek(asOf, 1);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return { start: date, end: date, label: date };
    });
  }
  if (period === "monthly") {
    const start = startOfMonth(asOf);
    const end = endOfMonth(asOf);
    const result = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
      result.push({ start: cursor, end: addDays(cursor, 6) > end ? end : addDays(cursor, 6), label: cursor });
    }
    return result;
  }
  const firstMonth = startOfMonth(yearStart(asOf));
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(firstMonth, index);
    return { start, end: endOfMonth(start), label: start };
  });
}

function revenueSeries(rows, asOf, period) {
  let running = 0;
  return chartWindows(asOf, period).map((window) => {
    const generated =
      window.start > asOf
        ? 0
        : sum(
            rows.filter((row) => isDateInRange(row.classDate, window.start, window.end)),
            (row) => row.charge,
          );
    running += generated;
    return { ...window, generated, value: running };
  });
}

function naturalPeriodEnd(asOf, period) {
  if (period === "today") return asOf;
  if (period === "weekly") return addDays(startOfWeek(asOf, 1), 6);
  if (period === "monthly") return endOfMonth(asOf);
  return `${asOf.slice(0, 4)}-12-31`;
}

function completedClassCount(rows, range) {
  return new Set(
    rows
      .filter((row) => row.classStatus === "Completed" && inRange(row.classDate, range))
      .map((row) =>
        classWorkspaceSessionKey({
          ...row,
          groupId: row.groupId || "",
          studentId: row.groupId ? "" : row.studentId || "",
        }),
      ),
  ).size;
}

function projectedRevenue(state, asOf, period, generated) {
  const end = naturalPeriodEnd(asOf, period);
  if (end <= asOf) return { value: generated, upcomingClasses: 0 };

  const occurrences = generateScheduledOccurrences(state, addDays(asOf, 1), end).filter(
    (occurrence) => occurrence.status !== "Cancelled" && !occurrence.recorded,
  );
  const upcomingValue = sum(occurrences, (occurrence) => {
    const hours = finite(occurrence.durationHours)
      ? occurrence.durationHours
      : finite(state.settings?.defaultClassHours)
        ? state.settings.defaultClassHours
        : 0;
    return sum(rosterForClassSession(state, occurrence), (student) => {
      const rate = resolveHourlyRate(state, student, occurrence.groupId);
      return finite(rate) ? hours * rate : 0;
    });
  });

  return { value: generated + upcomingValue, upcomingClasses: occurrences.length };
}

function revenueByGroup(rows, range, groupsById, studentsById) {
  const aggregates = new Map();
  for (const row of rows) {
    if (!inRange(row.classDate, range) || !finite(row.charge) || row.charge <= 0) continue;
    const groupId = row.groupId || "";
    const id = groupId ? `group:${groupId}` : "individual";
    const current = aggregates.get(id) || {
      id,
      name: groupId
        ? groupsById.get(groupId)?.name || row.groupName || "Group"
        : studentsById.get(row.studentId)?.fullName || row.studentName || "Individual classes",
      value: 0,
      sessionKeys: new Set(),
    };
    current.value += row.charge;
    current.sessionKeys.add(
      classWorkspaceSessionKey({ ...row, groupId, studentId: groupId ? "" : row.studentId || "" }),
    );
    aggregates.set(id, current);
  }

  return [...aggregates.values()]
    .map(({ sessionKeys, ...item }) => ({ ...item, classCount: sessionKeys.size }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));
}

function todaySessions(state, derived, asOf) {
  const activeStudents = new Map((derived.groups || []).map((group) => [group.id, group.activeStudents || 0]));
  const scheduled = (derived.upcomingClasses || []).filter((item) => item.classDate === asOf);
  const logged = (derived.classLog || []).filter((item) => item.classDate === asOf);
  const sessions = new Map();

  for (const occurrence of scheduled) {
    const workspaceKey = classWorkspaceSessionKey(occurrence);
    sessions.set(workspaceKey, {
      id: occurrence.id,
      workspaceKey,
      groupId: occurrence.groupId,
      studentId: occurrence.studentId || "",
      title: occurrence.groupName || occurrence.studentName || "Class",
      startTime: occurrence.startTime,
      expected: occurrence.groupId ? activeStudents.get(occurrence.groupId) || 0 : 1,
      attended: 0,
      records: 0,
      status: occurrence.status === "Cancelled" ? "Cancelled" : occurrence.recorded ? "Completed" : "Confirmed",
    });
  }

  for (const row of logged) {
    const workspaceKey = classWorkspaceSessionKey({
      ...row,
      studentId: row.groupId ? "" : row.studentId,
    });
    const existing = sessions.get(workspaceKey) || {
      id: row.id,
      workspaceKey,
      groupId: row.groupId,
      studentId: row.groupId ? "" : row.studentId,
      title: row.classTitle || row.groupName || row.studentName || "Individual class",
      startTime: row.startTime,
      expected: row.groupId ? activeStudents.get(row.groupId) || 0 : 1,
      attended: 0,
      records: 0,
      status: "Pending",
    };
    existing.records += 1;
    if (row.attendance === "P" || row.attendance === "L") existing.attended += 1;
    if (row.classStatus === "Cancelled") existing.status = "Cancelled";
    else if (row.classStatus === "Completed") existing.status = "Completed";
    else existing.status = "Pending";
    sessions.set(workspaceKey, existing);
  }

  return [...sessions.values()]
    .sort((left, right) => (left.startTime || "99:99").localeCompare(right.startTime || "99:99"))
    .map((session, index, all) => ({
      ...session,
      expected: Math.max(session.expected, session.records),
      isNext: index === all.findIndex((item) => item.status !== "Completed" && item.status !== "Cancelled"),
    }));
}

function academicAlerts(student) {
  return (student.alerts || []).filter((alert) => ["Low grade", "Low attendance", "Missing work"].includes(alert));
}

function topStudents(students) {
  return students
    .filter(
      (student) =>
        student.status === "Active" &&
        !academicAlerts(student).length &&
        (finite(student.gradeAverage) || finite(student.attendance)),
    )
    .sort((left, right) => (right.gradeAverage ?? right.attendance ?? 0) - (left.gradeAverage ?? left.attendance ?? 0))
    .slice(0, 3)
    .map((student) => ({
      ...student,
      highlight:
        student.attendance === 1
          ? "Perfect attendance"
          : finite(student.gradeAverage)
            ? "Strong average"
            : "Consistent progress",
    }));
}

function attentionStudents(students) {
  return students
    .filter((student) => student.status === "Active" && academicAlerts(student).length)
    .sort((left, right) => academicAlerts(right).length - academicAlerts(left).length)
    .slice(0, 3)
    .map((student) => ({
      ...student,
      highlight: academicAlerts(student)[0] || "Needs attention",
    }));
}

export function buildHomeDashboard(state, derived, period = "weekly") {
  const safePeriod = HOME_PERIODS.includes(period) ? period : "weekly";
  const asOf = state.settings.asOfDate;
  const range = rangeFor(asOf, safePeriod);
  const classRows = derived.classLog || [];
  const groupsById = new Map((state.groups || []).map((group) => [group.id, group]));
  const studentsById = new Map((state.students || []).map((student) => [student.id, student]));
  const gradeRows = state.grades || [];
  const attendance = attendanceFor(classRows, range);
  const previousAttendance = attendanceFor(classRows, range, true);
  const grade = gradeFor(gradeRows, range);
  const previousGrade = gradeFor(gradeRows, range, true);
  const generated = generatedFor(classRows, range);
  const previousGenerated = generatedFor(classRows, range, true);
  const projection = projectedRevenue(state, asOf, safePeriod, generated);
  const monthRange = rangeFor(asOf, "monthly");
  const monthlyCollected = collectedFor(state.classLog || [], monthRange);
  const previousMonthlyCollected = collectedFor(state.classLog || [], monthRange, true);
  const sessions = todaySessions(state, derived, asOf);
  const students = derived.students || [];
  const groups = (derived.groups || [])
    .filter((group) => !group.isUnassigned && finite(group.attendance))
    .sort((left, right) => right.attendance - left.attendance)
    .slice(0, 3);
  const attendanceSessions = attendanceSessionsFor(classRows, range, groupsById, studentsById);
  const previousAttendanceSessions = attendanceSessionsFor(classRows, range, groupsById, studentsById, true);

  return {
    period: safePeriod,
    range,
    sessions,
    expectedStudents: sum(sessions, (session) => session.expected),
    pendingSessions: sessions.filter((session) => session.status === "Pending").length,
    attendance,
    attendanceDelta: metricDelta(attendance, previousAttendance),
    attendanceSessions,
    previousAttendanceSessions,
    grade,
    gradeDelta: metricDelta(grade, previousGrade),
    generated,
    generatedDelta: delta(generated, previousGenerated),
    completedClassCount: completedClassCount(classRows, range),
    revenueSeries: revenueSeries(classRows, asOf, safePeriod),
    revenueProjection: projection.value,
    projectedClassCount: projection.upcomingClasses,
    revenueGroups: revenueByGroup(classRows, range, groupsById, studentsById),
    monthlyCollected,
    monthlyCollectedDelta: delta(monthlyCollected, previousMonthlyCollected),
    monthlyProjection: derived.dashboard?.recentProjection || 0,
    monthlyProjectionDelta: delta(derived.dashboard?.recentProjection || 0, previousMonthlyCollected),
    idealRevenue: derived.dashboard?.idealRevenue || 0,
    outstanding: derived.dashboard?.outstandingThroughToday || 0,
    outstandingRecords: classRows.filter((row) => finite(row.outstanding) && row.outstanding > 0).length,
    topStudents: topStudents(students),
    attentionStudents: attentionStudents(students),
    topGroups: groups,
  };
}
