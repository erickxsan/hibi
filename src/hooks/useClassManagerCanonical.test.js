import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain";
import {
  canonicalGroup,
  canonicalStudent,
  operationalStateForDate,
  persistRecipe,
  placeSavedGroup,
} from "./useClassManager";

describe("class manager draft canonicalization", () => {
  it("uses the real operational date without mutating persisted legacy dates", () => {
    const state = createStarterState();
    state.settings.asOfDate = "2026-01-12";
    state.settings.selectedMonth = "2026-01-01";

    const result = operationalStateForDate(state, "2026-08-15");

    expect(result.settings.asOfDate).toBe("2026-08-15");
    expect(result.settings.selectedMonth).toBe("2026-08-01");
    expect(state.settings.asOfDate).toBe("2026-01-12");
    expect(state.settings.selectedMonth).toBe("2026-01-01");
  });

  it("prefers current student fields over legacy view aliases", () => {
    const result = canonicalStudent({
      id: "s1",
      code: "NEW-01",
      studentCode: "OLD-01",
      fullName: "Sample Student",
      phone: "555 010 2026",
      studentPhone: "555 000 0000",
      studentEmail: "student@example.com",
      guardianPhone: "555 111 2222",
      notes: "Current notes",
      importantNotes: "Legacy notes",
      status: "Active",
      groupIds: [],
    });

    expect(result.code).toBe("NEW-01");
    expect(result.phone).toBe("555 010 2026");
    expect(result.studentEmail).toBe("student@example.com");
    expect(result.guardianPhone).toBe("555 111 2222");
    expect(result.notes).toBe("Current notes");
  });

  it("prefers the current schedule field over its legacy view alias", () => {
    const result = canonicalGroup({
      id: "g1",
      name: "Math",
      schedule: "Room 4",
      scheduleRoom: "Old room",
      weeklySchedule: [],
      plannedSessionsPerMonth: 8,
    });

    expect(result.schedule).toBe("Room 4");
  });
});

describe("class manager cloud conflict handling", () => {
  it("reapplies a regular edit to the latest revision without losing unrelated changes", async () => {
    const base = createStarterState();
    const latest = createStarterState();
    latest.settings.hourlyRate = 80;
    const adapter = {
      save: vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error("conflict"), { latestState: latest }))
        .mockImplementationOnce(async (state) => state),
    };

    const result = await persistRecipe({
      baseState: base,
      adapter,
      recipe: (state) => ({
        ...state,
        settings: { ...state.settings, defaultClassHours: 1.5 },
      }),
    });

    expect(result.mergedConflict).toBe(true);
    expect(result.state.settings.hourlyRate).toBe(80);
    expect(result.state.settings.defaultClassHours).toBe(1.5);
    expect(adapter.save).toHaveBeenCalledTimes(2);
  });

  it("never retries an intentional backup replacement after a conflict", async () => {
    const base = createStarterState();
    const conflict = Object.assign(new Error("conflict"), { latestState: createStarterState() });
    const adapter = { replace: vi.fn().mockRejectedValue(conflict), save: vi.fn() };

    await expect(persistRecipe({ baseState: base, recipe: (state) => state, adapter, replace: true })).rejects.toBe(
      conflict,
    );
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("never rebases a reviewed import after a cloud revision conflict", async () => {
    const base = createStarterState();
    const conflict = Object.assign(new Error("conflict"), { latestState: createStarterState() });
    const adapter = { importRecords: vi.fn().mockRejectedValue(conflict), save: vi.fn() };

    await expect(
      persistRecipe({
        baseState: base,
        recipe: (state) => state,
        adapter,
        importMetadata: { fileHash: "a".repeat(64) },
      }),
    ).rejects.toBe(conflict);

    expect(adapter.importRecords).toHaveBeenCalledTimes(1);
    expect(adapter.save).not.toHaveBeenCalled();
  });
});

describe("saving groups", () => {
  const monthly = { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" };
  const slot = { id: "mon", dayOfWeek: 1, startTime: "10:00", durationHours: 1 };

  it("starts a new group's schedule and billing on the day it is created", () => {
    const item = canonicalGroup({ id: "g1", name: "Inglés A1", weeklySchedule: [slot], billing: monthly });
    const [created] = placeSavedGroup([], item, { name: "Inglés A1" }, "2026-10-22");
    expect(created.scheduleResumeDate).toBe("2026-10-22");
    expect(created.billing.effectiveFrom).toBe("2026-11");
    const [early] = placeSavedGroup([], item, {}, "2026-10-03");
    expect(early.billing.effectiveFrom).toBe("2026-10");
  });

  it("keeps the stored schedule start when an edit does not send one", () => {
    const stored = {
      ...canonicalGroup({ id: "g1", name: "Inglés A1", weeklySchedule: [slot] }),
      scheduleResumeDate: "2026-10-22",
    };
    const edit = { id: "g1", name: "Inglés A2", weeklySchedule: [slot, { ...slot, id: "wed", dayOfWeek: 3 }] };
    const [saved] = placeSavedGroup([stored], canonicalGroup(edit), edit, "2026-11-30");
    expect(saved).toMatchObject({ name: "Inglés A2", scheduleResumeDate: "2026-10-22" });
    expect(saved.weeklySchedule).toHaveLength(2);
    const reopened = { ...stored, scheduleResumeDate: "2026-12-01" };
    expect(placeSavedGroup([stored], canonicalGroup(reopened), reopened, "2026-11-30")[0].scheduleResumeDate).toBe(
      "2026-12-01",
    );
    const legacy = canonicalGroup({ id: "g0", name: "Old", weeklySchedule: [slot] });
    expect(placeSavedGroup([legacy], legacy, { id: "g0" }, "2026-11-30")[0].scheduleResumeDate).toBe("");
  });
});
