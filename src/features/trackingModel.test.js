import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain";
import {
  inScope,
  monthlyBlocks,
  trackingBuckets,
  trackingKpis,
  trackingMetric,
  trackingRange,
  trackingRecords,
  trackingStudents,
} from "./trackingModel";

const AS_OF = "2026-10-21";

function row(id, classDate, studentId, attendance, amountPaid) {
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
        weeklySchedule: [{ id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 }],
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
      { id: "s4", code: "S4", fullName: "Noa Ruiz", isIndividual: true, status: "Active" },
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

function setup(state = fixture(), period = "month", scope = "all") {
  const derived = deriveAll(state, AS_OF);
  const range = trackingRange(AS_OF, period, state);
  const students = trackingStudents(state, derived, range, scope);
  return { state, derived, range, students, kpis: trackingKpis(state, derived, range, scope, students) };
}

describe("tracking ranges", () => {
  it("ends every period on the report date and compares it with the same stretch before", () => {
    expect(trackingRange(AS_OF, "month")).toEqual({
      period: "month",
      start: "2026-10-01",
      end: AS_OF,
      previousStart: "2026-09-01",
      previousEnd: "2026-09-21",
    });
    expect(trackingRange("2026-03-31", "month").previousEnd).toBe("2026-02-28");
    expect(trackingRange(AS_OF, "week")).toMatchObject({
      start: "2026-10-19",
      previousStart: "2026-10-12",
      previousEnd: "2026-10-14",
    });
    expect(trackingRange(AS_OF, "thirty")).toMatchObject({ start: "2026-09-22", previousEnd: "2026-09-21" });
    expect(trackingRange(AS_OF, "all", fixture())).toMatchObject({ start: "2026-10-12", previousStart: "" });
  });

  it("uses the chosen first day for a custom range and compares it with as many days just before", () => {
    expect(trackingRange("2026-10-15", "custom", null, "2026-10-06")).toEqual({
      period: "custom",
      start: "2026-10-06",
      end: "2026-10-15",
      previousStart: "2026-09-26",
      previousEnd: "2026-10-05",
    });
    expect(trackingRange("2026-10-15", "custom", null, "2026-10-15")).toMatchObject({
      start: "2026-10-15",
      previousStart: "2026-10-14",
      previousEnd: "2026-10-14",
    });
  });

  it("buckets payments by day, week or month depending on the length", () => {
    expect(trackingBuckets(trackingRange(AS_OF, "week")).map((bucket) => bucket.kind)).toEqual(["day", "day", "day"]);
    const weeks = trackingBuckets(trackingRange(AS_OF, "month"));
    expect(weeks.map((bucket) => [bucket.start, bucket.end])).toEqual([
      ["2026-10-01", "2026-10-04"],
      ["2026-10-05", "2026-10-11"],
      ["2026-10-12", "2026-10-18"],
      ["2026-10-19", "2026-10-21"],
    ]);
    const months = trackingBuckets({ start: "2026-05-10", end: AS_OF });
    expect(months).toHaveLength(6);
    expect(months[0]).toMatchObject({ start: "2026-05-10", kind: "month" });
  });
});

describe("tracking figures", () => {
  it("summarizes each student of the scope for the period", () => {
    const { students } = setup();
    const byId = Object.fromEntries(students.map((item) => [item.student.id, item]));
    expect(Object.keys(byId)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(byId.s1).toMatchObject({ classes: 2, absences: 0, attendance: 1, grades: [5], paid: 200, owed: 200 });
    expect(byId.s1.overdue).toBe(200);
    expect(byId.s2).toMatchObject({ classes: 2, absences: 1, attendance: 0.5, ungraded: ["Quiz"], owed: 0 });
    expect(byId.s2.sequence.map((entry) => entry.code)).toEqual(["P", "A"]);
    expect(byId.s3.monthlyDue).toHaveLength(1);
    expect(byId.s3.monthlyDue[0]).toMatchObject({ groupId: "g2", amount: 1000, dueDate: "2026-10-05" });
  });

  it("keeps the scope to a group or to individual students", () => {
    const state = fixture();
    expect(setup(state, "month", "g2").students.map((item) => item.student.id)).toEqual(["s3"]);
    expect(setup(state, "month", "individual").students.map((item) => item.student.id)).toEqual(["s4"]);
    expect(inScope(state.students[0], "g1")).toBe(true);
    expect(inScope(state.students[0], "individual")).toBe(false);
  });

  it("builds the headline figures without charging absent students", () => {
    const { kpis } = setup();
    expect(kpis.attendance).toMatchObject({ value: 0.75, records: 4, absences: 1, registered: 2 });
    expect(kpis.attendance.low.map((item) => item.student.id)).toEqual(["s2"]);
    expect(kpis.grades).toMatchObject({ value: 5, count: 1, graded: 1 });
    expect(kpis.grades.low.map((item) => item.student.id)).toEqual(["s1"]);
    expect(kpis.grades.ungraded.map((item) => item.student.id)).toEqual(["s2"]);
    expect(kpis.payments).toMatchObject({ collected: 400, paidClasses: 2, unpaidClasses: 1, overdue: 1200 });
  });

  it("shapes the attendance, grade and collection charts", () => {
    const { state, derived, range } = setup();
    const attendance = trackingMetric(state, derived, range, "g1", "attendance");
    const registered = attendance.points.filter((point) => point.kind === "reg");
    expect(registered.map((point) => [point.date, point.value])).toEqual([
      ["2026-10-12", 1],
      ["2026-10-19", 0.5],
    ]);
    expect(registered[1].absentIds).toEqual(["s2"]);
    expect(registered[1].assignment?.assessment).toBe("Quiz");
    const grades = trackingMetric(state, derived, range, "all", "grades");
    expect(grades.points.map((point) => point.value)).toEqual([5]);
    const collections = trackingMetric(state, derived, range, "all", "payments");
    expect(collections.points.map((point) => point.value)).toEqual([0, 0, 200, 200]);
  });
});

describe("monthly fees block", () => {
  it("lists who owes the month and counts payments as they arrive", () => {
    const state = fixture();
    const [block] = monthlyBlocks(state, AS_OF);
    expect(block.group.id).toBe("g2");
    expect(block).toMatchObject({ paidCount: 0, total: 1, expectedAmount: 1000, dueDate: "2026-10-05" });
    expect(block.rows[0].charge.status).toBe("overdue");
    state.students[2].monthlyPayments = [
      { id: "m1", groupId: "g2", period: "2026-10", amount: 1000, paidAt: "2026-10-20" },
    ];
    expect(monthlyBlocks(state, AS_OF)[0]).toMatchObject({ paidCount: 1, paidAmount: 1000 });
    expect(monthlyBlocks(state, AS_OF, "g1")).toEqual([]);
  });
});

describe("tracking breakdown", () => {
  it("lists one row per student and class, newest first, with grades and payments", () => {
    const { state, derived, range } = setup();
    const records = trackingRecords(state, derived, range);
    expect(records.map((record) => [record.row.id, record.payment])).toEqual([
      ["r4", "none"],
      ["r3", "paid"],
      ["r2", "paid"],
      ["r1", "pending"],
    ]);
    expect(records.find((record) => record.row.id === "r3")).toMatchObject({ assessment: "Quiz", grade: 5 });
    expect(records.find((record) => record.row.id === "r4").ungraded).toBe(true);
    expect(trackingRecords(state, derived, range, "all", "s1").map((record) => record.row.id)).toEqual(["r3", "r1"]);
  });
});
