import { describe, expect, it } from "vitest";
import {
  deriveAll,
  deserializeState,
  normalizeState,
  serializeState,
  validateState,
} from "./index";

function settings() {
  return {
    currency: "MXN",
    hourlyRate: 50,
    defaultClassHours: 2,
    recentProjectionWeeks: 4,
    lowGradeThreshold: 0.7,
    lowAttendanceThreshold: 0.8,
    selectedMonth: "2026-07-01",
    asOfDate: "2026-07-14",
  };
}

function group(id, name) {
  return { id, name, grade: "", subject: "English", schedule: "", plannedSessionsPerMonth: 8, assistantContact: "", notes: "" };
}

function legacyStudent(overrides = {}) {
  return { id: "student_legacy", code: "LEG-001", fullName: "Legacy Student", groupId: "", phone: "", guardianContact: "", notes: "", status: "Active", ...overrides };
}

function legacyClass(overrides = {}) {
  return { id: "class_legacy", classDate: "2026-07-10", studentId: "student_legacy", classStatus: "Completed", attendance: "P", hours: 2, amountPaid: 50, paymentDate: "2026-07-10", paymentMethod: "Cash", paymentReference: "LEGACY-1", notes: "", ...overrides };
}

describe("legacy workspace compatibility", () => {
  it("keeps an existing account with students but no groups usable", () => {
    const state = normalizeState({ version: 1, settings: settings(), groups: [], students: [legacyStudent()], grades: [], classLog: [legacyClass()] });
    expect(state.students[0]).toMatchObject({ id: "student_legacy", avatarId: "", groupIds: [], isIndividual: false });
    expect(state.classLog[0]).toMatchObject({ id: "class_legacy", groupId: "" });
    expect(state).toMatchObject({ scheduleExceptions: [], scheduleChanges: [] });
    expect(state.classLog[0]).toMatchObject({ appliedHourlyRate: 50, appliedCharge: 100 });
    const derived = deriveAll(state);
    expect(derived.groups.find((item) => item.isUnassigned)?.studentCount).toBe(1);
    expect(derived.students[0].outstanding).toBe(50);
    state.settings.hourlyRate = 500;
    expect(deriveAll(state).classLog[0].charge).toBe(100);
  });

  it("preserves IDs, grades, notes, payments, settings, and a legacy group relationship", () => {
    const groups = [group("group_one", "Group One"), group("group_two", "Group Two")];
    const raw = {
      version: 1,
      settings: settings(),
      groups,
      students: [legacyStudent({ groupId: "group_one", notes: "Keep this note" })],
      grades: [{ id: "grade_legacy", date: "2026-07-09", studentId: "student_legacy", assessment: "Quiz", category: "Quiz", score: 8, maxScore: 10, workStatus: "On time", feedback: "Keep feedback" }],
      classLog: [legacyClass()],
    };
    const state = deserializeState(JSON.stringify(raw));
    expect(state.students[0]).toMatchObject({ id: "student_legacy", groupIds: ["group_one"], notes: "Keep this note" });
    expect(state.grades[0]).toMatchObject({ id: "grade_legacy", feedback: "Keep feedback" });
    expect(state.classLog[0]).toMatchObject({ id: "class_legacy", groupId: "group_one", paymentReference: "LEGACY-1" });
    expect(state.settings).toEqual(settings());
    expect(validateState(state).valid).toBe(true);
  });

  it("round-trips new individual and multiple-group records without changing relationships", () => {
    const groups = [group("group_one", "Group One"), group("group_two", "Group Two")];
    const state = normalizeState({
      version: 1,
      settings: settings(),
      groups,
      students: [{ ...legacyStudent(), groupId: undefined, groupIds: groups.map((item) => item.id), isIndividual: true }],
      grades: [],
      classLog: [
        { ...legacyClass({ id: "class_group", groupId: "group_two", startTime: "16:00", classTitle: "Group lesson" }) },
        { ...legacyClass({ id: "class_individual", groupId: "", startTime: "18:00", classTitle: "Individual lesson" }) },
      ],
    });
    const restored = deserializeState(serializeState(state));
    expect(restored.students[0]).toMatchObject({ id: "student_legacy", groupIds: ["group_one", "group_two"], isIndividual: true });
    expect(restored.classLog.map((row) => [row.id, row.groupId, row.startTime])).toEqual([
      ["class_group", "group_two", "16:00"],
      ["class_individual", "", "18:00"],
    ]);
  });

  it("keeps optional or incomplete legacy values valid and predictable", () => {
    const state = normalizeState({
      version: 1,
      settings: settings(),
      groups: [group("group_one", "Group One")],
      students: [legacyStudent({ groupId: "group_one", phone: undefined, guardianContact: undefined, notes: undefined })],
      grades: [],
      classLog: [],
    });
    expect(state.students[0]).toMatchObject({ phone: "", guardianContact: "", notes: "" });
    expect(validateState(state).valid).toBe(true);
  });
});
