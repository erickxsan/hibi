import { describe, expect, it } from "vitest";
import {
  createClassSchedule,
  createClassLogRow,
  createGroup,
  createStarterState,
  createStudent,
  deserializeState,
  editScheduledClassState,
  generateScheduledOccurrences,
  removeScheduledClassState,
  scheduledClassSupportsFutureScope,
  serializeState,
  validateState,
} from "./index.js";

function recurringState() {
  const state = createStarterState("2026-08-02");
  state.groups = [createGroup({ id: "group-a", name: "Group A" })];
  state.students = [createStudent({ id: "student-a", code: "STU-001", fullName: "Ana", groupIds: ["group-a"] })];
  state.classSchedules = [
    createClassSchedule({
      id: "series-a",
      recurrence: "weekly",
      format: "group",
      groupId: "group-a",
      startDate: "2026-07-06",
      startTime: "10:00",
      durationHours: 2,
      daysOfWeek: [1],
    }),
  ];
  state.classLog = [
    createClassLogRow({
      id: "recorded-past",
      classDate: "2026-07-27",
      startTime: "10:00",
      groupId: "group-a",
      studentId: "student-a",
      classStatus: "Completed",
      attendance: "P",
    }),
  ];
  return state;
}

function occurrence(state, date) {
  return generateScheduledOccurrences(state, date, date).find((item) => item.classDate === date);
}

describe("safe scheduled class mutations", () => {
  it("treats a closed editor with no selected class as non-recurring", () => {
    expect(scheduledClassSupportsFutureScope(recurringState(), null)).toBe(false);
  });

  it("edits one occurrence without modifying the series or its past records", () => {
    const state = recurringState();
    const beforeSchedule = structuredClone(state.classSchedules[0]);
    const beforeLog = structuredClone(state.classLog);
    const session = occurrence(state, "2026-08-03");

    const next = editScheduledClassState(state, {
      session,
      scope: "occurrence",
      asOfDate: "2026-08-02",
      draft: { ...session, classDate: "2026-08-04", startTime: "11:30", durationHours: 1.5 },
    });

    expect(next.classSchedules[0]).toEqual(beforeSchedule);
    expect(next.classLog).toEqual(beforeLog);
    expect(next.scheduleExceptions).toHaveLength(1);
    expect(next.scheduleExceptions[0].id).toBeTruthy();
    expect(occurrence(next, "2026-07-27")).toMatchObject({ classDate: "2026-07-27", startTime: "10:00" });
    expect(occurrence(next, "2026-08-04")).toMatchObject({ occurrenceDate: "2026-08-03", startTime: "11:30" });
  });

  it("splits a recurring series for this and future classes while preserving the past", () => {
    const state = recurringState();
    const beforeLog = structuredClone(state.classLog);
    const session = occurrence(state, "2026-08-03");

    const next = editScheduledClassState(state, {
      session,
      scope: "future",
      asOfDate: "2026-08-02",
      draft: { ...session, classDate: "2026-08-05", startTime: "12:00", durationHours: 1 },
    });

    expect(next.classLog).toEqual(beforeLog);
    expect(next.classSchedules).toHaveLength(2);
    expect(next.classSchedules.find((item) => item.id === "series-a")?.endDate).toBe("2026-08-02");
    expect(occurrence(next, "2026-07-27")).toMatchObject({ classDate: "2026-07-27", startTime: "10:00" });
    expect(occurrence(next, "2026-08-03")).toBeUndefined();
    expect(occurrence(next, "2026-08-05")).toMatchObject({ startTime: "12:00", durationHours: 1 });
    expect(occurrence(next, "2026-08-12")).toMatchObject({ startTime: "12:00", durationHours: 1 });

    const validation = validateState(next);
    expect(validation.errors).toEqual([]);
    const persisted = deserializeState(serializeState(next));
    expect(persisted.classSchedules.find((item) => item.id === "series-a")?.endDate).toBe("2026-08-02");
    expect(occurrence(persisted, "2026-07-27")).toMatchObject({ classDate: "2026-07-27", startTime: "10:00" });
    expect(occurrence(persisted, "2026-08-05")).toMatchObject({ startTime: "12:00" });
  });

  it("removes only one occurrence and keeps the rest of the series", () => {
    const state = recurringState();
    const session = occurrence(state, "2026-08-03");
    const next = removeScheduledClassState(state, { session, scope: "occurrence", asOfDate: "2026-08-02" });

    expect(occurrence(next, "2026-08-03")).toMatchObject({ status: "Cancelled" });
    expect(occurrence(next, "2026-08-10")).toMatchObject({ status: "Scheduled" });
    expect(next.classLog).toEqual(state.classLog);
  });

  it("ends a recurring series without deleting earlier classes", () => {
    const state = recurringState();
    const session = occurrence(state, "2026-08-03");
    const next = removeScheduledClassState(state, { session, scope: "future", asOfDate: "2026-08-02" });

    expect(occurrence(next, "2026-07-27")).toBeTruthy();
    expect(occurrence(next, "2026-08-03")).toBeUndefined();
    expect(occurrence(next, "2026-08-10")).toBeUndefined();
    expect(next.classLog).toEqual(state.classLog);
  });

  it("rejects edits to past or already recorded classes", () => {
    const state = recurringState();
    const future = occurrence(state, "2026-08-03");
    const past = occurrence(state, "2026-07-27");
    const draft = { ...future, classDate: "2026-08-03" };

    expect(() => editScheduledClassState(state, { session: past, draft, asOfDate: "2026-08-02" })).toThrow(
      /Recorded classes|Past classes/,
    );
    expect(() =>
      editScheduledClassState(state, {
        session: { ...future, rows: [{ id: "saved" }] },
        draft,
        asOfDate: "2026-08-02",
      }),
    ).toThrow(/Recorded classes/);
  });
});
