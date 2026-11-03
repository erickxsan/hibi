import { describe, expect, it } from "vitest";
import { createGroup, createStarterState, createStudent } from "../domain";
import {
  attendanceCode,
  classDays,
  comparisonScope,
  dayCode,
  defaultChargeId,
  monthlyStamps,
  sheetMonths,
} from "./trackingStudentSheetModel";

function mondayState() {
  const state = createStarterState({ settings: { onboardingVersion: 2, onboardingStep: 9 } });
  state.groups = [
    createGroup({
      id: "g1",
      name: "Primaria",
      weeklySchedule: [{ id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 }],
    }),
  ];
  state.students = [createStudent({ id: "s1", fullName: "Luna López", groupIds: ["g1"] })];
  return state;
}

function record(classDate, attendance) {
  return {
    key: `${classDate}|g:g1|16:00`,
    className: "Primaria",
    row: { id: `r-${classDate}`, classDate, startTime: "16:00", classStatus: "Completed", attendance },
  };
}

describe("tracking student sheet model", () => {
  it("reads each class as present, absent, excused, unmarked or cancelled", () => {
    const completed = { classStatus: "Completed" };
    expect(attendanceCode({ ...completed, attendance: "P" })).toBe("P");
    expect(attendanceCode({ ...completed, attendance: "L" })).toBe("P");
    expect(attendanceCode({ ...completed, attendance: "A" })).toBe("A");
    expect(attendanceCode({ ...completed, attendance: "E" })).toBe("E");
    expect(attendanceCode({ ...completed, attendance: "" })).toBe("U");
    expect(attendanceCode({ classStatus: "Cancelled", attendance: "P" })).toBe("C");
  });

  it("compares with the filtered group, the student's only group or everyone", () => {
    expect(comparisonScope({ groupIds: ["g1", "g2"] }, "g2")).toBe("g2");
    expect(comparisonScope({ groupIds: ["g1"] }, "all")).toBe("g1");
    expect(comparisonScope({ groupIds: ["g1", "g2"] }, "all")).toBe("all");
    expect(comparisonScope({ groupIds: [], isIndividual: true }, "all")).toBe("all");
  });

  it("offers every month of the range, ending at the report date's", () => {
    expect(sheetMonths({ start: "2026-10-01" }, "2026-10-21")).toEqual(["2026-10-01"]);
    expect(sheetMonths({ start: "2026-08-20" }, "2026-10-21")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(sheetMonths({ start: "" }, "2026-10-21")).toEqual(["2026-10-01"]);
  });

  it("opens on the oldest fee still owed, else this month's, else the latest", () => {
    const fee = (period, status, dueDate) => ({ id: period, period, status, dueDate });
    const asOf = "2026-10-21";
    expect(
      defaultChargeId(
        [
          fee("2026-09", "overdue", "2026-09-05"),
          fee("2026-10", "overdue", "2026-10-05"),
          fee("2026-11", "pending", "2026-11-05"),
        ],
        asOf,
      ),
    ).toBe("2026-09");
    expect(defaultChargeId([fee("2026-10", "paid", "2026-10-05"), fee("2026-11", "pending", "2026-11-05")], asOf)).toBe(
      "2026-10",
    );
    expect(defaultChargeId([fee("2026-08", "paid", "2026-08-05"), fee("2026-09", "paid", "2026-09-05")], asOf)).toBe(
      "2026-09",
    );
    expect(defaultChargeId([], asOf)).toBe("");
  });

  it("colors a day with several classes by the one that most needs a look", () => {
    expect(dayCode([{ code: "P" }, { code: "A" }])).toBe("A");
    expect(dayCode([{ code: "F" }, { code: "P" }])).toBe("P");
    expect(dayCode([{ code: "C" }])).toBe("C");
  });

  it("with a past report date, shows no recorded class as upcoming and flags the one nobody took", () => {
    const state = mondayState();
    const student = state.students[0];
    const range = { start: "2026-10-01", end: "2026-10-13" };
    // The 5th has no record; the 12th was taken; the 19th is after the report date but before today.
    const days = classDays(state, [record("2026-10-12", "P")], {
      range,
      scope: "all",
      student,
      asOf: "2026-10-13",
      liveDate: "2026-10-21",
    });
    expect(days.get("2026-10-05").map((entry) => entry.code)).toEqual(["N"]);
    expect(days.get("2026-10-12").map((entry) => entry.code)).toEqual(["P"]);
    expect(days.has("2026-10-19")).toBe(false);
    expect(days.get("2026-10-26").map((entry) => entry.code)).toEqual(["F"]);
  });

  it("keeps every fee still owed among the stamps, not only the latest four", () => {
    const state = mondayState();
    const billing = { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-07" };
    state.groups = [
      { ...state.groups[0], billing },
      createGroup({
        id: "g2",
        name: "Prepa",
        weeklySchedule: [{ id: "slot-tue", dayOfWeek: 2, startTime: "17:00", durationHours: 1 }],
        billing,
      }),
    ];
    state.students = [createStudent({ id: "s1", fullName: "Luna López", groupIds: ["g1", "g2"] })];
    const stamps = monthlyStamps(state, "2026-10-12", "all", "s1");
    const periods = [...new Set(stamps.map((charge) => charge.period))];
    expect(periods[0] < "2026-09").toBe(true);
    expect(periods).toEqual(expect.arrayContaining(["2026-09", "2026-10", "2026-11"]));
    expect(stamps.length).toBeGreaterThan(4);
    expect(defaultChargeId(stamps, "2026-10-12")).toBe(stamps[0].id);
  });
});
