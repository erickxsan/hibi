import { describe, expect, it } from "vitest";
import {
  monthlyOccurrenceIn,
  normalizeRepeatRule,
  nthWeekdayOf,
  pickerRuleForSchedule,
  repeatRuleOccursOn,
  scheduleFieldsForRule,
} from "./classRecurrence.js";
import { generateScheduledOccurrences } from "./schedule.js";
import { createStarterState } from "./starterState.js";
import { normalizeState, validateClassSchedule } from "./validation.js";

describe("class repeat rules", () => {
  it("normalizes daily and monthly rules and rejects other values", () => {
    expect(normalizeRepeatRule({ kind: "daily", interval: 40, dailyMode: "weekdays" })).toEqual({
      kind: "daily",
      interval: 14,
      dailyMode: "weekdays",
    });
    expect(normalizeRepeatRule({ kind: "monthly", interval: "2", monthlyMode: "nthWeekday" })).toEqual({
      kind: "monthly",
      interval: 2,
      monthlyMode: "nthWeekday",
    });
    expect(normalizeRepeatRule({ kind: "monthly" })).toEqual({ kind: "monthly", interval: 1, monthlyMode: "dayOfMonth" });
    expect(normalizeRepeatRule({ kind: "weekly" })).toBeNull();
    expect(normalizeRepeatRule(null)).toBeNull();
  });

  it("counts daily repetition in calendar days and can skip weekends", () => {
    const schedule = { startDate: "2026-10-16", repeatRule: { kind: "daily", interval: 2, dailyMode: "weekdays" } };
    // Fri 16 → Sun 18 (weekend, skipped) → Tue 20 → Thu 22.
    expect(["2026-10-16", "2026-10-18", "2026-10-20", "2026-10-21", "2026-10-22"].map((date) =>
      repeatRuleOccursOn(schedule, date),
    )).toEqual([true, false, true, false, true]);
    expect(repeatRuleOccursOn(schedule, "2026-10-14")).toBe(false);
  });

  it("skips months without the requested day and stores the fifth weekday as the last one", () => {
    const day31 = { startDate: "2026-10-31", repeatRule: { kind: "monthly", monthlyMode: "dayOfMonth" } };
    expect(repeatRuleOccursOn(day31, "2026-11-30")).toBe(false);
    expect(repeatRuleOccursOn(day31, "2026-12-31")).toBe(true);
    expect(monthlyOccurrenceIn("2026-10-31", "2026-11-01")).toBe("");

    // Sat 17 Oct 2026 is the third Saturday.
    const third = { startDate: "2026-10-17", repeatRule: { kind: "monthly", monthlyMode: "nthWeekday" } };
    expect(nthWeekdayOf("2026-10-17")).toBe(3);
    expect(repeatRuleOccursOn(third, "2026-11-21")).toBe(true);
    expect(repeatRuleOccursOn(third, "2026-11-14")).toBe(false);

    // Fri 30 Oct 2026 is the fifth Friday → «the last Friday».
    const last = { startDate: "2026-10-30", repeatRule: { kind: "monthly", monthlyMode: "nthWeekday" } };
    expect(repeatRuleOccursOn(last, "2026-11-27")).toBe(true);
    const everyOther = { startDate: "2026-10-17", repeatRule: { kind: "monthly", interval: 2, monthlyMode: "nthWeekday" } };
    expect(repeatRuleOccursOn(everyOther, "2026-11-21")).toBe(false);
    expect(repeatRuleOccursOn(everyOther, "2026-12-19")).toBe(true);
  });

  it("maps picker rules to legacy-compatible schedule fields and back", () => {
    expect(scheduleFieldsForRule({ kind: "weekly", interval: 2, days: [2, 0] }, "2026-10-13")).toEqual({
      recurrence: "weekly",
      intervalWeeks: 2,
      daysOfWeek: [2, 7],
      repeatRule: null,
    });
    expect(scheduleFieldsForRule({ kind: "daily", dailyMode: "weekdays" }, "2026-10-13")).toMatchObject({
      recurrence: "weekly",
      daysOfWeek: [1, 2, 3, 4, 5],
      repeatRule: { kind: "daily", interval: 1, dailyMode: "weekdays" },
    });
    expect(scheduleFieldsForRule({ kind: "monthly", interval: 2 }, "2026-10-17")).toMatchObject({
      intervalWeeks: 8,
      daysOfWeek: [6],
      repeatRule: { kind: "monthly", interval: 2 },
    });
    expect(pickerRuleForSchedule({ startDate: "2026-10-13", intervalWeeks: 1, daysOfWeek: [2, 7] })).toMatchObject({
      kind: "weekly",
      days: [2, 0],
    });
    expect(
      pickerRuleForSchedule({ startDate: "2026-10-17", repeatRule: { kind: "monthly", monthlyMode: "nthWeekday" } }),
    ).toMatchObject({ kind: "monthly", monthlyMode: "nthWeekday", startDate: "2026-10-17" });
  });

  it("generates occurrences, keeps the rule through normalization and validates it", () => {
    const state = normalizeState({
      ...createStarterState(),
      students: [{ id: "s1", code: "S1", fullName: "Ana", status: "Active" }],
      classSchedules: [
        {
          id: "monthly",
          recurrence: "weekly",
          format: "individual",
          studentId: "s1",
          startDate: "2026-10-17",
          startTime: "10:00",
          durationHours: 1,
          intervalWeeks: 4,
          daysOfWeek: [6],
          repeatRule: { kind: "monthly", monthlyMode: "nthWeekday" },
        },
      ],
    });
    expect(state.classSchedules[0].repeatRule).toEqual({ kind: "monthly", interval: 1, monthlyMode: "nthWeekday" });
    const dates = generateScheduledOccurrences(state, "2026-10-01", "2027-01-31").map((item) => item.classDate);
    expect(dates).toEqual(["2026-10-17", "2026-11-21", "2026-12-19", "2027-01-16"]);
    expect(validateClassSchedule({ ...state.classSchedules[0], repeatRule: { kind: "yearly" } }).valid).toBe(false);
    expect(validateClassSchedule(state.classSchedules[0]).valid).toBe(true);
  });
});
