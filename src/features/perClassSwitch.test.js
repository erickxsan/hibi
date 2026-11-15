import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain/calculations.js";
import { markLost } from "../domain/lostPayments.js";
import { sumMoney } from "../domain/money.js";
import {
  deriveMonthlyCharges,
  monthlyPaymentsBetween,
  normalizeBillingByGroup,
  perClassStart,
  recordMonthlyPayment,
} from "../domain/monthlyBilling.js";
import { generateScheduledOccurrences, resolveHourlyRate } from "../domain/schedule.js";
import { createStarterState } from "../domain/starterState.js";
import { normalizeState } from "../domain/validation.js";
import { buildClassRecords } from "./classesDraftModel.js";
import { billingChanges, billingDraftFor, joinGroup } from "./communityModel.js";

/*
 * Switching one student of a monthly group to «Por clase» (audit 2026-11-13, A1 and A2).
 * Group: Monday and Thursday, 2 h at $100/h ($200 a class), $1,000 a month due on the 5th.
 * Today is Friday, November 13: the November classes of the 2nd, 5th, 9th and 12th are recorded.
 */
const TODAY = "2026-11-13";
const MONTHLY = { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-09" };
const PER_CLASS = { mode: "perClass", fee: null, due: null };

function fixture({ billing = MONTHLY, ana = {} } = {}) {
  return normalizeState({
    ...createStarterState({ settings: { asOfDate: TODAY, hourlyRate: 100 } }),
    groups: [
      {
        id: "g",
        name: "Grupo",
        hourlyRate: 100,
        weeklySchedule: [
          { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
        ],
        scheduleResumeDate: "2026-08-01",
        ...(billing ? { billing } : {}),
      },
    ],
    students: [
      { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"], ...ana },
      { id: "beto", code: "B", fullName: "Beto", status: "Active", groupIds: ["g"] },
    ],
  });
}

const classDays = (state, from, to) =>
  [...new Set(generateScheduledOccurrences(state, from, to).map((item) => item.classDate))].sort();

// Saves a day's class as Clases › Guardar does: all present (`attendance` changes who is not),
// `paid` marks who paid it on the spot.
function recordClasses(state, from, to, paid = [], attendance = {}) {
  let next = state;
  for (const date of classDays(state, from, to)) {
    const roster = next.students.filter((student) => student.groupIds.includes("g"));
    const session = { classDate: date, groupId: "g", durationHours: 2, startTime: "16:00", title: "", rows: [] };
    const entries = Object.fromEntries(
      roster.map((student) => [
        student.id,
        {
          attendance: attendance[student.id] ?? "P",
          paymentState: paid.includes(student.id) ? "Paid" : "",
          paymentTouched: paid.includes(student.id),
        },
      ]),
    );
    const rows = buildClassRecords(next, session, roster, entries, { today: date }).map((row) => ({
      ...row,
      id: `${row.studentId}-${date}`,
      appliedHourlyRate: resolveHourlyRate(next, row.studentId, "g"),
    }));
    next = normalizeState({ ...next, classLog: [...next.classLog, ...rows] });
  }
  return next;
}

function payFees(state, studentIds, periods) {
  let next = state;
  for (const period of periods)
    for (const studentId of studentIds)
      next = recordMonthlyPayment(next, { studentId, groupId: "g", period, paidAt: `${period}-05` });
  return next;
}

// Comunidad › grupo › «Forma de cobro» › Guardar (billingChanges + saveGroupBilling).
function saveBilling(state, change, asOf = TODAY) {
  const group = state.groups[0];
  const members = state.students.filter((student) => student.groupIds.includes("g"));
  const draft = change(billingDraftFor(group, members));
  // With the workspace, as Community saves it.
  const { billing, overrides, starts } = billingChanges(group, members, draft, asOf, draft.applyFrom, state);
  const next = normalizeState({
    ...state,
    groups: [{ ...group, billing }],
    students: state.students.map((student) => {
      if (!Object.hasOwn(overrides, student.id)) return student;
      const byGroup = { ...(student.billingByGroup || {}) };
      if (overrides[student.id]) byGroup.g = overrides[student.id];
      else delete byGroup.g;
      const { billingByGroup: _old, ...rest } = student;
      const billingByGroup = normalizeBillingByGroup(byGroup);
      return billingByGroup ? { ...rest, billingByGroup } : rest;
    }),
  });
  return { state: next, overrides, starts };
}

const adjust =
  (adjustments, extra = {}) =>
  (draft) => ({ ...draft, ...extra, adjustments });

// What Ana owes on `asOf`: class balances plus fees due by then.
function owed(state, asOf = TODAY) {
  const classes = sumMoney(
    deriveAll(state, asOf).classLog.filter((row) => row.studentId === "ana"),
    (row) => row.outstanding || 0,
  );
  const fees = sumMoney(
    deriveMonthlyCharges(state, asOf).filter(
      (charge) =>
        charge.studentId === "ana" && ["overdue", "pending"].includes(charge.status) && charge.dueDate <= asOf,
    ),
    (charge) => charge.balance,
  );
  return { classes, fees };
}

const feeOf = (state, period, asOf = TODAY) =>
  deriveMonthlyCharges(state, asOf).find((charge) => charge.studentId === "ana" && charge.period === period);

describe("switching a student of a monthly group to per class", () => {
  it("keeps this month's unpaid fee: per class starts next month (A1)", () => {
    let state = recordClasses(payFees(fixture(), ["ana", "beto"], ["2026-09", "2026-10"]), "2026-11-01", TODAY);
    expect(owed(state)).toEqual({ classes: 0, fees: 1000 });

    const saved = saveBilling(state, adjust({ ana: PER_CLASS }));
    state = saved.state;
    expect(saved.overrides.ana).toEqual({ mode: "perClass", effectiveFrom: "2026-12" });
    // Before the fix the fee vanished and the four classes stayed at $0: Ana owed nothing.
    expect(owed(state)).toEqual({ classes: 0, fees: 1000 });
    expect(feeOf(state, "2026-11")).toMatchObject({ total: 1000, status: "overdue", coversTo: "2026-11-30" });

    // December is per class: her classes cost $200 each and she has no December fee.
    state = recordClasses(state, "2026-12-01", "2026-12-07");
    const december = deriveAll(state, "2026-12-07").classLog.filter(
      (row) => row.studentId === "ana" && row.classDate >= "2026-12-01",
    );
    expect(december.map((row) => row.outstanding)).toEqual([200, 200]);
    expect(feeOf(state, "2026-12", "2026-12-07")).toBeUndefined();
  });

  it("never charges a month already paid twice (A2)", () => {
    let state = payFees(fixture(), ["ana", "beto"], ["2026-09", "2026-10", "2026-11"]);
    state = recordClasses(state, "2026-11-01", TODAY);
    state = saveBilling(state, adjust({ ana: PER_CLASS })).state;
    state = recordClasses(state, "2026-11-14", "2026-11-30");
    const end = "2026-11-30";
    // Before the fix the $1,000 payment belonged to no month and the five classes left cost $1,000 more.
    expect(feeOf(state, "2026-11", end)).toMatchObject({ status: "paid", paid: 1000, balance: 0 });
    expect(owed(state, end)).toEqual({ classes: 0, fees: 0 });
    const anaPayments = monthlyPaymentsBetween(state, "2026-11-01", end).filter((item) => item.studentId === "ana");
    expect(sumMoney(anaPayments, (item) => item.amount)).toBe(1000);
  });

  it.each([
    // [«Aplica desde», when the other changes start, when per class starts]
    ["current", "2026-11", "2026-12"],
    ["next", "2026-12", "2026-12"],
    ["2026-09", "2026-09", "2026-12"],
    ["2027-01", "2027-01", "2027-01"],
  ])(
    "with the group's fee changing from %s, per class still waits for the months lived monthly",
    (applyFrom, others, perClass) => {
      const state = recordClasses(payFees(fixture(), ["ana", "beto"], ["2026-09", "2026-10"]), "2026-11-01", TODAY);
      const { overrides, starts } = saveBilling(
        state,
        adjust({ ana: PER_CLASS, beto: { mode: "customFee", fee: 900, due: null } }, { monthlyFee: 1200, applyFrom }),
      );
      expect(starts).toEqual({ ana: perClass, beto: others });
      expect(overrides.ana).toMatchObject({ mode: "perClass", effectiveFrom: perClass });
      expect(overrides.beto).toMatchObject({ mode: "customFee", fee: 900, effectiveFrom: others });
    },
  );

  it("keeps months lived per class per class when the group turns monthly in the same save", () => {
    // The group billed per class until now: Ana's November classes were charged $200 each.
    const state = recordClasses(fixture({ billing: null }), "2026-11-01", TODAY);
    expect(owed(state)).toEqual({ classes: 800, fees: 0 });
    for (const applyFrom of ["2026-09", "current"]) {
      const saved = saveBilling(state, adjust({ ana: PER_CLASS }, { mode: "monthly", monthlyFee: 1000, applyFrom }));
      expect(saved.starts.ana).toBe(applyFrom === "current" ? "2026-11" : "2026-09");
      expect(owed(saved.state)).toEqual({ classes: 800, fees: 0 });
    }
  });

  it("starts this month for a student who joined this month with nothing recorded yet", () => {
    // Reversed on purpose (audit of the fixes, finding 1): adding a student and then choosing «Por clase»
    // is the only way to make a new student pay per class, so the month only counts as lived monthly
    // once the records show it (a class she came to, money credited to the fee, a receipt, a lost mark).
    const state = fixture({ ana: { billingByGroup: { g: { mode: "group", joinedOn: "2026-11-10" } } } });
    const { overrides } = saveBilling(state, adjust({ ana: PER_CLASS }));
    expect(overrides.ana).toEqual({ mode: "perClass", effectiveFrom: "2026-11", joinedOn: "2026-11-10" });
  });

  it("leaves a student already per class as they are", () => {
    const state = fixture({ ana: { billingByGroup: { g: { mode: "perClass", effectiveFrom: "2026-10" } } } });
    expect(saveBilling(state, (draft) => draft)).toMatchObject({ overrides: {}, starts: {} });
    expect(perClassStart(state.students[0], state.groups[0], TODAY, "2026-11")).toBe("2026-11");
  });

  it("brings a student back to the group fee this month, discounting what they paid per class", () => {
    // Ana pays per class from November: she paid the classes of the 2nd and 5th, not those of the 9th and 12th.
    let state = fixture({ ana: { billingByGroup: { g: { mode: "perClass", effectiveFrom: "2026-11" } } } });
    state = payFees(state, ["ana", "beto"], ["2026-09", "2026-10"]);
    state = recordClasses(state, "2026-11-01", "2026-11-06", ["ana"]);
    state = recordClasses(state, "2026-11-07", TODAY);
    expect(owed(state)).toEqual({ classes: 400, fees: 0 });

    const saved = saveBilling(state, adjust({}));
    expect(saved).toMatchObject({ overrides: { ana: null }, starts: { ana: "2026-11" } });
    // November is a fee again: $1,000 less the $400 already paid per class, due on the 5th, so overdue.
    expect(feeOf(saved.state, "2026-11")).toMatchObject({ total: 600, balance: 600, status: "overdue" });
    expect(owed(saved.state)).toEqual({ classes: 0, fees: 600 });
    const paidPerClass = sumMoney(
      saved.state.classLog.filter((row) => row.studentId === "ana"),
      (row) => row.amountPaid || 0,
    );
    expect(paidPerClass).toBe(400);
  });
});

/*
 * A student added this month and then set to «Por clase» (audit of the fixes, finding 1). Joining
 * always stamps `joinedOn` and a first-month amount, so a month only counts as lived monthly once
 * the records show it: a class she came to (stored at $0 under the fee), money on one of her classes
 * that the fee credits, a monthly receipt or a lost mark of that month.
 */
describe("a student who joined this month and is then set per class", () => {
  // Comunidad › grupo › «Agregar alumno» with the first-month choice (joinGroup), on `day`.
  function addBea(state, day, amount) {
    const bea = joinGroup(
      { id: "bea", code: "C", fullName: "Bea", status: "Active", groupIds: [] },
      state.groups[0],
      day,
      {
        amount,
      },
    );
    return normalizeState({ ...state, students: [...state.students, bea] });
  }
  const owedBy = (state, studentId, asOf) => ({
    classes: sumMoney(
      deriveAll(state, asOf).classLog.filter((row) => row.studentId === studentId),
      (row) => row.outstanding || 0,
    ),
    fees: deriveMonthlyCharges(state, asOf)
      .filter((charge) => charge.studentId === studentId && charge.status !== "paid")
      .map((charge) => `${charge.period}:${charge.status}:${charge.balance}`),
  });
  const base = () => payFees(fixture(), ["ana", "beto"], ["2026-09", "2026-10"]);
  const END = "2026-11-30";

  it.each([
    ["«completo»", 1000],
    ["«nada este mes»", 0],
  ])("pays per class from this month when added with %s and nothing recorded yet", (_label, amount) => {
    let state = addBea(base(), TODAY, amount);
    const saved = saveBilling(state, adjust({ bea: PER_CLASS }));
    expect(saved.starts.bea).toBe("2026-11");
    expect(saved.overrides.bea).toEqual({
      mode: "perClass",
      effectiveFrom: "2026-11",
      joinedOn: TODAY,
      firstMonthAmount: amount,
    });
    // Before the fix: «completo» left `2026-11:overdue:1000` and «nada» a waived month, her classes at $0.
    state = recordClasses(saved.state, "2026-11-14", END);
    expect(owedBy(state, "bea", END)).toEqual({ classes: 1000, fees: [] });
  });

  it("keeps the month monthly once she came to a class covered by the fee", () => {
    let state = recordClasses(addBea(base(), "2026-11-02", 1000), "2026-11-02", TODAY);
    const saved = saveBilling(state, adjust({ bea: PER_CLASS }));
    expect(saved.starts.bea).toBe("2026-12");
    state = recordClasses(saved.state, "2026-11-14", END);
    expect(owedBy(state, "bea", END)).toEqual({ classes: 0, fees: ["2026-11:overdue:1000"] });
  });

  it("does not count classes she missed or that wait for attendance: they cost nothing either way", () => {
    for (const mark of ["A", ""]) {
      const state = recordClasses(addBea(base(), "2026-11-02", 1000), "2026-11-02", TODAY, [], { bea: mark });
      expect(saveBilling(state, adjust({ bea: PER_CLASS })).starts.bea).toBe("2026-11");
    }
  });

  it("counts money paid on one of her classes, which the fee credits", () => {
    let state = recordClasses(addBea(base(), "2026-11-02", 1000), "2026-11-02", TODAY, [], { bea: "A" });
    state = normalizeState({
      ...state,
      classLog: state.classLog.map((row) =>
        row.id === "bea-2026-11-09" ? { ...row, amountPaid: 200, paymentDate: "2026-11-06" } : row,
      ),
    });
    expect(saveBilling(state, adjust({ bea: PER_CLASS })).starts.bea).toBe("2026-12");
  });

  it("counts a monthly receipt or a lost mark of the month, even with no class recorded", () => {
    const joined = addBea(base(), "2026-11-02", 1000);
    const paid = recordMonthlyPayment(joined, {
      studentId: "bea",
      groupId: "g",
      period: "2026-11",
      amount: 300,
      paidAt: "2026-11-03",
    });
    expect(saveBilling(paid, adjust({ bea: PER_CLASS })).starts.bea).toBe("2026-12");
    const lost = markLost(joined, [{ studentId: "bea", kind: "monthly", groupId: "g", period: "2026-11" }], TODAY);
    expect(saveBilling(lost, adjust({ bea: PER_CLASS })).starts.bea).toBe("2026-12");
  });

  it("lets a month waived on joining turn per class: its recorded classes stay free, the rest are charged", () => {
    let state = recordClasses(addBea(base(), "2026-11-02", 0), "2026-11-02", TODAY);
    const saved = saveBilling(state, adjust({ bea: PER_CLASS }));
    expect(saved.starts.bea).toBe("2026-11");
    state = recordClasses(saved.state, "2026-11-14", END);
    // Nov 2, 5, 9 and 12 stay at $0 as recorded; Nov 16 to 30 (five classes) cost $200 each.
    expect(owedBy(state, "bea", END)).toEqual({ classes: 1000, fees: [] });
  });
});

/*
 * A fee already past its due date (second review of the fixes, item 2): it was owed before the switch,
 * so per class waits for the next month even with nothing recorded, unless the student joined that
 * month (adding a student and then choosing «Por clase» is how a new student pays per class).
 */
describe("a fee already past its due date when switching to per class", () => {
  const paidUntilOctober = () => payFees(fixture(), ["ana", "beto"], ["2026-09", "2026-10"]);

  it("keeps November's unpaid fee, due on the 5th, with nothing recorded yet", () => {
    const state = paidUntilOctober();
    expect(owed(state)).toEqual({ classes: 0, fees: 1000 });
    const saved = saveBilling(state, adjust({ ana: PER_CLASS }));
    // Before: per class from November and the overdue $1,000 vanished.
    expect(saved.starts.ana).toBe("2026-12");
    expect(owed(saved.state)).toEqual({ classes: 0, fees: 1000 });
  });

  it("keeps it when she missed every November class recorded", () => {
    const state = recordClasses(paidUntilOctober(), "2026-11-01", TODAY, [], { ana: "A" });
    const saved = saveBilling(state, adjust({ ana: PER_CLASS }));
    expect(saved.starts.ana).toBe("2026-12");
    expect(owed(saved.state)).toEqual({ classes: 0, fees: 1000 });
  });

  it("starts this month when switched before the due date with nothing recorded", () => {
    const saved = saveBilling(paidUntilOctober(), adjust({ ana: PER_CLASS }), "2026-11-03");
    expect(saved.starts.ana).toBe("2026-11");
    expect(feeOf(saved.state, "2026-11", "2026-11-03")).toBeUndefined();
  });

  it("does not count a month with nothing to pay (an own fee of $0)", () => {
    const state = fixture({ ana: { billingByGroup: { g: { mode: "customFee", fee: 0, effectiveFrom: "2026-09" } } } });
    expect(saveBilling(state, adjust({ ana: PER_CLASS })).starts.ana).toBe("2026-11");
  });

  it("still lets a student added this month go per class a week later with nothing recorded", () => {
    const bea = joinGroup(
      { id: "bea", code: "C", fullName: "Bea", status: "Active", groupIds: [] },
      fixture().groups[0],
      TODAY,
      {
        amount: 1000,
      },
    );
    const state = normalizeState({ ...paidUntilOctober(), students: [...paidUntilOctober().students, bea] });
    // Her fee fell due the day she joined (13th); on the 20th it is past due, but it is her first month.
    expect(saveBilling(state, adjust({ bea: PER_CLASS }), "2026-11-20").starts.bea).toBe("2026-11");
  });
});
