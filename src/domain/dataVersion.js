import { DATA_VERSION } from "./constants.js";

// Guard against a tab that runs an older Hibi. normalizeState keeps only the fields this build knows, so
// an older build that saved a record would upload it without the fields a newer build added. Every build
// stamps DATA_VERSION into `settings.dataVersion` when it writes, and refuses to write a workspace whose
// number is higher than its own. A workspace without the field was last written before the guard (0).

export class NewerDataVersionError extends Error {
  constructor(message = "A new version of Hibi is available. Reload to keep saving.") {
    super(message);
    this.name = "NewerDataVersionError";
    this.code = "newer_data_version";
  }
}

/** The data version stored in a settings object, 0 when it is missing or malformed. */
export function settingsDataVersion(settings) {
  const value = settings?.dataVersion;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** The data version of a workspace state (0 before the guard existed). */
export function dataVersionOf(state) {
  return settingsDataVersion(state?.settings);
}

/** Whether a newer build wrote this state, so this build must not save over it. */
export function needsNewerClient(state, understood = DATA_VERSION) {
  return dataVersionOf(state) > understood;
}

/** Throws NewerDataVersionError when any of the states was written by a newer build. */
export function assertWritableDataVersion(...states) {
  if (states.some((state) => needsNewerClient(state))) throw new NewerDataVersionError();
}

/** The state stamped with this build's data version (the same object when it already carries it). */
export function withCurrentDataVersion(state) {
  if (!state || dataVersionOf(state) === DATA_VERSION) return state;
  assertWritableDataVersion(state);
  return { ...state, settings: { ...state.settings, dataVersion: DATA_VERSION } };
}
