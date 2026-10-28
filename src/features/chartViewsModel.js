import { roundMoney, sumMoney } from "../domain/money.js";
import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek } from "../domain/dates";
import { dayOfWeekForDate, generateScheduledOccurrences, resolveHourlyRate } from "../domain/schedule";
import { coveredByMonthlyFee, deriveMonthlyCharges, periodOf } from "../domain/monthlyBilling";
import { groupBadgeOf } from "../domain/groupBadge";
import { rosterForClassSession } from "./classesWorkspaceModel";
import {
  assignmentsIn,
  debtSummary,
  matchesGroup,
  monthProjection,
  paymentsBetween,
  sessionAttendance,
  sessionsIn,
} from "./homeDashboardModel";
import { inScope } from "./trackingModel";

/*
 * The charts each metric can show in Inicio (card and detail) and in Seguimiento, in the order the view
 * selector lists them: the first one is what a card or a tab opens on. Each builder reads one scope —
 * `{ state, derived, asOf, start, end, group }` — so Inicio's periods and Seguimiento's ranges share them.
 */
export const CHART_VIEWS = Object.freeze({
  attendance: Object.freeze(["calendar", "map", "slots", "trend"]),
  grade: Object.freeze(["assignments", "scatter", "histogram", "boxes", "students", "submissions"]),
  collections: Object.freeze(["pace", "close", "upcoming", "punctuality", "sources"]),
});

/** Views drawn by the original dot and bar plots; the rest are drawn by ChartViews. */
export const PLOT_VIEWS = Object.freeze(["assignments", "pace"]);

const DAY_MS = 86_400_000;
/** Calendars longer than this show one cell per month instead of one per day. */
const DAY_GRID_LIMIT = 42;
export const TREND_WEEKS = 12;
export const TREND_PROJECTION = 4;
export const UPCOMING_DAYS = 14;
export const PUNCTUALITY_PAYMENTS = 4;
export const STUDENT_SPARK_GRADES = 6;
/** Accumulated lines up to this many days go day by day; longer ones by the period's stretches. */
const CLOSE_DAILY_LIMIT = 92;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function daysBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
}

function earlier(left, right) {
  return left < right ? left : right;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Linear-interpolated quantile of an ascending list. */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function pooled(sessions) {
  let present = 0;
  let total = 0;
  const absentIds = [];
  sessions.forEach((session) => {
    const stats = sessionAttendance(session);
    if (!stats) return;
    present += stats.present;
    total += stats.total;
    absentIds.push(...stats.absentIds);
  });
  return { present, total, value: total ? present / total : null, absentIds };
}

function sessionKind(session, asOf) {
  if (sessionAttendance(session)) return "reg";
  if (session.statusLabel === "Pending") return "unreg";
  if (session.statusLabel === "Registered") return "done";
  return session.classDate >= asOf ? "fut" : "unreg";
}

function activeStudents(state, group) {
  return (state.students || []).filter((student) => student.status !== "Inactive" && inScope(student, group));
}

/** The date a range's figures stop at: its last day, or today when it runs into the future. */
function throughOf(scope) {
  return earlier(scope.end, scope.asOf);
}

/* ---------- Asistencia ---------- */

/**
 * Attendance of each day of the range in a Monday-first calendar (one cell per month past six weeks),
 * plus the average of each weekday column when the range spans at least two weeks.
 */
export function attendanceCalendar(scope) {
  const { state, asOf, group = "all" } = scope;
  // A calendar always shows at least the whole week of its range (Inicio's «Hoy» is one day).
  const short = daysBetween(scope.start, scope.end) < 6;
  const start = short ? startOfWeek(scope.start, 1) : scope.start;
  const end = short ? addDays(start, 6) : scope.end;
  const sessions = sessionsIn(state, start, end, asOf, group);
  if (daysBetween(start, end) > DAY_GRID_LIMIT) {
    const months = [];
    for (let month = startOfMonth(start); month <= end; month = addMonths(month, 1)) {
      const monthEnd = endOfMonth(month);
      const own = sessions.filter((session) => session.classDate >= month && session.classDate <= monthEnd);
      const stats = pooled(own.filter((session) => session.classDate <= asOf));
      months.push({
        key: month,
        date: month,
        layout: "month",
        sessions: own,
        ...stats,
        state: stats.total ? "reg" : month > asOf ? "fut" : "none",
      });
    }
    return { layout: "months", weeks: [], weekdays: [], cells: months, worst: null };
  }
  const byDate = new Map();
  sessions.forEach((session) => byDate.set(session.classDate, [...(byDate.get(session.classDate) || []), session]));
  const cellOf = (date) => {
    const own = byDate.get(date) || [];
    const stats = pooled(own);
    const kinds = own.map((session) => sessionKind(session, asOf));
    const state = stats.total ? "reg" : kinds.includes("unreg") ? "unreg" : kinds.includes("fut") ? "fut" : "none";
    return { key: date, date, layout: "day", sessions: own, ...stats, state, today: date === asOf };
  };
  const weeks = [];
  for (let monday = startOfWeek(start, 1); monday <= end; monday = addDays(monday, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(monday, index);
        return date >= start && date <= end ? cellOf(date) : null;
      }),
    );
  }
  const cells = weeks.flat().filter(Boolean);
  const weekdays =
    weeks.length >= 2
      ? Array.from({ length: 7 }, (_, index) => {
          const column = weeks.map((week) => week[index]).filter((cell) => cell?.total);
          const present = column.reduce((sum, cell) => sum + cell.present, 0);
          const total = column.reduce((sum, cell) => sum + cell.total, 0);
          return { index, days: column.length, value: total ? present / total : null };
        })
      : [];
  const measured = weekdays.filter((day) => day.value !== null && day.days >= 2);
  const worst = measured.length >= 2 ? measured.reduce((low, day) => (day.value < low.value ? day : low)) : null;
  return { layout: "days", weeks, weekdays, cells, worst };
}

