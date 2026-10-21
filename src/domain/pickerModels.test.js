import { describe, expect, it } from "vitest";
import {
  calendarDays,
  clockArc,
  clockPoint,
  hourAvailability,
  minutesToTime,
  nextRecurrenceDates,
  normalizeRecurrence,
  pickerDateLabel,
  slotAvailability,
  timeToMinutes,
} from "./pickerModels";

describe("date and recurrence picker models", () => {
  it("normalizes legacy weekly intervals and Sunday without mutating their IDs or input", () => {
    const legacy = { intervalWeeks: 2, daysOfWeek: [7, 1, 1], startDate: "2026-10-18" };
    expect(normalizeRecurrence(legacy)).toMatchObject({ kind: "weekly", interval: 2, days: [1, 0] });
    expect(legacy.daysOfWeek).toEqual([7, 1, 1]);
    expect(nextRecurrenceDates(legacy)).toEqual(["2026-10-18", "2026-10-19", "2026-11-01", "2026-11-02"]);
    expect(normalizeRecurrence({ anchorDate: "2026-10-18" }).anchorDate).toBe("2026-10-18");
    expect(normalizeRecurrence(null, "2026-10-19")).toMatchObject({ kind: "weekly", days: [1] });
    expect(normalizeRecurrence({ kind: "invalid", interval: 0, days: [9], startDate: "bad" })).toMatchObject({
      kind: "weekly",
      interval: 1,
      days: [],
      startDate: "",
    });
    expect(normalizeRecurrence({ kind: "daily", interval: 90, dailyMode: "weekdays" })).toMatchObject({
      interval: 14,
      dailyMode: "weekdays",
    });
    expect(normalizeRecurrence({ kind: "monthly", interval: -3, monthlyMode: "nthWeekday" })).toMatchObject({
      interval: 1,
      monthlyMode: "nthWeekday",
    });
    expect(normalizeRecurrence()).toMatchObject({ days: [], interval: 1 });
  });

  it("generates daily and weekday-only dates anchored to the requested interval", () => {
    expect(nextRecurrenceDates({ kind: "daily", startDate: "2026-10-16", interval: 1 })).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
    ]);
    expect(nextRecurrenceDates({ kind: "daily", startDate: "2026-10-16", dailyMode: "weekdays" })).toEqual([
      "2026-10-16",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
    ]);
    expect(nextRecurrenceDates({ kind: "daily", interval: 2, dailyMode: "weekdays", startDate: "2026-10-16" })).toEqual(
      ["2026-10-16", "2026-10-20", "2026-10-22", "2026-10-26"],
    );
  });

  it("keeps weekly dates after the start and observes the interval", () => {
    expect(nextRecurrenceDates({ kind: "weekly", startDate: "2026-10-14", days: [1, 5], interval: 2 })).toEqual([
      "2026-10-16",
      "2026-10-26",
      "2026-10-30",
      "2026-11-09",
    ]);
    expect(nextRecurrenceDates({ kind: "weekly", startDate: "2026-10-18", days: [0] }, 2)).toEqual([
      "2026-10-18",
      "2026-10-25",
    ]);
    expect(nextRecurrenceDates({ kind: "weekly", startDate: "2026-10-14", days: [] })).toEqual([]);
    expect(nextRecurrenceDates({ startDate: "bad" })).toEqual([]);
    expect(nextRecurrenceDates({ startDate: "2026-10-14" }, 0)).toEqual([]);
  });

  it("skips missing monthly dates instead of overflowing and includes leap days", () => {
    expect(nextRecurrenceDates({ kind: "monthly", startDate: "2026-01-31" })).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
    ]);
    expect(nextRecurrenceDates({ kind: "monthly", startDate: "2028-01-29" }, 3)).toEqual([
      "2028-01-29",
      "2028-02-29",
      "2028-03-29",
    ]);
    expect(nextRecurrenceDates({ kind: "monthly", interval: 12, startDate: "2026-12-01" }, 2)).toEqual([
      "2026-12-01",
      "2027-12-01",
    ]);
  });

  it("uses the nth weekday, and interprets a fifth occurrence as the last weekday", () => {
    expect(nextRecurrenceDates({ kind: "monthly", monthlyMode: "nthWeekday", startDate: "2026-10-17" })).toEqual([
      "2026-10-17",
      "2026-11-21",
      "2026-12-19",
      "2027-01-16",
    ]);
    expect(nextRecurrenceDates({ kind: "monthly", monthlyMode: "nthWeekday", startDate: "2026-10-31" })).toEqual([
      "2026-10-31",
      "2026-11-28",
      "2026-12-26",
      "2027-01-30",
    ]);
  });

  it("lays out Monday-first months in five or six rows, using UTC calendar dates", () => {
    expect(calendarDays("2026-02-12")).toHaveLength(35);
    expect(calendarDays("2026-03-12")).toHaveLength(42);
    expect(calendarDays("2026-10-12")[0]).toBe("2026-09-28");
    expect(calendarDays("invalid")).toEqual([]);
    expect(pickerDateLabel("2026-10-12", "es-MX", { weekday: "long" })).toBe("lunes");
    expect(pickerDateLabel("", "en-MX")).toBe("");
  });
});

describe("clock availability", () => {
  const busy = [{ start: 1020, end: 1110, label: "Existing lesson" }];
  it("round trips valid times without changing stored precision", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("12:07")).toBe(727);
    for (const value of ["24:00", "8:00", "12:60", "", null]) expect(timeToMinutes(value)).toBeNull();
    expect(minutesToTime(727)).toBe("12:07");
    expect(minutesToTime(1440)).toBe("00:00");
    expect(minutesToTime(-15)).toBe("23:45");
  });
  it("uses half-open intervals, the full duration, and configurable working hours", () => {
    expect(slotAvailability(960, 60, busy).available).toBe(true);
    expect(slotAvailability(1110, 60, busy).available).toBe(true);
    expect(slotAvailability(1005, 30, busy).conflicts).toEqual(busy);
    expect(slotAvailability(1200, 90).inRange).toBe(false);
    expect(slotAvailability(420, 60).available).toBe(false);
    expect(slotAvailability(420, 60, [], 0, 1440).available).toBe(true);
    expect(slotAvailability(480, 0).available).toBe(false);
    expect(slotAvailability(NaN).available).toBe(false);
    expect(slotAvailability(480).available).toBe(true);
  });
  it("blocks full hours and finds the first quarter in a partly occupied hour", () => {
    expect(hourAvailability(17, 60, busy)).toEqual({ off: false, busy: true, firstFree: null });
    expect(hourAvailability(18, 60, busy)).toEqual({ off: false, busy: false, firstFree: 1110 });
    expect(hourAvailability(20, 90, busy)).toEqual({ off: true, busy: false, firstFree: null });
    expect(hourAvailability(8).firstFree).toBe(480);
  });
  it("clips dial arcs to the visible half-day and handles the large arc", () => {
    expect(clockArc(0, 720)).toContain(" 1 1 ");
    expect(clockArc(600, 780, 720)).toContain(" 0 1 ");
    expect(clockArc(480, 500, 720)).toBe("");
    expect(clockPoint(0)).toEqual({ x: 120, y: 32 });
    expect(clockPoint(90, 100).x).toBe(220);
  });
});
