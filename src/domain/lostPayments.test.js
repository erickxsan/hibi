import { describe, expect, it } from "vitest";
import { deriveClassLogRow, calculateOutstanding, calculatePaymentStatus } from "./calculations.js";
import { PAYMENT_STATUSES } from "./constants.js";
import {
  classLostAt,
  feeLostAt,
  lostKey,
  lostPaymentsIssues,
  markLost,
  normalizeLostPayments,
  recoverLost,
} from "./lostPayments.js";
import {
  deriveMonthlyCharges,
  groupMoneyOnRecord,
  monthlyPaymentsBetween,
  recordMonthlyPayment,
} from "./monthlyBilling.js";
import { repriceUnpaidClasses } from "./schedule.js";
import { validateStudent } from "./validation.js";

const AS_OF = "2026-11-05";

function workspace(overrides = {}) {
  return {
    settings: { asOfDate: AS_OF, hourlyRate: 100, defaultClassHours: 2 },
    groups: [
      {
        id: "g-month",
        name: "Prepa",
        status: "Active",
        weeklySchedule: [],
        billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-04" },
      },
      { id: "g-class", name: "Sec", status: "Active", weeklySchedule: [], hourlyRate: 100 },
    ],
    students: [{ id: "s1", fullName: "Luna Ortiz", status: "Active", groupIds: ["g-month", "g-class"] }],
    classLog: [
      {
        id: "c1",
        classDate: "2026-02-12",
        studentId: "s1",
        groupId: "g-class",
        classStatus: "Completed",
        attendance: "P",
        hours: 2,
        appliedHourlyRate: 100,
        appliedCharge: 200,
        amountPaid: 0,
      },
    ],
    grades: [],
    ...overrides,
  };
}

const MAY = { studentId: "s1", kind: "monthly", groupId: "g-month", period: "2026-05" };
const CLASS = { studentId: "s1", kind: "class", classId: "c1" };

function chargeOf(state, period, asOf = AS_OF) {
  return deriveMonthlyCharges(state, asOf).find((charge) => charge.period === period);
}

describe("marks", () => {
  it("keeps valid marks only, one per debt, whatever came in", () => {
    const marks = normalizeLostPayments([
      { kind: "monthly", groupId: "g", period: "2026-05", lostAt: "2026-11-05" },
      { kind: "monthly", groupId: "g", period: "2026-05", lostAt: "2026-11-06" },
      { kind: "monthly", groupId: "g", period: "mayo", lostAt: "2026-11-05" },
      { kind: "class", classId: " c1 ", lostAt: "2026-11-05", amount: 999 },
      { kind: "class", classId: "", lostAt: "2026-11-05" },
      { kind: "class", classId: "c2", lostAt: "ayer" },
      { kind: "other", groupId: "g", period: "2026-05", lostAt: "2026-11-05" },
      null,
    ]);
    expect(marks).toEqual([
      { kind: "class", classId: "c1", lostAt: "2026-11-05" },
      { kind: "monthly", groupId: "g", period: "2026-05", lostAt: "2026-11-05" },
    ]);
    expect(normalizeLostPayments("nope")).toEqual([]);
  });

  it("answers per day, so a report before the mark still shows the debt", () => {
    const student = { lostPayments: [{ kind: "monthly", groupId: "g", period: "2026-05", lostAt: "2026-11-05" }] };
    expect(feeLostAt(student, "g", "2026-05", "2026-11-05")).toBe("2026-11-05");
    expect(feeLostAt(student, "g", "2026-05", "2026-10-01")).toBe("");
    expect(feeLostAt(student, "g", "2026-06", AS_OF)).toBe("");
    expect(classLostAt(student, "", AS_OF)).toBe("");
    expect(classLostAt({}, "c1", AS_OF)).toBe("");
  });

  it("adds and removes marks without touching other students, and leaves no empty list", () => {
    const other = { id: "s2", fullName: "Otro", status: "Active" };
    const state = workspace({ students: [...workspace().students, other] });
    const lost = markLost(state, [MAY, CLASS], AS_OF);
    expect(lost.students[0].lostPayments).toHaveLength(2);
    expect(lost.students[1]).toBe(other);
    expect(recoverLost(lost, [MAY]).students[0].lostPayments.map(lostKey)).toEqual(["class|c1"]);
    expect(recoverLost(lost, [MAY, CLASS]).students[0]).not.toHaveProperty("lostPayments");
    expect(markLost(state, [], AS_OF)).toBe(state);
  });

  it("keeps the original day when an undone recovery brings a mark back", () => {
    const lost = markLost(workspace(), [{ ...MAY, lostAt: "2026-10-01" }], AS_OF);
    expect(lost.students[0].lostPayments[0].lostAt).toBe("2026-10-01");
  });

  it("reports malformed marks to the import validator", () => {
    expect(lostPaymentsIssues({})).toEqual([]);
    expect(lostPaymentsIssues({ lostPayments: "x" })[0][0]).toBe("lostPayments");
    expect(lostPaymentsIssues({ lostPayments: [{ kind: "class" }] })[0][0]).toBe("lostPayments[0]");
    const student = { id: "s1", code: "A", fullName: "Luna", status: "Active", lostPayments: [{ kind: "class" }] };
    expect(validateStudent(student).valid).toBe(false);
  });
});