/** Each student's own recorded classes of the range, in order, lowest attendance first. */
export function attendanceMap(scope) {
  const { state, derived, start, group = "all" } = scope;
  const through = throughOf(scope);
  const derivedRows = derived?.classLog || [];
  const rows = activeStudents(state, group)
    .map((student) => {
      const records = derivedRows
        .filter(
          (row) =>
            row.studentId === student.id &&
            row.classStatus === "Completed" &&
            row.classDate >= start &&
            row.classDate <= through &&
            ["P", "L", "A"].includes(row.attendance) &&
            matchesGroup(group, row.groupId || ""),
        )
        .sort((left, right) =>
          `${left.classDate}${left.startTime}`.localeCompare(`${right.classDate}${right.startTime}`),
        );
      const codes = records.map((row) => (row.attendance === "A" ? "A" : "P"));
      const cells = records.map((row, index) => ({
        key: row.id || `${row.classDate}-${index}`,
        date: row.classDate,
        startTime: row.startTime || "",
        groupId: row.groupId || "",
        code: codes[index],
        streak: codes[index] === "A" && (codes[index - 1] === "A" || codes[index + 1] === "A"),
      }));
      let trailing = 0;
      for (let index = codes.length - 1; index >= 0 && codes[index] === "A"; index -= 1) trailing += 1;
      const absences = codes.filter((code) => code === "A").length;
      return {
        key: student.id,
        student,
        cells,
        classes: cells.length,
        absences,
        trailing,
        attendance: cells.length ? (cells.length - absences) / cells.length : null,
      };
    })
    .filter((row) => row.classes)
    .sort(
      (left, right) =>
        left.attendance - right.attendance ||
        right.trailing - left.trailing ||
        String(left.student.fullName).localeCompare(String(right.student.fullName)),
    );
  return { rows };
}

