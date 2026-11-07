import { afterEach, describe, expect, it, vi } from "vitest";
import { createStarterState } from "./starterState.js";
import { normalizeState, validateState } from "./validation.js";
import { importState, serializeState } from "./storage.js";
import { deriveAll } from "./calculations.js";
import { buildImportPlan } from "./importRecords.js";
import {
  deriveMonthlyCharges,
  monthlyDueDate,
  normalizeMonthlyPayments,
  recordMonthlyPayment,
  removeMonthlyPayment,
  setMonthlyPayment,
  studentMoneyOnRecord,
} from "./monthlyBilling.js";
import { statisticsStateForGroups } from "./groupArchiving.js";
import { generateScheduledOccurrences } from "./schedule.js";
import { preserveGroupSchedule } from "./groupScheduleHistory.js";
import { monthlyStamps } from "../features/trackingStudentSheetModel.js";
import { debtSummary } from "../features/homeDashboardModel.js";
import {
  monthlyBlocks,
  trackingKpis,
  trackingRange,
  trackingRecords,
  trackingStudents,
} from "../features/trackingModel.js";

const MON_THU = [
  { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
  { id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
];
const FRIDAY = [{ id: "fri", dayOfWeek: 5, startTime: "16:00", durationHours: 2 }];
const IDS = { studentId: "ana", groupId: "g", period: "2026-10" };
function fixture({ monthly = true, classLog = [], students } = {}) {
  return normalizeState({
    ...createStarterState({ settings: { asOfDate: "2026-11-04", hourlyRate: 100 } }),
    groups: [
      {
        id: "g",
        name: "Grupo",
        hourlyRate: 100,
        weeklySchedule: MON_THU,
        scheduleResumeDate: "2026-09-01",
        ...(monthly
          ? {
              billing: {
                mode: "monthly",
                monthlyFee: 1000,
                due: { type: "dayOfMonth", day: 5 },
                effectiveFrom: "2026-09",
              },
            }
          : {}),
      },
    ],
    students: students || [{ id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] }],
    classLog,
  });
}
const receipt = (id, amount, paidAt = "2026-10-10", extra = {}) => ({
  id,
  groupId: "g",
  period: "2026-10",
  amount,
  paidAt,
  ...extra,
});
const row = (extra = {}) => ({
  id: "c",
  studentId: "ana",
  groupId: "g",
  classDate: "2026-10-05",
  startTime: "16:00",
  hours: 2,
  attendance: "P",
  classStatus: "Completed",
  appliedHourlyRate: 100,
  appliedCharge: 200,
  amountPaid: 200,
  paymentState: "Paid",
  paymentDate: "2026-11-02",
  ...extra,
});
const october = (state, asOf = "2026-10-31") => deriveMonthlyCharges(state, asOf).find((c) => c.period === "2026-10");
const reload = (state) => importState(serializeState(state));
afterEach(() => vi.restoreAllMocks());

describe("a receipt left behind by Undo", () => {
  it("reads as an abono, so losing the agreed total can never settle the month again", () => {
    const state = {
      settings: { asOfDate: "2026-10-21" },
      groups: [
        {
          id: "g",
          name: "Prepa",
          status: "Active",
          billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
        },
      ],
      students: [
        {
          id: "s",
          fullName: "Ana",
          status: "Active",
          groupIds: ["g"],
          monthlyPayments: [
            { id: "a", groupId: "g", period: "2026-10", amount: 300, paidAt: "2026-10-05", partial: true },
            { id: "b", groupId: "g", period: "2026-10", amount: 500, paidAt: "2026-10-06", settledTotal: 800 },
          ],
        },
      ],
      classLog: [],
    };
    const next = removeMonthlyPayment(state, { studentId: "s", paymentId: "a" });
    expect(next.students[0].monthlyPayments).toMatchObject([{ id: "b", partial: true, settledTotal: 800 }]);
    const { settledTotal: _lost, ...plain } = next.students[0].monthlyPayments[0];
    const oldTab = { ...next, students: [{ ...next.students[0], monthlyPayments: [plain] }] };
    expect(deriveMonthlyCharges(oldTab, "2026-10-21")[0]).toMatchObject({ status: "overdue", balance: 300 });
  });
});

describe("monthly receipts and undo", () => {
  function paidInParts() {
    let state = fixture();
    state = recordMonthlyPayment(state, { ...IDS, amount: 400, paidAt: "2026-10-10" });
    return recordMonthlyPayment(state, { ...IDS, amount: 600, paidAt: "2026-10-10" });
  }
  it("undoes the latest same-day receipt even when UUIDs sort in the opposite order", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce("z-first").mockReturnValueOnce("a-last");
    const state = paidInParts();
    expect(october(state)).toMatchObject({ paid: 1000, balance: 0, paymentId: "monthly_a-last" });
    const undone = reload(setMonthlyPayment(state, { ...IDS, paid: false, paymentId: october(state).paymentId }));
    expect(october(undone)).toMatchObject({ paid: 400, balance: 600, status: "overdue" });
  });
  it.each([0, 1])("reopens the right balance when receipt %s is removed, after a fee increase and reload", (index) => {
    const state = paidInParts();
    const raised = {
      ...state,
      groups: state.groups.map((g) => ({ ...g, billing: { ...g.billing, monthlyFee: 1400 } })),
    };
    expect(october(raised)).toMatchObject({ paid: 1000, balance: 0, total: 1000 });
    const paid = state.students[0].monthlyPayments;
    const after = reload(removeMonthlyPayment(raised, { studentId: "ana", paymentId: paid[index].id }));
    expect(october(after)).toMatchObject({
      paid: index ? 400 : 600,
      balance: paid[index].amount,
      total: 1000,
      status: "overdue",
    });
  });
  it("reopens legacy full payments without losing their agreed amount", () => {
    const state = fixture();
    state.students[0].monthlyPayments = [
      receipt("z-first", 400, "2026-10-10", { partial: true }),
      receipt("a-last", 600),
    ];
    const after = reload(removeMonthlyPayment(state, { studentId: "ana", paymentId: "z-first" }));
    expect(october(after)).toMatchObject({ paid: 600, balance: 400, status: "overdue" });
    expect(normalizeMonthlyPayments(state.students[0].monthlyPayments).map((p) => p.id)).toEqual(["z-first", "a-last"]);
  });
  it("uses recording time, rather than a backdated payment date, to choose the receipt to undo", () => {
    const state = fixture();
    state.students[0].monthlyPayments = [
      receipt("new", 300, "2026-10-05", { partial: true, recordedAt: "2026-10-20T12:00:00.000Z" }),
      receipt("old", 400, "2026-10-10", { partial: true, recordedAt: "2026-10-19T12:00:00.000Z" }),
    ];
    expect(october(state)).toMatchObject({ paymentId: "new", paid: 700, balance: 300 });
  });
  it("keeps the settlement date separate from the last recorded receipt", () => {
    const state = fixture();
    state.students[0].monthlyPayments = [
      receipt("new", 600, "2026-10-05", { settledTotal: 1000, recordedAt: "2026-10-20T12:00:00.000Z" }),
      receipt("old", 400, "2026-10-10", { partial: true, recordedAt: "2026-10-19T12:00:00.000Z" }),
    ];
    expect(october(state)).toMatchObject({
      status: "paid",
      paymentId: "new",
      lastPaidAt: "2026-10-05",
      paidAt: "2026-10-10",
    });
    expect(october(state, "2026-10-05")).toMatchObject({ status: "pending", paid: 600, balance: 400 });
  });
});

