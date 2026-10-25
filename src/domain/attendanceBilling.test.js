import { describe, expect, it } from "vitest";
import {
  attendanceBilling,
  calculateCharge,
  calculateOutstanding,
  calculatePaymentStatus,
  createStarterState,
  createStudent,
  deriveAll,
  importState,
  PAYMENT_STATUSES,
  serializeState,
} from "./index.js";

const AS_OF = "2026-10-20";

function stateWithStudent() {
  const state = createStarterState(AS_OF);
  state.settings.hourlyRate = 50;
  state.settings.defaultClassHours = 2;
  state.students = [createStudent({ id: "s1", fullName: "Ana", code: "S1", isIndividual: true })];
  return state;
}

const completed = (attendance, extra = {}) => ({
  id: `class-${attendance || "unmarked"}`,
  classDate: "2026-10-10",
  studentId: "s1",
  groupId: "",
  classStatus: "Completed",
  attendance,
  hours: null,
  appliedHourlyRate: null,
  appliedCharge: null,
  amountPaid: 0,
  paymentDate: null,
  ...extra,
});

describe("only a student who came is charged", () => {
  it("reads present and late as billable, absent and excused as absent, and blank as unmarked", () => {
    expect(attendanceBilling(completed("P"))).toBe("billable");
    expect(attendanceBilling(completed("L"))).toBe("billable");
    expect(attendanceBilling(completed("A"))).toBe("absent");
    expect(attendanceBilling(completed("E"))).toBe("absent");
    expect(attendanceBilling(completed(""))).toBe("unmarked");
    expect(attendanceBilling(completed(null))).toBe("unmarked");
    // A class that has not happened yet keeps its price for payments in advance.
    expect(attendanceBilling({ ...completed(""), classStatus: "Scheduled" })).toBe("billable");
  });

  it("charges a present student and nothing for an absence, even with a saved price", () => {
    const state = stateWithStudent();
    expect(calculateOutstanding(state, completed("P"), AS_OF)).toBe(100);
    for (const row of [completed("A"), completed("A", { appliedCharge: 100 }), completed("E")]) {
      expect(calculateCharge(state, row)).toBe(0);
      expect(calculateOutstanding(state, row, AS_OF)).toBe(0);
      expect(calculatePaymentStatus(state, row, AS_OF)).toBe(PAYMENT_STATUSES.NO_CHARGE);
    }
  });

  it("keeps an unmarked student out of the debts until attendance is taken", () => {
    const state = stateWithStudent();
    const row = completed("", { appliedCharge: 100, paymentState: "Pending" });
    expect(calculateOutstanding(state, row, AS_OF)).toBe(0);
    expect(calculatePaymentStatus(state, row, AS_OF)).toBe(PAYMENT_STATUSES.ATTENDANCE_NEEDED);
    state.classLog = [row];
    expect(deriveAll(state, AS_OF).students[0].outstanding).toBe(0);
    // Marking them present brings the saved price back.
    state.classLog = [{ ...row, attendance: "P" }];
    expect(deriveAll(state, AS_OF).students[0].outstanding).toBe(100);
  });

  it("flags a payment recorded for an absence for review instead of dropping it", () => {
    const state = stateWithStudent();
    const row = completed("A", { appliedCharge: 100, amountPaid: 100, paymentDate: "2026-10-10" });
    expect(calculatePaymentStatus(state, row, AS_OF)).toBe(PAYMENT_STATUSES.REVIEW_NO_CHARGE);
    expect(calculateOutstanding(state, row, AS_OF)).toBe(0);
    state.classLog = [row];
    // The money still counts as collected.
    expect(deriveAll(state, AS_OF).dashboard.collectedSelectedMonth).toBe(100);
  });

  it("still matches a payment in advance to a scheduled class", () => {
    const state = stateWithStudent();
    const row = {
      ...completed(""),
      classDate: "2026-10-27",
      classStatus: "Scheduled",
      amountPaid: 100,
      paymentDate: "2026-10-15",
    };
    expect(calculateCharge(state, row)).toBe(100);
    expect(calculatePaymentStatus(state, row, AS_OF)).toBe(PAYMENT_STATUSES.PAID_IN_ADVANCE);
  });

  it("does not give old absences a price when a backup is imported", () => {
    const state = stateWithStudent();
    state.classLog = [completed("P", { id: "came" }), completed("A", { id: "missed" }), completed("", { id: "blank" })];
    const imported = importState(serializeState(state));
    const charges = Object.fromEntries(imported.classLog.map((row) => [row.id, row.appliedCharge]));
    expect(charges).toEqual({ came: 100, missed: 0, blank: 0 });
    expect(deriveAll(imported, AS_OF).students[0].outstanding).toBe(100);
  });
});
