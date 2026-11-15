import { describe, expect, it } from "vitest";
import { deriveAll } from "../domain/calculations.js";
import { setGroupArchived } from "../domain/groupArchiving.js";
import { markLost } from "../domain/lostPayments.js";
import { sumMoney } from "../domain/money.js";
import {
  deriveMonthlyCharges,
  groupFirstPeriod,
  normalizeBillingByGroup,
  recordMonthlyPayment,
  recordStays,
  resumeGroupBilling,
  startGroupBilling,
} from "../domain/monthlyBilling.js";
import { generateScheduledOccurrences, resolveHourlyRate } from "../domain/schedule.js";
import { createStarterState } from "../domain/starterState.js";
import { normalizeState } from "../domain/validation.js";
import { buildClassRecords } from "./classesDraftModel.js";
import { applyFromOptions, backdatedEffects, billingChanges, billingDraftFor } from "./communityModel.js";

/*
 * «Forma de cobro» › mensual con «Aplica desde» en un mes pasado (audit 2026-11-13 A4, finding #8 of
 * 2026-10-28). Group: Monday and Thursday, 2 h at $100/h ($200 a class), $1,000 a month due on the 5th.
 * Today is Friday, November 13.
 */
const TODAY = "2026-11-13";
const MONTHLY = { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 } };
const PER_CLASS = { mode: "perClass", fee: null, due: null };

function fixture({ group = {}, students = null, asOf = TODAY } = {}) {
  return normalizeState({
    ...createStarterState({ settings: { asOfDate: asOf, hourlyRate: 100 } }),
    groups: [
      {
        id: "g",
        name: "Grupo",
        hourlyRate: 100,
        weeklySchedule: [
          { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
        ],
        scheduleResumeDate: "2026-08-03",
        ...group,
      },
    ],
    students: students || [
      { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] },
      { id: "beto", code: "B", fullName: "Beto", status: "Active", groupIds: ["g"] },
    ],
  });
}

const classDays = (state, from, to) =>
  [...new Set(generateScheduledOccurrences(state, from, to).map((item) => item.classDate))].sort();

// Saves the classes of a range as Clases › Guardar does, for the students `who(date)` lists, all present and unpaid.
function recordClasses(state, from, to, who = () => ["ana", "beto"]) {
  let next = state;
  for (const date of classDays(state, from, to)) {
    const roster = next.students.filter((student) => who(date).includes(student.id));
    const session = { classDate: date, groupId: "g", durationHours: 2, startTime: "16:00", title: "", rows: [] };
    const entries = Object.fromEntries(roster.map((student) => [student.id, { attendance: "P" }]));
    const rows = buildClassRecords(next, session, roster, entries, { today: date }).map((row) => ({
      ...row,
      id: `${row.studentId}-${date}`,
      appliedHourlyRate: resolveHourlyRate(next, row.studentId, "g"),
    }));
    next = normalizeState({ ...next, classLog: [...next.classLog, ...rows] });
  }
  return next;
}

// Comunidad › grupo › «Forma de cobro» › Guardar, with the workspace as Community passes it.
function saveBilling(state, change, asOf = TODAY) {
  const group = state.groups[0];
  const members = state.students.filter((student) => student.status !== "Inactive" && student.groupIds.includes("g"));
  const draft = change(billingDraftFor(group, members));
  const { billing, overrides } = billingChanges(group, members, draft, asOf, draft.applyFrom, state);
  const effects = backdatedEffects(state, group, members, draft, asOf);
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
  return { state: next, billing, overrides, effects };
}

const monthlyFrom =
  (applyFrom, extra = {}) =>
  (draft) => ({ ...draft, ...MONTHLY, applyFrom, ...extra });

