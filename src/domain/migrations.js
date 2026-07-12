import { createStarterState } from "./starterState.js";
import { seedState } from "./seed.js";
import { assertValidState, normalizeState } from "./validation.js";

function collectionFingerprint(state) {
  const normalized = normalizeState(state);
  return JSON.stringify({
    version: normalized.version,
    groups: normalized.groups,
    students: normalized.students,
    grades: normalized.grades,
    classLog: normalized.classLog,
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