describe("historical report cutoff", () => {
  it("leaves October outstanding until its November receipt actually arrives", () => {
    const state = fixture();
    state.students[0].monthlyPayments = [receipt("p", 1000, "2026-11-02")];
    expect(october(state)).toMatchObject({ status: "overdue", paid: 0, balance: 1000 });
    expect(october(state, "2026-11-02")).toMatchObject({ status: "paid", paid: 1000, balance: 0 });
  });
  it("uses the cutoff for class balances, detail and headline even when handed today's derivation", () => {
    const state = fixture({ monthly: false, classLog: [row()] });
    const derived = deriveAll(state, "2026-11-04");
    const range = trackingRange("2026-10-31", "month", state);
    const students = trackingStudents(state, derived, range);
    expect(trackingKpis(state, derived, range, "all", students).payments).toMatchObject({ collected: 0, owed: 200 });
    expect(students[0].owed).toBe(200);
    expect(trackingRecords(state, derived, range)[0].payment).toBe("pending");
  });
  it("credits per-class receipts only after their date, without charging that covered class twice", () => {
    const state = fixture({ classLog: [row()] });
    expect(october(state)).toMatchObject({ total: 1000, balance: 1000 });
    expect(deriveAll(state, "2026-10-31").classLog[0].outstanding).toBe(0);
    expect(october(state, "2026-11-04")).toMatchObject({ total: 800, balance: 800 });
    const range = trackingRange("2026-10-31", "month", state);
    expect(trackingStudents(state, deriveAll(state, "2026-11-04"), range)[0].owed).toBe(2000); // September + October
  });
});

