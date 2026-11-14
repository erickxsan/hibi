// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistRecipe, useClassManager } from "./useClassManager.js";
import {
  createStarterState,
  createStudent,
  DATA_VERSION,
  NewerDataVersionError,
  serializeState,
  STORAGE_KEY,
} from "../domain/index.js";

const NEWER = DATA_VERSION + 1;

function legacyState() {
  const { dataVersion: _stamp, ...settings } = createStarterState({ settings: { onboardingVersion: 2 } }).settings;
  return {
    ...createStarterState(),
    settings,
    students: [createStudent({ id: "a", code: "A-1", fullName: "Ana", isIndividual: true })],
  };
}

const newerState = () => ({ ...legacyState(), settings: { ...legacyState().settings, dataVersion: NEWER } });
const addNote = (state) => ({ ...state, students: state.students.map((item) => ({ ...item, notes: "Edited" })) });

beforeEach(() => {
  localStorage.clear();
});

describe("saving on this device", () => {
  it("stamps this build's data version on a local save", async () => {
    const result = await persistRecipe({ baseState: legacyState(), recipe: addNote, adapter: undefined });
    expect(result.state.settings.dataVersion).toBe(DATA_VERSION);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.dataVersion).toBe(DATA_VERSION);
  });

  it("refuses to save over records, or to restore a file, written by a newer Hibi", async () => {
    const save = vi.fn();
    await expect(
      persistRecipe({ baseState: newerState(), recipe: addNote, adapter: undefined }),
    ).rejects.toBeInstanceOf(NewerDataVersionError);
    await expect(
      persistRecipe({ baseState: newerState(), recipe: addNote, adapter: { mode: "cloud", save } }),
    ).rejects.toBeInstanceOf(NewerDataVersionError);
    await expect(
      persistRecipe({ baseState: legacyState(), recipe: () => newerState(), adapter: undefined, replace: true }),
    ).rejects.toBeInstanceOf(NewerDataVersionError);
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("the manager in a tab running an older Hibi", () => {
  it("shows records from a newer Hibi but saves nothing", async () => {
    const stored = JSON.stringify(newerState());
    localStorage.setItem(STORAGE_KEY, stored);
    const { result } = renderHook(() => useClassManager());
    expect(result.current.needsNewerVersion).toBe(true);
    expect(result.current.state.students.map((item) => item.fullName)).toEqual(["Ana"]);
    await act(async () => {
      expect(await result.current.actions.setNotesDismissed(["owes:a:2026-10-01"])).toBe(false);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(result.current.toasts).toEqual([]);
  });

  it("stops saving when another tab stores records from a newer Hibi", async () => {
    localStorage.setItem(STORAGE_KEY, serializeState(legacyState()));
    const { result } = renderHook(() => useClassManager());
    expect(result.current.needsNewerVersion).toBe(false);
    const newer = JSON.stringify(newerState());
    await act(async () => {
      localStorage.setItem(STORAGE_KEY, newer);
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: newer }));
    });
    expect(result.current.needsNewerVersion).toBe(true);
    await act(async () => {
      expect(await result.current.actions.setNotesDismissed(["owes:a:2026-10-01"])).toBe(false);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(newer);
  });

  it("refuses to import a file written by a newer Hibi", async () => {
    const persistence = {
      initialState: createStarterState(),
      mode: "cloud",
      save: vi.fn(),
      replace: vi.fn(),
      importRecords: vi.fn(),
    };
    const { result } = renderHook(() => useClassManager({ persistence }));
    const file = JSON.stringify(newerState());
    await expect(result.current.actions.previewImportRecords(file, "hash")).rejects.toBeInstanceOf(
      NewerDataVersionError,
    );
    await act(async () => {
      expect(await result.current.actions.importRecords(file, { fileHash: "hash" })).toBe(false);
      expect(await result.current.actions.importJson(file)).toBe(false);
    });
    expect(persistence.save).not.toHaveBeenCalled();
    expect(persistence.replace).not.toHaveBeenCalled();
    expect(persistence.importRecords).not.toHaveBeenCalled();
    expect(result.current.toasts.map((toast) => toast.message)).toEqual([
      "A new version of Hibi is available. Reload to keep saving.",
      "A new version of Hibi is available. Reload to keep saving.",
    ]);
  });
});