/** Recorded classes grouped by recurring slot (who, weekday and hour), weakest slot first. */
export function attendanceSlots(scope) {
  const { state, asOf, start, group = "all" } = scope;
  const through = throughOf(scope);
  const bySlot = new Map();
  sessionsIn(state, start, through, asOf, group).forEach((session) => {
    const stats = sessionAttendance(session);
    if (!stats) return;
    const weekday = dayOfWeekForDate(session.classDate);
    const owner = session.groupId || `i:${session.studentId}`;
    const key = `${owner}|${weekday}|${session.startTime}`;
    const slot = bySlot.get(key) || {
      key,
      weekday,
      startTime: session.startTime,
      groupId: session.groupId || "",
      studentId: session.studentId || "",
      title: session.title,
      sessions: [],
    };
    slot.sessions.push({ key: session.key, date: session.classDate, value: stats.ratio, ...stats });
    bySlot.set(key, slot);
  });
  const slots = [...bySlot.values()].map((slot) => {
    const ordered = [...slot.sessions].sort((left, right) => left.date.localeCompare(right.date));
    const stats = pooled([]);
    ordered.forEach((item) => {
      stats.present += item.present;
      stats.total += item.total;
      stats.absentIds.push(...item.absentIds);
    });
    const absences = new Map();
    stats.absentIds.forEach((id) => absences.set(id, (absences.get(id) || 0) + 1));
    return {
      ...slot,
      sessions: ordered,
      present: stats.present,
      total: stats.total,
      average: stats.total ? stats.present / stats.total : null,
      delta: ordered.length >= 2 ? ordered.at(-1).value - ordered[0].value : null,
      absences: [...absences.entries()]
        .map(([studentId, count]) => ({ studentId, count }))
        .sort((left, right) => right.count - left.count),
    };
  });
  slots.sort(
    (left, right) =>
      left.average - right.average || left.weekday - right.weekday || left.startTime.localeCompare(right.startTime),
  );
  return { slots };
}

/**
 * Weekly attendance of the last twelve weeks, a four-week rolling average and, with enough weeks, where
 * that average is heading in the next four weeks (a band that widens with each week).
 */
export function attendanceTrend(scope) {
  const { state, asOf, group = "all", threshold = 0.8 } = scope;
  const lastMonday = startOfWeek(asOf, 1);
  const weeks = Array.from({ length: TREND_WEEKS }, (_, index) => {
    const start = addDays(lastMonday, (index - TREND_WEEKS + 1) * 7);
    const end = earlier(addDays(start, 6), asOf);
    return { key: start, start, end, ...pooled(sessionsIn(state, start, end, asOf, group)) };
  });
  const average = weeks.map((_, index) => {
    const window = weeks.slice(Math.max(0, index - 3), index + 1);
    const present = window.reduce((sum, week) => sum + week.present, 0);
    const total = window.reduce((sum, week) => sum + week.total, 0);
    return total && weeks[index].total ? present / total : null;
  });
  const measured = weeks.filter((week) => week.value !== null);
  const recent = average
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value !== null)
    .slice(-6);
  let projection = null;
  if (measured.length >= 4 && recent.length >= 3) {
    const xs = recent.map((item) => item.index);
    const ys = recent.map((item) => item.value);
    const mx = mean(xs);
    const my = mean(ys);
    const slope =
      xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0) /
      (xs.reduce((sum, x) => sum + (x - mx) ** 2, 0) || 1);
    const values = measured.slice(-8).map((week) => week.value);
    const center = mean(values);
    const sigma = Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
    const from = recent.at(-1).value;
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const steps = Array.from({ length: TREND_PROJECTION }, (_, index) => index + 1);
    projection = {
      from,
      center: steps.map((step) => clamp(from + slope * step)),
      low: steps.map((step) => clamp(from + slope * step - Math.min(0.25, Math.max(0.02, sigma) * Math.sqrt(step)))),
      high: steps.map((step) => clamp(from + slope * step + Math.min(0.25, Math.max(0.02, sigma) * Math.sqrt(step)))),
    };
  }
  const current = recent.at(-1)?.value ?? null;
  const first = average.find((value) => value !== null) ?? null;
  const crossing =
    projection && current !== null && current >= threshold
      ? projection.center.findIndex((value) => value < threshold) + 1 || null
      : null;
  let below = 0;
  for (let index = average.length - 1; index >= 0 && average[index] !== null && average[index] < threshold; index -= 1)
    below += 1;
  return { weeks, average, projection, current, first, crossing, below };
}

/* ---------- Calificación ---------- */

/** Students with both an attendance and an average in the range, placed by zone. */
export function gradeScatter({ rows = [], threshold }) {
  const points = rows
    .filter((row) => row.attendance !== null && row.average !== null)
    .map((row) => {
      const lowAttendance = row.attendance < threshold.attendance;
      const lowGrade = row.average < threshold.grade;
      return {
        key: row.student.id,
        student: row.student,
        attendance: row.attendance,
        average: row.average,
        zone: lowAttendance && lowGrade ? "risk" : lowAttendance || lowGrade ? "watch" : "ok",
      };
    })
    .sort((left, right) => left.attendance - right.attendance || left.average - right.average);
  return { points };
}

