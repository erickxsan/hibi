import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain";
import {
  buildAttentionItems,
  buildMetric,
  buildTodayTimeline,
  collectionBuckets,
  debtSummary,
  debtsThrough,
  defaultPointIndex,
  monthProjection,
  periodRange,
  shortNames,
  studentPeriodRows,
} from "./homeDashboardModel";

const AS_OF = "2026-10-21";

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
        hourlyRate: 100,
        weeklySchedule: [
          { id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "slot-wed", dayOfWeek: 3, startTime: "16:00", durationHours: 2 },
        ],
      },
      {
        id: "g2",
        name: "Calculus",
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
      {
        id: "grade-low",
        date: "2026-10-19",
        studentId: "s1",
        assessment: "Quiz",
        score: 5,
        maxScore: 10,
        classSessionKey: "2026-10-19|g:g1|16:00",
      },
      {
        id: "grade-missing",
        date: "2026-10-19",
        studentId: "s2",
        assessment: "Quiz",
        score: null,
        maxScore: 10,
        classSessionKey: "2026-10-19|g:g1|16:00",
      },
    ],
    classLog: [
      row("r1", "2026-10-12", "s1", "P", 0),
      row("r2", "2026-10-12", "s2", "P", 200),
      row("r3", "2026-10-19", "s1", "P", 200),
      row("r4", "2026-10-19", "s2", "A", 0),
    ],
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

function setup(state = fixture()) {
  return { state, derived: deriveAll(state, AS_OF) };
}

describe("home period ranges", () => {
  it("compares each period with the same stretch of the previous one", () => {
    expect(periodRange(AS_OF, "weekly")).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
      previousStart: "2026-10-12",
      previousEnd: "2026-10-14",
    });
    expect(periodRange(AS_OF, "monthly")).toMatchObject({ start: "2026-10-01", previousEnd: "2026-09-21" });
    expect(periodRange("2026-03-31", "monthly").previousEnd).toBe("2026-02-28");
    expect(periodRange(AS_OF, "today")).toMatchObject({ start: AS_OF, previousStart: "2026-10-14" });
    expect(periodRange(AS_OF, "yearly")).toMatchObject({ start: "2026-01-01", previousEnd: "2025-10-21" });
  });

  it("buckets collections by day, week of the month and month", () => {
    expect(collectionBuckets(AS_OF, "weekly").map((bucket) => bucket.future)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    const weeks = collectionBuckets(AS_OF, "monthly");
    expect(weeks[0]).toMatchObject({ start: "2026-10-01", end: "2026-10-04" });
    expect(weeks.at(-1).end).toBe("2026-10-31");
    expect(collectionBuckets(AS_OF, "yearly")).toHaveLength(12);
    expect(collectionBuckets(AS_OF, "today").at(-1).start).toBe(AS_OF);
  });
});

describe("home metrics", () => {
  it("measures attendance per class with upcoming and unrecorded points", () => {
    const { state, derived } = setup();
    const metric = buildMetric(state, derived, AS_OF, "attendance", "weekly");
    expect(metric.value).toBe(0.5);
    expect(metric.previous).toBe(1);
    expect(metric.delta).toBe(-0.5);
    const kinds = metric.points.map((point) => `${point.date}:${point.kind}`);
    expect(kinds).toContain("2026-10-19:reg");
    expect(kinds).toContain("2026-10-21:fut");
    expect(metric.points.find((point) => point.kind === "reg").absentIds).toEqual(["s2"]);
    expect(defaultPointIndex(metric)).toBe(metric.points.findIndex((point) => point.kind === "reg"));
  });

  it("averages grades on a ten-point scale and counts missing grades", () => {
    const { state, derived } = setup();
    const metric = buildMetric(state, derived, AS_OF, "grade", "weekly");
    expect(metric.value).toBe(5);
    expect(metric.graded).toBe(1);
    expect(metric.ungraded).toBe(1);
    expect(metric.points[0].assignment).toMatchObject({ assessment: "Quiz", low: 5, high: 5, missing: ["s2"] });
  });

  it("counts class payments and paid monthly fees by payment date", () => {
    const state = fixture();
    state.students[2].monthlyPayments = [
      { id: "m1", groupId: "g2", period: "2026-10", amount: 1000, paidAt: "2026-10-20" },
    ];
    const { derived } = setup(state);
    const metric = buildMetric(state, derived, AS_OF, "collections", "weekly");
    expect(metric.value).toBe(1200);
    expect(metric.previous).toBe(200);
    expect(metric.points[1].payments.map((payment) => payment.kind)).toEqual(["monthly"]);
    expect(metric.paymentDays).toBe(2);
    const scoped = buildMetric(state, derived, AS_OF, "collections", "weekly", "g1");
    expect(scoped.value).toBe(200);
  });

  it("compares a month in progress with the same stretch of the previous month", () => {
    const state = fixture();
    state.classLog.push(
      row("sep-early", "2026-09-14", "s1", "P", 200),
      // Paid after 21 Sep: outside «1–21 sep», so it must not inflate the comparison.
      row("sep-late", "2026-09-28", "s2", "P", 500, { appliedCharge: 500 }),
    );
    const { derived } = setup(state);
    const metric = buildMetric(state, derived, AS_OF, "collections", "monthly");
    expect(metric).toMatchObject({ previousStart: "2026-09-01", previousEnd: "2026-09-21" });
    expect(metric.value).toBe(400);
    expect(metric.previous).toBe(200);
    expect(metric.delta).toBe(1);
  });
});

