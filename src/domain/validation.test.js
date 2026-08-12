import { describe, expect, it } from "vitest";
import {
  createClassLogRow,
  createClassSchedule,
  createGrade,
  createGroup,
  createScheduleChange,
  createScheduleException,
  createSeedState,
  createStarterState,
  createStudent,
  normalizeState,
  validateClassLogRow,
  validateGrade,
  validateState,
  validateStudent,
} from "./index.js";

describe("state and entity validation", () => {
  it("accepts the canonical seed", () => {
    expect(validateState(createSeedState())).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("rejects unsupported versions, duplicate IDs/codes, and broken references", () => {
    const state = createSeedState();
    state.version = 99;
    state.students[1].id = state.students[0].id;
    state.students[1].code = state.students[0].code;
    state.grades[0].studentId = "missing-student";
    const checked = validateState(state);

    expect(checked.valid).toBe(false);
    expect(checked.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["unsupported_version", "duplicate", "duplicate_id", "unknown_reference"]),
    );
  });

  it("normalizes form strings without collapsing blank and zero", () => {
    const state = createSeedState();
    state.grades[0].score = "";
    state.grades[1].score = "0";
    state.classLog[0].hours = "";
    state.classLog[1].hours = "0";
    state.classLog[0].amountPaid = "";
    state.classLog[1].amountPaid = "0";
    const normalized = normalizeState(state);

    expect(normalized.grades[0].score).toBeNull();
    expect(normalized.grades[1].score).toBe(0);
    expect(normalized.classLog[0].hours).toBeNull();
    expect(normalized.classLog[1].hours).toBe(0);
    expect(normalized.classLog[0].amountPaid).toBeNull();
    expect(normalized.classLog[1].amountPaid).toBe(0);
    expect(normalized.students[0].id).toBe(state.students[0].id);
  });

  it("provides CRUD-friendly entity checks", () => {
    const state = createSeedState();
    const duplicateStudent = createStudent({
      code: state.students[0].code,
      fullName: "Another student",
      groupId: state.groups[0].id,
    });
    expect(validateStudent(duplicateStudent, state).errors[0].code).toBe("duplicate");

    const invalidEmail = createStudent({ code: "EMAIL-01", fullName: "Email check", studentEmail: "not-an-email" });
    expect(validateStudent(invalidEmail, state).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_email", path: "studentEmail" })]),
    );

    const blankGrade = createGrade({ studentId: state.students[0].id, date: "2026-07-10", assessment: "Quiz" });
    expect(validateGrade(blankGrade, state).errors.some((error) => error.path === "maxScore")).toBe(true);

    const completed = createClassLogRow({
      studentId: state.students[0].id,
      classDate: "2026-07-10",
      attendance: null,
    });
    expect(validateClassLogRow(completed, state).valid).toBe(true);
    expect(validateClassLogRow(completed, state).warnings[0].code).toBe("attendance_missing");
  });

  it("accepts unassigned students but rejects a nonblank unknown group", () => {
    const state = createStarterState();
    const unassigned = createStudent({ code: "NEW-001", fullName: "Unassigned Student", groupIds: [] });
    expect(validateStudent(unassigned, state).valid).toBe(true);

    const unknownGroup = { ...unassigned, id: "student_unknown_group", code: "NEW-002", groupIds: ["missing-group"] };
    expect(validateStudent(unknownGroup, state).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown_reference", path: "groupIds" })]),
    );
    expect(validateState(state).valid).toBe(true);
  });

  it("normalizes legacy enrollment and supports individual plus multiple groups", () => {
    const state = createSeedState();
    const legacy = { ...state.students[0] };
    delete legacy.groupIds;
    delete legacy.isIndividual;
    legacy.groupId = state.groups[0].id;
    const normalized = normalizeState({ ...state, students: [legacy] });
    expect(normalized.students[0].groupIds).toEqual([state.groups[0].id]);
    expect(normalized.students[0].isIndividual).toBe(false);

    const hybrid = createStudent({
      code: "HYB-001",
      fullName: "Hybrid Student",
      isIndividual: true,
      groupIds: state.groups.map((group) => group.id),
    });
    expect(validateStudent(hybrid, state).valid).toBe(true);
  });

  it("backfills a legacy class group only when the relationship is unambiguous", () => {
    const state = createSeedState();
    const student = state.students[0];
    const groupId = state.groups[0].id;
    const legacy = {
      ...state,
      students: [{ ...student, groupId, groupIds: undefined }],
      classLog: [{ ...state.classLog[0], studentId: student.id, groupId: undefined }],
    };
    const normalized = normalizeState(legacy);
    expect(normalized.students[0].id).toBe(student.id);
    expect(normalized.students[0].groupIds).toEqual([groupId]);
    expect(normalized.classLog[0].groupId).toBe(groupId);

    const ambiguous = normalizeState({
      ...legacy,
      students: [{ ...student, groupId: undefined, groupIds: state.groups.map((group) => group.id) }],
    });
    expect(ambiguous.classLog[0].groupId).toBe("");
  });

  it("rejects an unsupported currency", () => {
    const state = createStarterState();
    state.settings.currency = "USD";

    expect(validateState(state).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_enum", path: "settings.currency" })]),
    );
  });

  it("rejects broken references anywhere in the schedule graph", () => {
    const state = createStarterState();
    state.groups.push(
      createGroup({
        id: "group-valid",
        name: "Math",
        weeklySchedule: [{ id: "slot-valid", dayOfWeek: 1, startTime: "10:00", durationHours: 1 }],
      }),
    );
    state.students.push(
      createStudent({ id: "student-valid", code: "STU-001", fullName: "Ana", groupIds: ["group-valid"] }),
    );
    state.grades.push(
      createGrade({
        id: "grade",
        date: "2026-08-10",
        studentId: "student-valid",
        assessment: "Quiz",
        score: 8,
        maxScore: 10,
        classSessionKey: "2026-08-10|g:missing-session-group|10:00",
      }),
    );
    state.classSchedules.push(
      createClassSchedule({
        id: "schedule-valid",
        recurrence: "weekly",
        groupId: "group-valid",
        startDate: "2026-08-10",
        startTime: "11:00",
        daysOfWeek: [1],
        participantMode: "custom",
        participantIds: ["missing-schedule-participant"],
      }),
    );
    state.classLog.push(
      createClassLogRow({
        id: "class-log",
        classDate: "2026-08-10",
        studentId: "student-valid",
        groupId: "group-valid",
        scheduleSlotId: "missing-log-slot",
        hours: 1,
        appliedHourlyRate: 50,
        appliedCharge: 50,
        amountPaid: 0,
      }),
    );
    state.scheduleExceptions.push(
      createScheduleException({
        id: "exception",
        classScheduleId: "missing-class-schedule",
        sourceGroupId: "missing-source-group",
        sourceScheduleSlotId: "missing-source-slot",
        groupId: "group-valid",
        scheduleSlotId: "missing-exception-slot",
        occurrenceDate: "2026-08-10",
        classDate: "2026-08-10",
        startTime: "10:00",
        durationHours: 1,
        participantMode: "custom",
        participantIds: ["missing-exception-participant"],
      }),
    );
    state.scheduleChanges.push(
      createScheduleChange({
        id: "change",
        groupId: "group-valid",
        scheduleSlotId: "missing-change-slot",
        effectiveFrom: "2026-08-10",
        startTime: "10:00",
        durationHours: 1,
      }),
    );

    expect(validateState(state).errors.map((error) => error.path)).toEqual(
      expect.arrayContaining([
        "classSchedules[0].participantIds[0]",
        "grades[0].classSessionKey",
        "classLog[0].scheduleSlotId",
        "scheduleExceptions[0].classScheduleId",
        "scheduleExceptions[0].sourceGroupId",
        "scheduleExceptions[0].sourceScheduleSlotId",
        "scheduleExceptions[0].scheduleSlotId",
        "scheduleExceptions[0].participantIds[0]",
        "scheduleChanges[0].scheduleSlotId",
      ]),
    );
  });
});
