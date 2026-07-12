import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysInMonth,
  endOfMonth,
  isDateOnly,
  parseDateOnly,
  startOfMonth,
  startOfWeek,
  toDateOnly,
} from "./index.js";

describe("date-only helpers", () => {
  it("validates real calendar dates", () => {
    expect(isDateOnly("2024-02-29")).toBe(true);
    expect(isDateOnly("2023-02-29")).toBe(false);
    expect(isDateOnly("2026-7-01")).toBe(false);
    expect(isDateOnly("2026-07-01T00:00:00Z")).toBe(false);
  });

  it("does calendar math without timezone drift", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-12-18", 2)).toBe("2027-02-01");
    expect(startOfMonth("2026-07-31")).toBe("2026-07-01");
    expect(endOfMonth("2024-02-07")).toBe("2024-02-29");
    expect(daysInMonth("2026-07-01")).toBe(31);
    expect(startOfWeek("2026-07-10")).toBe("2026-07-06");
  });

  it("uses local fields when a browser Date is converted for an input", () => {
    const localDate = new Date(2026, 6, 10, 23, 30);
    expect(toDateOnly(localDate)).toBe("2026-07-10");
    expect(parseDateOnly("2026-07-10").toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
});
