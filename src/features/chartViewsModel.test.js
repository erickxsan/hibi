import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain";
import {
  attendanceCalendar,
  attendanceMap,
  attendanceSlots,
  attendanceTrend,
  buildChartView,
  CHART_VIEWS,
  collectionsClose,
  collectionsSources,
  collectionsUpcoming,
  gradeBoxes,
  gradeHistogram,
  gradeScatter,
  gradeSparks,
  gradeSubmissions,
  paymentPunctuality,
  randomChartView,
} from "./chartViewsModel";
import { assignmentsIn, buildMetric, studentPeriodRows } from "./homeDashboardModel";

const AS_OF = "2026-10-21";
const threshold = { attendance: 0.8, grade: 7 };

function row(id, classDate, studentId, attendance, amountPaid, extra = {}) {
  return {
    id,
    classDate,
    studentId,
    groupId: "g1",
    startTime: "16:00",
    scheduleSlotId: "slot-mon",
    scheduleOccurrenceDate: classDate,
    classStatus: "Completed",
    attendance,
    hours: 2,
    appliedHourlyRate: 100,
    appliedCharge: attendance === "A" ? 0 : 200,
    amountPaid,
    paymentState: attendance === "A" ? "" : amountPaid ? "Paid" : "Pending",
    paymentDate: amountPaid ? classDate : null,
    paymentMethod: amountPaid ? "Cash" : "",
    ...extra,
  };
}

function grade(id, date, studentId, score, extra = {}) {
  return {
    id,
    date,
    studentId,
    assessment: "Quiz",
    score,
    maxScore: 10,
    classSessionKey: `${date}|g:g1|16:00`,
    ...extra,
  };
}

