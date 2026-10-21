import { roundMoney, sumMoney } from "../domain/money.js";
import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek } from "../domain/dates";
import { generateScheduledOccurrences, resolveHourlyRate } from "../domain/schedule";
import { coveredByMonthlyFee, deriveMonthlyCharges, monthlyPaymentsBetween, periodOf } from "../domain/monthlyBilling";
import { buildClassWorkspaceSessionsForRange, rosterForClassSession } from "./classesWorkspaceModel";
import { studentClassNote } from "./classesDraftModel";

/*
 * Data for the «Sello sereno» home: today's line, «Para atender» and the three period metrics
 * (attendance, grade, collections) that can be explored point by point.
 */
export const HOME_PERIODS = Object.freeze(["today", "weekly", "monthly", "yearly"]);
export const HOME_METRICS = Object.freeze(["attendance", "grade", "collections"]);
const DAY_START = 8 * 60;
/** A class balance is «Pendiente» for a week after the class and «Vencido» after that. */
export const OVERDUE_AFTER_DAYS = 7;

export function isOverdueClassDebt(classDate, asOf) {
  return Boolean(classDate) && classDate < addDays(asOf, -OVERDUE_AFTER_DAYS);
}
const DAY_END = 20 * 60;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function minutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function studentGroupIds(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}

function activeStudents(state) {
  return (state.students || []).filter((student) => student.status !== "Inactive");
}

function firstName(name) {
  return String(name || "").split(" ")[0];
}

/** Natural range of a period plus the comparable range before it (to the same day). */
export function periodRange(asOf, period) {
  if (period === "today")
    return { start: asOf, end: asOf, previousStart: addDays(asOf, -7), previousEnd: addDays(asOf, -7) };
  if (period === "weekly") {
    const start = startOfWeek(asOf, 1);
    const elapsed = Math.round((Date.parse(asOf) - Date.parse(start)) / 86_400_000);
    return {
      start,
      end: addDays(start, 6),
      previousStart: addDays(start, -7),
      previousEnd: addDays(start, elapsed - 7),
    };
  }
  if (period === "monthly") {
    const start = startOfMonth(asOf);
    const previousStart = addMonths(start, -1);
    const sameDay = addDays(previousStart, Number(asOf.slice(8, 10)) - 1);
    return {
      start,
      end: endOfMonth(start),
      previousStart,
      previousEnd: sameDay > endOfMonth(previousStart) ? endOfMonth(previousStart) : sameDay,
    };
  }
  const year = Number(asOf.slice(0, 4));
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    previousStart: `${year - 1}-01-01`,
    previousEnd: `${year - 1}${asOf.slice(4)}`,
  };
}

export function matchesGroup(filter, groupId) {
  if (!filter || filter === "all") return true;
  if (filter === "individual") return !groupId;
  return groupId === filter;
}

export function sessionAttendance(session) {
  const rows = (session.rows || []).filter(
    (row) => row.classStatus === "Completed" && ["P", "L", "A"].includes(row.attendance),
  );
  if (!rows.length) return null;
  const present = rows.filter((row) => row.attendance !== "A");
  return {
    present: present.length,
    total: rows.length,
    ratio: present.length / rows.length,
    absentIds: rows.filter((row) => row.attendance === "A").map((row) => row.studentId),
  };
}

/** Sessions of a range with what the home needs about each one. */
function sessionsIn(state, start, end, asOf, groupFilter = "all") {
  return buildClassWorkspaceSessionsForRange(state, start, end, asOf).filter(
    (session) => session.statusLabel !== "Cancelled" && matchesGroup(groupFilter, session.groupId),
  );
}

function pointKind(session, asOf) {
  if (sessionAttendance(session)) return "reg";
  if (session.statusLabel === "Pending") return "unreg";
  if (session.statusLabel === "Registered") return "reg";
  return session.classDate >= asOf ? "fut" : "unreg";
}

function aggregateAttendance(sessions) {
  let present = 0;
  let total = 0;
  sessions.forEach((session) => {
    const stats = sessionAttendance(session);
    if (!stats) return;
    present += stats.present;
    total += stats.total;
  });
  return total ? { value: present / total, present, total } : { value: null, present: 0, total: 0 };
}

