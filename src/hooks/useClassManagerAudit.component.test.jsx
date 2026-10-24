// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClassManager } from "./useClassManager.js";
import {
  addDays,
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