// What is owed on `asOf` (by one student, or the whole group): class balances plus fees due by then.
function owed(state, asOf = TODAY, studentId = "") {
  const own = (item) => !studentId || item.studentId === studentId;
  const classes = sumMoney(deriveAll(state, asOf).classLog.filter(own), (row) => row.outstanding || 0);
  const fees = sumMoney(
    deriveMonthlyCharges(state, asOf).filter(
      (charge) => own(charge) && ["overdue", "pending"].includes(charge.status) && charge.dueDate <= asOf,
    ),
    (charge) => charge.balance,
  );
  return { classes, fees };
}

const feesOf = (state, studentId, asOf = TODAY) =>
  deriveMonthlyCharges(state, asOf)
    .filter((charge) => charge.studentId === studentId)
    .map((charge) => `${charge.period}:${charge.status}:${charge.balance}`);

const optionsFor = (state, extra = {}) => {
  const group = state.groups[0];
  const draft = { ...billingDraftFor(group, state.students), ...MONTHLY, ...extra };
  return applyFromOptions(group, draft, TODAY, state);
};

describe("never a start before the group existed", () => {
  it("offers a group created on August 3 from August, not six months back (G «mode»)", () => {
    const today = "2026-08-12";
    const state = recordClasses(fixture({ asOf: today }), "2026-08-03", today);
    const group = state.groups[0];
    const draft = { ...billingDraftFor(group, state.students), ...MONTHLY };
    expect(applyFromOptions(group, draft, today)[0]).toBe("2026-02");
    expect(applyFromOptions(group, draft, today, state)[0]).toBe("2026-08");
    expect(owed(state, today)).toEqual({ classes: 1200, fees: 0 });
    // A start in May (not offered any more) moves to the group's first month: before the fix, $8,000.
    const saved = saveBilling(state, monthlyFrom("2026-05"), today);
    expect(saved.billing).toMatchObject({ mode: "monthly", effectiveFrom: "2026-08" });
    expect(owed(saved.state, today)).toEqual({ classes: 0, fees: 2000 });
    expect(saved.effects).toEqual({ count: 2, total: 2000, stopped: 1200, dropped: 0, droppedTotal: 0 });
  });

  it("dates a group by its first class, schedule start, schedule history, billing or a join date", () => {
    const base = fixture({ group: { scheduleResumeDate: "" } });
    // Nothing on record: no month before this one.
    expect(groupFirstPeriod(base, base.groups[0], TODAY)).toBe("2026-11");
    expect(optionsFor(base)[0]).toBe("2026-11");
    const withClass = recordClasses(base, "2026-06-08", "2026-06-08", () => ["ana"]);
    expect(optionsFor(withClass)[0]).toBe("2026-06");
    const edited = fixture({
      group: {
        scheduleResumeDate: "",
        scheduleHistory: [
          { until: "2026-09-10", weeklySchedule: [{ id: "x", dayOfWeek: 2, startTime: "16:00", durationHours: 2 }] },
        ],
      },
    });
    expect(groupFirstPeriod(edited, edited.groups[0], TODAY)).toBe("2026-09");
    const joined = fixture({
      group: { scheduleResumeDate: "" },
      students: [
        {
          id: "ana",
          code: "A",
          fullName: "Ana",
          status: "Active",
          groupIds: ["g"],
          billingByGroup: { g: { mode: "group", joinedOn: "2026-10-02" } },
        },
      ],
    });
    expect(groupFirstPeriod(joined, joined.groups[0], TODAY)).toBe("2026-10");
  });

  it("keeps an arrangement's own start listed, even before the group's records", () => {
    const state = fixture({
      group: { scheduleResumeDate: "2026-10-01", billing: { ...MONTHLY, effectiveFrom: "2026-07" } },
    });
    const group = state.groups[0];
    expect(applyFromOptions(group, billingDraftFor(group, state.students), TODAY, state)[0]).toBe("2026-07");
    // Moving it is possible back to its own start, never before.
    expect(saveBilling(state, (draft) => ({ ...draft, applyFrom: "2026-06" })).billing.effectiveFrom).toBe("2026-07");
  });

  it("never reaches into the months a reactivated group spent archived", () => {
    // Per class since August, archived on September 10, reactivated on October 15.
    let state = recordClasses(fixture(), "2026-08-03", "2026-09-10");
    state = setGroupArchived(state, "g", true, "2026-09-10");
    state = normalizeState(setGroupArchived(state, "g", false, "2026-10-15"));
    state = recordClasses(state, "2026-10-15", TODAY);
    expect(state.groups[0]).toMatchObject({ archivedAt: "2026-09-10", scheduleResumeDate: "2026-10-15" });
    // September was archived in part only; nothing was archived for a whole month: August is offered.
    expect(optionsFor(state)[0]).toBe("2026-08");

    // Archived on August 20 instead: September was archived whole, so the group starts again in October.
    let away = recordClasses(fixture(), "2026-08-03", "2026-08-20");
    away = setGroupArchived(away, "g", true, "2026-08-20");
    away = normalizeState(setGroupArchived(away, "g", false, "2026-10-15"));
    away = recordClasses(away, "2026-10-15", TODAY);
    expect(optionsFor(away)[0]).toBe("2026-10");
    const saved = saveBilling(away, monthlyFrom("2026-08"));
    expect(saved.billing.effectiveFrom).toBe("2026-10");
    expect(feesOf(saved.state, "ana")).toEqual(["2026-10:overdue:1000", "2026-11:overdue:1000"]);
  });

  it("keeps the pause of a monthly group reactivated from archive when its fee changes backdated", () => {
    // Monthly since August, archived on August 20, reactivated on October 15: September stays per class.
    let state = recordClasses(
      fixture({ group: { billing: { ...MONTHLY, effectiveFrom: "2026-08" } } }),
      "2026-08-03",
      "2026-08-20",
    );
    state = setGroupArchived(state, "g", true, "2026-08-20");
    state = setGroupArchived(state, "g", false, "2026-10-15");
    state = normalizeState({
      ...state,
      groups: [resumeGroupBilling({ ...state.groups[0], archivedAt: "2026-08-20" }, "2026-10-15")],
    });
    expect(state.groups[0].billing).toMatchObject({
      effectiveFrom: "2026-11",
      history: [{ mode: "monthly" }, { mode: "perClass", effectiveFrom: "2026-09" }],
    });
    const before = feesOf(state, "ana");
    // Before the fix «desde agosto» with a new fee billed the archived September and October.
    const options = optionsFor(state, { monthlyFee: 1200 });
    expect(options[0]).toBe("2026-10");
    const saved = saveBilling(state, monthlyFrom("2026-08", { monthlyFee: 1200 }));
    expect(feesOf(saved.state, "ana").filter((fee) => fee.startsWith("2026-09"))).toEqual([]);
    expect(before.filter((fee) => fee.startsWith("2026-09"))).toEqual([]);
  });
});

