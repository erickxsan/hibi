import { describe, expect, it } from "vitest";
import {
  buildClassWorkspaceSessions,
  buildClassWorkspaceSessionsForRange,
  duplicateRecurringSlots,
  filterClassHistory,
  groupRecurringSlots,
  paymentRecordState,
  rosterForClassSession,
  selectPrimaryClassSession,
} from "./classesWorkspaceModel";

const state = {
  settings: { defaultClassHours: 2 },
  groups: [{ id: "g1", name: "Math", weeklySchedule: [] }],
  students: [
    { id: "s1", fullName: "Ana", groupIds: ["g1"], status: "Active" },
    { id: "s2", fullName: "Ben", groupIds: ["g1"], status: "Inactive" },
  ],
  classSchedules: [
    {
      id: "cs1",
      recurrence: "weekly",
      format: "group",
      groupId: "g1",
      studentId: "",
      startDate: "2026-07-01",
      startTime: "10:00",
      durationHours: 2,
      intervalWeeks: 1,
      daysOfWeek: [3],
    },
  ],
  classLog: [],
  scheduleExceptions: [],
  scheduleChanges: [],
};

describe("classes workspace model", () => {
  it("creates pending and future sessions and picks the current due class", () => {
    const sessions = buildClassWorkspaceSessions(state, "2026-07-15");
    expect(sessions.find((item) => item.classDate === "2026-07-08")?.statusLabel).toBe("Pending");
    expect(selectPrimaryClassSession(sessions, "2026-07-15", "11:00")?.classDate).toBe("2026-07-15");
  });

  it("never promotes a phantom past occurrence when there is no class today", () => {
    const sessions = buildClassWorkspaceSessions(state, "2026-07-16");
    expect(selectPrimaryClassSession(sessions, "2026-07-16", "11:00")?.classDate).toBe("2026-07-22");
  });

  it("keeps the current class selected until its scheduled end", () => {
    const sessions = [
      { key: "current", classDate: "2026-07-15", startTime: "10:00", durationHours: 2, statusLabel: "Scheduled" },
      { key: "next", classDate: "2026-07-15", startTime: "12:00", durationHours: 2, statusLabel: "Scheduled" },
    ];
    expect(selectPrimaryClassSession(sessions, "2026-07-15", "10:20")?.key).toBe("current");
    expect(selectPrimaryClassSession(sessions, "2026-07-15", "12:00")?.key).toBe("next");
  });

  it("prefers the next class today after an earlier unregistered class has ended", () => {
    const sessions = [
      { key: "earlier", classDate: "2026-07-15", startTime: "09:00", durationHours: 1, statusLabel: "Pending" },
      { key: "next", classDate: "2026-07-15", startTime: "13:00", durationHours: 2, statusLabel: "Scheduled" },
    ];
    expect(selectPrimaryClassSession(sessions, "2026-07-15", "11:00")?.key).toBe("next");
  });

  it("loads only active group students", () => {
    const session = buildClassWorkspaceSessions(state, "2026-07-15").find((item) => item.classDate === "2026-07-15");
    expect(rosterForClassSession(state, session).map((item) => item.id)).toEqual(["s1"]);
  });

  it("preserves explicit payment states and filters history", () => {
    expect(paymentRecordState({ paymentState: "Unpaid", amountPaid: 0 }, 100)).toBe("Unpaid");
    const rows = [
      {
        title: "Math",
        statusLabel: "Registered",
        classDate: "2026-07-10",
        startTime: "10:00",
        groupId: "g1",
        rows: [{ id: "saved" }],
      },
    ];
    expect(filterClassHistory(rows, { search: "math", status: "Registered" })).toHaveLength(1);
  });

  it("keeps virtual past occurrences out of history without hiding saved or cancelled classes", () => {
    const rows = [
      { key: "phantom", title: "Math", statusLabel: "Pending", classDate: "2026-07-01", rows: [] },
      { key: "saved", title: "Math", statusLabel: "Registered", classDate: "2026-07-02", rows: [{ id: "log" }] },
      { key: "cancelled", title: "Math", statusLabel: "Cancelled", classDate: "2026-07-03", rows: [] },
    ];
    expect(filterClassHistory(rows).map((session) => session.key)).toEqual(["cancelled", "saved"]);
  });

  it("builds an exact calendar range without dropping scheduled classes", () => {
    const sessions = buildClassWorkspaceSessionsForRange(state, "2026-07-01", "2026-07-31", "2026-07-15");
    expect(sessions.map((session) => session.classDate)).toEqual([
      "2026-07-01",
      "2026-07-08",
      "2026-07-15",
      "2026-07-22",
      "2026-07-29",
    ]);
  });
});

describe("recurring slots of a group", () => {
  const groupState = {
    groups: [
      {
        id: "g1",
        name: "S SA 2 - 4",
        weeklySchedule: [
          { id: "sat", dayOfWeek: 6, startTime: "14:00", durationHours: 2 },
          { id: "sun", dayOfWeek: 7, startTime: "08:00", durationHours: 2 },
        ],
      },
    ],
    scheduleChanges: [
      { groupId: "g1", scheduleSlotId: "sun", effectiveFrom: "2026-10-01", startTime: "09:00" },
      { groupId: "g1", scheduleSlotId: "sat", effectiveFrom: "2026-12-01", startTime: "15:00" },
    ],
    classSchedules: [
      { id: "series", groupId: "g1", recurrence: "weekly", daysOfWeek: [4], startTime: "17:00", durationHours: 1 },
      { id: "ended", groupId: "g1", recurrence: "weekly", daysOfWeek: [1], startTime: "17:00", endDate: "2026-09-30" },
      { id: "once", groupId: "g1", recurrence: "once", daysOfWeek: [2], startTime: "17:00" },
      { id: "other", groupId: "g2", recurrence: "weekly", daysOfWeek: [6], startTime: "14:00" },
    ],
  };

  it("lists the weekly schedule (with changes in effect) and open recurring series", () => {
    expect(groupRecurringSlots(groupState, "g1", "2026-10-23")).toEqual([
      { source: "series", dayOfWeek: 4, startTime: "17:00", durationHours: 1 },
      { source: "weekly", dayOfWeek: 6, startTime: "14:00", durationHours: 2 },
      { source: "weekly", dayOfWeek: 7, startTime: "09:00", durationHours: 2 },
    ]);
    expect(groupRecurringSlots(groupState, "", "2026-10-23")).toEqual([]);
  });

  it("finds a new series that repeats a slot of the same group, weekday and time", () => {
    const slots = groupRecurringSlots(groupState, "g1", "2026-10-23");
    // Picker weekdays: 6 = Saturday, 0 = Sunday.
    expect(duplicateRecurringSlots(slots, { days: [6], startTime: "14:00" })).toEqual([slots[1]]);
    expect(duplicateRecurringSlots(slots, { days: [0], startTime: "09:00" })).toEqual([slots[2]]);
    expect(duplicateRecurringSlots(slots, { days: [6], startTime: "16:00" })).toEqual([]);
    expect(duplicateRecurringSlots(slots, { days: [5], startTime: "14:00" })).toEqual([]);
  });
});
