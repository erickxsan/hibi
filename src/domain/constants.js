export const SCHEMA_VERSION = 1;
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
});

export const STUDENT_STATUSES = Object.freeze(["Active", "Inactive"]);
export const STUDENT_AVATAR_IDS = Object.freeze(["cat", "dog", "penguin", "fox", "rabbit", "bear", "frog", "owl"]);
export const CLASS_STATUSES = Object.freeze(["Scheduled", "Completed", "Cancelled"]);
export const ATTENDANCE_CODES = Object.freeze(["P", "A", "L", "E"]);
export const GRADE_CATEGORIES = Object.freeze([
  "Quiz",
  "Exam",
  "Project",
  "Homework",
  "Participation",
  "Other",
]);
export const WORK_STATUSES = Object.freeze(["On time", "Late", "Missing", "Excused"]);
export const PAYMENT_METHODS = Object.freeze(["Cash", "Transfer", "Card", "Other"]);

export const PAYMENT_STATUSES = Object.freeze({
  UNKNOWN_STUDENT: "Unknown student",
  REVIEW_CANCELLED: "Review cancelled payment",
  CANCELLED: "Cancelled",
  REVIEW_NO_CHARGE: "Review no-charge payment",
  NO_CHARGE: "No charge",
  DATE_NEEDED: "Date needed",
  AMOUNT_NEEDED: "Amount needed",
  FUTURE_PAYMENT_DATE: "Future payment date",
  SCHEDULED: "Scheduled",
  PENDING: "Pending",
  PARTIAL: "Partial",
  OVERPAID: "Overpaid",
  PAID_IN_ADVANCE: "Paid in advance",
  PAID: "Paid",
});
