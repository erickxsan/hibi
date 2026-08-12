import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./importRecords.js";
import {
  createClassLogRow,
  createClassSchedule,
  createGrade,
  createGroup,
  createScheduleChange,
  createScheduleException,
  createStudent,
} from "./ids.js";
import { generateScheduledOccurrences } from "./schedule.js";
import { createStarterState } from "./starterState.js";
import { serializeState } from "./storage.js";

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
    imported.students.push(
      createStudent({
        id: "student-new",
        code: "STU-002",
        fullName: "Luis",
        groupIds: ["group-new"],
        studentEmail: "luis@example.com",
        guardianPhone: "272 555 0102",
      }),
    );

    const plan = buildImportPlan(current, imported);

    expect(plan.summary.added).toBe(2);
    expect(plan.candidate.settings.hourlyRate).toBe(75);
    expect(plan.candidate.groups.map((item) => item.id)).toEqual(["group-current", "group-new"]);
    expect(plan.candidate.students.map((item) => item.id)).toEqual(["student-current", "student-new"]);
    expect(plan.candidate.students[1]).toMatchObject({
      studentEmail: "luis@example.com",
      guardianPhone: "272 555 0102",
    });
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
    imported.students.push(
      createStudent({ id: "foreign-student", code: "STU-001", fullName: "Ana", groupIds: ["foreign-group"] }),
    );
    imported.classLog.push(
      createClassLogRow({
        id: "foreign-class",
        classDate: "2026-07-27",
        studentId: "foreign-student",
        groupId: "foreign-group",
        hours: 2,
        appliedHourlyRate: 50,
        appliedCharge: 100,
        amountPaid: 0,
      }),
    );

    const plan = buildImportPlan(current, imported);

    expect(plan.summary.duplicates).toBe(2);
    expect(plan.summary.added).toBe(1);
    expect(plan.candidate.classLog[0]).toMatchObject({ studentId: "student-current", groupId: "group-current" });
  });

  it("keeps current conflicting information by default", () => {
    const current = stateWithRoster();
    const imported = createStarterState();
    imported.students.push(
      createStudent({ id: "foreign-student", code: "STU-001", fullName: "Ana Updated", groupIds: [] }),
    );

    const plan = buildImportPlan(current, imported);

    expect(plan.summary).toMatchObject({ conflicts: 1, kept: 1, updated: 0 });
    expect(plan.candidate.students[0].fullName).toBe("Ana");
  });

  it("updates only an explicitly approved conflict and preserves its stable ID", () => {
    const current = stateWithRoster();
    const imported = createStarterState();
    imported.students.push(
      createStudent({ id: "foreign-student", code: "STU-001", fullName: "Ana Updated", groupIds: [] }),
    );
    const preview = buildImportPlan(current, imported);
    const conflict = preview.entries.find((entry) => entry.status === "conflict");

    const approved = buildImportPlan(current, imported, { [conflict.key]: "use-imported" });

    expect(approved.summary).toMatchObject({ conflicts: 1, kept: 0, updated: 1 });
    expect(approved.candidate.students[0]).toMatchObject({ id: "student-current", fullName: "Ana Updated" });
  });

  it("does not duplicate a grade or class with the same business identity", () => {
    const current = stateWithRoster();
    current.grades.push(
      createGrade({
        id: "grade-current",
        date: "2026-07-27",
        studentId: "student-current",
        assessment: "Quiz",
        maxScore: 10,
        score: 8,
      }),
    );
    current.classLog.push(
      createClassLogRow({
        id: "class-current",
        classDate: "2026-07-27",
        startTime: "10:00",
        studentId: "student-current",
        groupId: "group-current",
        hours: 2,
        appliedHourlyRate: 50,
        appliedCharge: 100,
        amountPaid: 0,
      }),
    );
    const imported = stateWithRoster();
    imported.grades.push(
      createGrade({
        id: "grade-other",
        date: "2026-07-27",
        studentId: "student-current",
        assessment: "Quiz",
        maxScore: 10,
        score: 9,
      }),
    );
    imported.classLog.push(
      createClassLogRow({
        id: "class-other",
        classDate: "2026-07-27",
        startTime: "10:00",
        studentId: "student-current",
        groupId: "group-current",
        hours: 2,
        appliedHourlyRate: 50,
        appliedCharge: 100,
        amountPaid: 50,
      }),
    );

    const plan = buildImportPlan(current, imported);

    expect(plan.summary.conflicts).toBe(2);
    expect(plan.candidate.grades).toHaveLength(1);
    expect(plan.candidate.classLog).toHaveLength(1);
  });

  it("remaps the complete schedule graph before merging records", () => {
    const current = createStarterState();
    current.groups.push(
      createGroup({
        id: "group-current",
        name: "Math",
        weeklySchedule: [{ id: "slot-current", dayOfWeek: 1, startTime: "10:00", durationHours: 1 }],
      }),
    );
    current.students.push(
      createStudent({
        id: "student-current",
        code: "STU-001",
        fullName: "Ana",
        groupIds: ["group-current"],
      }),
    );
    current.classSchedules.push(
      createClassSchedule({
        id: "schedule-current",
        recurrence: "weekly",
        format: "group",
        groupId: "group-current",
        startDate: "2026-08-11",
        startTime: "11:00",
        durationHours: 1,
        daysOfWeek: [2],
        participantMode: "custom",
        participantIds: ["student-current"],
      }),
    );

    const imported = createStarterState();
    imported.groups.push(
      createGroup({
        id: "group-imported",
        name: "Math",
        notes: "Imported update",
        weeklySchedule: [{ id: "slot-imported", dayOfWeek: 1, startTime: "10:00", durationHours: 1 }],
      }),
    );
    imported.students.push(
      createStudent({
        id: "student-imported",
        code: "STU-001",
        fullName: "Ana",
        groupIds: ["group-imported"],
      }),
    );
    imported.classSchedules.push(
      createClassSchedule({
        id: "schedule-imported",
        recurrence: "weekly",
        format: "group",
        groupId: "group-imported",
        startDate: "2026-08-11",
        startTime: "11:00",
        durationHours: 1,
        daysOfWeek: [2],
        participantMode: "custom",
        participantIds: ["student-imported"],
      }),
    );
    imported.scheduleExceptions.push(
      createScheduleException({
        id: "group-exception",
        sourceGroupId: "group-imported",
        sourceScheduleSlotId: "slot-imported",
        groupId: "group-imported",
        format: "group",
        scheduleSlotId: "slot-imported",
        occurrenceDate: "2026-08-10",
        classDate: "2026-08-10",
        startTime: "10:30",
        durationHours: 1,
        participantMode: "custom",
        participantIds: ["student-imported"],
      }),
      createScheduleException({
        id: "class-schedule-exception",
        classScheduleId: "schedule-imported",
        sourceScheduleSlotId: "schedule-imported",
        groupId: "group-imported",
        format: "group",
        scheduleSlotId: "schedule-imported",
        occurrenceDate: "2026-08-11",
        classDate: "2026-08-11",
        startTime: "11:30",
        durationHours: 1,
        participantMode: "custom",
        participantIds: ["student-imported"],
      }),
    );
    imported.scheduleChanges.push(
      createScheduleChange({
        id: "schedule-change",
        groupId: "group-imported",
        scheduleSlotId: "slot-imported",
        effectiveFrom: "2026-08-17",
        dayOfWeek: 1,
        startTime: "12:00",
        durationHours: 1,
      }),
    );
    imported.classLog.push(
      createClassLogRow({
        id: "class-log",
        classDate: "2026-08-11",
        startTime: "11:30",
        studentId: "student-imported",
        groupId: "group-imported",
        scheduleSlotId: "schedule-imported",
        hours: 1,
        appliedHourlyRate: 50,
        appliedCharge: 50,
        amountPaid: 0,
      }),
    );
    imported.grades.push(
      createGrade({
        id: "grade",
        date: "2026-08-11",
        studentId: "student-imported",
        assessment: "Quiz",
        score: 8,
        maxScore: 10,
        classSessionKey: "2026-08-11|g:group-imported|11:30",
      }),
    );

    const plan = buildImportPlan(current, imported);
    const [groupException, classScheduleException] = plan.candidate.scheduleExceptions;

    expect(plan.candidate.classSchedules).toHaveLength(1);
    expect(plan.entries.find((entry) => entry.collection === "classSchedules")?.status).toBe("duplicate");
    expect(plan.candidate.classSchedules[0].participantIds).toEqual(["student-current"]);
    expect(groupException).toMatchObject({
      sourceGroupId: "group-current",
      sourceScheduleSlotId: "slot-current",
      groupId: "group-current",
      scheduleSlotId: "slot-current",
      participantIds: ["student-current"],
    });
    expect(classScheduleException).toMatchObject({
      classScheduleId: "schedule-current",
      sourceScheduleSlotId: "schedule-current",
      groupId: "group-current",
      scheduleSlotId: "schedule-current",
      participantIds: ["student-current"],
    });
    expect(plan.candidate.scheduleChanges[0]).toMatchObject({
      groupId: "group-current",
      scheduleSlotId: "slot-current",
    });
    expect(plan.candidate.classLog[0]).toMatchObject({
      studentId: "student-current",
      groupId: "group-current",
      scheduleSlotId: "schedule-current",
    });
    expect(plan.candidate.grades[0]).toMatchObject({
      studentId: "student-current",
      classSessionKey: "2026-08-11|g:group-current|11:30",
    });
    expect(() => serializeState(plan.candidate)).not.toThrow();
    expect(
      generateScheduledOccurrences(plan.candidate, "2026-08-10", "2026-08-18").map((item) => item.startTime),
    ).toEqual(expect.arrayContaining(["10:30", "11:30", "12:00"]));

    const groupConflict = plan.entries.find((entry) => entry.collection === "groups" && entry.status === "conflict");
    const approved = buildImportPlan(current, imported, { [groupConflict.key]: "use-imported" });
    expect(approved.candidate.groups[0].weeklySchedule[0].id).toBe("slot-current");
    expect(() => serializeState(approved.candidate)).not.toThrow();
  });
});
