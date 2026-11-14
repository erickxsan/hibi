// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useClassManager } from "./useClassManager.js";
import { createStarterState, importState, normalizeState, serializeState } from "../domain/index.js";
import { buildClassRecords } from "../features/classesDraftModel.js";

// Audit B2: «Guardar» on a class whose rows this screen has not seen yet (another tab or device saved it a
// moment earlier) must edit those rows, never add a second, hidden row for each student.
function fixture() {
  return normalizeState({
    ...createStarterState({ settings: { asOfDate: "2026-11-13", hourlyRate: 100 } }),
    groups: [
      {
        id: "g",
        name: "Grupo",
        hourlyRate: 100,
        scheduleResumeDate: "2026-09-01",
        weeklySchedule: [{ id: "thu", dayOfWeek: 4, startTime: "16:00", durationHours: 2 }],
      },
    ],
    students: [
      { id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] },
      { id: "beto", code: "B", fullName: "Beto", status: "Active", groupIds: ["g"] },
    ],
  });
}

const session = {
  classDate: "2026-11-12",
  groupId: "g",
  startTime: "16:00",
  durationHours: 2,
  title: "Grupo",
  scheduleSlotId: "thu",
  rows: [],
};
// What the Classes screen builds from a view without saved rows.
const recordsFor = (state, marks) =>
  buildClassRecords(
    state,
    session,
    state.students,
    Object.fromEntries(
      Object.entries(marks).map(([id, [attendance, paymentState = ""]]) => [
        id,
        { attendance, paymentState, paymentTouched: Boolean(paymentState), classId: "" },
      ]),
    ),
    { classStatus: "Completed", today: "2026-11-12" },
  );

function manager(initialState, firstSave = null) {
  let stored = serializeState(initialState);
  const persistence = {
    mode: "cloud",
    initialState,
    save: vi.fn(async (state) => {
      if (firstSave && persistence.save.mock.calls.length === 1) await firstSave();
      stored = serializeState(state);
      return importState(stored);
    }),
  };
  return { ...renderHook(() => useClassManager({ persistence })), persistence, stored: () => importState(stored) };
}

const save = async (hook, classRecords) => {
  let saved;
  await act(async () => {
    saved = await hook.result.current.actions.saveProgress({ classRecords });
  });
  return saved;
};
const rows = (state) =>
  state.classLog.map(({ studentId, attendance, amountPaid }) => [studentId, attendance, amountPaid]);

describe("saving a class another tab or device saved meanwhile", () => {
  it("edits the rows already there when the marks agree or the earlier save left them unmarked", async () => {
    const state = fixture();
    const hook = manager(state);
    expect(await save(hook, recordsFor(state, { ana: ["P", "Paid"], beto: [""] }))).toBe(true);
    const ids = hook.stored().classLog.map(({ id }) => id);

    // The same view saves again: identical for Ana, Beto marked now.
    expect(await save(hook, recordsFor(state, { ana: ["P", "Paid"], beto: ["A"] }))).toBe(true);
    const saved = hook.stored();
    expect(saved.classLog.map(({ id }) => id)).toEqual(ids);
    expect(rows(saved)).toEqual([
      ["ana", "P", 200],
      ["beto", "A", 0],
    ]);
  });

  it("refuses different marks and keeps the stored rows untouched", async () => {
    const state = fixture();
    const hook = manager(state);
    expect(await save(hook, recordsFor(state, { ana: ["P", "Paid"], beto: ["P"] }))).toBe(true);
    expect(await save(hook, recordsFor(state, { ana: ["P", "Pending"], beto: ["A"] }))).toBe(false);
    expect(rows(hook.stored())).toEqual([
      ["ana", "P", 200],
      ["beto", "P", 0],
    ]);
    expect(hook.result.current.toasts.at(-1)).toMatchObject({
      tone: "error",
      message: "This class was just saved with different marks. Review it before saving again.",
    });
  });

  it("does not add a second row when the save is retried on newer records that already hold the class", async () => {
    const state = fixture();
    // Another device saved the class with other marks; this save is refused and retried on those records.
    const elsewhere = importState(
      serializeState({
        ...state,
        classLog: recordsFor(state, { ana: ["P"], beto: ["A"] }).map((record, index) => ({
          ...record,
          id: `other-${index}`,
          attendance: record.attendance || null,
          appliedHourlyRate: 100,
          paymentDate: null,
          paymentReference: "",
          notes: "",
        })),
      }),
    );
    const hook = manager(state, async () => {
      throw Object.assign(new Error("Newer records"), { latestState: elsewhere });
    });
    expect(await save(hook, recordsFor(state, { ana: ["P", "Paid"], beto: ["A"] }))).toBe(false);
    expect(hook.persistence.save).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.classLog.map(({ id }) => id)).toEqual(["other-0", "other-1"]);
    expect(hook.result.current.toasts.at(-1)).toMatchObject({
      message: "A newer change from another device was loaded. Please retry your edit.",
    });
  });
});