describe("home agenda", () => {
  it("places today's classes on the line and picks the next one", () => {
    const { state, derived } = setup();
    const timeline = buildTodayTimeline(state, derived, AS_OF, "12:30");
    expect(timeline.items.map((item) => [item.session.title, item.state])).toEqual([["Reading", "next"]]);
    expect(timeline.freeMinutes).toBe(210);
    expect(timeline.expected).toBe(2);
    expect(timeline.items[0].notes.find((entry) => entry.student.id === "s1").note.kind).toBe("owes");
    expect(buildTodayTimeline(state, derived, AS_OF, "16:30").live?.key).toBe(timeline.items[0].key);
    expect(buildTodayTimeline(state, derived, AS_OF, "19:00").items[0].state).toBe("pending");
  });

  it("keeps the axis on whole hours at any time of day", () => {
    const { state, derived } = setup();
    for (const nowTime of ["00:15", "06:40", "07:59", "12:30", "20:30", "23:50"]) {
      const timeline = buildTodayTimeline(state, derived, AS_OF, nowTime);
      expect(timeline.dayStart % 60).toBe(0);
      expect(timeline.dayEnd % 60).toBe(0);
      expect(timeline.dayStart).toBe(8 * 60);
      expect(timeline.dayEnd).toBe(20 * 60);
    }
  });

  it("lists what to attend to with where each item leads", () => {
    const { state, derived } = setup();
    const items = buildAttentionItems(state, derived, AS_OF);
    expect(items.map((item) => item.kind)).toEqual([
      "unrecorded",
      "lowAttendance",
      "lowGrade",
      "overdue",
      "monthlyDue",
    ]);
    expect(items[0].action.type).toBe("record");
    expect(items[0].session.classDate).toBe("2026-10-20");
    expect(items[0].count).toBeGreaterThan(1);
    expect(items[1].students.map((student) => student.id)).toEqual(["s2"]);
    expect(items[2]).toMatchObject({ value: 5, assessment: "Quiz" });
    // One «vencido» everywhere: class balances and monthly fees of active students.
    expect(items[3]).toMatchObject({
      amount: 1200,
      owed: 1200,
      overdueThisMonth: 1200,
      overdueEarlier: 0,
      names: ["Ava Kim", "Maya Torres"],
      inactiveAmount: 0,
      action: { type: "metric", metric: "collections", focus: "debts" },
    });
    expect(items[4]).toMatchObject({ overdue: true, count: 1, amount: 1000 });
  });

  it("keeps an item marked as seen hidden until something new causes it", () => {
    const { state, derived } = setup();
    const items = buildAttentionItems(state, derived, AS_OF);
    expect(items.every((item) => item.seenKeys.length && !item.dismissed)).toBe(true);
    const seen = (keys) => ({
      ...state,
      settings: { ...state.settings, dismissedNotes: Object.fromEntries(keys.map((key) => [key, AS_OF])) },
    });
    const allKeys = items.flatMap((item) => item.seenKeys);
    expect(buildAttentionItems(seen(allKeys), derived, AS_OF).every((item) => item.dismissed)).toBe(true);
    // A student who newly owes an overdue class brings the debt alert back.
    const next = seen(allKeys);
    // Lucas paid r2 (12 Oct); leaving it unpaid makes it a new overdue debt.
    const paid = next.classLog.find((item) => item.id === "r2");
    next.classLog = next.classLog.map((item) =>
      item === paid ? { ...item, amountPaid: 0, paymentState: "Pending", paymentDate: null, paymentMethod: "" } : item,
    );
    const again = buildAttentionItems(next, deriveAll(next, AS_OF), AS_OF);
    expect(again.find((item) => item.kind === "overdue").dismissed).toBe(false);
    expect(again.find((item) => item.kind === "lowGrade").dismissed).toBe(true);
  });

  it("asks to take attendance for students saved unmarked instead of counting them as debt", () => {
    const state = fixture();
    // Maya was saved without attendance on 12 Oct, with the old «pending» payment.
    state.classLog = state.classLog.map((item) => (item.id === "r1" ? { ...item, attendance: "" } : item));
    const { derived } = setup(state);
    const items = buildAttentionItems(state, derived, AS_OF);
    const unmarked = items.find((item) => item.kind === "unmarked");
    expect(unmarked).toMatchObject({
      names: ["Maya Torres"],
      count: 1,
      action: { type: "record" },
      seenKeys: ["attention:unmarked:2026-10-12|g:g1|16:00:s1"],
    });
    expect(unmarked.session.classDate).toBe("2026-10-12");
    expect(items.find((item) => item.kind === "overdue")).toMatchObject({ amount: 1000, names: ["Ava Kim"] });
  });

  it("needs at least two classes before flagging low attendance", () => {
    const state = fixture();
    state.classLog = state.classLog.filter((item) => item.id !== "r2");
    const { derived } = setup(state);
    expect(buildAttentionItems(state, derived, AS_OF).some((item) => item.kind === "lowAttendance")).toBe(false);
  });
});

