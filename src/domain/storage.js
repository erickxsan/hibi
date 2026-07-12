import {
  REAL_ROSTER_BACKUP_KEY,
  REAL_ROSTER_MIGRATION_KEY,
  STORAGE_KEY,
} from "./constants.js";
import { migrateLegacyDemoToStarterState, isExactLegacyDemoState } from "./migrations.js";
import { createStarterState } from "./starterState.js";
import {
  assertValidState,
  DomainValidationError,
  normalizeState,
  validateState,
} from "./validation.js";

export class StorageUnavailableError extends Error {
  constructor(message = "Browser storage is unavailable.", options) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export function getDefaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new StorageUnavailableError();
  }
  return storage;
}

/** Serialize canonical state. Blank optional numbers stay null and zero stays zero. */
export function serializeState(state, { pretty = false } = {}) {
  const normalized = normalizeState(state);
  assertValidState(normalized);
  return JSON.stringify(normalized, null, pretty ? 2 : 0);
}

/** Parse and strictly validate an imported JSON document before accepting it. */
export function deserializeState(text) {
  if (typeof text !== "string") {
    throw new DomainValidationError("Imported data must be JSON text.", {
      valid: false,
      errors: [{ path: "", code: "invalid_type", message: "Expected JSON text." }],
      warnings: [],
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new DomainValidationError(
      "The selected file is not valid JSON.",
      {
        valid: false,
        errors: [{ path: "", code: "invalid_json", message: cause.message }],
        warnings: [],
      },
      { cause },
    );
  }

  const rawValidation = validateState(parsed);
  if (!rawValidation.valid) {
    throw new DomainValidationError("The selected file is not valid class-manager data.", rawValidation);
  }
  const normalized = normalizeState(parsed);
  assertValidState(normalized);
  return normalized;
}

export function exportState(state) {
  return serializeState(state, { pretty: true });
}

export function importState(text) {
  return deserializeState(text);
}

export function saveState(state, storage = getDefaultStorage(), key = STORAGE_KEY) {
  const target = requireStorage(storage);
  const serialized = serializeState(state);
  target.setItem(key, serialized);
  return deserializeState(serialized);
}

export function loadState(storage = getDefaultStorage(), key = STORAGE_KEY) {
  const target = requireStorage(storage);
  const serialized = target.getItem(key);
  return serialized === null ? createStarterState() : deserializeState(serialized);
}

export function removeSavedState(storage = getDefaultStorage(), key = STORAGE_KEY) {
  const target = requireStorage(storage);
  if (typeof target.removeItem !== "function") throw new StorageUnavailableError();
  target.removeItem(key);
}

/**
 * Non-throwing loader for initial app boot. Corrupt data is not overwritten, so
 * the UI can still offer the user an export/recovery path.
 */
export function safeLoadState(storage = getDefaultStorage(), key = STORAGE_KEY) {
  try {
    const target = requireStorage(storage);
    const serialized = target.getItem(key);
    if (serialized === null) return { state: createStarterState(), source: "starter", error: null };
    return { state: deserializeState(serialized), source: "storage", error: null };
  } catch (error) {
    return { state: createStarterState(), source: "starter", error };
  }
}

function writeMigrationMarker(target, status) {
  target.setItem(REAL_ROSTER_MIGRATION_KEY, status);
}

/**
 * Load the app's live state and perform the one guarded legacy-demo migration.
 * Imports remain migration-free; this path is used only during application boot.
 */
export function loadStateWithMigrations(storage = getDefaultStorage(), key = STORAGE_KEY) {
  const target = requireStorage(storage);
  const serialized = target.getItem(key);

  if (serialized === null) {
    const state = createStarterState();
    const nextText = serializeState(state);
    try {
      target.setItem(key, nextText);
      writeMigrationMarker(target, "initialized:real-roster-v1");
      return { state: deserializeState(nextText), source: "starter", error: null };
    } catch (error) {
      return { state, source: "starter", error };
    }
  }

  const state = deserializeState(serialized);
  if (target.getItem(REAL_ROSTER_MIGRATION_KEY) !== null) {
    return { state, source: "storage", error: null };
  }

  if (!isExactLegacyDemoState(state)) {
    try {
      writeMigrationMarker(target, "skipped:user-data");
      return { state, source: "storage", error: null };
    } catch (error) {
      return { state, source: "storage", error };
    }
  }

  const migrated = migrateLegacyDemoToStarterState(state);
  const migratedText = serializeState(migrated);
  try {
    target.setItem(REAL_ROSTER_BACKUP_KEY, serialized);
    target.setItem(key, migratedText);
    writeMigrationMarker(target, "migrated:real-roster-v1");
    return { state: deserializeState(migratedText), source: "migration", error: null };
  } catch (error) {
    const currentText = target.getItem(key);
    try {
      return {
        state: currentText === null ? state : deserializeState(currentText),
        source: currentText === migratedText ? "migration" : "storage",
        error,
      };
    } catch {
      return { state, source: "storage", error };
    }
  }
}

/** Corrupt saved bytes remain untouched; the starter roster is only a session fallback. */
export function safeLoadStateWithMigrations(storage = getDefaultStorage(), key = STORAGE_KEY) {
  try {
    return loadStateWithMigrations(storage, key);
  } catch (error) {
    return { state: createStarterState(), source: "starter", error };
  }
}

export function createExportFilename(asOfDate) {
  const date = typeof asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
    ? asOfDate
    : new Date().toISOString().slice(0, 10);
  return `class-manager-${date}.json`;
}