describe("monthly fees", () => {
  it("turns a given-up fee into «lost» and keeps what it still owes", () => {
    const state = markLost(workspace(), [MAY], AS_OF);
    const charge = chargeOf(state, "2026-05");
    expect(charge.status).toBe("lost");
    expect(charge.balance).toBe(800);
    expect(charge.lostAt).toBe(AS_OF);
    expect(chargeOf(state, "2026-06").status).toBe("overdue");
  });

  it("shows it overdue again in a report dated before the mark", () => {
    const state = markLost(workspace(), [MAY], AS_OF);
    expect(chargeOf(state, "2026-05", "2026-10-01").status).toBe("overdue");
  });

  it("loses only what was missing: an abono stays collected", () => {
    let state = recordMonthlyPayment(workspace(), {
      studentId: "s1",
      groupId: "g-month",
      period: "2026-05",
      amount: 300,
      paidAt: "2026-05-05",
    });
    state = markLost(state, [MAY], AS_OF);
    const charge = chargeOf(state, "2026-05");
    expect(charge.status).toBe("lost");
    expect(charge.paid).toBe(300);
    expect(charge.balance).toBe(500);
    expect(monthlyPaymentsBetween(state, "2026-01-01", AS_OF).map((item) => item.amount)).toEqual([300]);
  });

  it("never adds to what was collected", () => {
    const state = markLost(workspace(), [MAY], AS_OF);
    expect(monthlyPaymentsBetween(state, "2026-01-01", AS_OF)).toEqual([]);
  });

  it("recovering brings the debt back as it was", () => {
    const state = recoverLost(markLost(workspace(), [MAY], AS_OF), [MAY]);
    expect(chargeOf(state, "2026-05").status).toBe("overdue");
    expect(chargeOf(state, "2026-05").balance).toBe(800);
  });

  it("ignores a mark once the month is settled, and paying takes the mark away", () => {
    const paid = recordMonthlyPayment(markLost(workspace(), [MAY], AS_OF), {
      studentId: "s1",
      groupId: "g-month",
      period: "2026-05",
      paidAt: AS_OF,
    });
    expect(chargeOf(paid, "2026-05").status).toBe("paid");
    expect(paid.students[0].lostPayments).toBeUndefined();
    const settled = markLost(
      recordMonthlyPayment(workspace(), { studentId: "s1", groupId: "g-month", period: "2026-05", paidAt: AS_OF }),
      [MAY],
      AS_OF,
    );
    expect(chargeOf(settled, "2026-05").status).toBe("paid");
  });

  it("keeps a group with fees given up from being deleted", () => {
    expect(groupMoneyOnRecord(workspace(), "g-month")).toBe(false);
    expect(groupMoneyOnRecord(markLost(workspace(), [MAY], AS_OF), "g-month")).toBe(true);
  });
});

describe("classes", () => {
  const row = (state, asOf = AS_OF) => deriveClassLogRow(state, state.classLog[0], asOf);

  it("takes the balance out of what is owed and reports it as lost", () => {
    const state = markLost(workspace(), [CLASS], AS_OF);
    expect(row(state)).toMatchObject({ outstanding: 0, lostAmount: 200, paymentStatus: PAYMENT_STATUSES.LOST });
    expect(calculateOutstanding(state, state.classLog[0], AS_OF)).toBe(0);
    expect(calculatePaymentStatus(state, state.classLog[0], AS_OF)).toBe(PAYMENT_STATUSES.LOST);
  });

  it("still owes in a report dated before the mark", () => {
    const state = markLost(workspace(), [CLASS], AS_OF);
    expect(row(state, "2026-10-01")).toMatchObject({ outstanding: 200, lostAmount: 0 });
    expect(calculateOutstanding(state, state.classLog[0], "2026-10-01")).toBe(200);
  });

  it("loses only the part not paid", () => {
    const base = workspace();
    base.classLog[0] = { ...base.classLog[0], amountPaid: 50, paymentDate: "2026-02-12" };
    expect(row(markLost(base, [CLASS], AS_OF))).toMatchObject({ outstanding: 0, lostAmount: 150 });
  });

  it("stops being lost once the class is paid or stops being charged", () => {
    const base = markLost(workspace(), [CLASS], AS_OF);
    const paid = {
      ...base,
      classLog: [{ ...base.classLog[0], amountPaid: 200, paymentDate: AS_OF }],
    };
    expect(row(paid)).toMatchObject({ outstanding: 0, lostAmount: 0, paymentStatus: PAYMENT_STATUSES.PAID });
    const absent = { ...base, classLog: [{ ...base.classLog[0], attendance: "A" }] };
    expect(row(absent)).toMatchObject({ outstanding: 0, lostAmount: 0 });
  });

  it("comes back lost when the payment that settled it is corrected away", () => {
    const base = markLost(workspace(), [CLASS], AS_OF);
    const paid = { ...base, classLog: [{ ...base.classLog[0], amountPaid: 200, paymentDate: AS_OF }] };
    expect(row(paid)).toMatchObject({ lostAmount: 0 });
    expect(row(base)).toMatchObject({ lostAmount: 200 });
    expect(paid.students[0].lostPayments).toEqual(base.students[0].lostPayments);
  });

  it("is not repriced when the student's rate changes", () => {
    const state = markLost(workspace(), [CLASS], AS_OF);
    const student = { ...state.students[0], customHourlyRate: 300 };
    expect(repriceUnpaidClasses(state, state.students[0], student)[0].appliedCharge).toBe(200);
  });
});
