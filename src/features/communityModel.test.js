import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain";
import {
  archivedGroupHistory,
  billingChanges,
  billingDraftFor,
  feeSuggestion,
  groupAttendanceGrid,
  groupMonth,
  joinGroup,
  joiningOptions,
  monthlyTotal,
  nextDueDates,
  sortStudentsByAttention,
  studentMonth,
  studentMonths,
  studentRecentClasses,
  switchCredits,
} from "./communityModel";

const AS_OF = "2026-10-21";

function row(id, classDate, studentId, attendance, amountPaid, groupId = "g1") {
  return {
    id,
    classDate,
    studentId,
    groupId,
    startTime: "16:00",
    scheduleSlotId: "slot-mon",
    scheduleOccurrenceDate: classDate,
    classStatus: "Completed",
    attendance,
    hours: 2,
    appliedHourlyRate: 75,
    appliedCharge: attendance === "A" ? 0 : 150,
    amountPaid,
    paymentState: attendance === "A" ? "" : amountPaid ? "Paid" : "Pending",
    paymentDate: amountPaid ? classDate : null,
  };
}

function fixture() {
  return {
    version: 1,
    settings: { asOfDate: AS_OF, hourlyRate: 100, defaultClassHours: 2, lowAttendanceThreshold: 0.8 },
    groups: [
      {
        id: "g1",
        name: "Primaria 5A",
        hourlyRate: 75,
        weeklySchedule: [
          { id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "slot-thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
        ],
      },
      { id: "g-old", name: "Inglés", status: "Inactive", archivedAt: "2026-09-30", weeklySchedule: [] },
    ],
    students: [
      { id: "s1", code: "L1", fullName: "Luna López", groupIds: ["g1"], status: "Active" },
      { id: "s2", code: "D2", fullName: "Diego Soto", groupIds: ["g1"], status: "Active" },
      { id: "s3", code: "S3", fullName: "Sofía Martín", groupIds: ["g1"], status: "Active" },
      { id: "s4", code: "M4", fullName: "Mariana Paz", groupIds: ["g-old"], status: "Active" },
    ],
    grades: [
      {
        id: "gr1",
        date: "2026-10-19",
        studentId: "s2",
        assessment: "Lectura",
        score: 9,
        maxScore: 10,
        classSessionKey: "2026-10-19|g:g1|16:00",
      },
      {
        id: "gr2",
        date: "2026-10-19",
        studentId: "s3",
        assessment: "Lectura",
        score: null,
        maxScore: 10,
        classSessionKey: "2026-10-19|g:g1|16:00",
      },
    ],
    classLog: [
      row("r1", "2026-10-05", "s1", "A", 0),
      row("r2", "2026-10-05", "s2", "P", 150),
      row("r3", "2026-10-05", "s3", "P", 150),
      row("r4", "2026-10-12", "s1", "A", 0),
      row("r5", "2026-10-12", "s2", "P", 150),
      row("r6", "2026-10-12", "s3", "P", 150),
      row("r7", "2026-10-19", "s1", "P", 150),
      row("r8", "2026-10-19", "s2", "P", 150),
      row("r9", "2026-10-19", "s3", "P", 0),
      row("o1", "2026-09-28", "s4", "P", 0, "g-old"),
    ],
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

const setup = (state = fixture()) => ({ state, derived: deriveAll(state, AS_OF) });
const members = (state) => state.students.filter((student) => student.groupIds.includes("g1"));

describe("student months", () => {
  it("flags low attendance, recent and overdue debts, and sorts pending students first", () => {
    const { state, derived } = setup();
    const months = studentMonths(state, derived, AS_OF);
    expect(months.get("s1")).toMatchObject({
      classes: 3,
      absences: 2,
      sequence: ["A", "A", "P"],
      flag: { kind: "lowAttendance" },
    });
    expect(months.get("s3")).toMatchObject({
      owed: 150,
      overdue: false,
      flag: { kind: "owes", date: "2026-10-19" },
      ungraded: 1,
    });
    expect(months.get("s4").flag).toMatchObject({ kind: "overdue", amount: 150 });
    expect(months.get("s2")).toMatchObject({ average: 9, graded: 1, paid: 450, flag: { kind: "ok" } });
    expect(sortStudentsByAttention([...months.values()]).map((month) => month.student.id)).toEqual([
      "s4",
      "s1",
      "s3",
      "s2",
    ]);
    expect(studentMonth(state, derived, state.students[0], AS_OF, { groupId: "g-old" }).classes).toBe(0);
  });

  it("lists the latest classes with their grade", () => {
    const { state, derived } = setup();
    const recent = studentRecentClasses(state, derived, "s2", 2);
    expect(recent.map((item) => item.row.classDate)).toEqual(["2026-10-19", "2026-10-12"]);
    expect(recent[0]).toMatchObject({ groupName: "Primaria 5A", gradeValue: 9 });
  });
});

describe("group figures", () => {
  it("summarizes the month, the attendance grid and who owes", () => {
    const { state, derived } = setup();
    const summary = groupMonth(state, derived, state.groups[0], AS_OF, members(state));
    expect(summary).toMatchObject({ absences: 2, sessions: 3, average: 9, ungraded: 1, owed: 150, overdue: 0 });
    expect(summary.monthAttendance).toBeCloseTo(7 / 9);
    const grid = groupAttendanceGrid(state, state.groups[0], members(state), AS_OF);
    expect(grid.columns.map((column) => column.date)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);
    expect(grid.rows[0].cells.map((cell) => cell.code)).toEqual(["A", "A", "P"]);
  });

  it("keeps an archived group's history and what was left owed", () => {
    const { state, derived } = setup();
    const archived = state.groups[1];
    const history = archivedGroupHistory(state, derived, archived, [state.students[3]]);
    expect(history).toMatchObject({ classes: 1, attendance: 1, collected: 0, outstanding: 150 });
    expect(history.owing.map((item) => item.student.id)).toEqual(["s4"]);
    expect(history.members[0]).toMatchObject({ attended: 1, total: 1, owed: 150 });
  });
});

describe("monthly billing editor", () => {
  it("switches a per-class group next month by default, or this month crediting what was paid", () => {
    const { state } = setup();
    const group = state.groups[0];
    const draft = { ...billingDraftFor(group, members(state)), mode: "monthly", monthlyFee: 1200 };
    expect(billingChanges(group, members(state), draft, AS_OF).billing).toMatchObject({
      mode: "monthly",
      effectiveFrom: "2026-11",
      creditFirstMonth: false,
    });
    expect(billingChanges(group, members(state), draft, AS_OF, "current").billing).toMatchObject({
      effectiveFrom: "2026-10",
      creditFirstMonth: true,
    });
    const credits = switchCredits(state, group, members(state), draft, AS_OF);
    expect(credits.map((item) => [item.student.id, item.paid, item.amount])).toEqual([
      ["s1", 150, 1050],
      ["s2", 450, 750],
      ["s3", 300, 900],
    ]);
  });

  it("keeps the covered start of a new group when its monthly fee is edited", () => {
    const { state } = setup();
    const group = {
      ...state.groups[0],
      billing: {
        mode: "monthly",
        monthlyFee: 1200,
        due: { type: "dayOfMonth", day: 5 },
        effectiveFrom: "2026-11",
        coveredFrom: "2026-10-22",
      },
    };
    const draft = { ...billingDraftFor(group, members(state)), monthlyFee: 1300 };
    expect(billingChanges(group, members(state), draft, AS_OF).billing).toMatchObject({
      monthlyFee: 1300,
      effectiveFrom: "2026-11",
      coveredFrom: "2026-10-22",
    });
  });

  it("stores per-student adjustments and keeps the join date of a mid-month student", () => {
    const { state } = setup();
    const group = {
      ...state.groups[0],
      billing: { mode: "monthly", monthlyFee: 1200, due: { type: "nthClass", nth: 3 }, effectiveFrom: "2026-10" },
    };
    const roster = members(state).map((student) =>
      student.id === "s3"
        ? { ...student, billingByGroup: { g1: { mode: "group", joinedOn: "2026-10-10", firstMonthAmount: 600 } } }
        : student,
    );
    const draft = billingDraftFor(group, roster);
    expect(draft.adjustments).toEqual({});
    draft.adjustments = { s1: { mode: "perClass" }, s3: { mode: "customFee", fee: 1000 } };
    const { billing, overrides } = billingChanges(group, roster, draft, AS_OF);
    expect(billing).toMatchObject({ mode: "monthly", effectiveFrom: "2026-10", due: { type: "nthClass", nth: 3 } });
    expect(overrides).toEqual({
      s1: { mode: "perClass" },
      s3: { mode: "customFee", fee: 1000, joinedOn: "2026-10-10", firstMonthAmount: 600 },
    });
    expect(monthlyTotal(state, group, roster, draft)).toEqual({ total: 2200, monthly: 2, perClass: 1 });
    // Back to per class: the join date stays and nothing else needs saving.
    expect(billingChanges(group, roster, { ...draft, mode: "perClass" }, AS_OF).overrides).toEqual({});
  });

  it("previews due dates, the suggested fee and the first month of a new student", () => {
    const { state } = setup();
    const group = {
      ...state.groups[0],
      billing: { mode: "monthly", monthlyFee: 900, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
    };
    const withGroup = { ...state, groups: [group, state.groups[1]] };
    expect(nextDueDates(withGroup, group, { monthlyFee: 900, due: { type: "nthClass", nth: 1 } }, AS_OF)).toEqual([
      "2026-11-02",
      "2026-12-03",
    ]);
    expect(nextDueDates(withGroup, group, { monthlyFee: 900, due: { type: "dayOfMonth", day: 25 } }, AS_OF)).toEqual([
      "2026-10-25",
      "2026-11-25",
    ]);
    expect(feeSuggestion(withGroup, group, AS_OF)).toEqual({ classes: 9, perClass: 150, fee: 1350 });
    const options = joiningOptions(withGroup, group, state.students[3], AS_OF);
    expect(options).toMatchObject({ started: true, fee: 900, amounts: { total: 9, remaining: 3, prorated: 300 } });
    expect(joinGroup(state.students[3], group, AS_OF, { amount: 300 })).toMatchObject({
      groupIds: ["g-old", "g1"],
      billingByGroup: { g1: { mode: "group", joinedOn: AS_OF, firstMonthAmount: 300 } },
    });
    expect(joinGroup(state.students[3], state.groups[0], AS_OF).billingByGroup).toBeUndefined();
    expect(joiningOptions(state, state.groups[0], state.students[3], AS_OF)).toBeNull();
  });
});