/** Every grade of the range in half-point bins, with the mean and the median. */
export function gradeHistogram({ assignments = [], threshold }) {
  const grades = assignments.flatMap((item) =>
    item.grades.map((grade) => ({
      studentId: grade.studentId,
      value: Math.max(0, Math.min(10, grade.value)),
      assessment: item.assessment,
      date: item.date,
    })),
  );
  if (!grades.length) return { bins: [], grades, mean: null, median: null, low: 0 };
  const sorted = grades.map((grade) => grade.value).sort((left, right) => left - right);
  const from = Math.max(0, Math.min(4, Math.floor(sorted[0])));
  const bins = [];
  for (let low = from; low < 10; low += 0.5) {
    const high = low + 0.5;
    const items = grades.filter((grade) => grade.value >= low && (high >= 10 ? grade.value <= 10 : grade.value < high));
    bins.push({ key: String(low), low, high, items, count: items.length, isLow: low < threshold.grade });
  }
  return {
    bins,
    grades,
    from,
    mean: mean(sorted),
    median: quantile(sorted, 0.5),
    low: grades.filter((grade) => grade.value < threshold.grade).length,
  };
}

/** Spread of each group's grades: lowest, middle half, median and highest, plus the outliers. */
export function gradeBoxes({ state, assignments = [] }) {
  const groupsById = new Map((state.groups || []).map((group) => [group.id, group]));
  const byGroup = new Map();
  assignments.forEach((item) =>
    item.grades.forEach((grade) => {
      const list = byGroup.get(item.groupId) || [];
      list.push({ studentId: grade.studentId, value: grade.value, assessment: item.assessment });
      byGroup.set(item.groupId, list);
    }),
  );
  const boxes = [...byGroup.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([groupId, list]) => {
      const sorted = list.map((item) => item.value).sort((left, right) => left - right);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const fence = (q3 - q1) * 1.5;
      const inside = sorted.filter((value) => value >= q1 - fence && value <= q3 + fence);
      const byStudent = new Map();
      list.forEach((item) => byStudent.set(item.studentId, [...(byStudent.get(item.studentId) || []), item.value]));
      return {
        key: groupId || "individual",
        groupId,
        colorId: groupId ? groupBadgeOf(groupsById.get(groupId)).colorId : "kraft",
        count: list.length,
        min: inside[0],
        q1,
        median: quantile(sorted, 0.5),
        q3,
        max: inside.at(-1),
        outliers: list.filter((item) => item.value < q1 - fence || item.value > q3 + fence),
        students: [...byStudent.entries()]
          .map(([studentId, values]) => ({ studentId, average: mean(values), count: values.length }))
          .sort((left, right) => left.average - right.average),
      };
    })
    .sort((left, right) => left.median - right.median);
  return { boxes };
}

/** Each student's last grades up to today, the ones going down first. */
export function gradeSparks(scope) {
  const { state, asOf, group = "all" } = scope;
  const active = new Map(activeStudents(state, group).map((student) => [student.id, student]));
  const byStudent = new Map();
  assignmentsIn(state, "0000-01-01", asOf, group).forEach((item) =>
    item.grades.forEach((grade) => {
      if (!active.has(grade.studentId)) return;
      byStudent.set(grade.studentId, [
        ...(byStudent.get(grade.studentId) || []),
        { value: grade.value, assessment: item.assessment, date: item.date },
      ]);
    }),
  );
  const students = [...byStudent.entries()]
    .map(([studentId, list]) => {
      const grades = list.slice(-STUDENT_SPARK_GRADES);
      const split = Math.floor(grades.length / 2);
      const delta =
        grades.length >= 2
          ? mean(grades.slice(split).map((item) => item.value)) - mean(grades.slice(0, split).map((item) => item.value))
          : 0;
      return {
        key: studentId,
        student: active.get(studentId),
        grades,
        last: grades.at(-1).value,
        delta,
        trend: delta <= -0.6 ? "down" : delta >= 0.6 ? "up" : "flat",
      };
    })
    .filter((item) => item.grades.length >= 2)
    .sort(
      (left, right) =>
        left.delta - right.delta || String(left.student.fullName).localeCompare(String(right.student.fullName)),
    );
  return { students };
}

