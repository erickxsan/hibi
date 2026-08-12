import { describe, expect, it } from "vitest";
import {
  calculateCharge,
  calculateOutstanding,
  calculatePaymentStatus,
  createSeedState,
  createGroup,
  createStarterState,
  createStudent,
  deriveClassLogRow,
  deriveDashboard,
  deriveGroup,
  deriveStudent,
  PAYMENT_STATUSES,
} from "./index.js";

const AS_OF = "2026-07-10";

describe("minimal class-manager calculations", () => {
  it("reproduces the workbook dashboard from the demo records", () => {
    const state = createSeedState();
    const dashboard = deriveDashboard(state, AS_OF);

    expect(dashboard.activeStudents).toBe(3);
    expect(dashboard.overallGrade).toBeCloseTo(0.805);
    expect(dashboard.overallAttendance).toBeCloseTo(0.7222222222);
    expect(dashboard.missingAssignments).toBe(1);
    expect(dashboard.collectedThisWeek).toBe(770);
    expect(dashboard.collectedSelectedMonth).toBe(920);
    expect(dashboard.outstandingThroughToday).toBe(150);
    expect(dashboard.paidForFutureClasses).toBe(200);
    expect(dashboard.idealRevenue).toBe(2400);
    expect(dashboard.recentCollections).toBe(920);
    expect(dashboard.recentWeeklyAverage).toBe(230);
    expect(dashboard.recentProjection).toBeCloseTo(1018.57142857);
    expect(dashboard.weeklyCollections.at(-1)).toEqual({
      start: "2026-07-06",
      end: "2026-07-10",
      collected: 770,
    });
    expect(dashboard.monthlyCollections.at(-1).collected).toBe(920);
  });

  it("derives student and group indicators with P/L counted, A counted against, and E excluded", () => {
    const state = createSeedState();
    const maya = deriveStudent(state, "student_demo_s001", AS_OF);
    const lucas = deriveStudent(state, "student_demo_s002", AS_OF);
    const geometry = deriveGroup(state, "group_demo_geometry_9b", AS_OF);

    expect(maya.gradeAverage).toBeCloseTo(0.925);
    expect(maya.attendance).toBe(1);
    expect(maya.paidThroughToday).toBe(500);
    expect(lucas.gradeAverage).toBe(0.65);
    expect(lucas.attendance).toBeCloseTo(2 / 3);
    expect(lucas.missingAssignments).toBe(1);
    expect(lucas.outstanding).toBe(50);
    expect(lucas.alerts).toEqual(["Low grade", "Low attendance", "Missing work", "Balance due"]);
    expect(geometry.activeStudents).toBe(1);
    expect(geometry.idealRevenue).toBe(800);
    expect(geometry.collectedSelectedMonth).toBe(150);
    expect(geometry.outstanding).toBe(100);
  });

  it("excludes a blank score while preserving an explicit zero", () => {
    const state = createSeedState();
    state.grades = [
      {
        id: "blank",
        date: AS_OF,
        studentId: "student_demo_s001",
        assessment: "Blank",
        category: "Quiz",
        score: null,
        maxScore: 10,
        workStatus: "Missing",
        feedback: "",
      },
      {
        id: "zero",
        date: AS_OF,
        studentId: "student_demo_s001",
        assessment: "Zero",
        category: "Quiz",
        score: 0,
        maxScore: 10,
        workStatus: "On time",
        feedback: "",
      },
    ];
    expect(deriveStudent(state, "student_demo_s001", AS_OF).gradeAverage).toBe(0);
    state.grades = state.grades.slice(0, 1);
    expect(deriveStudent(state, "student_demo_s001", AS_OF).gradeAverage).toBeNull();
  });

  it("uses default hours for blank but respects a zero-hour waiver", () => {
    const state = createSeedState();
    const base = {
      id: "edge",
      classDate: "2026-07-09",
      studentId: "student_demo_s001",
      classStatus: "Completed",
      attendance: "P",
      amountPaid: null,
      paymentDate: null,
      paymentMethod: "",
      paymentReference: "",
      notes: "",
    };
    expect(calculateCharge(state, { ...base, hours: null })).toBe(100);
    expect(calculateOutstanding(state, { ...base, hours: null }, AS_OF)).toBe(100);
    expect(calculatePaymentStatus(state, { ...base, hours: null }, AS_OF)).toBe(PAYMENT_STATUSES.PENDING);

    expect(calculateCharge(state, { ...base, hours: 0 })).toBe(0);
    expect(calculateOutstanding(state, { ...base, hours: 0 }, AS_OF)).toBe(0);
    expect(calculatePaymentStatus(state, { ...base, hours: 0 }, AS_OF)).toBe(PAYMENT_STATUSES.NO_CHARGE);
  });

  it("covers partial, overpaid, advance, cancelled, missing-date and unknown-student statuses", () => {
    const state = createSeedState();
    const derived = state.classLog.map((row) => deriveClassLogRow(state, row, AS_OF));
    expect(derived[1].paymentStatus).toBe(PAYMENT_STATUSES.PARTIAL);
    expect(derived[7].paymentStatus).toBe(PAYMENT_STATUSES.OVERPAID);
    expect(derived[8].paymentStatus).toBe(PAYMENT_STATUSES.CANCELLED);
    expect(derived[9].paymentStatus).toBe(PAYMENT_STATUSES.PAID_IN_ADVANCE);

    const paidWithoutDate = { ...state.classLog[0], id: "no-date", paymentDate: null };
    expect(calculatePaymentStatus(state, paidWithoutDate, AS_OF)).toBe(PAYMENT_STATUSES.DATE_NEEDED);
    expect(calculateOutstanding(state, paidWithoutDate, AS_OF)).toBe(100);

    const unknown = { ...state.classLog[0], id: "unknown", studentId: "not-a-student" };
    expect(calculatePaymentStatus(state, unknown, AS_OF)).toBe(PAYMENT_STATUSES.UNKNOWN_STUDENT);
    expect(calculateOutstanding(state, unknown, AS_OF)).toBeNull();

    const cancelledPaid = { ...state.classLog[8], id: "cancel-paid", amountPaid: 100, paymentDate: AS_OF };
    expect(calculatePaymentStatus(state, cancelledPaid, AS_OF)).toBe(PAYMENT_STATUSES.REVIEW_CANCELLED);
  });

  it("does not recognize a payment dated after the as-of date", () => {
    const state = createSeedState();
    const row = {
      ...state.classLog[0],
      id: "future-payment",
      classDate: "2026-07-09",
      paymentDate: "2026-07-11",
    };
    expect(calculatePaymentStatus(state, row, AS_OF)).toBe(PAYMENT_STATUSES.FUTURE_PAYMENT_DATE);
    expect(calculateOutstanding(state, row, AS_OF)).toBe(100);
  });

  it("reconciles unassigned students in global and group summaries without projecting revenue", () => {
    const state = createStarterState();
    state.students = [
      createStudent({ code: "TEST-001", fullName: "Student One" }),
      createStudent({ code: "TEST-002", fullName: "Student Two" }),
      createStudent({ code: "TEST-003", fullName: "Student Three" }),
    ];
    const dashboard = deriveDashboard(state, AS_OF);

    expect(dashboard.activeStudents).toBe(3);
    expect(dashboard.overallGrade).toBeNull();
    expect(dashboard.overallAttendance).toBeNull();
    expect(dashboard.groupSummaries).toHaveLength(1);
    expect(dashboard.groupSummaries[0]).toEqual(
      expect.objectContaining({
        id: "__unassigned__",
        name: "Unassigned",
        activeStudents: 3,
        idealRevenue: 0,
        projectionExcluded: true,
      }),
    );
    expect(dashboard.idealRevenue).toBe(0);
  });

  it("uses student, group, then account pricing and preserves historical snapshots", () => {
    const state = createStarterState(AS_OF);
    const group = createGroup({ id: "priced_group", name: "Priced group", hourlyRate: 80 });
    const groupRateStudent = createStudent({
      id: "group_rate",
      code: "RATE-1",
      fullName: "Group rate",
      groupIds: [group.id],
    });
    const customRateStudent = createStudent({
      id: "custom_rate",
      code: "RATE-2",
      fullName: "Custom rate",
      groupIds: [group.id],
      customHourlyRate: 120,
    });
    state.groups = [group];
    state.students = [groupRateStudent, customRateStudent];
    const base = { classDate: AS_OF, groupId: group.id, classStatus: "Completed", hours: 2 };
    expect(calculateCharge(state, { ...base, studentId: groupRateStudent.id })).toBe(160);
    expect(calculateCharge(state, { ...base, studentId: customRateStudent.id })).toBe(240);
    expect(
      calculateCharge(state, { ...base, studentId: customRateStudent.id, appliedHourlyRate: 70, appliedCharge: 140 }),
    ).toBe(140);
    state.groups[0].hourlyRate = 200;
    state.students[1].customHourlyRate = 300;
    expect(
      calculateCharge(state, { ...base, studentId: customRateStudent.id, appliedHourlyRate: 70, appliedCharge: 140 }),
    ).toBe(140);
  });

  it("projects ideal group revenue from every recurring occurrence and effective student rate", () => {
    const state = createStarterState("2026-07-31");
    state.settings.selectedMonth = "2026-07-01";
    const group = createGroup({
      id: "weekly",
      name: "Weekly",
      hourlyRate: 100,
      weeklySchedule: [{ id: "wed", dayOfWeek: 3, startTime: "16:00", durationHours: 1 }],
    });
    state.groups = [group];
    state.students = [
      createStudent({ id: "one", code: "ONE", fullName: "One", groupIds: [group.id], customHourlyRate: 80 }),
      createStudent({ id: "two", code: "TWO", fullName: "Two", groupIds: [group.id] }),
    ];
    const summary = deriveGroup(state, group.id, "2026-07-31");
    expect(summary.scheduledOccurrences).toBe(5);
    expect(summary.idealRevenue).toBe(900);
  });
});