function gradeSessionGroup(grade) {
  const owner = String(grade.classSessionKey || "").split("|")[1] || "";
  return owner.startsWith("g:") ? owner.slice(2) : "";
}

/** One point per graded assignment: average, range and who is missing a grade (0–10 scale). */
export function assignmentsIn(state, start, end, groupFilter = "all") {
  const byKey = new Map();
  for (const grade of state.grades || []) {
    if (!grade.date || grade.date < start || grade.date > end) continue;
    const groupId = gradeSessionGroup(grade);
    if (!matchesGroup(groupFilter, groupId)) continue;
    const key = `${grade.classSessionKey || grade.date}|${grade.assessment}`;
    const entry = byKey.get(key) || {
      key,
      date: grade.date,
      sessionKey: grade.classSessionKey || "",
      groupId,
      assessment: grade.assessment,
      grades: [],
      missing: [],
    };
    if (finite(grade.score) && finite(grade.maxScore) && grade.maxScore > 0)
      entry.grades.push({ studentId: grade.studentId, value: (grade.score / grade.maxScore) * 10 });
    else if (grade.workStatus !== "Excused") entry.missing.push(grade.studentId);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .filter((entry) => entry.grades.length || entry.missing.length)
    .map((entry) => {
      const values = entry.grades.map((item) => item.value);
      return {
        ...entry,
        average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
        low: values.length ? Math.min(...values) : null,
        high: values.length ? Math.max(...values) : null,
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date) || left.key.localeCompare(right.key));
}

function gradeAverage(assignments) {
  const values = assignments.flatMap((item) => item.grades.map((grade) => grade.value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Class payments and paid monthly fees between two dates, newest last. */
export function paymentsBetween(state, derivedRows, start, end, groupFilter = "all") {
  const classPayments = derivedRows
    .filter(
      (row) =>
        row.paymentDate &&
        row.paymentDate >= start &&
        row.paymentDate <= end &&
        finite(row.amountPaid) &&
        row.amountPaid > 0 &&
        matchesGroup(groupFilter, row.groupId || ""),
    )
    .map((row) => ({
      id: row.id,
      kind: "class",
      studentId: row.studentId,
      groupId: row.groupId || "",
      date: row.paymentDate,
      amount: roundMoney(row.amountPaid),
    }));
  const monthly = monthlyPaymentsBetween(state, start, end)
    .filter((item) => matchesGroup(groupFilter, item.groupId))
    .map((item) => ({
      id: item.id,
      kind: "monthly",
      studentId: item.studentId,
      groupId: item.groupId,
      date: item.paidAt,
      amount: roundMoney(item.amount),
      period: item.period,
    }));
  return [...classPayments, ...monthly].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Buckets for the collections bars: the last seven days for «Hoy» (payments carry a date, not an
 * hour), days of the week, weeks of the month and months of the year.
 */
export function collectionBuckets(asOf, period) {
  const range = periodRange(asOf, period);
  if (period === "today")
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(asOf, index - 6);
      return { start: date, end: date, label: date, kind: "day", future: false };
    });
  if (period === "weekly")
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(range.start, index);
      return { start: date, end: date, label: date, kind: "day", future: date > asOf };
    });
  if (period === "monthly") {
    const buckets = [];
    let cursor = range.start;
    while (cursor <= range.end) {
      const weekEnd = addDays(startOfWeek(cursor, 1), 6);
      const end = weekEnd > range.end ? range.end : weekEnd;
      buckets.push({ start: cursor, end, label: cursor, kind: "week", future: cursor > asOf });
      cursor = addDays(end, 1);
    }
    return buckets;
  }
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(range.start, index);
    return { start, end: endOfMonth(start), label: start, kind: "month", future: start > asOf };
  });
}

