// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClassManager } from "./useClassManager.js";
import {
  addDays,
  createGroup,
  createStarterState,
  createStudent,
  createClassLogRow,
  deriveAll,
  generateScheduledOccurrences,
  serializeState,
} from "../domain/index.js";
import { deriveMonthlyCharges } from "../domain/monthlyBilling.js";
import { buildAttentionItems } from "../features/homeDashboardModel.js";
describe("reviewed import through the live manager", () => {
  it.each(["invalid", NaN, Infinity])(
    "rejects invalid payments rather than rounding %s to zero",
    async (amountPaid) => {
      const initial = createStarterState();
      initial.students = [createStudent({ id: "s1", code: "S1", fullName: "Home" })];
      const persistence = { initialState: initial, mode: "cloud", save: vi.fn(async (state) => state) };
      const hook = renderHook(() => useClassManager({ persistence }));
      let applied;
      await act(async () => {
        applied = await hook.result.current.actions.upsertClassLog(
          createClassLogRow({
            studentId: "s1",
            classDate: initial.settings.asOfDate,
            hours: 1,
            amountPaid,
            paymentDate: initial.settings.asOfDate,
            paymentMethod: "Cash",
          }),
        );
      });
      expect(applied).toBe(false);
      expect(persistence.save).not.toHaveBeenCalled();
      expect(hook.result.current.state.classLog).toHaveLength(0);
    },
  );
  it("rejects old decisions after a second client publishes a change, then accepts a fresh review", async () => {
    const initial = createStarterState({ settings: { onboardingVersion: 2 } });
    initial.students = [createStudent({ id: "s1", code: "S1", fullName: "Home", notes: "A" })];
    let publish;
    const persistence = {
      initialState: initial,
      mode: "cloud",
      save: vi.fn(async (state) => state),
      importRecords: vi.fn(async (state) => ({ state })),
      subscribe: (listener) => {
        publish = listener;
        return () => {};
      },
    };
    const hook = renderHook(() => useClassManager({ persistence }));
    const imported = structuredClone(initial);
    imported.students[0].notes = "B";
    const text = serializeState(imported);
    const preview = await hook.result.current.actions.previewImportRecords(text, "hash");
    const remote = structuredClone(initial);
    remote.students[0].notes = "C";
    await act(async () => publish(remote, { source: "remote" }));
    await waitFor(() => expect(hook.result.current.state.students[0].notes).toBe("C"));
    let applied;
    await act(async () => {
      applied = await hook.result.current.actions.importRecords(text, {
        signature: preview.signature,
        decisions: { [preview.entries[0].key]: "use-imported" },
      });
    });
    expect(applied).toBe(false);
    expect(persistence.importRecords).not.toHaveBeenCalled();
    expect(hook.result.current.state.students[0].notes).toBe("C");
    const fresh = await hook.result.current.actions.previewImportRecords(text, "hash");
    await act(async () => {
      applied = await hook.result.current.actions.importRecords(text, {
        signature: fresh.signature,
        fileHash: "hash",
        decisions: { [fresh.entries[0].key]: "use-imported" },
      });
    });
    expect(applied).toBe(true);
    expect(persistence.importRecords).toHaveBeenCalledOnce();
    expect(hook.result.current.state.students[0].notes).toBe("B");
    hook.unmount();
  });
});

