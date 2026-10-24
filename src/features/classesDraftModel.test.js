import { describe, expect, it } from "vitest";
import { studentClassNote } from "./classesDraftModel";

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
    });
    expect(studentClassNote(state, student, session, [row("2026-08-15", 300)])).toMatchObject({
      kind: "owes",
      amount: 300,
      count: 1,
      date: "2026-08-15",
    });
  });
});
