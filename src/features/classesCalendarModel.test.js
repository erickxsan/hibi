import { describe, expect, it } from "vitest";
import {
  calendarMonthDays,
  calendarMonthRange,
  calendarSessionTone,
  calendarWeekDays,
  compactClock,
  filterCalendarSessions,
  groupCalendarSessionsByDate,
  minutesFromTime,
} from "./classesCalendarModel";

describe("classes calendar model", () => {
  it("builds a complete Sunday-first month grid", () => {
    expect(calendarMonthRange("2026-07-31")).toEqual({ startDate: "2026-06-28", endDate: "2026-08-01" });
    expect(calendarMonthDays("2026-07-31")).toHaveLength(35);
  });

  it("builds a Monday-first week", () => {
    expect(calendarWeekDays("2026-07-31")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("filters, groups and assigns stable tones", () => {
    const sessions = [
      { key: "1", classDate: "2026-07-31", title: "Math", groupId: "g1" },
      { key: "2", classDate: "2026-08-01", title: "Reading", studentId: "s1" },
    ];
    expect(filterCalendarSessions(sessions, { search: "math" })).toEqual([sessions[0]]);
    expect(filterCalendarSessions(sessions, { ownerId: "s1" })).toEqual([sessions[1]]);
    expect(groupCalendarSessionsByDate(sessions).get("2026-07-31")).toEqual([sessions[0]]);
    expect(calendarSessionTone(sessions[0])).toBe(calendarSessionTone(sessions[0]));
    expect(minutesFromTime("11:30")).toBe(690);
  });
});

describe("calendar chip time", () => {
  it("reads as a time, not a count", () => {
    expect(compactClock("16:00")).toBe("4p");
    expect(compactClock("10:30")).toBe("10:30a");
    expect(compactClock("12:00")).toBe("12p");
    expect(compactClock("00:15")).toBe("12:15a");
    expect(compactClock("8:00")).toBe("8a");
    expect(compactClock("")).toBe("");
    expect(compactClock("25:00")).toBe("");
  });
});
