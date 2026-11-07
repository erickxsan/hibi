import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain/calculations.js";
import { markLost } from "../domain/lostPayments.js";
import { studentClassNote } from "./classesDraftModel";
import { studentMonth } from "./communityModel";
import {
  buildAttentionItems,
  debtSummary,
  lostSummary,
  monthProjection,
  paymentsBetween,
  staleDebts,
} from "./homeDashboardModel";
import { chargeDebt, debtItem, studentDebtRows } from "./lostPaymentsModel";
import {
  monthlyBlocks,
  trackingDerived,
  trackingKpis,
  trackingRange,
  trackingRecords,
  trackingStudents,
} from "./trackingModel";
import { classDebts, monthlyStamps } from "./trackingStudentSheetModel";

const AS_OF = "2026-11-05";

const row = (id, studentId, classDate, extra = {}) => ({
  id,
  studentId,
  classDate,
  groupId: "g-class",
  startTime: "17:00",
  classStatus: "Completed",
  attendance: "P",
  hours: 2,
  appliedHourlyRate: 125,
  appliedCharge: 250,
  amountPaid: 0,
  ...extra,
});

function workspace() {
  return {
    settings: {
      asOfDate: AS_OF,
      hourlyRate: 125,
      defaultClassHours: 2,
      selectedMonth: "2026-11-01",
      lowAttendanceThreshold: 0.8,
    },
    groups: [
      {
        id: "g-month",
        name: "Prepa",
        status: "Active",
        weeklySchedule: [],
        billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-04" },
      },
      { id: "g-class", name: "Sec", status: "Active", weeklySchedule: [], hourlyRate: 125 },
    ],
    students: [
      {
        id: "luna",
        fullName: "Luna Ortiz",
        status: "Active",
        groupIds: ["g-month"],
        monthlyPayments: [
          { id: "a", groupId: "g-month", period: "2026-04", amount: 300, paidAt: "2026-04-05", partial: true },
        ],
      },
      { id: "diego", fullName: "Diego Mora", status: "Active", groupIds: ["g-class"] },
      { id: "rodrigo", fullName: "Rodrigo Peña", status: "Inactive", groupIds: ["g-class"] },
    ],
    classLog: [
      row("d-feb", "diego", "2026-02-12"),
      row("d-oct", "diego", "2026-10-29"),
      row("d-now", "diego", "2026-11-03"),
      row("r-mar", "rodrigo", "2026-03-05"),
    ],
    grades: [],
  };
}

const MAY = { studentId: "luna", kind: "monthly", groupId: "g-month", period: "2026-05" };
const FEB = { studentId: "diego", kind: "class", classId: "d-feb" };
const MAR = { studentId: "rodrigo", kind: "class", classId: "r-mar" };

const derive = (state, asOf = AS_OF) => deriveAll(state, asOf);
const lostState = () => markLost(workspace(), [MAY, FEB, MAR], AS_OF);

