import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain";
import { canonicalGroup, canonicalStudent, persistRecipe } from "./useClassManager";

describe("class manager draft canonicalization", () => {
  it("prefers current student fields over legacy view aliases", () => {
    const result = canonicalStudent({
      id: "s1",
      code: "NEW-01",
      studentCode: "OLD-01",
      fullName: "Sample Student",
      phone: "555 010 2026",
      studentPhone: "555 000 0000",
      notes: "Current notes",
      importantNotes: "Legacy notes",
      status: "Active",
      groupIds: [],
    });

    expect(result.code).toBe("NEW-01");
    expect(result.phone).toBe("555 010 2026");
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
      save: vi.fn()
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

    await expect(persistRecipe({ baseState: base, recipe: (state) => state, adapter, replace: true }))
      .rejects.toBe(conflict);
    expect(adapter.save).not.toHaveBeenCalled();
  });
});