describe("home money", () => {
  it("adds class balances and monthly fees to what is owed", () => {
    const { state, derived } = setup();
    const debts = debtsThrough(state, derived.classLog, AS_OF);
    expect(debts.map((item) => [item.studentId, item.amount, item.overdue])).toEqual([
      ["s3", 1000, 1000],
      ["s1", 200, 200],
    ]);
  });

  it("splits overdue money by month and keeps inactive students apart", () => {
    const state = fixture();
    state.students.push({ id: "s9", code: "S9", fullName: "Old Student", groupIds: ["g1"], status: "Inactive" });
    // Maya: September overdue, 12 Oct overdue, 19 Oct not due yet (a class is overdue after seven days).
    state.classLog = state.classLog.map((item) =>
      item.id === "r3" ? { ...item, amountPaid: 0, paymentDate: null, paymentState: "Pending" } : item,
    );
    state.classLog.push(row("sep-maya", "2026-09-14", "s1", "P", 0), row("sep-old", "2026-09-14", "s9", "P", 0));
    const { derived } = setup(state);
    const maya = debtsThrough(state, derived.classLog, AS_OF).find((item) => item.studentId === "s1");
    expect(maya).toMatchObject({
      amount: 600,
      overdue: 400,
      overdueThisMonth: 200,
      overdueEarlier: 200,
      inactive: false,
    });
    const summary = debtSummary(state, derived.classLog, AS_OF);
    expect(summary).toMatchObject({
      period: "2026-10",
      owed: 1600,
      overdue: 1400,
      overdueThisMonth: 1200,
      overdueEarlier: 200,
      notDue: 200,
    });
    expect(summary.debts.map((item) => item.studentId)).toEqual(["s3", "s1"]);
    expect(summary.overdueStudents.map((item) => item.studentId)).toEqual(["s3", "s1"]);
    expect(summary.inactive).toMatchObject({ owed: 200 });
    expect(summary.inactive.debts.map((item) => item.studentId)).toEqual(["s9"]);
    const alert = buildAttentionItems(state, derived, AS_OF).find((item) => item.kind === "overdue");
    // The inactive student's debt is not in the headline nor in the names.
    expect(alert).toMatchObject({
      amount: 1400,
      owed: 1600,
      overdueThisMonth: 1200,
      overdueEarlier: 200,
      names: ["Ava Kim", "Maya Torres"],
      inactiveAmount: 200,
      inactiveNames: ["Old Student"],
    });
  });

  it("still flags debt when only inactive students owe, without calling it overdue", () => {
    const state = fixture();
    state.students.push({ id: "s9", code: "S9", fullName: "Old Student", groupIds: ["g1"], status: "Inactive" });
    state.groups[1].billing = undefined;
    state.classLog = [...state.classLog.filter((item) => item.id !== "r1"), row("sep-old", "2026-09-14", "s9", "P", 0)];
    const { derived } = setup(state);
    const alert = buildAttentionItems(state, derived, AS_OF).find((item) => item.kind === "overdue");
    expect(alert).toMatchObject({ tone: "pend", amount: 0, inactiveAmount: 200, inactiveNames: ["Old Student"] });
  });

  it("projects the month with unpaid fees and upcoming per-class charges", () => {
    const { state, derived } = setup();
    const projection = monthProjection(state, derived.classLog, AS_OF);
    expect(projection.collected).toBe(400);
    expect(projection.monthlyDue).toBe(1000);
    // Five upcoming Reading classes after today (22–31 Oct: Mon 26, Wed 28) × 2 students × $200.
    expect(projection.perClass).toBe(800);
    expect(projection.projected).toBe(2200);
  });

  it("summarizes each student for the explorer table", () => {
    const { state, derived } = setup();
    const rows = studentPeriodRows(state, derived, AS_OF, "monthly");
    const lucas = rows.find((item) => item.student.id === "s2");
    expect(lucas).toMatchObject({ attendance: 0.5, absences: 1, sequence: ["P", "A"], paid: 200, ungraded: ["Quiz"] });
    expect(lucas.nextClass).toEqual({ date: AS_OF, startTime: "16:00" });
    expect(studentPeriodRows(state, derived, AS_OF, "monthly", "g2").map((item) => item.student.id)).toEqual(["s3"]);
  });

  it("shortens names for sentences", () => {
    expect(shortNames(["Maya Torres", "Lucas Bennett", "Ava Kim", "Ben Ray"], "es-MX")).toBe("Maya, Lucas y Ava +1");
  });
});
