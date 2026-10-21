import { describe, expect, it } from "vitest";
import { createStarterState } from "./starterState.js";
import { normalizeState, validateState } from "./validation.js";
import {
  billingIssues,
  coveredByMonthlyFee,
  deriveMonthlyCharges,
  groupClassDates,
  joiningAmounts,
  monthlyDueDate,
  monthlyPaymentsBetween,
  nextPeriod,
  normalizeBillingByGroup,
  normalizeGroupBilling,
  normalizeMonthlyPayments,
  setMonthlyPayment,
  studentMonthlyPlan,
  suggestedMonthlyFee,
} from "./monthlyBilling.js";

// Mondays and Thursdays, 2 h at $75: October 2026 has 9 classes (5, 8, 12, 15, 19, 22, 26, 29 + Thu 1).
function fixture(billing = {}) {
  return normalizeState({
    ...createStarterState({ settings: { asOfDate: "2026-10-12", hourlyRate: 50 } }),
    groups: [
      {
        id: "p5a",
        name: "Primaria 5A",
        hourlyRate: 75,
        weeklySchedule: [
          { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
        ],
        billing: {
          mode: "monthly",
          monthlyFee: 1200,
          due: { type: "nthClass", nth: 3 },
          effectiveFrom: "2026-10",
          ...billing,
        },
      },
    ],
    students: [
      { id: "diego", code: "D", fullName: "Diego", status: "Active", groupIds: ["p5a"] },
      {
        id: "valeria",
        code: "V",
        fullName: "Valeria",
        status: "Active",
        groupIds: ["p5a"],
        billingByGroup: { p5a: { mode: "customFee", fee: 1000 } },
      },
      {
        id: "luna",
        code: "L",
        fullName: "Luna",
        status: "Active",
        groupIds: ["p5a"],
        billingByGroup: { p5a: { mode: "perClass" } },
      },
    ],
  });
}

describe("monthly billing", () => {
  it("normalizes optional fields and leaves legacy groups untouched", () => {
    expect(normalizeGroupBilling(undefined)).toBeNull();
    expect(normalizeGroupBilling({ mode: "perClass" })).toEqual({ mode: "perClass" });
    expect(normalizeGroupBilling({ mode: "monthly", monthlyFee: "900", due: { type: "dayOfMonth", day: 31 } })).toEqual(
      {
        mode: "monthly",
        monthlyFee: 900,
        due: { type: "dayOfMonth", day: 28 },
        effectiveFrom: "",
        creditFirstMonth: false,
      },
    );
    expect(normalizeGroupBilling({ mode: "monthly", due: { type: "nthClass", nth: "last" } }).due).toEqual({
      type: "nthClass",
      nth: "last",
    });
    expect(normalizeBillingByGroup({ g: { mode: "group" } })).toBeNull();
    expect(normalizeBillingByGroup({ g: { mode: "customFee", fee: "800" }, " ": { mode: "perClass" } })).toEqual({
      g: { mode: "customFee", fee: 800 },
    });
    expect(
      normalizeMonthlyPayments([
        { id: "a", groupId: "g", period: "2026-10", amount: 5, paidAt: "2026-10-05" },
        { id: "b", groupId: "g", period: "2026-10", amount: 5, paidAt: "2026-10-06" },
        { id: "c", groupId: "g", period: "2026-13", amount: 5, paidAt: "2026-10-06" },
      ]),
    ).toHaveLength(1);
    const legacy = normalizeState({ ...createStarterState(), groups: [{ id: "g", name: "G" }] });
    expect(Object.hasOwn(legacy.groups[0], "billing")).toBe(false);
    expect(nextPeriod("2026-12")).toBe("2027-01");
  });

  it("finds due dates on the group's real schedule and suggests a fee", () => {
    const state = fixture();
    const group = state.groups[0];
    expect(groupClassDates(state, group, "2026-10")).toHaveLength(9);
    expect(monthlyDueDate(state, group, "2026-10")).toBe("2026-10-08");
    expect(monthlyDueDate(state, group, "2026-11")).toBe("2026-11-09");
    expect(
      monthlyDueDate(
        { ...state, groups: [{ ...group, billing: { ...group.billing, due: { type: "nthClass", nth: "last" } } }] },
        { ...group, billing: { ...group.billing, due: { type: "nthClass", nth: "last" } } },
        "2026-10",
      ),
    ).toBe("2026-10-29");
    expect(
      monthlyDueDate(
        state,
        { ...group, billing: { ...group.billing, due: { type: "dayOfMonth", day: 5 } } },
        "2026-10",
      ),
    ).toBe("2026-10-05");
    expect(suggestedMonthlyFee(state, group, "2026-10")).toEqual({ classes: 9, perClass: 150, fee: 1350 });
  });

  it("derives charges per student with custom fees, per-class students and statuses", () => {
    let state = fixture();
    const charges = deriveMonthlyCharges(state, "2026-10-12");
    expect(charges.map((item) => [item.studentId, item.amount, item.status])).toEqual([
      ["diego", 1200, "overdue"],
      ["valeria", 1000, "overdue"],
    ]);
    expect(coveredByMonthlyFee(state, "luna", "p5a", "2026-10-12")).toBe(false);
    expect(coveredByMonthlyFee(state, "diego", "p5a", "2026-10-12")).toBe(true);
    expect(coveredByMonthlyFee(state, "diego", "p5a", "2026-09-28")).toBe(false);

    state = setMonthlyPayment(state, {
      studentId: "diego",
      groupId: "p5a",
      period: "2026-10",
      amount: 1200,
      paidAt: "2026-10-05",
    });
    const paid = deriveMonthlyCharges(state, "2026-10-12").find((item) => item.studentId === "diego");
    expect(paid).toMatchObject({ status: "paid", paidAt: "2026-10-05", amount: 1200 });
    expect(monthlyPaymentsBetween(state, "2026-10-01", "2026-10-31")).toHaveLength(1);
    expect(monthlyPaymentsBetween(state, "2026-10-06", "2026-10-31")).toHaveLength(0);

    state = setMonthlyPayment(state, { studentId: "diego", groupId: "p5a", period: "2026-10", paid: false });
    expect(state.students.find((item) => item.id === "diego").monthlyPayments).toBeUndefined();
    expect(deriveMonthlyCharges(state, "2026-10-01").every((item) => item.status === "pending")).toBe(true);
  });

  it("credits per-class payments in the first month and handles students joining mid-month", () => {
    const base = fixture({ creditFirstMonth: true });
    const state = {
      ...base,
      classLog: [
        {
          id: "row",
          classDate: "2026-10-05",
          studentId: "diego",
          groupId: "p5a",
          classStatus: "Completed",
          amountPaid: 300,
        },
      ],
    };
    expect(studentMonthlyPlan(state, state.students[0], state.groups[0], "2026-10")).toMatchObject({
      fee: 1200,
      amount: 900,
      prorated: true,
    });
    expect(studentMonthlyPlan(state, state.students[0], state.groups[0], "2026-11")).toMatchObject({ amount: 1200 });

    const amounts = joiningAmounts(state, state.groups[0], 1200, "2026-10-19");
    expect(amounts).toEqual({ total: 9, remaining: 4, full: 1200, prorated: 533.33, next: 0 });
    const joined = {
      ...state,
      students: [
        ...state.students,
        {
          id: "camila",
          code: "C",
          fullName: "Camila",
          status: "Active",
          groupIds: ["p5a"],
          billingByGroup: { p5a: { mode: "group", joinedOn: "2026-10-19", firstMonthAmount: 0 } },
        },
      ],
    };
    const camila = deriveMonthlyCharges(joined, "2026-11-30").filter((item) => item.studentId === "camila");
    expect(camila.map((item) => [item.period, item.amount, item.status])).toEqual([
      ["2026-10", 0, "waived"],
      ["2026-11", 1200, "overdue"],
    ]);
  });

  it("stops charging archived groups after the archive month and validates the import shape", () => {
    const state = fixture();
    const archived = { ...state, groups: [{ ...state.groups[0], status: "Inactive", archivedAt: "2026-10-20" }] };
    expect(new Set(deriveMonthlyCharges(archived, "2026-12-15").map((item) => item.period))).toEqual(
      new Set(["2026-10"]),
    );
    expect(deriveMonthlyCharges(archived, "2026-12-15", { includeArchived: false })).toEqual([]);
    expect(billingIssues({ billing: { mode: "yearly" } }, "group")).toHaveLength(1);
    expect(billingIssues({ billing: { mode: "monthly", monthlyFee: -1, effectiveFrom: "oct" } }, "group")).toHaveLength(
      2,
    );
    expect(billingIssues({ monthlyPayments: [{ period: "x" }], billingByGroup: [] }, "student")).toHaveLength(2);
    expect(billingIssues({ monthlyPayments: {} }, "student")).toHaveLength(1);
    expect(validateState(state).valid).toBe(true);
  });
});
