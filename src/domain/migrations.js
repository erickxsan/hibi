import { createStarterState } from "./starterState.js";
import { seedState } from "./seed.js";
import { assertValidState, normalizeState } from "./validation.js";

function collectionFingerprint(state) {
  const normalized = normalizeState(state);
  const legacyClassLog = normalized.classLog.map(({ appliedHourlyRate: _rate, appliedCharge: _charge, ...row }) => row);
  return JSON.stringify({
    version: normalized.version,
    groups: normalized.groups,
    students: normalized.students,
    grades: normalized.grades,
    classLog: legacyClassLog,
  });
}

const LEGACY_DEMO_FINGERPRINT = collectionFingerprint(seedState);

export function isExactLegacyDemoState(state) {
  return collectionFingerprint(state) === LEGACY_DEMO_FINGERPRINT;
}

export function migrateLegacyDemoToStarterState(state) {
  const normalized = normalizeState(state);
  const migrated = normalizeState(createStarterState({ settings: normalized.settings }));
  assertValidState(migrated);
  return migrated;
}