describe("what a lost debt does to the figures", () => {
  it("moves money out of what is owed, without touching what was collected", () => {
    const before = workspace();
    const beforeDebts = debtSummary(before, derive(before).classLog, AS_OF);
    const state = lostState();
    const rows = derive(state).classLog;
    const debts = debtSummary(state, rows, AS_OF);
    expect(beforeDebts.owed - debts.owed).toBe(800 + 250);
    expect(beforeDebts.inactive.owed - debts.inactive.owed).toBe(250);
    expect(debts.debts.flatMap((item) => item.reasons).some((reason) => reason.date === "2026-02-12")).toBe(false);
    expect(paymentsBetween(state, rows, "2026-01-01", AS_OF)).toEqual(
      paymentsBetween(before, derive(before).classLog, "2026-01-01", AS_OF),
    );
  });

  it("adds up per student, biggest first, inactive students included", () => {
    const state = lostState();
    const summary = lostSummary(state, derive(state).classLog, AS_OF);
    expect(summary.total).toBe(1300);
    expect(summary.students.map((item) => [item.studentId, item.amount])).toEqual([
      ["luna", 800],
      ["diego", 250],
      ["rodrigo", 250],
    ]);
    expect(summary.students[0].items[0]).toMatchObject({ kind: "monthly", period: "2026-05", lostAt: AS_OF });
    expect(summary.students[1].items[0]).toMatchObject({ kind: "class", classId: "d-feb", amount: 250 });
  });

  it("follows the group filter and the date being looked at", () => {
    const state = lostState();
    expect(lostSummary(state, derive(state).classLog, AS_OF, "g-class").total).toBe(500);
    // The rows the app hands in are today's; the report derives its own.
    const earlier = trackingDerived(state, derive(state), "2026-10-01").classLog;
    expect(lostSummary(state, earlier, "2026-10-01").total).toBe(0);
  });

  it("leaves a fee given up out of this month's expected money", () => {
    const state = markLost(workspace(), [{ ...MAY, period: "2026-11" }], AS_OF);
    const rows = derive(state).classLog;
    const before = workspace();
    expect(monthProjection(before, derive(before).classLog, AS_OF).monthlyDue).toBe(800);
    expect(monthProjection(state, rows, AS_OF).monthlyDue).toBe(0);
    const block = monthlyBlocks(state, AS_OF)[0];
    expect(block.total).toBe(0);
    expect(block.expectedAmount).toBe(0);
    expect(block.rows[0].charge.status).toBe("lost");
  });

  it("keeps what was paid of a fee given up in the month's money, but not as a paid student", () => {
    const base = workspace();
    base.students[0].monthlyPayments = [
      { id: "abono", groupId: "g-month", period: "2026-11", amount: 300, paidAt: "2026-11-02", partial: true },
    ];
    const state = markLost(base, [{ ...MAY, period: "2026-11" }], AS_OF);
    const block = monthlyBlocks(state, AS_OF)[0];
    expect(block).toMatchObject({ paidCount: 0, total: 0, paidAmount: 300, expectedAmount: 300 });
  });

  it("names lost classes in the breakdown and counts them as neither owed nor collected", () => {
    const state = lostState();
    const derived = derive(state);
    const range = trackingRange(AS_OF, "all", state, "");
    const students = trackingStudents(state, derived, range);
    const kpis = trackingKpis(state, derived, range, "all", students);
    expect(kpis.payments.lost).toBe(1300);
    expect(students.find((item) => item.student.id === "luna").lost).toBe(800);
    expect(students.find((item) => item.student.id === "diego").owed).toBe(500);
    const records = trackingRecords(state, derived, range);
    expect(records.find((item) => item.row.id === "d-feb").payment).toBe("lost");
    expect(records.find((item) => item.row.id === "d-oct").payment).toBe("pending");
  });

  it("shows it on the student's month", () => {
    const state = lostState();
    const derived = derive(state);
    const month = studentMonth(state, derived, state.students[1], AS_OF);
    expect(month).toMatchObject({ owed: 500, lost: 250 });
    expect(studentMonth(state, derived, state.students[0], AS_OF, { groupId: "g-class" }).lost).toBe(0);
  });

  it("stops the class roster from asking for a fee given up", () => {
    const state = markLost(workspace(), [{ ...MAY, period: "2026-10" }], AS_OF);
    const session = { groupId: "g-month", classDate: "2026-10-20" };
    expect(studentClassNote(state, state.students[0], session, derive(state).classLog, null, AS_OF).kind).toBe(
      "upToDate",
    );
    const open = workspace();
    expect(studentClassNote(open, open.students[0], session, derive(open).classLog, null, AS_OF).kind).toBe(
      "monthlyPending",
    );
  });
});

