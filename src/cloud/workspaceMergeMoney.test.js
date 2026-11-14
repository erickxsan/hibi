// Audit B3 (2026-11-13, F4): two devices record a student's payments, lost marks or billing before
// either syncs. Each element merges on its own; the money rules decide what a merge by element cannot.
import { describe, expect, it, vi } from "vitest";
import { createClassLogRow, createStarterState, normalizeState } from "../domain/index.js";
import { lostKey, markLost } from "../domain/lostPayments.js";
import {
  changeStudentAdjustment,
  deriveMonthlyCharges,
  monthlyBalance,
  monthlyPaymentsBetween,
  recordMonthlyPayment,
  recordStays,
  removeMonthlyPayment,
} from "../domain/monthlyBilling.js";
import { describeOperation, diffWorkspaceStates, mergeWorkspaceStates } from "./workspaceMerge.js";

const AS_OF = "2026-11-13";
const MONTHLY = { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-09" };
const start = normalizeState({
  ...createStarterState({ settings: { asOfDate: AS_OF, hourlyRate: 100 } }),
  groups: [
    { id: "g", name: "Grupo", hourlyRate: 100, billing: MONTHLY },
    { id: "h", name: "Otro", hourlyRate: 100, billing: MONTHLY },
  ],
  students: [
    { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g", "h"] },
    { id: "beto", code: "B", fullName: "Beto", status: "Active", groupIds: ["g"] },
  ],
});

// Each receipt is recorded at its own moment, as on a real device.
let tick = 0;
function at(change) {
  tick += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + tick * 1000));
  return change();
}
function pay(state, period, { id, amount = undefined, studentId = "ana", groupId = "g", paidAt = AS_OF } = {}) {
  const next = at(() => recordMonthlyPayment(state, { studentId, groupId, period, amount, paidAt, id }));
  expect(next).not.toBe(state);
  return next;
}
const undo = (state, paymentId, studentId = "ana") => removeMonthlyPayment(state, { studentId, paymentId });
const lose = (state, period, lostAt = AS_OF, studentId = "ana") =>
  markLost(state, [{ studentId, kind: "monthly", groupId: "g", period }], lostAt);
const studentOf = (state, id = "ana") => state.students.find((item) => item.id === id);
const receiptIds = (state, id = "ana") => (studentOf(state, id).monthlyPayments || []).map((item) => item.id);
const balanceOf = (state, period, studentId = "ana") => monthlyBalance(state, { studentId, groupId: "g", period });
const chargeOf = (state, period) =>
  deriveMonthlyCharges(state, AS_OF).find(
    (item) => item.studentId === "ana" && item.groupId === "g" && item.period === period,
  );
const merge = (local, remote, prefer = "none", base = start) => mergeWorkspaceStates({ base, local, remote, prefer });
const withAna = (state, change) => ({
  ...state,
  students: state.students.map((item) => (item.id === "ana" ? change(item) : item)),
});
const monthConflict = (...months) => ({
  collection: "students",
  entityId: "ana",
  kind: "field",
  fields: ["monthlyPayments"],
  items: { monthlyPayments: months },
});