describe("one financial scope across reports", () => {
  it.each(["g", "individual"])("keeps historical debt after membership changes, for scope %s", (scope) => {
    const state = fixture({
      monthly: false,
      classLog: [
        row({ groupId: scope === "individual" ? "" : "g", amountPaid: 0, paymentDate: null, paymentState: "Pending" }),
      ],
    });
    state.students[0] = { ...state.students[0], groupIds: scope === "individual" ? ["g"] : [] };
    const derived = deriveAll(state, "2026-11-04");
    const range = trackingRange("2026-11-04", "month", state);
    const students = trackingStudents(state, derived, range, scope);
    expect(students).toHaveLength(1);
    expect(trackingKpis(state, derived, range, scope, students).payments.owed).toBe(200);
    expect(debtSummary(state, derived.classLog, range.end, scope).owed).toBe(200);
  });
  it("includes archived monthly fees only when the shared archive scope includes them", () => {
    const state = fixture();
    state.groups[0] = { ...state.groups[0], status: "Inactive", archivedAt: "2026-10-31" };
    for (const included of [false, true]) {
      const scoped = statisticsStateForGroups(state, included);
      const derived = deriveAll(scoped, "2026-10-31");
      const range = trackingRange("2026-10-31", "month", scoped);
      const students = trackingStudents(scoped, derived, range);
      const amount = included ? 2000 : 0;
      expect(debtSummary(scoped, derived.classLog, range.end).owed).toBe(amount);
      expect(trackingKpis(scoped, derived, range, "all", students).payments.owed).toBe(amount);
      expect(monthlyBlocks(scoped, range.end)).toHaveLength(included ? 1 : 0);
      expect(monthlyStamps(scoped, range.end, "all", "ana")).toHaveLength(included ? 2 : 0);
    }
  });
  it("keeps inactive students' debt in the separate total", () => {
    const state = fixture({ monthly: false, classLog: [row({ amountPaid: 0, paymentDate: null })] });
    state.students[0].status = "Inactive";
    const derived = deriveAll(state, "2026-11-04");
    const range = trackingRange("2026-11-04", "month", state);
    expect(trackingKpis(state, derived, range, "all", trackingStudents(state, derived, range)).payments).toMatchObject({
      owed: 0,
      inactiveOwed: 200,
    });
  });
});

describe("historical monthly calendar", () => {
  function nthClass(state) {
    return {
      ...state,
      groups: state.groups.map((g) => ({ ...g, billing: { ...g.billing, due: { type: "nthClass", nth: 2 } } })),
    };
  }
  it("keeps old due dates after replacing or removing slots, including after a backup reload", () => {
    const state = nthClass(fixture({ classLog: [row({ scheduleSlotId: "mon", amountPaid: 0, paymentDate: null })] }));
    const [before] = state.groups;
    const next = preserveGroupSchedule(before, { ...before, weeklySchedule: FRIDAY }, "2026-11-04");
    const restored = reload({ ...state, groups: [next] });
    expect(validateState(restored).valid).toBe(true);
    expect(monthlyDueDate(restored, restored.groups[0], "2026-09")).toBe("2026-09-07");
    // Nov 2 still follows the earlier schedule, followed by Friday Nov 6.
    expect(monthlyDueDate(restored, restored.groups[0], "2026-11")).toBe("2026-11-06");
    expect(generateScheduledOccurrences(restored, "2026-11-04", "2026-11-10").map((o) => o.classDate)).toEqual([
      "2026-11-06",
    ]);
    expect(generateScheduledOccurrences(restored, "2026-09-01", "2026-09-08").map((o) => o.classDate)).toEqual([
      "2026-09-03",
      "2026-09-07",
    ]);
    const imported = buildImportPlan(createStarterState(), restored).candidate;
    expect(monthlyDueDate(imported, imported.groups[0], "2026-09")).toBe("2026-09-07");
    const target = normalizeState({
      ...createStarterState(),
      groups: [
        {
          ...restored.groups[0],
          id: "target",
          weeklySchedule: FRIDAY.map((slot) => ({ ...slot, id: `target-${slot.id}` })),
          scheduleHistory: [
            { until: "2026-11-04", weeklySchedule: MON_THU.map((slot) => ({ ...slot, id: `target-${slot.id}` })) },
          ],
        },
      ],
    });
    const remapped = buildImportPlan(target, restored).candidate;
    expect(remapped.classLog[0].scheduleSlotId).toBe("target-mon");
    expect(validateState(remapped).valid).toBe(true);
  });
  it("keeps a month's earlier classes when its weekly schedule changes halfway through", () => {
    const state = nthClass(fixture());
    const [before] = state.groups;
    const next = preserveGroupSchedule(before, { ...before, weeklySchedule: FRIDAY }, "2026-10-12");
    const changed = { ...state, groups: [next] };
    expect(monthlyDueDate(changed, next, "2026-10")).toBe("2026-10-05");
    const again = preserveGroupSchedule(next, { ...next, weeklySchedule: [] }, "2026-10-12");
    expect(monthlyDueDate({ ...state, groups: [again] }, again, "2026-09")).toBe("2026-09-07");
    expect(again.scheduleHistory).toHaveLength(1);
  });
  it("does not move September's due date when the group resumes in November", () => {
    const state = nthClass(fixture());
    const resumed = { ...state, groups: state.groups.map((g) => ({ ...g, scheduleResumeDate: "2026-11-04" })) };
    expect(monthlyDueDate(resumed, resumed.groups[0], "2026-09")).toBe("2026-09-07");
  });
  it("recognizes paid and outstanding monthly history when deciding whether a student can be deleted", () => {
    const state = fixture();
    expect(studentMoneyOnRecord(state, "ana", "2026-11-04")).toBe(true);
    state.students[0].monthlyPayments = [receipt("p", 1000)];
    expect(studentMoneyOnRecord(state, "ana", "2026-09-01")).toBe(true);
    expect(studentMoneyOnRecord(fixture({ monthly: false }), "ana", "2026-11-04")).toBe(false);
  });
});
