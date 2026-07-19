import { describe, expect, it } from "vitest";
import {
  createSeedState,
  createStarterState,
  deserializeState,
  DomainValidationError,
  exportState,
  importState,
  loadState,
  normalizeState,
  safeLoadStateWithMigrations,
  safeLoadState,
  saveState,
  serializeState,
  STORAGE_KEY,
  REAL_ROSTER_BACKUP_KEY,
  REAL_ROSTER_MIGRATION_KEY,
} from "./index.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe("persistence and import/export", () => {
  it("round-trips canonical data and preserves null versus zero", () => {
    const state = createSeedState();
    state.grades[0].score = null;
    state.grades[1].score = 0;
    state.classLog[0].hours = null;
    state.classLog[1].hours = 0;
    const restored = deserializeState(serializeState(state));

    expect(restored.grades[0].score).toBeNull();
    expect(restored.grades[1].score).toBe(0);
    expect(restored.classLog[0].hours).toBeNull();
    expect(restored.classLog[1].hours).toBe(0);
    expect(restored.students[0].id).toBe(state.students[0].id);
  });

  it("strictly rejects malformed JSON and the wrong schema", () => {
    expect(() => importState("{nope")).toThrow(DomainValidationError);
    const bad = createSeedState();
    delete bad.students;
    expect(() => deserializeState(JSON.stringify(bad))).toThrow(DomainValidationError);
  });

  it("fills safely defaulted fields before strict validation", () => {
    const legacy = createStarterState();
    delete legacy.settings.recentProjectionWeeks;
    delete legacy.scheduleExceptions;
    delete legacy.scheduleChanges;

    const restored = deserializeState(JSON.stringify(legacy));

    expect(restored.settings.recentProjectionWeeks).toBe(4);
    expect(restored.scheduleExceptions).toEqual([]);
    expect(restored.scheduleChanges).toEqual([]);
  });

  it("does not normalize an unrecognized document into an empty workspace", () => {
    expect(() => deserializeState(JSON.stringify({ version: 1, settings: {} })))
      .toThrow("not valid class-manager data");
  });

  it("loads the public-safe empty starter when empty and saves valid data to localStorage-compatible storage", () => {
    const storage = memoryStorage();
    expect(loadState(storage).students).toEqual([]);
    const state = createSeedState();
    state.settings.hourlyRate = 60;
    saveState(state, storage);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).settings.hourlyRate).toBe(60);
    expect(loadState(storage).settings.hourlyRate).toBe(60);
  });

  it("initializes empty live storage with the public-safe starter", () => {
    const storage = memoryStorage();
    const loaded = safeLoadStateWithMigrations(storage);

    expect(loaded.source).toBe("starter");
    expect(loaded.state.students).toEqual([]);
    expect(loaded.state.groups).toEqual([]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).students).toEqual([]);
    expect(storage.getItem(REAL_ROSTER_MIGRATION_KEY)).toBe("initialized:real-roster-v1");
  });

  it("migrates only the exact legacy demo collections, preserving custom settings and a backup", () => {
    const storage = memoryStorage();
    const legacy = createSeedState();
    legacy.settings.hourlyRate = 75;
    legacy.settings.defaultClassHours = 1.5;
    const original = serializeState(legacy);
    storage.setItem(STORAGE_KEY, original);

    const loaded = safeLoadStateWithMigrations(storage);

    expect(loaded.source).toBe("migration");
    expect(loaded.state.students).toEqual([]);
    expect(loaded.state.groups).toEqual([]);
    expect(loaded.state.grades).toEqual([]);
    expect(loaded.state.classLog).toEqual([]);
    expect(loaded.state.settings).toEqual(legacy.settings);
    expect(storage.getItem(REAL_ROSTER_BACKUP_KEY)).toBe(original);
    expect(storage.getItem(REAL_ROSTER_MIGRATION_KEY)).toBe("migrated:real-roster-v1");
  });

  it("never migrates modified collections and leaves their saved bytes unchanged", () => {
    const storage = memoryStorage();
    const changed = createSeedState();
    changed.students[0].fullName = "User-edited student";
    const original = serializeState(changed);
    storage.setItem(STORAGE_KEY, original);

    const loaded = safeLoadStateWithMigrations(storage);

    expect(loaded.source).toBe("storage");
    expect(loaded.state.students[0].fullName).toBe("User-edited student");
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
    expect(storage.getItem(REAL_ROSTER_BACKUP_KEY)).toBeNull();
    expect(storage.getItem(REAL_ROSTER_MIGRATION_KEY)).toBe("skipped:user-data");
  });

  it("respects an existing migration marker and does not re-run after a reset", () => {
    const storage = memoryStorage();
    const legacy = createSeedState();
    storage.setItem(STORAGE_KEY, serializeState(legacy));
    storage.setItem(REAL_ROSTER_MIGRATION_KEY, "completed-before");

    const loaded = safeLoadStateWithMigrations(storage);

    expect(loaded.source).toBe("storage");
    expect(loaded.state.students).toHaveLength(4);
    expect(storage.getItem(REAL_ROSTER_BACKUP_KEY)).toBeNull();
  });

  it("keeps corrupt saved bytes and migration keys untouched", () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, "not json");

    const loaded = safeLoadStateWithMigrations(storage);

    expect(loaded.state).toEqual(createStarterState());
    expect(loaded.error).toBeInstanceOf(DomainValidationError);
    expect(storage.getItem(STORAGE_KEY)).toBe("not json");
    expect(storage.getItem(REAL_ROSTER_MIGRATION_KEY)).toBeNull();
    expect(storage.getItem(REAL_ROSTER_BACKUP_KEY)).toBeNull();
  });

  it("recovers non-destructively from corrupt saved data", () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, "not json");
    const loaded = safeLoadState(storage);
    expect(loaded.source).toBe("starter");
    expect(loaded.error).toBeInstanceOf(DomainValidationError);
    expect(storage.getItem(STORAGE_KEY)).toBe("not json");
  });

  it("exports readable JSON that imports back to the same state", () => {
    const state = createSeedState();
    const text = exportState(state);
    expect(text).toContain("\n  \"settings\"");
    expect(importState(text)).toEqual(normalizeState(state));
  });
});