function fixture() {
  return {
    version: 1,
    settings: {
      asOfDate: AS_OF,
      hourlyRate: 100,
      defaultClassHours: 2,
      lowAttendanceThreshold: 0.8,
      lowGradeThreshold: 0.7,
      currency: "MXN",
    },
    groups: [
      {
        id: "g1",
        name: "Reading",
        colorId: "indigo",
        hourlyRate: 100,
        weeklySchedule: [
          { id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "slot-wed", dayOfWeek: 3, startTime: "16:00", durationHours: 2 },
        ],
      },
      {
        id: "g2",
        name: "Calculus",
        colorId: "ocre",
        hourlyRate: 100,
        weeklySchedule: [{ id: "slot-tue", dayOfWeek: 2, startTime: "17:00", durationHours: 1 }],
        billing: { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
      },
    ],
    students: [
      { id: "s1", code: "S1", fullName: "Maya Torres", groupIds: ["g1"], status: "Active" },
      { id: "s2", code: "S2", fullName: "Lucas Bennett", groupIds: ["g1"], status: "Active" },
      { id: "s3", code: "S3", fullName: "Ava Kim", groupIds: ["g2"], status: "Active" },
    ],
    grades: [
      grade("q1-s1", "2026-10-12", "s1", 9),
      grade("q1-s2", "2026-10-12", "s2", 8),
      grade("q2-s1", "2026-10-19", "s1", 5, { assessment: "Essay" }),
      grade("q2-s2", "2026-10-19", "s2", null, { assessment: "Essay", workStatus: "Missing" }),
    ],
    classLog: [
      row("r1", "2026-10-05", "s1", "P", 200),
      row("r2", "2026-10-05", "s2", "P", 200),
      row("r3", "2026-10-12", "s1", "P", 200, { paymentDate: "2026-10-15" }),
      row("r4", "2026-10-12", "s2", "A", 0),
      row("r5", "2026-10-19", "s1", "P", 200),
      row("r6", "2026-10-19", "s2", "A", 0),
    ],
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

function scope(extra = {}) {
  const state = extra.state || fixture();
  return {
    state,
    derived: deriveAll(state, AS_OF),
    asOf: AS_OF,
    start: "2026-10-01",
    end: "2026-10-31",
    group: "all",
    threshold,
    ...extra,
  };
}

describe("chart view catalog", () => {
  it("lists each metric's views with today's chart first where it was kept", () => {
    expect(CHART_VIEWS.attendance[0]).toBe("calendar");
    expect(CHART_VIEWS.grade[0]).toBe("assignments");
    expect(CHART_VIEWS.collections.slice(0, 2)).toEqual(["pace", "close"]);
    expect(randomChartView("grade", () => 0.99)).toBe("submissions");
    expect(randomChartView("attendance", () => 0)).toBe("calendar");
    expect(buildChartView("pace", scope())).toBeNull();
  });
});

describe("attendance views", () => {
  it("lays a month out as Monday-first weeks with weekday averages", () => {
    const calendar = attendanceCalendar(scope());
    expect(calendar.layout).toBe("days");
    expect(calendar.weeks[0].slice(0, 3)).toEqual([null, null, null]);
    const mondays = calendar.weeks.map((week) => week[0]).filter(Boolean);
    expect(mondays.find((cell) => cell.date === "2026-10-12")).toMatchObject({ state: "reg", value: 0.5 });
    expect(calendar.cells.find((cell) => cell.date === AS_OF)).toMatchObject({ today: true });
    expect(calendar.weekdays[0]).toMatchObject({ days: 3, value: 4 / 6 });
  });

  it("switches to one cell per month for long ranges", () => {
    const calendar = attendanceCalendar(scope({ start: "2026-01-01", end: "2026-12-31" }));
    expect(calendar.layout).toBe("months");
    expect(calendar.cells).toHaveLength(12);
    expect(calendar.cells[9]).toMatchObject({ state: "reg", total: 6, present: 4 });
    expect(calendar.cells[11].state).toBe("fut");
  });

  it("shows each student's own classes with absences in a row ringed", () => {
    const { rows } = attendanceMap(scope());
    expect(rows.map((item) => item.student.id)).toEqual(["s2", "s1"]);
    expect(rows[0]).toMatchObject({ classes: 3, absences: 2, trailing: 2 });
    expect(rows[0].cells.map((cell) => `${cell.code}${cell.streak ? "*" : ""}`)).toEqual(["P", "A*", "A*"]);
  });

  it("groups recorded classes by recurring slot, weakest first", () => {
    const { slots } = attendanceSlots(scope());
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ weekday: 1, startTime: "16:00", groupId: "g1", average: 4 / 6 });
    expect(slots[0].delta).toBe(-0.5);
    expect(slots[0].absences[0]).toEqual({ studentId: "s2", count: 2 });
  });

  it("projects the rolling average only with four measured weeks", () => {
    expect(attendanceTrend(scope()).projection).toBeNull();
    const state = fixture();
    state.classLog.push(
      row("o1", "2026-09-28", "s1", "P", 0),
      row("o2", "2026-09-28", "s2", "P", 0),
      row("o3", "2026-09-21", "s1", "P", 0),
      row("o4", "2026-09-21", "s2", "P", 0),
    );
    const trend = attendanceTrend(scope({ state, derived: deriveAll(state, AS_OF) }));
    expect(trend.weeks).toHaveLength(12);
    expect(trend.weeks.at(-1).start).toBe("2026-10-19");
    expect(trend.projection.center).toHaveLength(4);
    expect(trend.projection.low[3]).toBeLessThanOrEqual(trend.projection.center[3]);
    expect(trend.current).toBeLessThan(trend.first);
  });
});

describe("grade views", () => {
  it("places students by attendance and average", () => {
    const base = scope();
    const rows = studentPeriodRows(base.state, base.derived, AS_OF, "monthly");
    const { points } = gradeScatter({ rows, threshold });
    expect(points.map((point) => `${point.student.id}:${point.zone}`)).toEqual(["s2:watch", "s1:ok"]);
  });

  it("bins grades by half points with mean and median", () => {
    const base = scope();
    const histogram = gradeHistogram({ assignments: assignmentsIn(base.state, "2026-10-01", AS_OF), threshold });
    expect(histogram.from).toBe(4);
    expect(histogram.bins.find((bin) => bin.low === 5).count).toBe(1);
    expect(histogram.bins.at(-1)).toMatchObject({ low: 9.5, count: 0 });
    expect(histogram.mean).toBeCloseTo(22 / 3);
    expect(histogram.median).toBe(8);
    expect(histogram.low).toBe(1);
  });

  it("summarizes each group's spread, lowest median first", () => {
    const base = scope();
    const { boxes } = gradeBoxes({ state: base.state, assignments: assignmentsIn(base.state, "2026-10-01", AS_OF) });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ groupId: "g1", colorId: "indigo", count: 3, median: 8, min: 5, max: 9 });
    expect(boxes[0].students[0].studentId).toBe("s1");
  });

  it("follows each student's last grades and the direction they go", () => {
    const { students } = gradeSparks(scope());
    expect(students.map((item) => `${item.student.id}:${item.trend}`)).toEqual(["s1:down"]);
    expect(students[0].last).toBe(5);
  });

  it("marks every submission as graded, waiting, missing or excused", () => {
    const submissions = gradeSubmissions(scope());
    expect(submissions.rows.map((item) => item.assessment)).toEqual(["Essay", "Quiz"]);
    expect(submissions.rows[0]).toMatchObject({ graded: 1, missing: 1, ungraded: 0 });
    expect(submissions.rows[0].cells.map((cell) => cell.status)).toEqual(["graded", "missing"]);
    expect(submissions).toMatchObject({ graded: 3, missing: 1 });
  });
});

