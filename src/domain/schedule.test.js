import { describe, expect, it } from "vitest";
import { createGroup, createStarterState, generateScheduledOccurrences } from "./index.js";

function scheduledState() {
  const state = createStarterState("2026-07-13");
  state.groups = [createGroup({
    id: "group_a",
    name: "Group A",
    weeklySchedule: [
      { id: "slot_monday", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
      { id: "slot_thursday", dayOfWeek: 4, startTime: "18:00", durationHours: 1 },
    ],
  })];
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
      { id: "move", groupId: "group_a", scheduleSlotId: "slot_monday", occurrenceDate: "2026-07-13", classDate: "2026-07-14", startTime: "17:00", durationHours: 1.5, status: "Scheduled", kind: "override" },
      { id: "cancel", groupId: "group_a", scheduleSlotId: "slot_thursday", occurrenceDate: "2026-07-16", classDate: "2026-07-16", startTime: "18:00", durationHours: 1, status: "Cancelled", kind: "override" },
      { id: "extra", groupId: "group_a", scheduleSlotId: "", occurrenceDate: "2026-07-18", classDate: "2026-07-18", startTime: "10:00", durationHours: 2, status: "Scheduled", kind: "added" },
    ];
    const rows = generateScheduledOccurrences(state, "2026-07-13", "2026-07-19");
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ classDate: "2026-07-14", startTime: "17:00", kind: "override" }),
      expect.objectContaining({ classDate: "2026-07-16", status: "Cancelled" }),
      expect.objectContaining({ classDate: "2026-07-18", kind: "added" }),
    ]));
    expect(rows.some((row) => row.classDate === "2026-07-13")).toBe(false);
  });

  it("changes this and future meetings without altering earlier occurrences", () => {
    const state = scheduledState();
    state.scheduleChanges = [{ id: "future", groupId: "group_a", scheduleSlotId: "slot_monday", effectiveFrom: "2026-07-20", dayOfWeek: 3, startTime: "17:30", durationHours: 1.5 }];
    const rows = generateScheduledOccurrences(state, "2026-07-13", "2026-07-31")
      .filter((row) => row.scheduleSlotId === "slot_monday");
    expect(rows.map((row) => [row.classDate, row.startTime])).toEqual([
      ["2026-07-13", "16:00"],
      ["2026-07-22", "17:30"],
      ["2026-07-29", "17:30"],
    ]);
  });
});