describe("a student's money merged element by element (audit B3)", () => {
  it("F4: keeps the phone's October and the tablet's September, whatever is decided", () => {
    const phone = pay(start, "2026-10", { id: "phone-oct" });
    const tablet = pay(start, "2026-09", { id: "tablet-sep" });
    for (const prefer of ["none", "local"]) {
      const merged = merge(phone, tablet, prefer);
      expect(merged.conflicts).toEqual([]);
      expect(receiptIds(merged.state)).toEqual(["tablet-sep", "phone-oct"]);
      expect(["2026-09", "2026-10"].map((period) => chargeOf(merged.state, period).status)).toEqual(["paid", "paid"]);
    }
  });

  it("takes back a receipt undone on one device and keeps the other device's new one", () => {
    const base = pay(start, "2026-09", { id: "sep" });
    const merged = merge(undo(base, "sep"), pay(base, "2026-10", { id: "oct" }), "none", base);
    expect(merged.conflicts).toEqual([]);
    expect(receiptIds(merged.state)).toEqual(["oct"]);
  });

  it("empties a settled month whose two receipts were undone one on each device", () => {
    // Undo rewrites the agreed total on the receipts left in the month: that bookkeeping never keeps one.
    const base = pay(pay(start, "2026-10", { id: "a", amount: 400 }), "2026-10", { id: "b" });
    const local = undo(base, "b");
    const remote = undo(base, "a");
    expect(studentOf(local).monthlyPayments[0]).toMatchObject({ id: "a", partial: true, settledTotal: 1000 });
    const merged = merge(local, remote, "none", base);
    expect(merged.conflicts).toEqual([]);
    expect(receiptIds(merged.state)).toEqual([]);
    expect(studentOf(merged.state)).not.toHaveProperty("monthlyPayments");
    expect(merged.state.students).toEqual(undo(local, "a").students);
  });

  it("keeps lost marks on different debts and asks only about a debt marked on two different days", () => {
    const local = lose(start, "2026-09", "2026-11-10");
    const both = merge(local, lose(start, "2026-10", "2026-11-12"));
    expect(both.conflicts).toEqual([]);
    expect(studentOf(both.state).lostPayments.map(lostKey)).toEqual(["monthly|g|2026-09", "monthly|g|2026-10"]);

    const remote = lose(lose(start, "2026-09", "2026-11-12"), "2026-10", "2026-11-12");
    const asked = merge(local, remote);
    expect(asked.conflicts).toEqual([
      {
        collection: "students",
        entityId: "ana",
        kind: "field",
        fields: ["lostPayments"],
        items: { lostPayments: ["monthly|g|2026-09"] },
      },
    ]);
    expect(studentOf(merge(local, remote, "local").state).lostPayments).toEqual([
      { kind: "monthly", groupId: "g", period: "2026-09", lostAt: "2026-11-10" },
      { kind: "monthly", groupId: "g", period: "2026-10", lostAt: "2026-11-12" },
    ]);
  });

  it("combines an adjustment from the student editor with a stay the other device stamped in the same group", () => {
    const adjust = (state, groupId, fee) =>
      withAna(state, (ana) => ({
        ...ana,
        billingByGroup: {
          ...ana.billingByGroup,
          [groupId]: changeStudentAdjustment(ana.billingByGroup?.[groupId], { mode: "customFee", fee }, "2026-11"),
        },
      }));
    // The other device deactivates Ana: «leftOn» in both of her monthly groups.
    const deactivated = withAna(start, (ana) =>
      recordStays(ana, { ...ana, status: "Inactive" }, start.groups, "2026-11-10"),
    );
    const merged = merge(adjust(start, "g", 800), deactivated);
    expect(merged.conflicts).toEqual([]);
    expect(studentOf(merged.state)).toMatchObject({
      status: "Inactive",
      billingByGroup: {
        g: { mode: "customFee", fee: 800, effectiveFrom: "2026-11", leftOn: "2026-11-10" },
        h: { mode: "group", leftOn: "2026-11-10" },
      },
    });

    expect(merge(adjust(start, "g", 800), adjust(start, "h", 900)).conflicts).toEqual([]);
    const asked = merge(adjust(start, "g", 800), adjust(deactivated, "g", 900));
    expect(asked.conflicts).toEqual([
      {
        collection: "students",
        entityId: "ana",
        kind: "field",
        fields: ["billingByGroup"],
        items: { billingByGroup: ["g"] },
      },
    ]);
    // Keeping this device's adjustment keeps the other device's stays.
    expect(
      studentOf(merge(adjust(start, "g", 800), adjust(deactivated, "g", 900), "local").state).billingByGroup,
    ).toEqual({
      g: { mode: "customFee", fee: 800, effectiveFrom: "2026-11", leftOn: "2026-11-10" },
      h: { mode: "group", leftOn: "2026-11-10" },
    });
  });
});

