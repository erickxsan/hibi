import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./importRecords.js";
import { createClassLogRow, createGrade, createGroup, createStudent } from "./ids.js";
import { createStarterState } from "./starterState.js";

function stateWithRoster() {
  const state = createStarterState();
  const group = createGroup({ id: "group-current", name: "Math" });
  const student = createStudent({ id: "student-current", code: "STU-001", fullName: "Ana", groupIds: [group.id] });
  state.groups.push(group);
  state.students.push(student);
  return state;
}

describe("additive record imports", () => {
  it("adds new records without changing settings or removing current records", () => {
    const current = stateWithRoster();
    current.settings.hourlyRate = 75;
    const imported = createStarterState();
    imported.settings.hourlyRate = 999;
    imported.groups.push(createGroup({ id: "group-new", name: "Reading" }));
    imported.students.push(createStudent({ id: "student-new", code: "STU-002", fullName: "Luis", groupIds: ["group-new"] }));

    const plan = buildImportPlan(current, imported);

    expect(plan.summary.added).toBe(2);
    expect(plan.candidate.settings.hourlyRate).toBe(75);
    expect(plan.candidate.groups.map((item) => item.id)).toEqual(["group-current", "group-new"]);
    expect(plan.candidate.students.map((item) => item.id)).toEqual(["student-current", "student-new"]);
  });

  it("skips exact duplicates and is idempotent", () => {
    const current = stateWithRoster();
    const first = buildImportPlan(current, current);
    const second = buildImportPlan(first.candidate, current);

    expect(first.summary).toMatchObject({ added: 0, duplicates: 2, conflicts: 0 });
    expect(second.summary).toMatchObject({ added: 0, duplicates: 2, conflicts: 0 });
    expect(second.candidate.groups).toHaveLength(1);
    expect(second.candidate.students).toHaveLength(1);
  });

  it("detects semantic duplicates with different IDs and remaps their relationships", () => {
    const current = stateWithRoster();
    const imported = createStarterState();
    imported.groups.push(createGroup({ id: "foreign-group", name: "Math" }));
    imported.students.push(createStudent({ id: "foreign-student", code: "STU-001", fullName: "Ana", groupIds: ["foreign-group"] }));
    imported.classLog.push(createClassLogRow({
      id: "foreign-class",
      classDate: "2026-07-27",
      studentId: "foreign-student",
      groupId: "foreign-group",
      hours: 2,
      appliedHourlyRate: 50,
      appliedCharge: 100,
      amountPaid: 0,
    }));

    const plan = buildImportPlan(current, imported);

    expect(plan.summary.duplicates).toBe(2);
    expect(plan.summary.added).toBe(1);
    expect(plan.candidate.classLog[0]).toMatchObject({ studentId: "student-current", groupId: "group-current" });
  });

  it("keeps current conflicting information by default", () => {
    const current = stateWithRoster();
    const imported = createStarterState();
    imported.students.push(createStudent({ id: "foreign-student", code: "STU-001", fullName: "Ana Updated", groupIds: [] }));

    const plan = buildImportPlan(current, imported);

    expect(plan.summary).toMatchObject({ conflicts: 1, kept: 1, updated: 0 });
    expect(plan.candidate.students[0].fullName).toBe("Ana");
  });

  it("updates only an explicitly approved conflict and preserves its stable ID", () => {
    const current = stateWithRoster();
    const imported = createStarterState();
    imported.students.push(createStudent({ id: "foreign-student", code: "STU-001", fullName: "Ana Updated", groupIds: [] }));
    const preview = buildImportPlan(current, imported);
    const conflict = preview.entries.find((entry) => entry.status === "conflict");

    const approved = buildImportPlan(current, imported, { [conflict.key]: "use-imported" });

    expect(approved.summary).toMatchObject({ conflicts: 1, kept: 0, updated: 1 });
    expect(approved.candidate.students[0]).toMatchObject({ id: "student-current", fullName: "Ana Updated" });
  });

  it("does not duplicate a grade or class with the same business identity", () => {
    const current = stateWithRoster();
    current.grades.push(createGrade({ id: "grade-current", date: "2026-07-27", studentId: "student-current", assessment: "Quiz", maxScore: 10, score: 8 }));
    current.classLog.push(createClassLogRow({ id: "class-current", classDate: "2026-07-27", startTime: "10:00", studentId: "student-current", groupId: "group-current", hours: 2, appliedHourlyRate: 50, appliedCharge: 100, amountPaid: 0 }));
    const imported = stateWithRoster();
    imported.grades.push(createGrade({ id: "grade-other", date: "2026-07-27", studentId: "student-current", assessment: "Quiz", maxScore: 10, score: 9 }));
    imported.classLog.push(createClassLogRow({ id: "class-other", classDate: "2026-07-27", startTime: "10:00", studentId: "student-current", groupId: "group-current", hours: 2, appliedHourlyRate: 50, appliedCharge: 100, amountPaid: 50 }));

    const plan = buildImportPlan(current, imported);

    expect(plan.summary.conflicts).toBe(2);
    expect(plan.candidate.grades).toHaveLength(1);
    expect(plan.candidate.classLog).toHaveLength(1);
  });
});
