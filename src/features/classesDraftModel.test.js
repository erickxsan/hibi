import { describe, expect, it } from "vitest";
import { buildClassRecords, studentClassNote } from "./classesDraftModel";

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
});