describe("money rules a merge by element cannot see (audit B3)", () => {
  it("1. asks which receipt stays when both devices paid the same month in full, and counts it once either way", () => {
    const tablet = pay(start, "2026-10", { id: "tablet-oct" });
    const phone = pay(pay(start, "2026-09", { id: "phone-sep" }), "2026-10", { id: "phone-oct", paidAt: "2026-11-12" });
    const merged = merge(tablet, phone);
    expect(merged.conflicts).toEqual([monthConflict("g|2026-10")]);
    expect(receiptIds(merged.state)).toEqual(["phone-sep", "phone-oct"]);

    const kept = merge(tablet, phone, "local");
    expect(kept.conflicts).toEqual([monthConflict("g|2026-10")]);
    // This device's October replaces the cloud's; the phone's September stays.
    expect(receiptIds(kept.state)).toEqual(["phone-sep", "tablet-oct"]);
    expect(balanceOf(kept.state, "2026-10")).toMatchObject({ paid: 1000, total: 1000, settled: true });
    expect(monthlyPaymentsBetween(kept.state, "2026-11-01", "2026-11-30").map(({ amount }) => amount)).toEqual([
      1000, 1000,
    ]);
  });

  it("2. keeps abonos from both devices while they fit the balance and asks when together they pay more", () => {
    const within = merge(
      pay(start, "2026-10", { id: "l", amount: 300 }),
      pay(start, "2026-10", { id: "r", amount: 400 }),
    );
    expect(within.conflicts).toEqual([]);
    expect(balanceOf(within.state, "2026-10")).toMatchObject({ paid: 700, balance: 300, settled: false });

    // Together they settle the month: this device's abono records the agreed total, as on one device.
    const remote = pay(start, "2026-10", { id: "r", amount: 400 });
    const local = pay(start, "2026-10", { id: "l", amount: 600 });
    const settled = merge(local, remote);
    expect(settled.conflicts).toEqual([]);
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + tick * 1000));
    const oneDevice = recordMonthlyPayment(remote, {
      studentId: "ana",
      groupId: "g",
      period: "2026-10",
      amount: 600,
      paidAt: AS_OF,
      id: "l",
    });
    expect(studentOf(settled.state).monthlyPayments).toEqual(studentOf(oneDevice).monthlyPayments);
    expect(chargeOf(settled.state, "2026-10").status).toBe("paid");

    const over = pay(start, "2026-10", { id: "l", amount: 700 });
    const overRemote = pay(start, "2026-10", { id: "r", amount: 600 });
    expect(merge(over, overRemote).conflicts).toEqual([monthConflict("g|2026-10")]);
    expect(balanceOf(merge(over, overRemote, "local").state, "2026-10")).toMatchObject({ paid: 700, balance: 300 });

    // An abono and a full payment: each device paid what it saw.
    const full = pay(start, "2026-10", { id: "full" });
    expect(merge(full, pay(start, "2026-10", { id: "abono", amount: 300 })).conflicts).toEqual([
      monthConflict("g|2026-10"),
    ]);
    expect(merge(pay(start, "2026-10", { id: "abono", amount: 300 }), full).conflicts).toEqual([
      monthConflict("g|2026-10"),
    ]);
  });

  it("3. ends a fee paid on one device and marked lost on the other as paid, without the mark, like one device", () => {
    const local = pay(start, "2026-10", { id: "oct" });
    const remote = lose(start, "2026-10");
    const merged = merge(local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(studentOf(merged.state)).not.toHaveProperty("lostPayments");
    expect(chargeOf(merged.state, "2026-10").status).toBe("paid");
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + tick * 1000));
    expect(studentOf(merged.state)).toEqual(
      studentOf(
        recordMonthlyPayment(remote, { studentId: "ana", groupId: "g", period: "2026-10", paidAt: AS_OF, id: "oct" }),
      ),
    );

    // An abono brings the rest of the fee back as owed, in either direction; other marks stay.
    for (const [mine, theirs] of [
      [pay(start, "2026-10", { id: "abono", amount: 300 }), lose(lose(start, "2026-10"), "2026-09")],
      [lose(lose(start, "2026-10"), "2026-09"), pay(start, "2026-10", { id: "abono", amount: 300 })],
    ]) {
      const result = merge(mine, theirs);
      expect(result.conflicts).toEqual([]);
      expect(studentOf(result.state).lostPayments.map(lostKey)).toEqual(["monthly|g|2026-09"]);
      expect(chargeOf(result.state, "2026-10")).toMatchObject({ status: "overdue", balance: 700, partial: true });
    }

    // Marked again after the abono, on the device that recorded it: the teacher saw the money.
    const remarked = lose(pay(start, "2026-10", { id: "abono", amount: 300 }), "2026-10");
    const noted = withAna(start, (ana) => ({ ...ana, notes: "Paga los viernes" }));
    expect(studentOf(merge(noted, remarked).state)).toMatchObject({
      notes: "Paga los viernes",
      lostPayments: [{ kind: "monthly", groupId: "g", period: "2026-10", lostAt: AS_OF }],
    });
  });

  it("4. combines an Undo that rewrites the month's other receipts with an abono from the other device", () => {
    // October: an abono, a full payment undone (the abono now holds the agreed total), then another abono.
    let base = pay(start, "2026-10", { id: "a0", amount: 200 });
    base = undo(pay(base, "2026-10", { id: "full" }), "full");
    base = pay(base, "2026-10", { id: "a1", amount: 300 });
    expect(balanceOf(base, "2026-10")).toMatchObject({ paid: 500, balance: 500 });

    const local = undo(base, "a0");
    expect(studentOf(local).monthlyPayments).toEqual([
      expect.objectContaining({ id: "a1", settledTotal: 1000, partial: true }),
    ]);
    const remote = pay(base, "2026-10", { id: "q", amount: 400 });
    const merged = merge(local, remote, "none", base);
    expect(merged.conflicts).toEqual([]);
    expect(receiptIds(merged.state)).toEqual(["a1", "q"]);
    // The same receipts as the abono recorded right after the Undo on one device.
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0) + tick * 1000));
    const oneDevice = recordMonthlyPayment(local, {
      studentId: "ana",
      groupId: "g",
      period: "2026-10",
      amount: 400,
      paidAt: AS_OF,
      id: "q",
    });
    expect(studentOf(merged.state).monthlyPayments).toEqual(studentOf(oneDevice).monthlyPayments);
    expect(balanceOf(merged.state, "2026-10")).toMatchObject({ paid: 700, balance: 300 });

    // An Undo of one receipt against an Undo of the other: both go.
    expect(receiptIds(merge(local, undo(base, "a1"), "none", base).state)).toEqual([]);
  });

  it("5. leaves merged receipts and marks canonical, so equal states compare equal and nothing is rewritten", () => {
    const local = lose(
      pay(pay(start, "2026-11", { id: "nov" }), "2026-09", { id: "sep", studentId: "beto" }),
      "2026-10",
    );
    const remote = lose(pay(start, "2026-10", { id: "oct", amount: 100, paidAt: "2026-11-02" }), "2026-09");
    const merged = merge(local, remote);
    expect(merged.conflicts).toEqual([]);
    const canonical = normalizeState(merged.state);
    expect(canonical.students).toEqual(merged.state.students);
    expect(diffWorkspaceStates(merged.state, canonical).changeCount).toBe(0);
    // Merging the result again with either side changes nothing.
    expect(merge(merged.state, remote, "none", remote).state).toEqual(merged.state);
    expect(merge(local, local)).toEqual({ state: local, conflicts: [] });
  });

  it("6. describes only the colliding month, this device's and the cloud's receipts of it", () => {
    const tablet = pay(start, "2026-10", { id: "tablet-oct" });
    const phone = pay(pay(start, "2026-09", { id: "phone-sep" }), "2026-10", { id: "phone-oct", paidAt: "2026-11-12" });
    const { changes, conflicts } = describeOperation({ previousState: start, state: tablet }, phone);
    expect(conflicts).toEqual([monthConflict("g|2026-10")]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ collection: "students", entityId: "ana", conflict: "field" });
    const row = changes[0].fields.find(({ field }) => field === "monthlyPayments");
    expect(row).toMatchObject({ before: undefined, conflict: true });
    expect(row.local.map(({ id }) => id)).toEqual(["tablet-oct"]);
    expect(row.cloud.map(({ id }) => id)).toEqual(["phone-oct"]);

    // Without a conflict a row shows what this device changed, not the whole history.
    const quiet = describeOperation({ previousState: phone, state: pay(phone, "2026-11", { id: "nov" }) }, phone);
    const changed = quiet.changes[0].fields.find(({ field }) => field === "monthlyPayments");
    expect(changed.local.map(({ id }) => id)).toEqual(["nov"]);
    expect(changed).toMatchObject({ before: undefined, cloud: undefined, conflict: false });
  });

  it("7. moves the lost mark of a folded class to the class that stays and keeps the marks in canonical order", () => {
    const row = (id) =>
      createClassLogRow({
        id,
        studentId: "ana",
        groupId: "",
        classDate: "2026-11-12",
        startTime: "16:00",
        classTitle: "Individual",
        hours: 2,
        appliedHourlyRate: 100,
        attendance: "P",
        appliedCharge: 200,
        paymentState: "Pending",
      });
    const created = { ...start, classLog: [row("tab-ana")] };
    const cloud = markLost(
      { ...start, classLog: [row("pho-ana")] },
      [{ studentId: "ana", kind: "class", classId: "q-other" }],
      AS_OF,
    );
    const first = mergeWorkspaceStates({ base: start, local: created, remote: cloud });
    expect(first.conflicts).toEqual([]);
    const marked = lose(markLost(created, [{ studentId: "ana", kind: "class", classId: "tab-ana" }], AS_OF), "2026-10");
    const second = mergeWorkspaceStates({ base: created, local: marked, remote: first.state });
    expect(second.conflicts).toEqual([]);
    // Before the fold the tablet's mark sorted after the cloud's («tab-ana» > «q-other»); after it, before.
    expect(studentOf(second.state).lostPayments.map(lostKey)).toEqual([
      "class|pho-ana",
      "class|q-other",
      "monthly|g|2026-10",
    ]);
    expect(normalizeState(second.state).students).toEqual(second.state.students);
  });
});