function gradeOwnerGroup(grade) {
  const owner = String(grade.classSessionKey || "").split("|")[1] || "";
  return owner.startsWith("g:") ? owner.slice(2) : "";
}

const SUBMISSION_ORDER = { graded: 0, excused: 1, ungraded: 2, missing: 3 };

/** Each assignment of the range with every student's submission: graded, waiting, not handed in or excused. */
export function gradeSubmissions(scope) {
  const { state, start, group = "all" } = scope;
  const through = throughOf(scope);
  const byKey = new Map();
  (state.grades || []).forEach((grade) => {
    if (!grade.date || grade.date < start || grade.date > through) return;
    const groupId = gradeOwnerGroup(grade);
    if (!matchesGroup(group, groupId)) return;
    const key = `${grade.classSessionKey || grade.date}|${grade.assessment}`;
    const entry = byKey.get(key) || { key, assessment: grade.assessment, date: grade.date, groupId, cells: [] };
    const scored = finite(grade.score) && finite(grade.maxScore) && grade.maxScore > 0;
    const status = scored
      ? "graded"
      : grade.workStatus === "Missing"
        ? "missing"
        : grade.workStatus === "Excused"
          ? "excused"
          : "ungraded";
    entry.cells.push({
      key: `${key}|${grade.studentId}`,
      studentId: grade.studentId,
      status,
      value: scored ? (grade.score / grade.maxScore) * 10 : null,
    });
    byKey.set(key, entry);
  });
  const rows = [...byKey.values()]
    .map((entry) => {
      const cells = [...entry.cells].sort(
        (left, right) => SUBMISSION_ORDER[left.status] - SUBMISSION_ORDER[right.status],
      );
      const count = (status) => cells.filter((cell) => cell.status === status).length;
      return {
        ...entry,
        cells,
        graded: count("graded"),
        ungraded: count("ungraded"),
        missing: count("missing"),
        excused: count("excused"),
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date) || left.assessment.localeCompare(right.assessment));
  const total = (field) => rows.reduce((sum, row) => sum + row[field], 0);
  return {
    rows,
    graded: total("graded"),
    ungraded: total("ungraded"),
    missing: total("missing"),
    excused: total("excused"),
  };
}

/* ---------- Cobros ---------- */

/**
 * The money accumulated day by day (stretch by stretch past three months), the same stretch of the
 * previous period for comparison and, for the current month with every group, where the month will
 * probably close: nothing more paid (low), the projection (probable) and the projection plus older debts
 * collected (high).
 */
export function collectionsClose(scope) {
  const { state, derived, asOf, start, end, group = "all", points = [], previousStart = "", previousEnd = "" } = scope;
  const derivedRows = derived?.classLog || [];
  const steps =
    daysBetween(start, end) <= CLOSE_DAILY_LIMIT
      ? Array.from({ length: daysBetween(start, end) + 1 }, (_, index) => {
          const date = addDays(start, index);
          return { key: date, start: date, end: date, kind: "day", future: date > asOf };
        })
      : points.map((point) => ({
          key: point.key,
          start: point.start,
          end: point.end,
          kind: point.kind,
          future: point.future,
        }));
  const payments = paymentsBetween(state, derivedRows, start, earlier(end, asOf), group);
  let running = 0;
  const series = steps.map((step) => {
    const value = step.future
      ? 0
      : sumMoney(
          payments.filter((item) => item.date >= step.start && item.date <= step.end),
          (item) => item.amount,
        );
    running = roundMoney(running + value);
    return { ...step, value, sum: running };
  });
  const lastReal = series.reduce((found, step, index) => (!step.future ? index : found), -1);
  let previous = null;
  if (previousStart) {
    const reachOf = (step) => {
      const reach = addDays(previousStart, daysBetween(start, step.end));
      return previousEnd && reach > previousEnd ? previousEnd : reach;
    };
    const before = paymentsBetween(state, derivedRows, previousStart, reachOf(series.at(-1)), group);
    previous = series.map((step) => {
      const limit = reachOf(step);
      return sumMoney(
        before.filter((item) => item.date <= limit),
        (item) => item.amount,
      );
    });
  }
  const previousTotal = previousStart && previousEnd && previous ? previous.at(-1) : null;
  let projection = null;
  if (scope.monthly && group === "all") {
    const forecast = monthProjection(state, derivedRows, asOf);
    const debts = debtSummary(state, derivedRows, asOf);
    projection = {
      low: forecast.collected,
      probable: forecast.projected,
      high: roundMoney(forecast.projected + debts.overdueEarlier),
      monthlyDue: forecast.monthlyDue,
      perClass: forecast.perClass,
      earlierDebts: debts.overdueEarlier,
    };
  }
  const sums = series.map((step) => step.sum);
  return { series, sums, lastReal, previous, previousTotal, projection, collected: lastReal >= 0 ? sums[lastReal] : 0 };
}

/** What should come in each of the next two weeks' days: monthly fees that fall due and classes at their rate. */
export function collectionsUpcoming(scope) {
  const { state, asOf, group = "all" } = scope;
  const start = addDays(asOf, 1);
  const end = addDays(asOf, UPCOMING_DAYS);
  const days = Array.from({ length: UPCOMING_DAYS }, (_, index) => {
    const date = addDays(start, index);
    return { key: date, date, monthly: 0, classes: 0, total: 0, items: [] };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  const add = (date, item) => {
    const day = byDate.get(date);
    if (!day || !(item.amount > 0)) return;
    day.items.push(item);
    day[item.kind === "monthly" ? "monthly" : "classes"] = roundMoney(
      day[item.kind === "monthly" ? "monthly" : "classes"] + item.amount,
    );
    day.total = roundMoney(day.monthly + day.classes);
  };
  deriveMonthlyCharges(state, asOf, { through: periodOf(end), includeArchived: false })
    .filter(
      (charge) =>
        charge.status === "pending" &&
        charge.dueDate >= start &&
        charge.dueDate <= end &&
        matchesGroup(group, charge.groupId),
    )
    .forEach((charge) =>
      add(charge.dueDate, {
        key: `m-${charge.id || `${charge.studentId}-${charge.period}`}`,
        kind: "monthly",
        studentId: charge.studentId,
        groupId: charge.groupId,
        amount: charge.amount,
        period: charge.period,
      }),
    );
  generateScheduledOccurrences(state, start, end)
    .filter(
      (occurrence) =>
        occurrence.status !== "Cancelled" && !occurrence.recorded && matchesGroup(group, occurrence.groupId || ""),
    )
    .forEach((occurrence) => {
      const hours = finite(occurrence.durationHours)
        ? occurrence.durationHours
        : Number(state.settings?.defaultClassHours) || 0;
      rosterForClassSession(state, occurrence).forEach((student) => {
        if (occurrence.groupId && coveredByMonthlyFee(state, student.id, occurrence.groupId, occurrence.classDate))
          return;
        const rate = resolveHourlyRate(state, student, occurrence.groupId);
        if (!finite(rate)) return;
        add(occurrence.classDate, {
          key: `c-${occurrence.classDate}-${occurrence.startTime}-${student.id}`,
          kind: "class",
          studentId: student.id,
          groupId: occurrence.groupId || "",
          amount: roundMoney(hours * rate),
          startTime: occurrence.startTime,
        });
      });
    });
  const total = sumMoney(days, (day) => day.total);
  const peak = days.reduce((best, day, index) => (day.total > (days[best]?.total ?? 0) ? index : best), -1);
  return {
    days,
    total,
    monthly: sumMoney(days, (day) => day.monthly),
    classes: sumMoney(days, (day) => day.classes),
    peak: peak >= 0 && days[peak].total > 0 ? peak : -1,
  };
}

/** How many days before (negative) or after each due date the student paid their last payments. */
export function paymentPunctuality(scope) {
  const { state, derived, asOf, group = "all" } = scope;
  const derivedRows = derived?.classLog || [];
  const byStudent = new Map();
  const add = (studentId, item) => byStudent.set(studentId, [...(byStudent.get(studentId) || []), item]);
  derivedRows
    .filter(
      (row) =>
        row.paymentDate &&
        row.classDate &&
        row.paymentDate <= asOf &&
        finite(row.amountPaid) &&
        row.amountPaid > 0 &&
        matchesGroup(group, row.groupId || ""),
    )
    .forEach((row) =>
      add(row.studentId, {
        key: `c-${row.id}`,
        kind: "class",
        due: row.classDate,
        paid: row.paymentDate,
        groupId: row.groupId || "",
        days: daysBetween(row.classDate, row.paymentDate),
      }),
    );
  deriveMonthlyCharges(state, asOf, { includeArchived: false })
    .filter(
      (charge) =>
        charge.status === "paid" && charge.paidAt && charge.paidAt <= asOf && matchesGroup(group, charge.groupId),
    )
    .forEach((charge) =>
      add(charge.studentId, {
        key: `m-${charge.id || `${charge.studentId}-${charge.period}`}`,
        kind: "monthly",
        due: charge.dueDate,
        paid: charge.paidAt,
        groupId: charge.groupId,
        period: charge.period,
        days: daysBetween(charge.dueDate, charge.paidAt),
      }),
    );
  const rows = activeStudents(state, group)
    .filter((student) => byStudent.has(student.id))
    .map((student) => {
      const payments = byStudent
        .get(student.id)
        .sort((left, right) => right.paid.localeCompare(left.paid) || right.due.localeCompare(left.due))
        .slice(0, PUNCTUALITY_PAYMENTS);
      const days = payments.map((item) => item.days);
      return {
        key: student.id,
        student,
        payments,
        average: Math.round(mean(days)),
        min: Math.min(...days),
        max: Math.max(...days),
      };
    })
    .sort(
      (left, right) =>
        right.average - left.average || String(left.student.fullName).localeCompare(String(right.student.fullName)),
    );
  return {
    rows,
    onTime: rows.filter((row) => row.average <= 0).length,
    late: rows.filter((row) => row.average > 7),
  };
}

/** Where the range's money came from: each group's share, the hours it took and what it paid per hour. */
export function collectionsSources(scope) {
  const { state, derived, asOf, start, group = "all" } = scope;
  const through = throughOf(scope);
  const groupsById = new Map((state.groups || []).map((item) => [item.id, item]));
  const payments = paymentsBetween(state, derived?.classLog || [], start, through, group);
  const hours = new Map();
  sessionsIn(state, start, through, asOf, group).forEach((session) => {
    if (!sessionAttendance(session)) return;
    const key = session.groupId || "";
    hours.set(key, (hours.get(key) || 0) + (Number(session.durationHours) || 0));
  });
  const byGroup = new Map();
  payments.forEach((payment) => {
    const key = payment.groupId || "";
    byGroup.set(key, [...(byGroup.get(key) || []), payment]);
  });
  const total = sumMoney(payments, (item) => item.amount);
  const sources = [...byGroup.entries()]
    .map(([groupId, list]) => {
      const amount = sumMoney(list, (item) => item.amount);
      const taught = hours.get(groupId) || 0;
      return {
        key: groupId || "individual",
        groupId,
        colorId: groupId ? groupBadgeOf(groupsById.get(groupId)).colorId : "kraft",
        amount,
        hours: taught,
        rate: taught ? Math.round(amount / taught) : null,
        share: total ? amount / total : 0,
        payments: list,
      };
    })
    .filter((source) => source.amount > 0)
    .sort((left, right) => right.amount - left.amount);
  const rated = sources.filter((source) => source.rate !== null);
  const best = rated.length >= 2 ? rated.reduce((top, source) => (source.rate > top.rate ? source : top)) : null;
  return { sources, total, best };
}

/** One chart view's data for a scope; `null` for the views drawn by the original plots. */
export function buildChartView(view, scope) {
  switch (view) {
    case "calendar":
      return attendanceCalendar(scope);
    case "map":
      return attendanceMap(scope);
    case "slots":
      return attendanceSlots(scope);
    case "trend":
      return attendanceTrend(scope);
    case "scatter":
      return gradeScatter(scope);
    case "histogram":
      return gradeHistogram(scope);
    case "boxes":
      return gradeBoxes(scope);
    case "students":
      return gradeSparks(scope);
    case "submissions":
      return gradeSubmissions(scope);
    case "close":
      return collectionsClose(scope);
    case "upcoming":
      return collectionsUpcoming(scope);
    case "punctuality":
      return paymentPunctuality(scope);
    case "sources":
      return collectionsSources(scope);
    default:
      return null;
  }
}

/** A random view of a metric, for the card that opens Inicio. */
export function randomChartView(metric, random = Math.random) {
  const views = CHART_VIEWS[metric] || [];
  return views[Math.min(views.length - 1, Math.floor(random() * views.length))] || "";
}