describe("collection views", () => {
  it("accumulates the month and compares it with the previous one", () => {
    const state = fixture();
    state.classLog.push(row("sep", "2026-09-07", "s1", "P", 300, { appliedCharge: 300 }));
    const base = scope({ state, derived: deriveAll(state, AS_OF) });
    const metric = buildMetric(state, base.derived, AS_OF, "collections", "monthly");
    const close = collectionsClose({
      ...base,
      points: metric.points,
      previousStart: "2026-09-01",
      previousEnd: "2026-09-30",
      monthly: true,
    });
    expect(close.series).toHaveLength(31);
    expect(close.lastReal).toBe(20);
    expect(close.series[14]).toMatchObject({ start: "2026-10-15", value: 200, sum: 600 });
    expect(close.collected).toBe(800);
    expect(close.sums.at(-1)).toBe(800);
    expect(close.previous.at(-1)).toBe(300);
    expect(close.previousTotal).toBe(300);
    expect(close.projection.low).toBe(800);
    expect(close.projection.high).toBeGreaterThanOrEqual(close.projection.probable);
  });

  it("lists the money due in the next two weeks by day", () => {
    const upcoming = collectionsUpcoming(scope());
    expect(upcoming.days).toHaveLength(14);
    expect(upcoming.days[0].date).toBe("2026-10-22");
    const monday = upcoming.days.find((day) => day.date === "2026-10-26");
    expect(monday.classes).toBe(400);
    expect(upcoming.days.find((day) => day.date === "2026-10-27").classes).toBe(0);
    expect(upcoming.monthly).toBe(0);
    expect(upcoming.peak).toBeGreaterThanOrEqual(0);
  });

  it("counts how many days before or after the due date each student pays", () => {
    const { rows, onTime } = paymentPunctuality(scope());
    expect(rows[0]).toMatchObject({ key: "s1", average: 1, min: 0, max: 3 });
    expect(rows.find((item) => item.key === "s2")).toMatchObject({ average: 0 });
    expect(onTime).toBe(1);
  });

  it("splits the money by group with what each one paid per hour", () => {
    const { sources, total } = collectionsSources(scope());
    expect(total).toBe(800);
    expect(sources[0]).toMatchObject({ groupId: "g1", colorId: "indigo", amount: 800, hours: 6, share: 1 });
    expect(sources[0].rate).toBe(133);
  });
});