describe("a backdated start never bills a student before they joined", () => {
  it("bills Beto, added on October 20 with no class yet, from today and not since August (F3)", () => {
    const state = normalizeState({
      ...fixture({ students: [{ id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] }] }),
    });
    const beto = { id: "beto", code: "B", fullName: "Beto", status: "Active", groupIds: ["g"] };
    const joined = normalizeState({
      ...state,
      students: [...state.students, recordStays(null, beto, state.groups, "2026-10-20")],
    });
    expect(joined.students[1].billingByGroup).toBeUndefined();
    const saved = saveBilling(joined, monthlyFrom("2026-08"));
    // Nothing on record shows either of them in the group before today: they join the fee today, as joining does.
    expect(saved.overrides).toEqual({
      ana: { mode: "group", joinedOn: TODAY },
      beto: { mode: "group", joinedOn: TODAY },
    });
    // Before the fix: August to November overdue, $4,000.
    expect(feesOf(saved.state, "beto")).toEqual(["2026-11:pending:1000"]);
  });

  it("bills from the first class on record; months before it are not billed", () => {
    // Ana since August 3; Beto's first class is October 22.
    const state = recordClasses(fixture(), "2026-08-03", TODAY, (date) =>
      date >= "2026-10-22" ? ["ana", "beto"] : ["ana"],
    );
    const saved = saveBilling(state, monthlyFrom("2026-08"));
    expect(saved.overrides).toEqual({
      ana: { mode: "group", joinedOn: "2026-08-03" },
      beto: { mode: "group", joinedOn: "2026-10-22" },
    });
    expect(feesOf(saved.state, "beto")).toEqual(["2026-10:overdue:1000", "2026-11:overdue:1000"]);
    expect(feesOf(saved.state, "ana")).toEqual([
      "2026-08:overdue:1000",
      "2026-09:overdue:1000",
      "2026-10:overdue:1000",
      "2026-11:overdue:1000",
    ]);
  });

  it("saves nothing when the start is not backdated, or when the first class is the first day", () => {
    const state = recordClasses(fixture(), "2026-10-22", TODAY);
    expect(saveBilling(state, monthlyFrom("current")).overrides).toEqual({});
    expect(saveBilling(state, monthlyFrom("next")).overrides).toEqual({});
    const early = recordClasses(fixture({ group: { scheduleResumeDate: "2026-06-01" } }), "2026-06-01", "2026-06-01");
    expect(saveBilling(early, monthlyFrom("2026-06")).overrides).toEqual({});
  });

  it("keeps per class the months a student switched to per class in the same save did not pay monthly", () => {
    // Audit of the fixes, finding 3. Monthly since September, Ana and Beto since August 3: August was
    // per class ($1,800 unpaid each). September and October are paid; November's classes are recorded.
    let state = recordClasses(
      fixture({ group: { billing: { ...MONTHLY, effectiveFrom: "2026-09" } } }),
      "2026-08-03",
      TODAY,
    );
    for (const studentId of ["ana", "beto"])
      for (const period of ["2026-09", "2026-10"])
        state = recordMonthlyPayment(state, { studentId, groupId: "g", period, paidAt: `${period}-05` });
    const august = (current) =>
      sumMoney(
        deriveAll(current, TODAY).classLog.filter((row) => row.studentId === "ana" && row.classDate < "2026-09-01"),
        (row) => row.outstanding || 0,
      );
    expect(august(state)).toBe(1800);
    const before = feesOf(state, "ana");
    // One save: «Aplica desde» back to August and Ana per class.
    const saved = saveBilling(state, (draft) => ({ ...draft, applyFrom: "2026-08", adjustments: { ana: PER_CLASS } }));
    // Before the fix: { perClass from December, joinedOn: "2026-08-03" }, a $1,000 August fee and August at $0.
    expect(saved.overrides.ana).toEqual({
      mode: "perClass",
      effectiveFrom: "2026-12",
      history: [
        { mode: "perClass", effectiveFrom: "2026-08" },
        { mode: "group", effectiveFrom: "2026-09" },
      ],
    });
    expect(feesOf(saved.state, "ana")).toEqual(before);
    expect(august(saved.state)).toBe(1800);
    // Beto, who keeps the group fee, gets the backdated August as before.
    expect(saved.overrides.beto).toEqual({ mode: "group", joinedOn: "2026-08-03" });
    expect(feesOf(saved.state, "beto")[0]).toBe("2026-08:overdue:1000");
    // December is per class for Ana.
    const december = recordClasses(saved.state, "2026-12-01", "2026-12-07");
    expect(
      deriveAll(december, "2026-12-07")
        .classLog.filter((row) => row.studentId === "ana" && row.classDate >= "2026-12-01")
        .map((row) => row.outstanding),
    ).toEqual([200, 200]);
  });

  it("composes with adjustments changed in the same save and with per class", () => {
    const state = recordClasses(fixture(), "2026-08-03", TODAY, (date) =>
      date >= "2026-10-22" ? ["ana", "beto"] : ["ana"],
    );
    const adjustments = { ana: PER_CLASS, beto: { mode: "customFee", fee: 600, due: null } };
    const saved = saveBilling(state, monthlyFrom("2026-08", { adjustments }));
    // Ana pays per class from August: no fee, so no join date. Beto's own fee keeps his join date.
    expect(saved.overrides).toEqual({
      ana: { mode: "perClass", effectiveFrom: "2026-08" },
      beto: { mode: "customFee", fee: 600, effectiveFrom: "2026-08", joinedOn: "2026-10-22" },
    });
    expect(feesOf(saved.state, "beto")).toEqual(["2026-10:overdue:600", "2026-11:overdue:600"]);
    expect(feesOf(saved.state, "ana")).toEqual([]);
    expect(owed(saved.state, TODAY, "ana").classes).toBe(owed(state, TODAY, "ana").classes);
  });

  it("keeps a stored per-class or own-fee adjustment and the months it already billed", () => {
    // Beto pays his own fee since October; the group moves its start from October back to August.
    let state = recordClasses(
      fixture({ group: { billing: { ...MONTHLY, effectiveFrom: "2026-10" } } }),
      "2026-08-03",
      "2026-09-30",
      () => ["ana"],
    );
    state = recordClasses(state, "2026-09-10", TODAY, (date) => (date >= "2026-10-01" ? ["ana", "beto"] : ["beto"]));
    state = normalizeState({
      ...state,
      students: state.students.map((student) =>
        student.id === "beto"
          ? { ...student, billingByGroup: { g: { mode: "customFee", fee: 700, effectiveFrom: "2026-10" } } }
          : student,
      ),
    });
    const before = feesOf(state, "beto");
    expect(before).toEqual(["2026-10:overdue:700", "2026-11:overdue:700"]);
    const saved = saveBilling(state, (draft) => ({ ...draft, applyFrom: "2026-08" }));
    expect(saved.billing).toMatchObject({ mode: "monthly", effectiveFrom: "2026-08" });
    // Beto's first class is September 10: August is not his; September pays the group fee, less what he paid per class (nothing).
    expect(saved.overrides.beto).toEqual({
      mode: "customFee",
      fee: 700,
      effectiveFrom: "2026-10",
      joinedOn: "2026-09-10",
    });
    expect(feesOf(saved.state, "beto")).toEqual(["2026-09:overdue:1000", ...before]);
  });

  it("saves nothing for a student who always paid per class, whose classes keep their price", () => {
    const students = [
      { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] },
      {
        id: "caro",
        code: "C",
        fullName: "Caro",
        status: "Active",
        groupIds: ["g"],
        billingByGroup: { g: { mode: "perClass" } },
      },
    ];
    const state = recordClasses(fixture({ students }), "2026-09-10", TODAY, () => ["ana", "caro"]);
    const saved = saveBilling(state, monthlyFrom("2026-08"));
    expect(Object.keys(saved.overrides)).toEqual(["ana"]);
    expect(feesOf(saved.state, "caro")).toEqual([]);
    expect(owed(saved.state, TODAY, "caro")).toEqual(owed(state, TODAY, "caro"));
  });

  it("never drops a month the old arrangement already billed", () => {
    // Monthly since October without join dates; Beto's records start on October 22.
    const state = recordClasses(
      fixture({ group: { billing: { ...MONTHLY, effectiveFrom: "2026-10" } } }),
      "2026-10-22",
      TODAY,
    );
    const before = feesOf(state, "beto");
    expect(before).toEqual(["2026-10:overdue:1000", "2026-11:overdue:1000"]);
    const saved = saveBilling(state, (draft) => ({ ...draft, applyFrom: "2026-08" }));
    // Capped to October 1: October stays as it was, August and September are not his.
    expect(saved.overrides.beto).toEqual({ mode: "group", joinedOn: "2026-10-01" });
    expect(feesOf(saved.state, "beto")).toEqual(before);
  });

  describe("when the group had an earlier monthly term (audit of the fixes, finding 2)", () => {
    // Monthly January to March, per class since April. Ana came from January 5; Beto was added on
    // October 20 with no join date (the group billed per class) and came first on October 22.
    const earlier = { mode: "perClass", effectiveFrom: "2026-04", history: [{ ...MONTHLY, effectiveFrom: "2026-01" }] };
    const withBeto = () =>
      recordClasses(
        fixture({ group: { billing: earlier, scheduleResumeDate: "2026-01-05" } }),
        "2026-01-05",
        TODAY,
        (date) => (date >= "2026-10-22" ? ["ana", "beto"] : ["ana"]),
      );
    const OLD = ["2026-01:overdue:1000", "2026-02:overdue:1000", "2026-03:overdue:1000"];

    it("keeps the fees Beto already owed and leaves out only the backdated months before his first class", () => {
      const state = withBeto();
      // Older data: with no join date the January-March term already billed him.
      expect(feesOf(state, "beto")).toEqual(OLD);
      expect(owed(state, TODAY, "beto")).toEqual({ classes: 1400, fees: 3000 });
      const saved = saveBilling(state, monthlyFrom("2026-08"));
      // Away from April 1 to his first class: January-March stay owed, August and September are not his.
      expect(saved.overrides.beto).toEqual({ mode: "group", away: [{ from: "2026-04-01", to: "2026-10-22" }] });
      // Before 43beef0's follow-up: January-March and August-November ($7,000); then October-November only.
      expect(feesOf(saved.state, "beto")).toEqual([...OLD, "2026-10:overdue:1000", "2026-11:overdue:1000"]);
      expect(owed(saved.state, TODAY, "beto")).toEqual({ classes: 0, fees: 5000 });
      // October is owed from the day he came, as joining does.
      const october = deriveMonthlyCharges(saved.state, TODAY).find(
        (charge) => charge.studentId === "beto" && charge.period === "2026-10",
      );
      expect(october).toMatchObject({ dueDate: "2026-10-22", coversFrom: "2026-10-22", coversTo: "2026-11-04" });
      // Ana came in January: her January-March fees stay and nothing is saved for her.
      expect(saved.overrides).not.toHaveProperty("ana");
      expect(feesOf(saved.state, "ana").slice(0, 3)).toEqual(feesOf(state, "ana").slice(0, 3));
      // No fee already shown disappears, and the hint counts the new ones.
      expect(saved.effects).toMatchObject({ dropped: 0, droppedTotal: 0 });
    });

    it("composes the away stretch with a later archive and reactivation", () => {
      const saved = saveBilling(withBeto(), monthlyFrom("2026-08")).state;
      const status = (current, day, value) =>
        normalizeState({
          ...current,
          students: current.students.map((s) =>
            s.id === "beto" ? recordStays(s, { ...s, status: value }, current.groups, day, current.classLog) : s,
          ),
        });
      const archived = status(saved, "2026-11-10", "Inactive");
      const back = status(archived, "2026-12-20", "Active");
      expect(back.students[1].billingByGroup.g.away).toEqual([
        { from: "2026-04-01", to: "2026-10-22" },
        { from: "2026-11-10", to: "2026-12-20" },
      ]);
      // November fell due (5th) before he left (10th); December is owed from the day he came back.
      expect(feesOf(back, "beto", "2026-12-31")).toEqual([
        ...OLD,
        "2026-10:overdue:1000",
        "2026-11:overdue:1000",
        "2026-12:overdue:1000",
      ]);
    });

    it("keeps the earlier fees when a receipt, a lost mark or an adjustment shows him there", () => {
      const paid = recordMonthlyPayment(withBeto(), {
        studentId: "beto",
        groupId: "g",
        period: "2026-02",
        amount: 400,
        paidAt: "2026-02-10",
      });
      const lost = markLost(
        withBeto(),
        [{ studentId: "beto", kind: "monthly", groupId: "g", period: "2026-03" }],
        TODAY,
      );
      const adjusted = normalizeState({
        ...withBeto(),
        students: withBeto().students.map((student) =>
          student.id === "beto"
            ? { ...student, billingByGroup: { g: { mode: "customFee", fee: 800, effectiveFrom: "2026-02" } } }
            : student,
        ),
      });
      for (const state of [paid, lost, adjusted]) {
        const before = feesOf(state, "beto");
        const saved = saveBilling(state, monthlyFrom("2026-08"));
        expect(saved.overrides).not.toHaveProperty("beto");
        expect(feesOf(saved.state, "beto").filter((fee) => fee < "2026-04")).toEqual(
          before.filter((fee) => fee < "2026-04"),
        );
      }
    });

    it("keeps them for a student with nothing on record, and while his first class falls in a monthly month", () => {
      const nothing = normalizeState({
        ...withBeto(),
        classLog: withBeto().classLog.filter((row) => row.studentId !== "beto"),
      });
      expect(saveBilling(nothing, monthlyFrom("2026-08")).overrides).not.toHaveProperty("beto");
      // The earlier term was January to March and October on: his first class (October 22) is in it.
      const back = {
        mode: "monthly",
        ...MONTHLY,
        effectiveFrom: "2026-10",
        history: [earlier.history[0], { mode: "perClass", effectiveFrom: "2026-04" }],
      };
      const inside = normalizeState({ ...withBeto(), groups: [{ ...withBeto().groups[0], billing: back }] });
      expect(saveBilling(inside, monthlyFrom("2026-08")).overrides).not.toHaveProperty("beto");
    });
  });

  it("archived students owe only the months they were there, also after coming back", () => {
    // Carla came September 14 to 28 and was archived while the group billed per class; Dani was archived with no class.
    let state = fixture({
      students: [
        { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] },
        { id: "carla", code: "C", fullName: "Carla", status: "Active", groupIds: ["g"] },
        { id: "dani", code: "D", fullName: "Dani", status: "Active", groupIds: ["g"] },
      ],
    });
    state = recordClasses(state, "2026-08-03", "2026-09-28", (date) =>
      date >= "2026-09-14" ? ["ana", "carla"] : ["ana"],
    );
    state = recordClasses(state, "2026-08-10", TODAY, (date) => (date >= "2026-10-01" ? ["ana"] : []));
    const archive = (current, id, date, status) =>
      normalizeState({
        ...current,
        students: current.students.map((s) =>
          s.id === id ? recordStays(s, { ...s, status }, current.groups, date, current.classLog) : s,
        ),
      });
    state = archive(state, "carla", "2026-09-30", "Inactive");
    state = archive(state, "dani", "2026-08-05", "Inactive");
    const saved = saveBilling(state, monthlyFrom("2026-08"));
    // Carla's first class is September 14, saved while she is archived; Dani has nothing on record: reactivating decides.
    expect(saved.overrides).toEqual({
      ana: { mode: "group", joinedOn: "2026-08-03" },
      carla: { mode: "group", joinedOn: "2026-09-14" },
    });
    // Archived without a date of leaving: no fee while she is away.
    expect(feesOf(saved.state, "carla")).toEqual([]);
    expect(feesOf(saved.state, "dani")).toEqual([]);
    let back = archive(saved.state, "carla", "2026-11-13", "Active");
    back = archive(back, "dani", "2026-11-13", "Active");
    // Before the fix August was hers too: nothing showed when she had joined.
    expect(feesOf(back, "carla")).toEqual(["2026-09:overdue:1000", "2026-11:pending:1000"]);
    expect(feesOf(back, "dani")).toEqual(["2026-11:pending:1000"]);
  });

  it("a student who left with a date is not billed months before their first class", () => {
    // Monthly from October; Ema came on September 14 and left on October 15.
    const students = [
      { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] },
      {
        id: "ema",
        code: "E",
        fullName: "Ema",
        status: "Active",
        groupIds: [],
        billingByGroup: { g: { mode: "group", leftOn: "2026-10-15" } },
      },
    ];
    const state = recordClasses(
      fixture({ group: { billing: { ...MONTHLY, effectiveFrom: "2026-10" } }, students }),
      "2026-08-03",
      TODAY,
      (date) => (date >= "2026-09-14" && date <= "2026-10-15" ? ["ana", "ema"] : ["ana"]),
    );
    expect(feesOf(state, "ema")).toEqual(["2026-10:overdue:1000"]);
    const saved = saveBilling(state, (draft) => ({ ...draft, applyFrom: "2026-08" }));
    expect(saved.overrides.ema).toEqual({ mode: "group", joinedOn: "2026-09-14", leftOn: "2026-10-15" });
    expect(feesOf(saved.state, "ema")).toEqual(["2026-09:overdue:1000", "2026-10:overdue:1000"]);
  });
});

