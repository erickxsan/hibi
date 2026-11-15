import { DATA_VERSION, DEFAULT_SETTINGS, SCHEMA_VERSION } from "./constants.js";
import { startOfMonth, todayDateOnly } from "./dates.js";

/** Public-safe empty state. Personal records must be imported by the owner. */
export function createStarterState(options = {}) {
  const today = todayDateOnly();
  return {
    version: SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      selectedMonth: startOfMonth(today),
      asOfDate: today,
      // A new workspace is written in this build's format from its first save.
      dataVersion: DATA_VERSION,
      ...(options.settings || {}),
    },
    groups: [],
    students: [],
    grades: [],
    classLog: [],
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}
