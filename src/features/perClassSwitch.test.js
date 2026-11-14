import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain/calculations.js";
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
import { billingChanges, billingDraftFor } from "./communityModel.js";

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

// Saves a day's class as Clases › Guardar does: both present, `paid` marks who paid it on the spot.
function recordClasses(state, from, to, paid = []) {
  let next = state;
  for (const date of classDays(state, from, to)) {
    const roster = next.students.filter((student) => student.groupIds.includes("g"));
    const session = { classDate: date, groupId: "g", durationHours: 2, startTime: "16:00", title: "", rows: [] };
    const entries = Object.fromEntries(
      roster.map((student) => [
        student.id,
        {
          attendance: "P",
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
  const { billing, overrides, starts } = billingChanges(group, members, change(billingDraftFor(group, members)), asOf);
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

  it("starts next month for a student who joined this month", () => {
    const state = fixture({ ana: { billingByGroup: { g: { mode: "group", joinedOn: "2026-11-10" } } } });
    const { overrides } = saveBilling(state, adjust({ ana: PER_CLASS }));
    expect(overrides.ana).toEqual({ mode: "perClass", effectiveFrom: "2026-12", joinedOn: "2026-11-10" });
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