describe("old debts", () => {
  it("gathers what is more than three months overdue, biggest first", () => {
    const state = workspace();
    const stale = staleDebts(state, derive(state).classLog, AS_OF);
    expect(stale.students.map((item) => [item.studentId, item.amount])).toEqual([
      ["luna", 2900],
      ["diego", 250],
      ["rodrigo", 250],
    ]);
    expect(stale.students[0].items.map((item) => item.period)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(stale.students[0].items[0].amount).toBe(500);
    expect(stale.students[2].inactive).toBe(true);
    expect(stale.total).toBe(3400);
  });

  it("looks further back on demand, and is empty when nothing is that old", () => {
    const state = workspace();
    const rows = derive(state).classLog;
    expect(staleDebts(state, rows, AS_OF, 6).total).toBe(1000);
    expect(staleDebts(state, rows, AS_OF, 12).students).toEqual([]);
  });

  it("does not trip on a month shorter than the day it counts from", () => {
    const state = workspace();
    expect(() => staleDebts(state, derive(state, "2026-05-31").classLog, "2026-05-31")).not.toThrow();
  });

  it("drops what was given up, and raises one alert that a newly old debt brings back", () => {
    const state = lostState();
    const rows = derive(state).classLog;
    expect(staleDebts(state, rows, AS_OF).total).toBe(2100);
    const derived = derive(state);
    const item = buildAttentionItems(state, derived, AS_OF).find((entry) => entry.kind === "staleDebts");
    expect(item).toMatchObject({ tone: "pend", amount: 2100, action: { type: "stale" } });
    expect(item.names).toEqual(["Luna Ortiz"]);
    const seen = {
      ...state,
      settings: { ...state.settings, dismissedNotes: Object.fromEntries(item.seenKeys.map((key) => [key, true])) },
    };
    expect(buildAttentionItems(seen, derive(seen), AS_OF).find((entry) => entry.kind === "staleDebts").dismissed).toBe(
      true,
    );
    const allGone = markLost(
      state,
      staleDebts(state, rows, AS_OF).students.flatMap((student) =>
        student.items.map((debt) => debtItem(student.studentId, debt)),
      ),
      AS_OF,
    );
    expect(buildAttentionItems(allGone, derive(allGone), AS_OF).some((entry) => entry.kind === "staleDebts")).toBe(
      false,
    );
  });
});

describe("a student's list of debts", () => {
  it("lists fees and classes oldest first, and only overdue ones can be given up", () => {
    const state = workspace();
    const luna = studentDebtRows(state, derive(state), { studentId: "luna", asOf: AS_OF });
    expect(luna.map((item) => item.period)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(luna[0]).toMatchObject({ amount: 500, abono: 300, canLose: true, lost: false });
    expect(luna.at(-1).canLose).toBe(false);
    const diego = studentDebtRows(state, derive(state), { studentId: "diego", asOf: AS_OF });
    expect(diego.map((item) => [item.classId, item.canLose])).toEqual([
      ["d-feb", true],
      ["d-oct", false],
      ["d-now", false],
    ]);
  });

  it("keeps what was given up, marked, so it can be recovered", () => {
    const state = lostState();
    const derived = derive(state);
    const luna = studentDebtRows(state, derived, { studentId: "luna", asOf: AS_OF });
    expect(luna[1]).toMatchObject({ period: "2026-05", lost: true, canLose: false, lostAt: AS_OF });
    const diego = studentDebtRows(state, derived, { studentId: "diego", asOf: AS_OF });
    expect(diego[0]).toMatchObject({ classId: "d-feb", lost: true, amount: 250 });
    expect(monthlyStamps(state, AS_OF, "all", "luna").find((item) => item.period === "2026-05").status).toBe("lost");
    expect(
      classDebts(state, derived, { scope: "all", studentId: "diego", asOf: AS_OF }).map((item) => item.row.id),
    ).toContain("d-feb");
  });

  it("turns any debt into what the actions need", () => {
    expect(debtItem("s", { kind: "class", classId: "c", amount: 1 })).toEqual({
      studentId: "s",
      kind: "class",
      classId: "c",
    });
    expect(debtItem("s", { kind: "monthly", groupId: "g", period: "2026-05", lostAt: AS_OF })).toEqual({
      studentId: "s",
      kind: "monthly",
      groupId: "g",
      period: "2026-05",
      lostAt: AS_OF,
    });
    expect(chargeDebt({ groupId: "g", period: "2026-05", dueDate: "2026-05-05", balance: 800 })).toEqual({
      kind: "monthly",
      groupId: "g",
      period: "2026-05",
      date: "2026-05-05",
      amount: 800,
    });
  });
});
