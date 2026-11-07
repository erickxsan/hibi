// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClassManager } from "./useClassManager.js";
import { createStarterState, normalizeState, serializeState, importState, deriveAll } from "../domain/index.js";
import { monthlyDueDate, monthlyPaymentsBetween } from "../domain/monthlyBilling.js";
import { buildClassRecords } from "../features/classesDraftModel.js";
import { paymentWord } from "../features/ClassSessionDetail.jsx";

function fixture() {
  return normalizeState({
    ...createStarterState(),
    groups: [
      {
        id: "g",
        name: "Grupo",
        hourlyRate: 100,
        scheduleResumeDate: "2026-09-01",
        weeklySchedule: [
          { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 },
        ],
        billing: { mode: "monthly", monthlyFee: 1000, due: { type: "nthClass", nth: 2 }, effectiveFrom: "2026-09" },
      },
    ],
    students: [{ id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] }],
  });
}
function manager(initialState) {
  let stored = serializeState(initialState);
  const persistence = {
    mode: "cloud",
    initialState,
    save: vi.fn(async (state) => {
      stored = serializeState(state);
      return importState(stored);
    }),
  };
  return { ...renderHook(() => useClassManager({ persistence })), persistence, reload: () => importState(stored) };
}

describe("payment safety through the live manager", () => {
  it.each(["Cancelled", "Absent"])(
    "preserves received money when a class becomes %s, through save and reload",
    async (change) => {
      const state = fixture();
      delete state.groups[0].billing;
      state.classLog = [
        {
          id: "c",
          studentId: "ana",
          groupId: "g",
          classDate: "2026-10-19",
          startTime: "16:00",
          hours: 2,
          attendance: "P",
          classStatus: "Completed",
          appliedHourlyRate: 100,
          appliedCharge: 200,
          amountPaid: 200,
          paymentState: "Paid",
          paymentDate: "2026-10-19",
          paymentMethod: "Transfer",
          paymentReference: "receipt-1",
        },
      ];
      const hook = manager(state);
      const session = { ...state.classLog[0], durationHours: 2, title: "Grupo", rows: state.classLog };
      const records = buildClassRecords(
        state,
        session,
        state.students,
        { ana: { classId: "c", attendance: change === "Absent" ? "A" : "P", paymentState: "Paid" } },
        { classStatus: change === "Cancelled" ? "Cancelled" : "Completed", today: "2026-10-21" },
      );
      await act(async () =>
        expect(await hook.result.current.actions.saveProgress({ classRecords: records })).toBe(true),
      );
      const saved = hook.reload();
      expect(saved.classLog[0]).toMatchObject({
        amountPaid: 200,
        paymentDate: "2026-10-19",
        paymentMethod: "Transfer",
        paymentReference: "receipt-1",
        appliedCharge: 0,
      });
      const derived = deriveAll(saved, "2026-10-21");
      expect(derived.classLog[0].outstanding).toBe(0);
      expect(paymentWord(saved.classLog[0], derived.classLog[0], "es-MX", (key) => key).text).toContain("200");
      expect(paymentWord(saved.classLog[0], derived.classLog[0], "es-MX", (key) => key).tone).toBe("pend");
      const restoredSession = { ...session, rows: saved.classLog };
      const restoredRecords = buildClassRecords(
        saved,
        restoredSession,
        saved.students,
        { ana: { classId: "c", attendance: "P", paymentTouched: false } },
        { today: "2026-10-21" },
      );
      await act(async () =>
        expect(await hook.result.current.actions.saveProgress({ classRecords: restoredRecords })).toBe(true),
      );
      expect(hook.reload().classLog[0]).toMatchObject({
        attendance: "P",
        amountPaid: 200,
        paymentState: "Paid",
        paymentDate: "2026-10-19",
      });
    },
  );

  it.each([100, 300])("keeps a received amount of %s while correcting a paid class", async (amountPaid) => {
    const state = fixture();
    delete state.groups[0].billing;
    state.classLog = [
      {
        id: "c",
        studentId: "ana",
        groupId: "g",
        classDate: "2026-10-19",
        startTime: "16:00",
        hours: 2,
        attendance: "P",
        classStatus: "Completed",
        appliedHourlyRate: 100,
        appliedCharge: 200,
        amountPaid,
        paymentState: amountPaid >= 200 ? "Paid" : "Pending",
        paymentDate: "2026-10-19",
        paymentMethod: "Transfer",
      },
    ];
    const hook = manager(state);
    const session = { ...state.classLog[0], durationHours: 2, title: "Grupo", rows: state.classLog };
    const records = buildClassRecords(
      state,
      session,
      state.students,
      { ana: { classId: "c", attendance: "P", paymentTouched: false } },
      { today: "2026-10-21" },
    );
    await act(async () => expect(await hook.result.current.actions.saveProgress({ classRecords: records })).toBe(true));
    expect(hook.reload().classLog[0]).toMatchObject({
      amountPaid,
      paymentDate: "2026-10-19",
      paymentMethod: "Transfer",
    });
  });

  it.each(["paid", "unpaid", "archived"])(
    "refuses deletion with %s monthly history and preserves records",
    async (kind) => {
      const state = fixture();
      if (kind === "paid")
        state.students[0].monthlyPayments = [
          { id: "p", groupId: "g", period: "2026-10", amount: 1000, paidAt: "2026-10-20" },
        ];
      if (kind === "archived") state.groups[0] = { ...state.groups[0], status: "Inactive", archivedAt: "2026-10-10" };
      const hook = manager(state);
      await act(async () => expect(await hook.result.current.actions.deleteStudent("ana")).toBe(false));
      expect(hook.persistence.save).not.toHaveBeenCalled();
      expect(hook.reload().students).toHaveLength(1);
      if (kind === "paid")
        expect(monthlyPaymentsBetween(hook.reload(), "2026-10-01", "2026-10-31")[0].amount).toBe(1000);
    },
  );

  it("still allows deleting an unused student without monthly history", async () => {
    const state = fixture();
    delete state.groups[0].billing;
    const hook = manager(state);
    await act(async () => expect(await hook.result.current.actions.deleteStudent("ana")).toBe(true));
    expect(hook.reload().students).toHaveLength(0);
  });

  it.each(["upsertGroup", "saveGroupBilling"])(
    "keeps historical due dates through %s and later metadata edits",
    async (action) => {
      const state = fixture();
      const hook = manager(state);
      const draft = {
        ...state.groups[0],
        weeklySchedule: [{ id: "fri", dayOfWeek: 5, startTime: "16:00", durationHours: 2 }],
      };
      await act(async () => expect(await hook.result.current.actions[action](draft)).toBe(true));
      expect(monthlyDueDate(hook.reload(), hook.reload().groups[0], "2026-09")).toBe("2026-09-07");
      const renamed = { ...hook.result.current.state.groups[0], name: "Renombrado" };
      delete renamed.scheduleHistory; // Older editors may omit this optional field.
      await act(async () => expect(await hook.result.current.actions.saveGroupBilling(renamed)).toBe(true));
      const restored = hook.reload();
      expect(monthlyDueDate(restored, restored.groups[0], "2026-09")).toBe("2026-09-07");
      expect(restored.groups[0].weeklySchedule[0].dayOfWeek).toBe(5);
    },
  );
});
