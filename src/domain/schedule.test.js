import { describe, expect, it } from "vitest";
import {
  createClassSchedule,
  createGroup,
  createStarterState,
  generateScheduledOccurrences,
  importState,
  repriceUnpaidClasses,
  serializeState,
} from "./index.js";
import { startGroupSchedule } from "./groupArchiving.js";

function scheduledState() {
  const state = createStarterState("2026-07-13");
  state.groups = [
    createGroup({
      id: "group_a",
      name: "Group A",
      weeklySchedule: [
        { id: "slot_monday", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
        { id: "slot_thursday", dayOfWeek: 4, startTime: "18:00", durationHours: 1 },
      ],
    }),
  ];
  return state;
}

describe("recurring class schedules", () => {
  it("generates every weekly meeting time and marks recorded occurrences", () => {
    const state = scheduledState();
    state.classLog = [{ groupId: "group_a", classDate: "2026-07-13", startTime: "16:00" }];
    const rows = generateScheduledOccurrences(state, "2026-07-13", "2026-07-19");
    expect(rows.map((row) => [row.classDate, row.startTime, row.durationHours])).toEqual([
      ["2026-07-13", "16:00", 2],
      ["2026-07-16", "18:00", 1],
    ]);
    expect(rows[0].recorded).toBe(true);
  });

  it("supports a one-time reschedule, cancellation, and extra class", () => {
    const state = scheduledState();
    state.scheduleExceptions = [
      {
        id: "move",
        groupId: "group_a",
        scheduleSlotId: "slot_monday",
        occurrenceDate: "2026-07-13",
        classDate: "2026-07-14",
        startTime: "17:00",
        durationHours: 1.5,
        status: "Scheduled",
        kind: "override",
      },
      {
        id: "cancel",
        groupId: "group_a",
        scheduleSlotId: "slot_thursday",
        occurrenceDate: "2026-07-16",
        classDate: "2026-07-16",
        startTime: "18:00",
        durationHours: 1,
        status: "Cancelled",
        kind: "override",
      },
      {
        id: "extra",
        groupId: "group_a",
        scheduleSlotId: "",
        occurrenceDate: "2026-07-18",
        classDate: "2026-07-18",
        startTime: "10:00",
        durationHours: 2,
        status: "Scheduled",
        kind: "added",
      },
    ];
    const rows = generateScheduledOccurrences(state, "2026-07-13", "2026-07-19");
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classDate: "2026-07-14", startTime: "17:00", kind: "override" }),
        expect.objectContaining({ classDate: "2026-07-16", status: "Cancelled" }),
        expect.objectContaining({ classDate: "2026-07-18", kind: "added" }),
      ]),
    );
    expect(rows.some((row) => row.classDate === "2026-07-13")).toBe(false);
  });

  it("changes this and future meetings without altering earlier occurrences", () => {
    const state = scheduledState();
    state.scheduleChanges = [
      {
        id: "future",
        groupId: "group_a",
        scheduleSlotId: "slot_monday",
        effectiveFrom: "2026-07-20",
        dayOfWeek: 3,
        startTime: "17:30",
        durationHours: 1.5,
      },
    ];
    const rows = generateScheduledOccurrences(state, "2026-07-13", "2026-07-31").filter(
      (row) => row.scheduleSlotId === "slot_monday",
    );
    expect(rows.map((row) => [row.classDate, row.startTime])).toEqual([
      ["2026-07-13", "16:00"],
      ["2026-07-22", "17:30"],
      ["2026-07-29", "17:30"],
    ]);
  });

  it("starts a new group's schedule on its creation day without hiding classes added on purpose", () => {
    const state = scheduledState();
    // Created on Thursday 2026-07-16: Monday the 13th was before the group existed.
    state.groups = [startGroupSchedule(state.groups[0], "2026-07-16")];
    state.classSchedules = [
      createClassSchedule({
        id: "backdated",
        groupId: "group_a",
        startDate: "2026-07-14",
        startTime: "12:00",
        durationHours: 1,
        daysOfWeek: [2],
      }),
    ];
    const rows = generateScheduledOccurrences(state, "2026-07-13", "2026-07-20");
    expect(rows.map((row) => [row.classDate, row.startTime, row.kind])).toEqual([
      ["2026-07-14", "12:00", "added"],
      ["2026-07-16", "18:00", "recurring"],
      ["2026-07-20", "16:00", "recurring"],
    ]);
    expect(startGroupSchedule(state.groups[0], "2026-07-30").scheduleResumeDate).toBe("2026-07-16");
    const restored = importState(serializeState(state));
    expect(restored.groups[0].scheduleResumeDate).toBe("2026-07-16");
  });
});

describe("a student's own rate on classes they still owe", () => {
  const row = (fields) => ({
    studentId: "s1",
    groupId: "g1",
    classStatus: "Completed",
    attendance: "P",
    hours: 2,
    appliedHourlyRate: 50,
    appliedCharge: 100,
    amountPaid: 0,
    ...fields,
  });
  const state = {
    settings: { hourlyRate: 50, defaultClassHours: 2 },
    groups: [{ id: "g1", hourlyRate: null }],
    students: [{ id: "s1", customHourlyRate: null }],
    classLog: [
      row({ id: "owed" }),
      row({ id: "absent", attendance: "A", appliedCharge: 0 }),
      row({ id: "paid", amountPaid: 100 }),
      row({ id: "cancelled", classStatus: "Cancelled", appliedCharge: 0 }),
      row({ id: "handSet", appliedCharge: 70 }),
      row({ id: "other", studentId: "s2" }),
    ],
  };
  const byId = (log) => Object.fromEntries(log.map((item) => [item.id, item]));

  it("reprices unpaid classes and leaves paid, cancelled and hand-set ones alone", () => {
    const log = byId(repriceUnpaidClasses(state, state.students[0], { id: "s1", customHourlyRate: 80 }));
    expect(log.owed).toMatchObject({ appliedHourlyRate: 80, appliedCharge: 160 });
    expect(log.absent).toMatchObject({ appliedHourlyRate: 80, appliedCharge: 0 });
    expect(log.paid).toBe(state.classLog[2]);
    expect(log.cancelled).toBe(state.classLog[3]);
    expect(log.handSet).toBe(state.classLog[4]);
    expect(log.other).toBe(state.classLog[5]);
  });

  it("corrects classes still at the group rate when the own rate was already saved", () => {
    const own = { id: "s1", customHourlyRate: 80 };
    const log = byId(repriceUnpaidClasses({ ...state, students: [own] }, own, own));
    expect(log.owed).toMatchObject({ appliedHourlyRate: 80, appliedCharge: 160 });
  });

  it("goes back to the group rate when the own rate is removed", () => {
    const own = { id: "s1", customHourlyRate: 80 };
    const priced = repriceUnpaidClasses(state, state.students[0], own);
    const log = byId(repriceUnpaidClasses({ ...state, classLog: priced }, own, { id: "s1", customHourlyRate: null }));
    expect(log.owed).toMatchObject({ appliedHourlyRate: 50, appliedCharge: 100 });
  });
});
