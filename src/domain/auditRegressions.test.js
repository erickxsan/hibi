import { describe, expect, it } from "vitest";
import {
  createClassLogRow,
  createClassSchedule,
  createStarterState,
  createStudent,
  deriveAll,
  calculateCharge,
  calculatePaymentStatus,
  calculateOutstanding,
  generateScheduledOccurrences,
  editScheduledClassState,
  importState,
  serializeState,
} from "./index.js";
import { buildImportPlan } from "./importRecords.js";
import { roundMoney, sumMoney } from "./money.js";

function stateWithStudent() {
  const state = createStarterState("2026-10-02");
  state.students = [createStudent({ id: "s1", fullName: "Home", code: "S1", isIndividual: true })];
  return state;
}
describe("audit integrity regressions", () => {
  it("can replace the first occurrence without creating a series whose end precedes its start", () => {
    const state = stateWithStudent();
    state.classSchedules = [
      createClassSchedule({
        id: "series",
        recurrence: "weekly",
        format: "individual",
        studentId: "s1",
        startDate: "2026-10-05",
        endDate: "2026-10-30",
        startTime: "10:00",
        intervalWeeks: 2,
        daysOfWeek: [1, 4],
      }),
    ];
    const session = generateScheduledOccurrences(state, "2026-10-05", "2026-10-05")[0];
    const next = editScheduledClassState(state, {
      session,
      scope: "future",
      asOfDate: "2026-10-02",
      draft: { ...session, startTime: "12:00" },
    });
    expect(() => importState(serializeState(next))).not.toThrow();
    expect(next.classSchedules).toHaveLength(1);
    expect(generateScheduledOccurrences(next, "2026-10-01", "2026-11-30").map((item) => item.classDate)).toEqual([
      "2026-10-05",
      "2026-10-08",
      "2026-10-19",
      "2026-10-22",
    ]);
  });
  it("preserves dates, phase and termination through repeated future edits and serialization", () => {
    let state = stateWithStudent();
    state.classSchedules = [
      createClassSchedule({
        id: "series",
        recurrence: "weekly",
        format: "individual",
        studentId: "s1",
        startDate: "2026-10-05",
        endDate: "2026-10-30",
        startTime: "10:00",
        intervalWeeks: 2,
        daysOfWeek: [1, 4],
      }),
    ];
    const dates = (value) =>
      generateScheduledOccurrences(value, "2026-10-01", "2026-11-30").map((item) => item.classDate);
    const before = dates(state);
    expect(before).toEqual(["2026-10-05", "2026-10-08", "2026-10-19", "2026-10-22"]);
    for (const [date, time] of [
      ["2026-10-08", "12:00"],
      ["2026-10-19", "13:00"],
    ]) {
      const session = generateScheduledOccurrences(state, date, date)[0];
      state = editScheduledClassState(state, {
        session,
        scope: "future",
        asOfDate: "2026-10-02",
        draft: { ...session, startTime: time, durationHours: 1.5 },
      });
      state = importState(serializeState(state));
      expect(dates(state)).toEqual(before);
    }
  });
  it("requires occurrence scope to move one weekday of a multi-day series", () => {
    const state = stateWithStudent();
    state.classSchedules = [
      createClassSchedule({
        id: "series",
        recurrence: "weekly",
        format: "individual",
        studentId: "s1",
        startDate: "2026-10-05",
        startTime: "10:00",
        intervalWeeks: 2,
        daysOfWeek: [1, 4],
      }),
    ];
    const session = generateScheduledOccurrences(state, "2026-10-08", "2026-10-08")[0];
    expect(() =>
      editScheduledClassState(state, {
        session,
        scope: "future",
        asOfDate: "2026-10-02",
        draft: { ...session, classDate: "2026-10-09" },
      }),
    ).toThrow(/one occurrence/);
    const next = editScheduledClassState(state, {
      session,
      asOfDate: "2026-10-02",
      draft: { ...session, classDate: "2026-10-09" },
    });
    expect(generateScheduledOccurrences(next, "2026-10-01", "2026-10-30").map((item) => item.classDate)).toEqual([
      "2026-10-05",
      "2026-10-09",
      "2026-10-19",
      "2026-10-22",
    ]);
  });
  it.each([99.9, 0.1, 33.335])("uses cent precision for rate %s in both derivation paths and old imports", (rate) => {
    let state = stateWithStudent();
    state.settings.hourlyRate = rate;
    const charge = roundMoney(rate * 3);
    state.classLog = [
      createClassLogRow({
        classDate: "2026-10-01",
        studentId: "s1",
        hours: 3,
        amountPaid: charge,
        paymentDate: "2026-10-01",
        paymentMethod: "Cash",
      }),
    ];
    const row = state.classLog[0];
    expect(calculateCharge(state, row)).toBe(charge);
    expect(calculatePaymentStatus(state, row, "2026-10-02")).toBe("Paid");
    expect(calculateOutstanding(state, row, "2026-10-02")).toBe(0);
    expect(deriveAll(state, "2026-10-02").classLog[0]).toMatchObject({ outstanding: 0, paymentStatus: "Paid" });
    row.appliedCharge = charge + 5.68e-14;
    state = importState(serializeState(state));
    expect(state.classLog[0].appliedCharge).toBe(charge);
    expect(state.classLog[0].appliedHourlyRate).toBe(rate);
  });
  it("rounds half cents consistently and sums minor units", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(0.005)).toBe(0.01);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });
  it("invalidates an import approval when the entity changed remotely", () => {
    const current = stateWithStudent();
    current.students[0].notes = "A";
    const imported = structuredClone(current);
    imported.students[0].notes = "B";
    const preview = buildImportPlan(current, imported);
    const decisions = { [preview.entries[0].key]: "use-imported" };
    expect(buildImportPlan(current, imported, decisions).signature).toBe(preview.signature);
    const remote = structuredClone(current);
    remote.students[0].notes = "C";
    expect(buildImportPlan(remote, imported, decisions).signature).not.toBe(preview.signature);
  });
});
