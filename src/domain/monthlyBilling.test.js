import { describe, expect, it } from "vitest";
import { createStarterState } from "./starterState.js";
import { normalizeState, validateState } from "./validation.js";
import {
  billingIssues,
  changeGroupBilling,
  coveredByMonthlyFee,
  deriveMonthlyCharges,
  firstBillingPeriod,
  groupBillingFor,
  groupClassDates,
  joiningAmounts,
  monthlyDueDate,
  monthlyPaymentsBetween,
  moveBillingStart,
  nextPeriod,
  normalizeBillingByGroup,
  normalizeGroupBilling,
  normalizeMonthlyPayments,
  recordMonthlyPayment,
  setMonthlyPayment,
  startGroupBilling,
  studentMonthlyDueDate,
  studentMonthlyPlan,
  suggestedMonthlyFee,
} from "./monthlyBilling.js";
import { startGroupSchedule } from "./groupArchiving.js";
import { calculateCharge } from "./calculations.js";
import { buildAttentionItems, debtSummary } from "../features/homeDashboardModel.js";

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
        { id: "b", groupId: "g", period: "2026-10", amount: 9, paidAt: "2026-10-07" },
        { id: "c", groupId: "g", period: "2026-13", amount: 5, paidAt: "2026-10-06" },
      ]).map((item) => item.id),
    ).toEqual(["a", "b"]);
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

  it("lets a student fall due on their own day or class instead of the group's", () => {
    const base = fixture({ due: { type: "dayOfMonth", day: 5 } });
    const own = (due, mode = "group") => ({ ...base.students[0], billingByGroup: { p5a: { mode, due } } });
    const state = { ...base, students: [own({ type: "dayOfMonth", day: 20 }), ...base.students.slice(1)] };
    const [group] = state.groups;
    expect(studentMonthlyDueDate(state, state.students[0], group, "2026-10")).toBe("2026-10-20");
    // October's classes: Thu 1, Mon 5, Thu 8, Mon 12…; the 2nd class is the 5th.
    expect(studentMonthlyDueDate(state, own({ type: "nthClass", nth: 2 }), group, "2026-10")).toBe("2026-10-05");
    expect(studentMonthlyDueDate(state, own({ type: "nthClass", nth: "last" }), group, "2026-10")).toBe("2026-10-29");
    const diego = deriveMonthlyCharges(state, "2026-10-12").find((item) => item.studentId === "diego");
    expect(diego).toMatchObject({ dueDate: "2026-10-20", groupDueDate: "2026-10-05", status: "pending", amount: 1200 });
    expect(deriveMonthlyCharges(state, "2026-10-21").find((item) => item.studentId === "diego").status).toBe("overdue");
    // A due-only adjustment is kept; per class has no due date to move.
    expect(normalizeBillingByGroup({ p5a: { mode: "group", due: { type: "dayOfMonth", day: 40 } } })).toEqual({
      p5a: { mode: "group", due: { type: "dayOfMonth", day: 28 } },
    });
    expect(normalizeBillingByGroup({ p5a: { mode: "perClass", due: { type: "dayOfMonth", day: 9 } } })).toEqual({
      p5a: { mode: "perClass" },
    });
  });

  it("never makes a student's fee due before the day they joined", () => {
    const base = fixture({ due: { type: "dayOfMonth", day: 5 } });
    const state = {
      ...base,
      students: [
        ...base.students,
        {
          id: "sofia",
          code: "S",
          fullName: "Sofía",
          status: "Active",
          groupIds: ["p5a"],
          billingByGroup: { p5a: { mode: "group", joinedOn: "2026-10-12" } },
        },
      ],
    };
    const [group] = state.groups;
    const sofia = state.students.at(-1);
    expect(studentMonthlyDueDate(state, sofia, group, "2026-10")).toBe("2026-10-12");
    expect(studentMonthlyDueDate(state, sofia, group, "2026-11")).toBe("2026-11-05");
    expect(studentMonthlyDueDate(state, state.students[0], group, "2026-10")).toBe("2026-10-05");
    const onJoinDay = deriveMonthlyCharges(state, "2026-10-12").find((item) => item.studentId === "sofia");
    expect(onJoinDay).toMatchObject({ dueDate: "2026-10-12", groupDueDate: "2026-10-05", status: "pending" });
    expect(deriveMonthlyCharges(state, "2026-10-12").find((item) => item.studentId === "diego").status).toBe("overdue");
    expect(deriveMonthlyCharges(state, "2026-10-13").find((item) => item.studentId === "sofia").status).toBe("overdue");
    // Inicio and Seguimiento read the same per-student date: owed on the join day, overdue only after it.
    const sofiaDebt = (asOf) => debtSummary(state, [], asOf).debts.find((item) => item.studentId === "sofia");
    expect(sofiaDebt("2026-10-12")).toMatchObject({ amount: 1200, overdue: 0 });
    expect(sofiaDebt("2026-10-13")).toMatchObject({ amount: 1200, overdue: 1200, overdueThisMonth: 1200 });
    expect(debtSummary(state, [], "2026-10-12").overdueStudents.map((item) => item.studentId)).not.toContain("sofia");
  });

  it("starts a new group's billing in the first month whose due day is still ahead", () => {
    const monthly = (due) => ({ mode: "monthly", monthlyFee: 800, due });
    expect(firstBillingPeriod(monthly({ type: "dayOfMonth", day: 5 }), "2026-10-22")).toBe("2026-11");
    expect(firstBillingPeriod(monthly({ type: "dayOfMonth", day: 5 }), "2026-10-05")).toBe("2026-10");
    expect(firstBillingPeriod(monthly({ type: "dayOfMonth", day: 5 }), "2026-12-06")).toBe("2027-01");
    expect(firstBillingPeriod(monthly({ type: "nthClass", nth: 1 }), "2026-10-22")).toBe("2026-10");
    const created = startGroupBilling(
      { id: "g", billing: { ...monthly({ type: "dayOfMonth", day: 5 }), effectiveFrom: "2026-10" } },
      "2026-10-22",
    );
    expect(created.billing.effectiveFrom).toBe("2026-11");
    const later = { id: "g", billing: { ...monthly({ type: "dayOfMonth", day: 5 }), effectiveFrom: "2027-01" } };
    expect(startGroupBilling(later, "2026-10-22").billing.effectiveFrom).toBe("2027-01");
    const perClass = { id: "g", billing: { mode: "perClass" } };
    expect(startGroupBilling(perClass, "2026-10-22")).toBe(perClass);

    // Created on Thu 22 Oct with two students: nothing is owed or overdue that day.
    const base = fixture({ due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" });
    const group = startGroupBilling(startGroupSchedule(base.groups[0], "2026-10-22"), "2026-10-22");
    const state = { ...base, groups: [group] };
    expect(deriveMonthlyCharges(state, "2026-10-22")).toEqual([]);
    expect(deriveMonthlyCharges(state, "2026-11-05").every((item) => item.status === "pending")).toBe(true);
  });

  it("names fees due today apart from overdue ones in «Para atender»", () => {
    const base = fixture({ due: { type: "dayOfMonth", day: 5 } });
    const state = {
      ...base,
      students: [
        ...base.students,
        {
          id: "sofia",
          code: "S",
          fullName: "Sofía",
          status: "Active",
          groupIds: ["p5a"],
          billingByGroup: { p5a: { mode: "group", joinedOn: "2026-10-22" } },
        },
      ],
    };
    const item = buildAttentionItems(state, {}, "2026-10-22").find((entry) => entry.kind === "monthlyDue");
    expect(item).toMatchObject({ overdue: true, count: 2, amount: 2200, names: ["Diego", "Valeria"] });
    expect(item.dueToday).toEqual({ names: ["Sofía"], amount: 1200 });
  });

  it("covers the classes left this month at no charge when a new group's first fee is next month", () => {
    const base = fixture({ due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" });
    const group = startGroupBilling(startGroupSchedule(base.groups[0], "2026-10-22"), "2026-10-22");
    expect(group.billing).toMatchObject({ effectiveFrom: "2026-11", coveredFrom: "2026-10-22" });
    const state = { ...base, groups: [group] };
    // Mon 26 Oct is part of the monthly arrangement: no per-class charge at the general rate.
    expect(coveredByMonthlyFee(state, "diego", "p5a", "2026-10-26")).toBe(true);
    expect(coveredByMonthlyFee(state, "diego", "p5a", "2026-10-19")).toBe(false);
    // A student kept per class still pays per class.
    expect(coveredByMonthlyFee(state, "luna", "p5a", "2026-10-26")).toBe(false);
    expect(deriveMonthlyCharges(state, "2026-11-01").every((item) => item.period === "2026-11")).toBe(true);
    // The start survives normalization and is validated on import.
    expect(normalizeGroupBilling(group.billing).coveredFrom).toBe("2026-10-22");
    expect(normalizeGroupBilling({ ...group.billing, coveredFrom: "22/10/2026" })).not.toHaveProperty("coveredFrom");
    expect(billingIssues({ billing: { ...group.billing, coveredFrom: "22/10" } }, "group")).toEqual([
      ["billing.coveredFrom", "Covered start must use YYYY-MM-DD."],
    ]);
    // A group that bills from this month needs no covered days.
    const early = startGroupBilling(startGroupSchedule(base.groups[0], "2026-10-03"), "2026-10-03");
    expect(early.billing.effectiveFrom).toBe("2026-10");
    expect(early.billing).not.toHaveProperty("coveredFrom");
  });

  it("starts a group due at its nth class next month when no class is left this month", () => {
    const base = fixture({ due: { type: "nthClass", nth: 1 }, effectiveFrom: "2026-10" });
    // Mondays and Thursdays: on Sat 31 Oct no October class is left, so October is never charged.
    const lastDay = startGroupBilling(startGroupSchedule(base.groups[0], "2026-10-31"), "2026-10-31");
    expect(lastDay.billing).toMatchObject({ effectiveFrom: "2026-11", coveredFrom: "2026-10-31" });
    const charges = deriveMonthlyCharges({ ...base, groups: [lastDay] }, "2026-11-01");
    expect(charges.length).toBeGreaterThan(0);
    expect(charges.every((item) => item.period === "2026-11" && item.status === "pending")).toBe(true);
    // On Mon 26 Oct classes are still left: October bills, due at its first remaining class.
    const monday = startGroupBilling(startGroupSchedule(base.groups[0], "2026-10-26"), "2026-10-26");
    expect(monday.billing.effectiveFrom).toBe("2026-10");
    expect(firstBillingPeriod(monday.billing, "2026-10-30", monday.weeklySchedule)).toBe("2026-11");
  });

  it("suggests a full month's fee even when the group started partway through it or is not saved", () => {
    const base = fixture();
    const started = { ...base, groups: [startGroupSchedule(base.groups[0], "2026-10-22")] };
    expect(groupClassDates(started, started.groups[0], "2026-10")).toEqual(["2026-10-22", "2026-10-26", "2026-10-29"]);
    expect(suggestedMonthlyFee(started, started.groups[0], "2026-10")).toEqual({
      classes: 9,
      perClass: 150,
      fee: 1350,
    });
    const draft = {
      id: "draft",
      hourlyRate: 100,
      weeklySchedule: [{ id: "w", dayOfWeek: 3, startTime: "10:00", durationHours: 1.5 }],
    };
    expect(suggestedMonthlyFee(base, draft, "2026-11")).toEqual({ classes: 4, perClass: 150, fee: 600 });
    expect(base.groups.map((item) => item.id)).toEqual(["p5a"]);
  });
  it("records abonos until the month is settled and takes back only the last one", () => {
    let state = fixture({ due: { type: "dayOfMonth", day: 15 } });
    const ids = { studentId: "diego", groupId: "p5a", period: "2026-10" };
    const diego = () => deriveMonthlyCharges(state, "2026-10-20").find((item) => item.studentId === "diego");
    state = recordMonthlyPayment(state, { ...ids, amount: 100, paidAt: "2026-10-10" });
    expect(diego()).toMatchObject({
      status: "overdue",
      partial: true,
      total: 1200,
      paid: 100,
      balance: 1100,
      amount: 1100,
      paidAt: "",
    });
    // More than what is owed is capped at the balance, which settles the month.
    state = recordMonthlyPayment(state, { ...ids, amount: 5000, paidAt: "2026-10-20" });
    expect(diego()).toMatchObject({ status: "paid", partial: false, paid: 1200, balance: 0, amount: 1200 });
    expect(diego().paidAt).toBe("2026-10-20");
    expect(state.students[0].monthlyPayments.map((item) => [item.amount, Boolean(item.partial)])).toEqual([
      [100, true],
      [1100, false],
    ]);
    expect(recordMonthlyPayment(state, { ...ids, amount: 50, paidAt: "2026-10-21" })).toBe(state);
    state = setMonthlyPayment(state, { ...ids, paid: false, paymentId: diego().paymentId });
    expect(diego()).toMatchObject({ status: "overdue", paid: 100, balance: 1100 });
    // Revenue counts each abono on the day it was paid.
    expect(monthlyPaymentsBetween(state, "2026-10-01", "2026-10-31").map((item) => item.amount)).toEqual([100]);
  });

  it("keeps a month settled by a full payment when the fee changes later", () => {
    let state = fixture();
    state = recordMonthlyPayment(state, {
      studentId: "diego",
      groupId: "p5a",
      period: "2026-10",
      paidAt: "2026-10-08",
    });
    const [group] = state.groups;
    const raised = { ...state, groups: [{ ...group, billing: { ...group.billing, monthlyFee: 1500 } }] };
    expect(deriveMonthlyCharges(raised, "2026-10-20").find((item) => item.studentId === "diego")).toMatchObject({
      status: "paid",
      amount: 1200,
    });
  });

  it("applies a billing change from a month and leaves the months before it as they were", () => {
    const state = fixture({ due: { type: "dayOfMonth", day: 5 } });
    const [group] = state.groups;
    const due = { type: "dayOfMonth", day: 5 };
    const raised = changeGroupBilling(group.billing, { mode: "monthly", monthlyFee: 1500, due }, "2026-11");
    expect(raised).toMatchObject({
      monthlyFee: 1500,
      effectiveFrom: "2026-11",
      history: [{ monthlyFee: 1200, effectiveFrom: "2026-10" }],
    });
    const withRaise = { ...state, groups: [{ ...group, billing: raised }] };
    expect(groupBillingFor(withRaise.groups[0], "2026-10").monthlyFee).toBe(1200);
    expect(
      deriveMonthlyCharges(withRaise, "2026-11-20")
        .filter((item) => item.studentId === "diego")
        .map((item) => [item.period, item.total]),
    ).toEqual([
      ["2026-10", 1200],
      ["2026-11", 1500],
    ]);
    // Per class from December: October and November keep their monthly fees.
    const perClass = changeGroupBilling(raised, { mode: "perClass" }, "2026-12");
    expect(normalizeGroupBilling(perClass)).toEqual(perClass);
    const ended = { ...state, groups: [{ ...group, billing: perClass }] };
    expect(
      deriveMonthlyCharges(ended, "2027-01-20")
        .filter((item) => item.studentId === "diego")
        .map((item) => item.period),
    ).toEqual(["2026-10", "2026-11"]);
    expect(coveredByMonthlyFee(ended, "diego", "p5a", "2026-11-30")).toBe(true);
    expect(coveredByMonthlyFee(ended, "diego", "p5a", "2026-12-03")).toBe(false);
    // A change from the first month replaces everything.
    expect(changeGroupBilling(raised, { mode: "monthly", monthlyFee: 900, due }, "2026-10")).not.toHaveProperty(
      "history",
    );
    expect(
      billingIssues(
        { billing: { mode: "perClass", history: [{ mode: "monthly", effectiveFrom: "2026-10" }, {}] } },
        "group",
      ),
    ).toHaveLength(1);
  });

  it("moves an arrangement's start back and stops charging that month's classes on their own", () => {
    const base = fixture({ due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-11" });
    const lesson = { groupId: "p5a", studentId: "diego", classStatus: "Completed", attendance: "P", hours: 2 };
    const paid = {
      ...lesson,
      id: "r1",
      classDate: "2026-10-05",
      appliedCharge: 150,
      amountPaid: 150,
      paymentDate: "2026-10-05",
    };
    const unpaid = { ...lesson, id: "r2", classDate: "2026-10-08", appliedCharge: 150, amountPaid: 0 };
    const state = { ...base, classLog: [paid, unpaid] };
    expect(calculateCharge(state, unpaid)).toBe(150);
    // An arrangement saved without a start month never erases what recorded classes owe.
    const startless = { ...state.groups[0], billing: { ...state.groups[0].billing, effectiveFrom: "" } };
    expect(calculateCharge({ ...state, groups: [startless] }, unpaid)).toBe(150);
    const billing = moveBillingStart(state.groups[0].billing, "2026-10");
    expect(billing).toMatchObject({ effectiveFrom: "2026-10", monthlyFee: 1200 });
    const moved = { ...state, groups: [{ ...state.groups[0], billing }] };
    // October is part of the fee now: the unpaid class costs nothing more and the paid one is discounted.
    expect(calculateCharge(moved, unpaid)).toBe(0);
    expect(calculateCharge(moved, paid)).toBe(150);
    expect(deriveMonthlyCharges(moved, "2026-10-20").find((item) => item.studentId === "diego")).toMatchObject({
      period: "2026-10",
      total: 1050,
    });
    expect(moveBillingStart(billing, "2026-11")).toMatchObject({ effectiveFrom: "2026-11" });
  });

  it("covers from each due date to the day before the next, whenever the payment is made", () => {
    let state = fixture({ due: { type: "dayOfMonth", day: 15 } });
    state = recordMonthlyPayment(state, {
      studentId: "diego",
      groupId: "p5a",
      period: "2026-11",
      paidAt: "2026-11-28",
    });
    const diego = deriveMonthlyCharges(state, "2026-12-20").filter((item) => item.studentId === "diego");
    expect(diego.map((item) => [item.period, item.coversFrom, item.coversTo])).toEqual([
      ["2026-10", "2026-10-01", "2026-11-14"],
      ["2026-11", "2026-11-15", "2026-12-14"],
      ["2026-12", "2026-12-15", "2027-01-14"],
    ]);
    expect(diego[1]).toMatchObject({ status: "paid", paidAt: "2026-11-28" });
    // The last month of an arrangement ends with its month.
    const [group] = state.groups;
    const billing = changeGroupBilling(group.billing, { mode: "perClass" }, "2026-12");
    const ended = { ...state, groups: [{ ...group, billing }] };
    const november = deriveMonthlyCharges(ended, "2026-12-20").find(
      (item) => item.studentId === "diego" && item.period === "2026-11",
    );
    expect(november.coversTo).toBe("2026-11-30");
  });
});
