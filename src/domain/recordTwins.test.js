import { describe, expect, it } from "vitest";
import { createClassLogRow, createGrade } from "./ids.js";
import { adoptStoredTwins, DuplicateRecordError, isBlankTwin, sameTwinContent, twinKey } from "./recordTwins.js";

const row = (id, overrides = {}) =>
  createClassLogRow({
    id,
    studentId: "ana",
    groupId: "g",
    classDate: "2026-11-12",
    startTime: "16:00",
    hours: 2,
    appliedHourlyRate: 100,
    amountPaid: 0,
    ...overrides,
  });
const paid = { attendance: "P", appliedCharge: 200, amountPaid: 200, paymentState: "Paid", paymentDate: "2026-11-12" };

describe("twin records", () => {
  it("names a class by student, date and start time, and a grade by student, session and assignment", () => {
    expect(twinKey("classLog", row("a"))).toBe(twinKey("classLog", row("b", { groupId: "h", ...paid })));
    expect(twinKey("classLog", row("a", { startTime: "" }))).toBeNull();
    const grade = createGrade({ studentId: "ana", assessment: "Quiz 1", classSessionKey: "2026-11-12|g|16:00" });
    expect(twinKey("grades", grade)).toBe(
      twinKey("grades", { ...grade, assessment: " quiz 1 ", classSessionKey: "2026-11-12|g:g|16:00" }),
    );
    expect(twinKey("grades", grade)).not.toBe(twinKey("grades", { ...grade, assessment: "Tarea" }));
    expect(twinKey("grades", { ...grade, classSessionKey: "" })).toBeNull();
    expect(twinKey("students", { id: "ana" })).toBeNull();
  });

  it("tells a record with nothing on it from one with a mark, money, a cancellation or a note", () => {
    expect(isBlankTwin("classLog", row("a", { attendance: null }))).toBe(true);
    for (const overrides of [
      { attendance: "A" },
      { amountPaid: 50 },
      { paymentState: "Paid" },
      { classStatus: "Cancelled" },
      { notes: "Llegó tarde" },
      { paymentReference: "r-1" },
    ]) {
      expect(isBlankTwin("classLog", row("a", overrides))).toBe(false);
    }
    expect(isBlankTwin("grades", createGrade({ workStatus: "On time" }))).toBe(true);
    expect(isBlankTwin("grades", createGrade({ score: 0 }))).toBe(false);
    expect(isBlankTwin("grades", createGrade({ workStatus: "Missing" }))).toBe(false);
    expect(sameTwinContent(row("a", paid), row("b", { ...paid }))).toBe(true);
  });

  it("edits the stored twin instead of adding a second record, and refuses different marks", () => {
    const stored = [row("cloud", paid)];
    expect(adoptStoredTwins("classLog", stored, [row("", paid)])).toEqual(stored);
    expect(adoptStoredTwins("classLog", stored, [row("new", { attendance: null })])).toEqual(stored);
    expect(adoptStoredTwins("classLog", [row("cloud", { attendance: null })], [row("new", paid)])).toEqual([
      row("cloud", paid),
    ]);
    expect(() => adoptStoredTwins("classLog", stored, [row("new", { attendance: "A" })])).toThrow(DuplicateRecordError);

    // Records already stored, another group's class at that time, and rows without a time are not twins.
    const own = row("cloud", { attendance: "A" });
    expect(adoptStoredTwins("classLog", stored, [own])).toEqual([own]);
    const otherGroup = row("new", { groupId: "h", attendance: "A" });
    expect(adoptStoredTwins("classLog", stored, [otherGroup])).toEqual([otherGroup]);
    const untimed = row("new", { startTime: "", attendance: "A" });
    expect(adoptStoredTwins("classLog", [row("cloud", { startTime: "", ...paid })], [untimed])).toEqual([untimed]);
    expect(adoptStoredTwins("students", stored, [own])).toEqual([own]);
  });
});