describe("what the hint says before saving", () => {
  it("names the fees born overdue and the unpaid per-class debt a backdated start forgives (D8)", () => {
    const state = recordClasses(
      fixture({ students: [{ id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] }] }),
      "2026-10-05",
      "2026-10-08",
      () => ["ana"],
    );
    expect(owed(state)).toEqual({ classes: 400, fees: 0 });
    const saved = saveBilling(state, monthlyFrom("2026-10"));
    // Unchanged meaning: the two classes are now part of the fee and two fees are born overdue. Now it is said.
    expect(owed(saved.state)).toEqual({ classes: 0, fees: 2000 });
    expect(saved.effects).toEqual({ count: 2, total: 2000, stopped: 400, dropped: 0, droppedTotal: 0 });
  });

  it("counts what was paid per class as already credited to the fee", () => {
    let state = recordClasses(fixture(), "2026-10-05", "2026-10-08");
    state = normalizeState({
      ...state,
      classLog: state.classLog.map((row) =>
        row.studentId === "ana" ? { ...row, amountPaid: 200, paymentDate: row.classDate, paymentState: "Paid" } : row,
      ),
    });
    const { effects } = saveBilling(state, monthlyFrom("2026-10"));
    expect(effects).toEqual({ count: 4, total: 3600, stopped: 400, dropped: 0, droppedTotal: 0 });
  });

  it("tells also the debt of a former student whose classes the fee now covers", () => {
    // Fer was removed while the group billed per class, owing his two October classes; no fee bills him.
    const students = [
      { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] },
      { id: "fer", code: "F", fullName: "Fer", status: "Active", groupIds: [] },
    ];
    const state = recordClasses(fixture({ students }), "2026-10-05", "2026-10-08", () => ["ana", "fer"]);
    expect(owed(state, TODAY, "fer")).toEqual({ classes: 400, fees: 0 });
    const { effects, state: after } = saveBilling(state, monthlyFrom("2026-10"));
    // Ana's $400 become part of her fee; Fer's $400 are simply no longer charged, and the hint counts them.
    expect(effects).toEqual({ count: 2, total: 2000, stopped: 800, dropped: 0, droppedTotal: 0 });
    expect(owed(after, TODAY, "fer")).toEqual({ classes: 0, fees: 0 });
  });
});

describe("a new group (tutorial and «Nuevo grupo»)", () => {
  it("still starts this month or the next, with nothing to save per student", () => {
    const state = fixture();
    const draft = { ...billingDraftFor(null, []), ...MONTHLY };
    const { billing, overrides } = billingChanges({ name: "Nuevo" }, [], draft, TODAY, null, state);
    expect(billing).toEqual({ ...MONTHLY, creditFirstMonth: false, effectiveFrom: "2026-11" });
    expect(overrides).toEqual({});
    expect(startGroupBilling({ id: "n", billing, weeklySchedule: [] }, TODAY).billing).toMatchObject({
      effectiveFrom: "2026-12",
      coveredFrom: TODAY,
    });
  });
});