describe("random offline sessions on two devices (audit B3)", () => {
  it("never pays a month above its total, and without a review keeps every receipt exactly once", () => {
    let seed = 20261113;
    const random = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const PERIODS = ["2026-09", "2026-10", "2026-11"];
    const STUDENTS = ["ana", "beto"];
    const step = (state, prefix) => {
      const studentId = STUDENTS[random(2)];
      const period = PERIODS[random(3)];
      const action = random(5);
      const id = `${prefix}-${(tick += 1)}`;
      if (action <= 1) {
        const amount = action === 0 ? undefined : [100, 250, 400, 600, 900][random(5)];
        return at(() => recordMonthlyPayment(state, { studentId, groupId: "g", period, amount, paidAt: AS_OF, id }));
      }
      if (action === 2) {
        const own = studentOf(state, studentId).monthlyPayments || [];
        return own.length ? undo(state, own[random(own.length)].id, studentId) : state;
      }
      if (action === 3 && !balanceOf(state, period, studentId).settled)
        return lose(state, period, `2026-11-1${random(3)}`, studentId);
      return markLost(state, [], AS_OF);
    };
    const run = (state, prefix, count) => {
      let next = state;
      for (let index = 0; index < count; index += 1) next = step(next, prefix);
      return next;
    };
    let reviewed = 0;
    for (let round = 0; round < 250; round += 1) {
      const base = run(start, `b${round}`, random(4));
      const local = run(base, `l${round}`, 1 + random(4));
      const remote = run(base, `r${round}`, 1 + random(4));
      for (const prefer of ["none", "local"]) {
        const { state, conflicts } = merge(local, remote, prefer, base);
        for (const studentId of STUDENTS)
          for (const period of PERIODS) {
            const { paid, total } = balanceOf(state, period, studentId);
            expect(paid).toBeLessThanOrEqual(total);
          }
        if (prefer === "none" && conflicts.length) reviewed += 1;
        const colliding = new Set(
          conflicts.flatMap((item) => item.items?.monthlyPayments?.map((month) => `${item.entityId}|${month}`) || []),
        );
        for (const studentId of STUDENTS) {
          const before = new Set((studentOf(base, studentId).monthlyPayments || []).map(({ id }) => id));
          const merged = (studentOf(state, studentId).monthlyPayments || []).map(({ id }) => id);
          expect(new Set(merged).size).toBe(merged.length);
          // Every receipt recorded during the session on either device is there, unless its month went to review.
          for (const side of prefer === "none" && conflicts.length ? [] : [local, remote]) {
            for (const receipt of studentOf(side, studentId).monthlyPayments || []) {
              if (before.has(receipt.id)) continue;
              if (colliding.has(`${studentId}|${receipt.groupId}|${receipt.period}`)) continue;
              expect(merged).toContain(receipt.id);
            }
          }
          // Money from a device that did not hold a lost mark brings its fee back.
          for (const mark of studentOf(state, studentId).lostPayments || []) {
            const fresh = (studentOf(state, studentId).monthlyPayments || []).filter(
              (receipt) =>
                !before.has(receipt.id) && receipt.groupId === mark.groupId && receipt.period === mark.period,
            );
            for (const receipt of fresh)
              for (const side of [local, remote]) {
                const brought = (studentOf(side, studentId).monthlyPayments || []).some(({ id }) => id === receipt.id);
                const held = (studentOf(side, studentId).lostPayments || []).some(
                  (item) => lostKey(item) === lostKey(mark),
                );
                expect(brought && !held).toBe(false);
              }
          }
        }
      }
    }
    // The generator does reach months paid on both devices.
    expect(reviewed).toBeGreaterThan(10);
  });
});