describe("a group created through the live manager", () => {
  it("has no unrecorded classes or overdue fees on the day it is created", async () => {
    // Thursday 22 Oct 2026, the day the teacher ran the tutorial.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 22, 12));
    try {
      const initial = createStarterState();
      const persistence = { initialState: initial, mode: "cloud", save: vi.fn(async (state) => state) };
      const hook = renderHook(() => useClassManager({ persistence }));
      let groupId;
      await act(async () => {
        groupId = await hook.result.current.actions.saveOnboardingGroup({
          name: "Inglés A1",
          subject: "Inglés",
          weeklySchedule: [
            { id: "mon", dayOfWeek: 1, startTime: "16:00", durationHours: 1 },
            { id: "wed", dayOfWeek: 3, startTime: "16:00", durationHours: 1 },
          ],
          plannedSessionsPerMonth: 8,
          // What the tutorial used to send: billing from the current month, due on day 5.
          billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
        });
      });
      await act(async () => {
        await hook.result.current.actions.saveOnboardingStudents(groupId, ["Mateo", "Ana"]);
      });
      const state = hook.result.current.state;
      const asOf = "2026-10-22";
      expect(state.groups[0]).toMatchObject({ scheduleResumeDate: asOf, billing: { effectiveFrom: "2026-11" } });
      expect(generateScheduledOccurrences(state, addDays(asOf, -30), addDays(asOf, -1))).toEqual([]);
      expect(deriveMonthlyCharges(state, asOf)).toEqual([]);
      const kinds = buildAttentionItems(state, deriveAll(state, asOf), asOf).map((item) => item.kind);
      expect(kinds).not.toContain("unrecorded");
      expect(kinds).not.toContain("monthlyDue");

      // Editing the schedule later keeps the start date.
      await act(async () => {
        await hook.result.current.actions.saveOnboardingGroup({
          id: groupId,
          name: "Inglés A1",
          subject: "Inglés",
          weeklySchedule: [{ id: "tue", dayOfWeek: 2, startTime: "17:00", durationHours: 1 }],
          plannedSessionsPerMonth: 4,
        });
      });
      expect(hook.result.current.state.groups[0].scheduleResumeDate).toBe(asOf);
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a student added to a monthly group through the live manager", () => {
  it("owes from the day they join, not every month since the group started", async () => {
    // Thursday 1 Oct 2026, before that day's class: the join sheet asks nothing about the first month.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 9));
    try {
      const initial = createStarterState();
      initial.groups = [
        createGroup({
          id: "g-mensual",
          name: "Mensual",
          weeklySchedule: [{ id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 1 }],
          scheduleResumeDate: "2026-05-01",
          billing: { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-05" },
        }),
      ];
      initial.students = [createStudent({ id: "ana", code: "ANA", fullName: "Ana Ruiz", groupIds: [] })];
      const persistence = { initialState: initial, mode: "cloud", save: vi.fn(async (state) => state) };
      const hook = renderHook(() => useClassManager({ persistence }));
      const ana = hook.result.current.state.students.find((student) => student.id === "ana");
      await act(async () => {
        await hook.result.current.actions.upsertStudent({ ...ana, groupIds: ["g-mensual"] });
      });
      await act(async () => {
        await hook.result.current.actions.upsertStudent({ code: "LEO", fullName: "Leo Paz", groupIds: ["g-mensual"] });
      });
      const state = hook.result.current.state;
      const periods = (name) => {
        const id = state.students.find((student) => student.fullName === name).id;
        return deriveMonthlyCharges(state, "2026-10-28")
          .filter((charge) => charge.studentId === id)
          .map((charge) => `${charge.period}:${charge.total}`);
      };
      expect(state.students.find((student) => student.id === "ana").billingByGroup).toEqual({
        "g-mensual": { mode: "group", joinedOn: "2026-10-01" },
      });
      expect(periods("Ana Ruiz")).toEqual(["2026-10:1000"]);
      expect(periods("Leo Paz")).toEqual(["2026-10:1000"]);

      // Saving her again (another field) keeps the date she joined.
      vi.setSystemTime(new Date(2026, 9, 20, 9));
      const joined = hook.result.current.state.students.find((student) => student.id === "ana");
      await act(async () => {
        await hook.result.current.actions.upsertStudent({ ...joined, notes: "Llega 10 min tarde" });
      });
      expect(
        hook.result.current.state.students.find((student) => student.id === "ana").billingByGroup["g-mensual"].joinedOn,
      ).toBe("2026-10-01");
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("leaving and coming back through the live manager", () => {
  it("keeps a deactivated student's fees, skips the months away and pauses an archived group", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 3, 9));
    try {
      const initial = createStarterState();
      initial.groups = [
        createGroup({
          id: "g-mensual",
          name: "Mensual",
          weeklySchedule: [{ id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 1 }],
          scheduleResumeDate: "2026-06-01",
          billing: { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-06" },
        }),
      ];
      initial.students = [createStudent({ id: "ana", code: "ANA", fullName: "Ana Ruiz", groupIds: ["g-mensual"] })];
      const persistence = { initialState: initial, mode: "cloud", save: vi.fn(async (state) => state) };
      const hook = renderHook(() => useClassManager({ persistence }));
      // The manager reads today again when the page becomes visible.
      const travel = async (date) => {
        vi.setSystemTime(date);
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
      };
      const owedOn = (asOf) =>
        deriveMonthlyCharges(hook.result.current.state, asOf)
          .filter((charge) => charge.status !== "paid")
          .map((charge) => charge.period);

      // Deactivated on 3 Aug: June and July stay owed.
      await act(async () => {
        await hook.result.current.actions.archiveStudent("ana");
      });
      expect(owedOn("2026-10-28")).toEqual(["2026-06", "2026-07"]);

      // Back on 20 Oct: August and September are not billed.
      await travel(new Date(2026, 9, 20, 9));
      const ana = hook.result.current.state.students.find((student) => student.id === "ana");
      await act(async () => {
        await hook.result.current.actions.upsertStudent({ ...ana, status: "Active" });
      });
      expect(owedOn("2026-10-28")).toEqual(["2026-06", "2026-07", "2026-10"]);

      // The group is archived on 22 Oct and reactivated on 2 Dec: November is not billed.
      await travel(new Date(2026, 9, 22, 9));
      await act(async () => {
        await hook.result.current.actions.archiveGroup("g-mensual");
      });
      await travel(new Date(2026, 11, 2, 9));
      await act(async () => {
        await hook.result.current.actions.reactivateGroup("g-mensual");
      });
      expect(owedOn("2026-12-10")).toEqual(["2026-06", "2026-07", "2026-10", "2026-12"]);
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
