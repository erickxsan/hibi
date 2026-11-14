export const SCHEMA_VERSION = 1;
// Version of the record format this build reads and writes in full, stored as `settings.dataVersion`.
// SCHEMA_VERSION stays 1 (backups, the server contract and older builds reject any other value); this
// number is what lets a tab left open across a deploy notice that a newer Hibi has written the workspace.
// A build that finds a higher number stops saving, because normalizeState drops the fields it does not
// know and a save would upload the record without them.
// BUMP IT whenever a persisted field is added to any record or to the settings, or a field changes meaning.
export const DATA_VERSION = 1;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export const STORAGE_KEY = "minimal-class-manager:v1";
export const REAL_ROSTER_MIGRATION_KEY = "minimal-class-manager:migration:real-roster-2026-07-11:v1";
export const REAL_ROSTER_BACKUP_KEY = "minimal-class-manager:backup:before-real-roster-2026-07-11:v1";

export const DEFAULT_SETTINGS = Object.freeze({
  currency: "MXN",
  hourlyRate: 50,
  defaultClassHours: 2,
  recentProjectionWeeks: 4,
  lowGradeThreshold: 0.7,
  lowAttendanceThreshold: 0.8,
  selectedMonth: "2026-07-01",
  asOfDate: "2026-07-10",
  onboardingVersion: 0,
  onboardingStep: 1,
  onboardingGroupId: "",
});

export const STUDENT_STATUSES = Object.freeze(["Active", "Inactive"]);
export const STUDENT_AVATAR_IDS = Object.freeze(["cat", "dog", "penguin", "fox", "rabbit", "bear", "frog", "owl"]);
export const GROUP_COLOR_IDS = Object.freeze(["bermellon", "ocre", "jade", "indigo", "kraft"]);
export const GROUP_ICON_IDS = Object.freeze([
  "book",
  "pencil",
  "calculator",
  "shapes",
  "flask",
  "atom",
  "globe",
  "languages",
  "music",
  "palette",
  "brain",
  "puzzle",
  "star",
  "sun",
  "sprout",
  "graduation",
  "checklist",
]);
export const CLASS_STATUSES = Object.freeze(["Scheduled", "Completed", "Cancelled"]);
export const ATTENDANCE_CODES = Object.freeze(["P", "A", "L", "E"]);
export const GRADE_CATEGORIES = Object.freeze(["Quiz", "Exam", "Project", "Homework", "Participation", "Other"]);
export const WORK_STATUSES = Object.freeze(["On time", "Late", "Missing", "Excused"]);
export const PAYMENT_METHODS = Object.freeze(["Cash", "Transfer", "Card", "Other"]);
export const PAYMENT_RECORD_STATES = Object.freeze(["Paid", "Pending", "Unpaid"]);

export const PAYMENT_STATUSES = Object.freeze({
  UNKNOWN_STUDENT: "Unknown student",
  REVIEW_CANCELLED: "Review cancelled payment",
  CANCELLED: "Cancelled",
  ATTENDANCE_NEEDED: "Attendance needed",
  REVIEW_NO_CHARGE: "Review no-charge payment",
  NO_CHARGE: "No charge",
  DATE_NEEDED: "Date needed",
  AMOUNT_NEEDED: "Amount needed",
  FUTURE_PAYMENT_DATE: "Future payment date",
  SCHEDULED: "Scheduled",
  PENDING: "Pending",
  LOST: "Lost",
  PARTIAL: "Partial",
  OVERPAID: "Overpaid",
  PAID_IN_ADVANCE: "Paid in advance",
  PAID: "Paid",
});
