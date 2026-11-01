import { describe, expect, it } from "vitest";
import { buildClassRecords, studentClassNote } from "./classesDraftModel";
import { createStarterState } from "../domain/starterState";
import { normalizeState } from "../domain/validation";
import { recordMonthlyPayment } from "../domain/monthlyBilling";

const student = { id: "s1", fullName: "Ana", groupIds: ["g1"], status: "Active" };
const session = { key: "k", classDate: "2026-10-23", groupId: "g1", format: "group" };
const state = { groups: [{ id: "g1", name: "Math", weeklySchedule: [] }], students: [student], grades: [] };
const row = (classDate, outstanding, attendance = "P") => ({
  studentId: "s1",
  groupId: "g1",
  classDate,
  classStatus: "Completed",
  attendance,
  outstanding,
});

describe("student note before class", () => {
  it("names how many unpaid classes the debt spans and the oldest one, without changing the amount", () => {
    const rows = [row("2026-10-01", 225), row("2026-10-08", 225), row("2026-10-15", 225), row("2026-10-22", 0)];
    expect(studentClassNote(state, student, session, rows)).toEqual({
      kind: "owes",
      tone: "pend",
      amount: 675,
      count: 3,
      date: "2026-10-01",
      latest: "2026-10-15",
    });
    expect(studentClassNote(state, student, session, [row("2026-08-15", 300)])).toMatchObject({
      kind: "owes",
      amount: 300,
      count: 1,
      date: "2026-08-15",
    });
  });
});

describe("monthly fee note before class", () => {
  // Mondays and Thursdays, $1,200 a month due on the 15th since October.
  const monthly = normalizeState({
    ...createStarterState({ settings: { asOfDate: "2026-11-02" } }),
    groups: [
      {
        id: "m1",
        name: "Primaria 5A",
        hourlyRate: 75,
        weeklySchedule: [
          { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
        ],
        billing: { mode: "monthly", monthlyFee: 1200, due: { type: "dayOfMonth", day: 15 }, effectiveFrom: "2026-10" },
      },
    ],
    students: [{ id: "diego", code: "D", fullName: "Diego", status: "Active", groupIds: ["m1"] }],
  });
  const diego = monthly.students[0];
  const classOn = (classDate) => ({ key: classDate, classDate, groupId: "m1", format: "group" });
  const paidOctober = recordMonthlyPayment(monthly, {
    studentId: "diego",
    groupId: "m1",
    period: "2026-10",
    paidAt: "2026-10-15",
  });

  it("waits for the due date: a class before the 15th still belongs to last month's fee", () => {
    expect(studentClassNote(paidOctober, diego, classOn("2026-11-02"))).toEqual({ kind: "upToDate", tone: "" });
    expect(studentClassNote(paidOctober, diego, classOn("2026-11-16"))).toEqual({
      kind: "monthlyPending",
      tone: "pend",
      period: "2026-11",
    });
    // A later class looked at today is not flagged before its month is due.
    expect(studentClassNote(paidOctober, diego, classOn("2026-11-16"), [], null, "2026-11-02")).toMatchObject({
      kind: "upToDate",
    });
  });

  it("still flags last month's fee when it was never paid", () => {
    expect(studentClassNote(monthly, diego, classOn("2026-11-02"))).toEqual({
      kind: "monthlyPending",
      tone: "pend",
      period: "2026-10",
    });
  });
});

describe("class records from the roster", () => {
  const roster = [
    { id: "s1", fullName: "Ana", groupIds: ["g1"], status: "Active" },
    { id: "s2", fullName: "Beto", groupIds: ["g1"], status: "Active" },
    { id: "s3", fullName: "Caro", groupIds: ["g1"], status: "Active" },
  ];
  const rosterState = {
    settings: { hourlyRate: 50, defaultClassHours: 2 },
    groups: [{ id: "g1", name: "Math", hourlyRate: 50, weeklySchedule: [] }],
    students: roster,
    grades: [],
    classLog: [],
  };
  const classSession = { key: "k", classDate: "2026-10-10", groupId: "g1", durationHours: 2, title: "Math", rows: [] };
  const byStudent = (records) => Object.fromEntries(records.map((record) => [record.studentId, record]));

  it("charges only present students; absent and unmarked ones carry no charge or pending payment", () => {
    const entries = { s1: { attendance: "P" }, s2: { attendance: "A" }, s3: {} };
    const records = byStudent(buildClassRecords(rosterState, classSession, roster, entries, { today: "2026-10-10" }));
    expect(records.s1).toMatchObject({ attendance: "P", appliedCharge: 100, paymentState: "Pending" });
    expect(records.s2).toMatchObject({ attendance: "A", appliedCharge: 0, paymentState: "" });
    expect(records.s3).toMatchObject({ attendance: "", appliedCharge: 0, paymentState: "" });
  });

  it("keeps a payment already recorded for a student saved as unmarked", () => {
    const existing = {
      id: "c3",
      studentId: "s3",
      classDate: "2026-10-10",
      attendance: "P",
      appliedCharge: 100,
      amountPaid: 100,
      paymentDate: "2026-10-10",
      paymentMethod: "Cash",
      paymentState: "Paid",
    };
    const records = byStudent(
      buildClassRecords(rosterState, { ...classSession, rows: [existing] }, roster, {}, { today: "2026-10-10" }),
    );
    expect(records.s3).toMatchObject({
      appliedCharge: 0,
      amountPaid: 100,
      paymentDate: "2026-10-10",
      paymentState: "",
    });
  });

  it("charges the rate of the class day when an absent student is marked present later", () => {
    const absent = {
      id: "c1",
      studentId: "s1",
      classDate: "2026-10-10",
      attendance: "A",
      appliedHourlyRate: 50,
      appliedCharge: 0,
    };
    const raised = { ...rosterState, groups: [{ ...rosterState.groups[0], hourlyRate: 80 }] };
    const records = byStudent(
      buildClassRecords(
        raised,
        { ...classSession, rows: [absent] },
        roster,
        { s1: { attendance: "P" } },
        { today: "2026-10-12" },
      ),
    );
    expect(records.s1).toMatchObject({ appliedCharge: 100, paymentState: "Pending" });
  });

  it("keeps a per-class payment when the group later bills that month monthly and the class is saved again", () => {
    const paid = {
      id: "c1",
      studentId: "s1",
      groupId: "g1",
      classDate: "2026-10-10",
      classStatus: "Completed",
      attendance: "P",
      appliedHourlyRate: 50,
      appliedCharge: 100,
      amountPaid: 100,
      paymentDate: "2026-10-10",
      paymentMethod: "Cash",
      paymentState: "Paid",
    };
    const monthly = {
      ...rosterState,
      groups: [
        {
          ...rosterState.groups[0],
          billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 28 }, effectiveFrom: "2026-10" },
        },
      ],
    };
    const records = byStudent(
      buildClassRecords(
        monthly,
        { ...classSession, rows: [paid] },
        roster,
        { s1: { attendance: "P", paymentState: "Paid", paymentTouched: false, classId: "c1" } },
        { today: "2026-10-28" },
      ),
    );
    expect(records.s1).toMatchObject({
      appliedCharge: 0,
      amountPaid: 100,
      paymentDate: "2026-10-10",
      paymentMethod: "Cash",
      paymentState: "",
    });
    expect(records.s2).toMatchObject({ appliedCharge: 0, amountPaid: 0, paymentState: "" });
  });
});