function percentDelta(current, previous) {
  if (!finite(current) || !finite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function attendancePoints(state, asOf, period, groupFilter) {
  const range = periodRange(asOf, period);
  if (period === "yearly") {
    return Array.from({ length: 12 }, (_, index) => {
      const start = addMonths(range.start, index);
      if (start > asOf) return { kind: "fut", key: start, date: start, month: true };
      const stats = aggregateAttendance(sessionsIn(state, start, endOfMonth(start), asOf, groupFilter));
      return stats.value === null
        ? { kind: "empty", key: start, date: start, month: true }
        : {
            kind: "reg",
            key: start,
            date: start,
            month: true,
            value: stats.value,
            present: stats.present,
            total: stats.total,
          };
    }).filter((point) => point.kind !== "empty");
  }
  return sessionsIn(state, range.start, range.end, asOf, groupFilter).map((session) => {
    const kind = pointKind(session, asOf);
    const stats = sessionAttendance(session);
    return {
      kind: stats ? "reg" : kind,
      key: session.key,
      date: session.classDate,
      startTime: session.startTime,
      title: session.title,
      groupId: session.groupId || "",
      session,
      value: stats?.ratio ?? null,
      present: stats?.present ?? 0,
      total: stats?.total ?? 0,
      absentIds: stats?.absentIds ?? [],
    };
  });
}

function gradePoints(state, asOf, period, groupFilter) {
  const range = periodRange(asOf, period);
  if (period === "yearly") {
    return Array.from({ length: 12 }, (_, index) => {
      const start = addMonths(range.start, index);
      if (start > asOf) return null;
      const average = gradeAverage(assignmentsIn(state, start, endOfMonth(start), groupFilter));
      return average === null ? null : { kind: "reg", key: start, date: start, month: true, value: average };
    }).filter(Boolean);
  }
  return assignmentsIn(state, range.start, range.end, groupFilter)
    .filter((item) => item.average !== null)
    .map((item) => ({
      kind: "reg",
      key: item.key,
      date: item.date,
      value: item.average,
      assignment: item,
      groupId: item.groupId,
    }));
}

function collectionBars(state, derivedRows, asOf, period, groupFilter) {
  const buckets = collectionBuckets(asOf, period);
  return buckets.map((bucket) => {
    const payments = bucket.future ? [] : paymentsBetween(state, derivedRows, bucket.start, bucket.end, groupFilter);
    return { ...bucket, key: bucket.start, payments, value: sumMoney(payments, (item) => item.amount) };
  });
}

/** Money owed through today: unpaid class balances and monthly fees that are pending or overdue. */
export function debtsThrough(state, derivedRows, asOf, groupFilter = "all") {
  const byStudent = new Map();
  const add = (studentId, amount, overdue, why) => {
    const current = byStudent.get(studentId) || { studentId, amount: 0, overdue: 0, reasons: [] };
    current.amount = roundMoney(current.amount + amount);
    if (overdue) current.overdue = roundMoney(current.overdue + amount);
    current.reasons.push(why);
    byStudent.set(studentId, current);
  };
  derivedRows
    .filter(
      (row) =>
        row.classDate <= asOf &&
        finite(row.outstanding) &&
        row.outstanding > 0 &&
        matchesGroup(groupFilter, row.groupId || ""),
    )
    .forEach((row) =>
      add(row.studentId, row.outstanding, isOverdueClassDebt(row.classDate, asOf), {
        kind: "class",
        date: row.classDate,
        amount: row.outstanding,
      }),
    );
  deriveMonthlyCharges(state, asOf, { includeArchived: false })
    .filter((charge) => ["pending", "overdue"].includes(charge.status) && charge.dueDate <= asOf)
    .filter((charge) => matchesGroup(groupFilter, charge.groupId))
    .forEach((charge) =>
      add(charge.studentId, charge.amount, charge.status === "overdue", {
        kind: "monthly",
        period: charge.period,
        amount: charge.amount,
        groupId: charge.groupId,
      }),
    );
  return [...byStudent.values()].sort((left, right) => right.amount - left.amount);
}

/** Collections expected for the rest of the month: monthly fees still unpaid plus upcoming per-class charges. */
export function monthProjection(state, derivedRows, asOf) {
  const start = startOfMonth(asOf);
  const end = endOfMonth(asOf);
  const collected = sumMoney(paymentsBetween(state, derivedRows, start, asOf), (item) => item.amount);
  const period = periodOf(asOf);
  const monthlyDue = sumMoney(
    deriveMonthlyCharges(state, asOf, { includeArchived: false }).filter(
      (charge) => charge.period === period && ["pending", "overdue"].includes(charge.status),
    ),
    (charge) => charge.amount,
  );
  const upcoming = end > asOf ? generateScheduledOccurrences(state, addDays(asOf, 1), end) : [];
  const perClass = sumMoney(
    upcoming.filter((occurrence) => occurrence.status !== "Cancelled" && !occurrence.recorded),
    (occurrence) => {
      const hours = finite(occurrence.durationHours)
        ? occurrence.durationHours
        : Number(state.settings?.defaultClassHours) || 0;
      return sumMoney(rosterForClassSession(state, occurrence), (student) => {
        if (occurrence.groupId && coveredByMonthlyFee(state, student.id, occurrence.groupId, occurrence.classDate))
          return 0;
        const rate = resolveHourlyRate(state, student, occurrence.groupId);
        return finite(rate) ? roundMoney(hours * rate) : 0;
      });
    },
  );
  return { collected, projected: roundMoney(collected + monthlyDue + perClass), monthlyDue, perClass };
}

/** Value, comparison and points of one metric for the selected period and group scope. */
export function buildMetric(state, derived, asOf, metric, period = "weekly", groupFilter = "all") {
  const derivedRows = derived?.classLog || [];
  const range = periodRange(asOf, period);
  const throughToday = range.end > asOf ? asOf : range.end;
  if (metric === "attendance") {
    const points = attendancePoints(state, asOf, period, groupFilter);
    const current = aggregateAttendance(sessionsIn(state, range.start, throughToday, asOf, groupFilter));
    const previous = aggregateAttendance(sessionsIn(state, range.previousStart, range.previousEnd, asOf, groupFilter));
    return {
      metric,
      period,
      value: current.value,
      previous: previous.value,
      delta: finite(current.value) && finite(previous.value) ? current.value - previous.value : null,
      points,
      registered: points.filter((point) => point.kind === "reg").length,
      upcoming: points.filter((point) => point.kind === "fut").length,
      unregistered: points.filter((point) => point.kind === "unreg").length,
    };
  }
  if (metric === "grade") {
    const points = gradePoints(state, asOf, period, groupFilter);
    const current = gradeAverage(assignmentsIn(state, range.start, throughToday, groupFilter));
    const previous = gradeAverage(assignmentsIn(state, range.previousStart, range.previousEnd, groupFilter));
    const assignments = period === "yearly" ? [] : assignmentsIn(state, range.start, range.end, groupFilter);
    return {
      metric,
      period,
      value: current,
      previous,
      delta: finite(current) && finite(previous) ? current - previous : null,
      points,
      graded: assignments.filter((item) => item.average !== null).length,
      ungraded: assignments.reduce((sum, item) => sum + item.missing.length, 0),
      assignments,
    };
  }
  const bars = collectionBars(state, derivedRows, asOf, period, groupFilter);
  const payments = paymentsBetween(state, derivedRows, range.start, throughToday, groupFilter);
  const value = sumMoney(payments, (item) => item.amount);
  const previous = sumMoney(
    paymentsBetween(state, derivedRows, range.previousStart, range.previousEnd, groupFilter),
    (item) => item.amount,
  );
  return {
    metric,
    period,
    value,
    previous,
    delta: percentDelta(value, previous),
    points: bars,
    payments,
    paymentDays: new Set(payments.map((item) => item.date)).size,
  };
}

export function buildPeriodMetrics(state, derived, asOf, period = "weekly", groupFilter = "all") {
  return Object.fromEntries(
    HOME_METRICS.map((metric) => [metric, buildMetric(state, derived, asOf, metric, period, groupFilter)]),
  );
}

/** Index of the point a card shows first: the last one with data. */
export function defaultPointIndex(metric) {
  const points = metric?.points || [];
  if (metric?.metric === "collections") {
    const lastPaid = points.reduce((found, point, index) => (!point.future && point.value > 0 ? index : found), -1);
    if (lastPaid >= 0) return lastPaid;
    return points.reduce((found, point, index) => (!point.future ? index : found), 0);
  }
  return points.reduce((found, point, index) => (point.kind === "reg" ? index : found), points.length ? 0 : -1);
}

/** Students of the scope with their numbers for the explorer table. */
export function studentPeriodRows(state, derived, asOf, period = "monthly", groupFilter = "all") {
  const range = periodRange(asOf, period);
  const derivedRows = derived?.classLog || [];
  const end = range.end > asOf ? asOf : range.end;
  const debts = new Map(debtsThrough(state, derivedRows, asOf, groupFilter).map((item) => [item.studentId, item]));
  const assignments = assignmentsIn(state, range.start, end, groupFilter);
  const upcoming = buildClassWorkspaceSessionsForRange(state, asOf, addDays(asOf, 30), asOf).filter((session) =>
    ["Scheduled", "Rescheduled"].includes(session.statusLabel),
  );
  return activeStudents(state)
    .filter((student) =>
      groupFilter === "all"
        ? true
        : groupFilter === "individual"
          ? student.isIndividual || !studentGroupIds(student).length
          : studentGroupIds(student).includes(groupFilter),
    )
    .map((student) => {
      const rows = derivedRows
        .filter(
          (row) =>
            row.studentId === student.id &&
            row.classStatus === "Completed" &&
            row.classDate >= range.start &&
            row.classDate <= end &&
            ["P", "L", "A"].includes(row.attendance) &&
            matchesGroup(groupFilter, row.groupId || ""),
        )
        .sort((left, right) => left.classDate.localeCompare(right.classDate));
      const absences = rows.filter((row) => row.attendance === "A").length;
      const grades = assignments.flatMap((item) =>
        item.grades.filter((grade) => grade.studentId === student.id).map((grade) => grade.value),
      );
      const ungraded = assignments.filter((item) => item.missing.includes(student.id)).map((item) => item.assessment);
      const paid = sumMoney(
        paymentsBetween(state, derivedRows, range.start, end, groupFilter).filter(
          (item) => item.studentId === student.id,
        ),
        (item) => item.amount,
      );
      const next = upcoming.find((session) =>
        session.groupId ? studentGroupIds(student).includes(session.groupId) : session.studentId === student.id,
      );
      const debt = debts.get(student.id);
      return {
        student,
        attendance: rows.length ? (rows.length - absences) / rows.length : null,
        attended: rows.length - absences,
        classes: rows.length,
        absences,
        sequence: rows.slice(-5).map((row) => (row.attendance === "A" ? "A" : "P")),
        grades,
        average: grades.length ? grades.reduce((sum, value) => sum + value, 0) / grades.length : null,
        ungraded,
        paid,
        owed: debt?.amount || 0,
        overdue: debt?.overdue || 0,
        nextClass: next ? { date: next.classDate, startTime: next.startTime } : null,
      };
    });
}

/** Status of each class of the day on the timeline. */
function timelineState(session, nowMinutes, nextKey) {
  const start = minutes(session.startTime) ?? 0;
  const end = start + Math.round((Number(session.durationHours) || 0) * 60);
  if (session.statusLabel === "Registered") return "done";
  if (end <= nowMinutes) return "pending";
  if (start <= nowMinutes) return "live";
  return session.key === nextKey ? "next" : "later";
}

/** Today's classes with position on the line, alerts and the notes shown before starting. */
export function buildTodayTimeline(state, derived, asOf, nowTime) {
  const nowMinutes = minutes(nowTime) ?? 0;
  const sessions = sessionsIn(state, asOf, asOf, asOf).filter((session) => session.statusLabel !== "Cancelled");
  const derivedRows = derived?.classLog || [];
  const next = sessions.find(
    (session) => session.statusLabel !== "Registered" && (minutes(session.startTime) ?? 0) > nowMinutes,
  );
  const items = sessions.map((session) => {
    const roster = rosterForClassSession(state, session);
    const notes = roster.map((student) => ({ student, note: studentClassNote(state, student, session, derivedRows) }));
    const start = minutes(session.startTime) ?? 0;
    return {
      session,
      key: session.key,
      start,
      end: start + Math.round((Number(session.durationHours) || 0) * 60),
      state: timelineState(session, nowMinutes, next?.key),
      roster,
      notes,
      alerts: notes.filter((item) => item.note.kind !== "upToDate" && item.note.kind !== "customFee").length,
      attendance: sessionAttendance(session),
    };
  });
  const live = items.find((item) => item.state === "live");
  const earliest = Math.min(DAY_START, ...items.map((item) => Math.floor(item.start / 60) * 60), nowMinutes);
  const latest = Math.max(DAY_END, ...items.map((item) => Math.ceil(item.end / 60) * 60));
  const nextItem = items.find((item) => item.key === next?.key) || null;
  const selected = live || nextItem || items.find((item) => item.state === "pending") || items.at(-1) || null;
  return {
    items,
    now: nowMinutes,
    dayStart: earliest,
    dayEnd: latest,
    live: live || null,
    next: nextItem,
    selectedKey: selected?.key || "",
    expected: items.reduce((sum, item) => sum + item.roster.length, 0),
    freeMinutes: nextItem && !live ? nextItem.start - nowMinutes : 0,
  };
}

/**
 * «Para atender»: unrecorded classes, low attendance this month, a recent low grade, overdue
 * balances and monthly fees due today or overdue. Each item says where it leads.
 */
export function buildAttentionItems(state, derived, asOf) {
  const derivedRows = derived?.classLog || [];
  const items = [];
  const studentsById = new Map((state.students || []).map((student) => [student.id, student]));
  const nameOf = (id) => studentsById.get(id)?.fullName || "";
  const pending = buildClassWorkspaceSessionsForRange(state, addDays(asOf, -30), addDays(asOf, -1), asOf).filter(
    (session) => session.statusLabel === "Pending",
  );
  if (pending.length) {
    const latest = pending.at(-1);
    items.push({
      kind: "unrecorded",
      tone: "pend",
      session: latest,
      count: pending.length,
      action: { type: "record", session: latest },
    });
  }
  const threshold = finite(state.settings?.lowAttendanceThreshold) ? state.settings.lowAttendanceThreshold : 0.8;
  const monthRows = studentPeriodRows(state, derived, asOf, "monthly");
  const lowAttendance = monthRows.filter(
    (row) => row.classes >= 2 && row.attendance !== null && row.attendance < threshold,
  );
  if (lowAttendance.length)
    items.push({
      kind: "lowAttendance",
      tone: "bad",
      students: lowAttendance.map((row) => row.student),
      threshold,
      action: { type: "metric", metric: "attendance" },
    });
  const gradeThreshold = (finite(state.settings?.lowGradeThreshold) ? state.settings.lowGradeThreshold : 0.7) * 10;
  const recentLow = assignmentsIn(state, addDays(asOf, -14), asOf)
    .flatMap((item) => item.grades.filter((grade) => grade.value < gradeThreshold).map((grade) => ({ ...grade, item })))
    .sort((left, right) => right.item.date.localeCompare(left.item.date))[0];
  if (recentLow)
    items.push({
      kind: "lowGrade",
      tone: "bad",
      student: studentsById.get(recentLow.studentId) || null,
      value: recentLow.value,
      assessment: recentLow.item.assessment,
      date: recentLow.item.date,
      action: { type: "metric", metric: "grade" },
    });
  const overdueClasses = derivedRows.filter(
    (row) => isOverdueClassDebt(row.classDate, asOf) && finite(row.outstanding) && row.outstanding > 0,
  );
  if (overdueClasses.length) {
    const ids = [...new Set(overdueClasses.map((row) => row.studentId))];
    items.push({
      kind: "overdue",
      tone: "bad",
      amount: sumMoney(overdueClasses, (row) => row.outstanding),
      names: ids.map(nameOf).filter(Boolean),
      action: { type: "metric", metric: "collections" },
    });
  }
  const dueMonthly = deriveMonthlyCharges(state, asOf, { includeArchived: false }).filter(
    (charge) => (charge.status === "pending" && charge.dueDate === asOf) || charge.status === "overdue",
  );
  const byGroup = new Map();
  dueMonthly.forEach((charge) => byGroup.set(charge.groupId, [...(byGroup.get(charge.groupId) || []), charge]));
  for (const [groupId, charges] of byGroup) {
    const group = (state.groups || []).find((item) => item.id === groupId);
    items.push({
      kind: "monthlyDue",
      tone: charges.some((charge) => charge.status === "overdue") ? "bad" : "pend",
      group,
      overdue: charges.some((charge) => charge.status === "overdue"),
      count: charges.length,
      amount: sumMoney(charges, (charge) => charge.amount),
      names: charges.map((charge) => nameOf(charge.studentId)).filter(Boolean),
      action: { type: "monthly" },
    });
  }
  return items;
}

/** First names joined for short sentences: «Luna, Valeria y Regina». */
export function shortNames(names, locale = "es-MX", limit = 3) {
  const first = names.map(firstName).filter(Boolean);
  const shown = first.slice(0, limit);
  const rest = first.length - shown.length;
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
  return rest > 0 ? `${list} +${rest}` : list;
}
