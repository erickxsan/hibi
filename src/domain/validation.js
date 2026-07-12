import {
  ATTENDANCE_CODES,
  CLASS_STATUSES,
  DEFAULT_SETTINGS,
  GRADE_CATEGORIES,
  PAYMENT_METHODS,
  SCHEMA_VERSION,
  STUDENT_STATUSES,
  WORK_STATUSES,
} from "./constants.js";
import { isDateOnly, startOfMonth } from "./dates.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function result(errors = [], warnings = []) {
  return { valid: errors.length === 0, errors, warnings };
}

function issue(path, code, message, value) {
  return value === undefined ? { path, code, message } : { path, code, message, value };
}

function requiredText(errors, value, path, label) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(issue(path, "required", `${label} is required.`));
  }
}

function enumValue(errors, value, allowed, path, label, { optional = false } = {}) {
  if (optional && (value === null || value === "" || value === undefined)) return;
  if (!allowed.includes(value)) {
    errors.push(issue(path, "invalid_enum", `${label} must be one of: ${allowed.join(", ")}.`, value));
  }
}

function finiteNumber(errors, value, path, label, { min = -Infinity, max = Infinity, integer = false, optional = false } = {}) {
  if (optional && (value === null || value === "" || value === undefined)) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(issue(path, "invalid_number", `${label} must be a finite number.`, value));
    return;
  }
  if (integer && !Number.isInteger(value)) {
    errors.push(issue(path, "not_integer", `${label} must be a whole number.`, value));
  }
  if (value < min || value > max) {
    errors.push(issue(path, "out_of_range", `${label} must be between ${min} and ${max}.`, value));
  }
}

function dateOnly(errors, value, path, label, { optional = false } = {}) {
  if (optional && (value === null || value === "" || value === undefined)) return;
  if (!isDateOnly(value)) errors.push(issue(path, "invalid_date", `${label} must use YYYY-MM-DD.`, value));
}

function duplicateIn(items, field, value, exceptId) {
  if (!value || !Array.isArray(items)) return false;
  const normalized = typeof value === "string" ? value.trim().toLocaleLowerCase() : value;
  return items.some((item) => {
    if (!item || item.id === exceptId) return false;
    const candidate = typeof item[field] === "string" ? item[field].trim().toLocaleLowerCase() : item[field];
    return candidate === normalized;
  });
}

function withPrefix(validation, prefix) {
  const prepend = (entry) => ({ ...entry, path: entry.path ? `${prefix}.${entry.path}` : prefix });
  return {
    valid: validation.valid,
    errors: validation.errors.map(prepend),
    warnings: validation.warnings.map(prepend),
  };
}

export function validateGroup(group, state = null) {
  const errors = [];
  const warnings = [];
  if (!isRecord(group)) return result([issue("", "invalid_type", "Group must be an object.")]);
  requiredText(errors, group.id, "id", "Stable group ID");
  requiredText(errors, group.name, "name", "Group name");
  finiteNumber(errors, group.plannedSessionsPerMonth, "plannedSessionsPerMonth", "Planned sessions per month", {
    min: 0,
    integer: true,
  });
  if (state && duplicateIn(state.groups, "name", group.name, group.id)) {
    errors.push(issue("name", "duplicate", "Group name must be unique.", group.name));
  }
  return result(errors, warnings);
}

export function validateStudent(student, state = null) {
  const errors = [];
  const warnings = [];
  if (!isRecord(student)) return result([issue("", "invalid_type", "Student must be an object.")]);
  requiredText(errors, student.id, "id", "Stable student ID");
  requiredText(errors, student.code, "code", "Student code");
  requiredText(errors, student.fullName, "fullName", "Student name");
  enumValue(errors, student.status, STUDENT_STATUSES, "status", "Student status");
  if (state && duplicateIn(state.students, "code", student.code, student.id)) {
    errors.push(issue("code", "duplicate", "Student code must be unique.", student.code));
  }
  if (state && student.groupId && !state.groups?.some((group) => group?.id === student.groupId)) {
    errors.push(issue("groupId", "unknown_reference", "Student references a group that does not exist.", student.groupId));
  }
  return result(errors, warnings);
}

export function validateGrade(grade, state = null) {
  const errors = [];
  const warnings = [];
  if (!isRecord(grade)) return result([issue("", "invalid_type", "Grade must be an object.")]);
  requiredText(errors, grade.id, "id", "Stable grade ID");
  dateOnly(errors, grade.date, "date", "Assessment date");
  requiredText(errors, grade.studentId, "studentId", "Student");
  requiredText(errors, grade.assessment, "assessment", "Assessment name");
  enumValue(errors, grade.category, GRADE_CATEGORIES, "category", "Assessment category");
  finiteNumber(errors, grade.score, "score", "Score", { min: 0, optional: true });
  finiteNumber(errors, grade.maxScore, "maxScore", "Maximum score", { min: Number.EPSILON });
  enumValue(errors, grade.workStatus, WORK_STATUSES, "workStatus", "Work status");
  if (state && grade.studentId && !state.students?.some((student) => student?.id === grade.studentId)) {
    errors.push(issue("studentId", "unknown_reference", "Grade references a student that does not exist.", grade.studentId));
  }
  if (typeof grade.score === "number" && typeof grade.maxScore === "number" && grade.score > grade.maxScore) {
    warnings.push(issue("score", "over_maximum", "Score is above the maximum; confirm that this is intentional.", grade.score));
  }
  if (grade.workStatus === "Missing" && typeof grade.score === "number") {
    warnings.push(issue("score", "missing_with_score", "Missing work has a score; confirm the work status."));
  }
  return result(errors, warnings);
}

export function validateClassLogRow(row, state = null) {
  const errors = [];
  const warnings = [];
  if (!isRecord(row)) return result([issue("", "invalid_type", "Class log row must be an object.")]);
  requiredText(errors, row.id, "id", "Stable class row ID");
  dateOnly(errors, row.classDate, "classDate", "Class date");
  requiredText(errors, row.studentId, "studentId", "Student");
  enumValue(errors, row.classStatus, CLASS_STATUSES, "classStatus", "Class status");
  enumValue(errors, row.attendance, ATTENDANCE_CODES, "attendance", "Attendance", { optional: true });
  finiteNumber(errors, row.hours, "hours", "Hours", { min: 0, optional: true });
  finiteNumber(errors, row.amountPaid, "amountPaid", "Amount paid", { min: 0, optional: true });
  dateOnly(errors, row.paymentDate, "paymentDate", "Payment date", { optional: true });
  enumValue(errors, row.paymentMethod, PAYMENT_METHODS, "paymentMethod", "Payment method", { optional: true });

  if (state && row.studentId && !state.students?.some((student) => student?.id === row.studentId)) {
    errors.push(issue("studentId", "unknown_reference", "Class row references a student that does not exist.", row.studentId));
  }
  if (row.classStatus === "Completed" && !row.attendance) {
    warnings.push(issue("attendance", "attendance_missing", "Completed class has no attendance mark."));
  }
  if (row.classStatus !== "Completed" && row.attendance) {
    warnings.push(issue("attendance", "attendance_on_noncompleted", "Attendance is normally only recorded for completed classes."));
  }
  if (typeof row.amountPaid === "number" && row.amountPaid > 0 && !row.paymentDate) {
    warnings.push(issue("paymentDate", "payment_date_missing", "A positive payment needs a payment date."));
  }
  if (row.paymentDate && !(typeof row.amountPaid === "number" && row.amountPaid > 0)) {
    warnings.push(issue("amountPaid", "payment_amount_missing", "A payment date needs a positive amount."));
  }
  if (typeof row.amountPaid === "number" && row.amountPaid > 0 && !row.paymentMethod) {
    warnings.push(issue("paymentMethod", "payment_method_missing", "Consider recording how the payment was received."));
  }
  return result(errors, warnings);
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim() || null;
}

function normalizeNumber(value, fallback) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function normalizeOptionalNumber(value) {
  // This is the critical blank-vs-zero boundary used by scores and class hours.
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

export function normalizeState(input) {
  const source = isRecord(input) ? input : {};
  const sourceSettings = isRecord(source.settings) ? source.settings : {};
  const selectedMonth = isDateOnly(sourceSettings.selectedMonth)
    ? startOfMonth(sourceSettings.selectedMonth)
    : sourceSettings.selectedMonth ?? DEFAULT_SETTINGS.selectedMonth;

  return {
    version: normalizeNumber(source.version, SCHEMA_VERSION),
    settings: {
      currency: normalizeText(sourceSettings.currency ?? DEFAULT_SETTINGS.currency),
      hourlyRate: normalizeNumber(sourceSettings.hourlyRate, DEFAULT_SETTINGS.hourlyRate),
      defaultClassHours: normalizeNumber(sourceSettings.defaultClassHours, DEFAULT_SETTINGS.defaultClassHours),
      recentProjectionWeeks: normalizeNumber(sourceSettings.recentProjectionWeeks, DEFAULT_SETTINGS.recentProjectionWeeks),
      lowGradeThreshold: normalizeNumber(sourceSettings.lowGradeThreshold, DEFAULT_SETTINGS.lowGradeThreshold),
      lowAttendanceThreshold: normalizeNumber(sourceSettings.lowAttendanceThreshold, DEFAULT_SETTINGS.lowAttendanceThreshold),
      selectedMonth,
      asOfDate: sourceSettings.asOfDate ?? DEFAULT_SETTINGS.asOfDate,
    },
    groups: (Array.isArray(source.groups) ? source.groups : []).map((group) => ({
      id: normalizeText(group?.id),
      name: normalizeText(group?.name),
      grade: normalizeText(group?.grade),
      subject: normalizeText(group?.subject),
      schedule: normalizeText(group?.schedule),
      plannedSessionsPerMonth: normalizeNumber(group?.plannedSessionsPerMonth, 0),
      assistantContact: normalizeText(group?.assistantContact),
      notes: normalizeText(group?.notes),
    })),
    students: (Array.isArray(source.students) ? source.students : []).map((student) => ({
      id: normalizeText(student?.id),
      code: normalizeText(student?.code),
      fullName: normalizeText(student?.fullName),
      groupId: normalizeText(student?.groupId),
      phone: normalizeText(student?.phone),
      guardianContact: normalizeText(student?.guardianContact),
      notes: normalizeText(student?.notes),
      status: normalizeText(student?.status),
    })),
    grades: (Array.isArray(source.grades) ? source.grades : []).map((grade) => ({
      id: normalizeText(grade?.id),
      date: normalizeText(grade?.date),
      studentId: normalizeText(grade?.studentId),
      assessment: normalizeText(grade?.assessment),
      category: normalizeText(grade?.category),
      score: normalizeOptionalNumber(grade?.score),
      maxScore: normalizeOptionalNumber(grade?.maxScore),
      workStatus: normalizeText(grade?.workStatus),
      feedback: normalizeText(grade?.feedback),
    })),
    classLog: (Array.isArray(source.classLog) ? source.classLog : []).map((row) => ({
      id: normalizeText(row?.id),
      classDate: normalizeText(row?.classDate),
      studentId: normalizeText(row?.studentId),
      classStatus: normalizeText(row?.classStatus),
      attendance: normalizeOptionalText(row?.attendance),
      hours: normalizeOptionalNumber(row?.hours),
      amountPaid: normalizeOptionalNumber(row?.amountPaid),
      paymentDate: normalizeOptionalText(row?.paymentDate),
      paymentMethod: normalizeText(row?.paymentMethod),
      paymentReference: normalizeText(row?.paymentReference),
      notes: normalizeText(row?.notes),
    })),
  };
}

function duplicateIdErrors(collection, path) {
  const errors = [];
  const seen = new Set();
  collection.forEach((item, index) => {
    if (!item?.id) return;
    if (seen.has(item.id)) {
      errors.push(issue(`${path}[${index}].id`, "duplicate_id", `Stable ID ${item.id} is duplicated.`, item.id));
    }
    seen.add(item.id);
  });
  return errors;
}

function duplicateFieldErrors(collection, field, path, label) {
  const errors = [];
  const seen = new Set();
  collection.forEach((item, index) => {
    const raw = item?.[field];
    if (typeof raw !== "string" || !raw.trim()) return;
    const normalized = raw.trim().toLocaleLowerCase();
    if (seen.has(normalized)) {
      errors.push(issue(`${path}[${index}].${field}`, "duplicate", `${label} must be unique.`, raw));
    }
    seen.add(normalized);
  });
  return errors;
}

export function validateState(input) {
  const errors = [];
  const warnings = [];
  if (!isRecord(input)) return result([issue("", "invalid_type", "Imported data must be a JSON object.")]);
  if (input.version !== SCHEMA_VERSION) {
    errors.push(issue("version", "unsupported_version", `Only schema version ${SCHEMA_VERSION} is supported.`, input.version));
  }
  if (!isRecord(input.settings)) {
    errors.push(issue("settings", "invalid_type", "Settings must be an object."));
  } else {
    enumValue(errors, input.settings.currency, ["MXN"], "settings.currency", "Currency");
    finiteNumber(errors, input.settings.hourlyRate, "settings.hourlyRate", "Hourly rate", { min: 0 });
    finiteNumber(errors, input.settings.defaultClassHours, "settings.defaultClassHours", "Default class hours", { min: 0 });
    finiteNumber(errors, input.settings.recentProjectionWeeks, "settings.recentProjectionWeeks", "Recent projection weeks", {
      min: 1,
      integer: true,
    });
    finiteNumber(errors, input.settings.lowGradeThreshold, "settings.lowGradeThreshold", "Low-grade threshold", { min: 0, max: 1 });
    finiteNumber(errors, input.settings.lowAttendanceThreshold, "settings.lowAttendanceThreshold", "Low-attendance threshold", { min: 0, max: 1 });
    dateOnly(errors, input.settings.selectedMonth, "settings.selectedMonth", "Selected month");
    if (isDateOnly(input.settings.selectedMonth) && startOfMonth(input.settings.selectedMonth) !== input.settings.selectedMonth) {
      errors.push(issue("settings.selectedMonth", "not_month_start", "Selected month must be the first day of its month."));
    }
    dateOnly(errors, input.settings.asOfDate, "settings.asOfDate", "As-of date");
  }

  for (const key of ["groups", "students", "grades", "classLog"]) {
    if (!Array.isArray(input[key])) errors.push(issue(key, "invalid_type", `${key} must be an array.`));
  }
  if (errors.some((entry) => entry.code === "invalid_type" && ["groups", "students", "grades", "classLog"].includes(entry.path))) {
    return result(errors, warnings);
  }

  const state = input;
  state.groups.forEach((group, index) => {
    const checked = withPrefix(validateGroup(group, state), `groups[${index}]`);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
  });
  state.students.forEach((student, index) => {
    const checked = withPrefix(validateStudent(student, state), `students[${index}]`);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
  });
  state.grades.forEach((grade, index) => {
    const checked = withPrefix(validateGrade(grade, state), `grades[${index}]`);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
  });
  state.classLog.forEach((row, index) => {
    const checked = withPrefix(validateClassLogRow(row, state), `classLog[${index}]`);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
  });

  errors.push(...duplicateIdErrors(state.groups, "groups"));
  errors.push(...duplicateIdErrors(state.students, "students"));
  errors.push(...duplicateIdErrors(state.grades, "grades"));
  errors.push(...duplicateIdErrors(state.classLog, "classLog"));
  errors.push(...duplicateFieldErrors(state.groups, "name", "groups", "Group name"));
  errors.push(...duplicateFieldErrors(state.students, "code", "students", "Student code"));

  const classKeys = new Map();
  state.classLog.forEach((row, index) => {
    if (!row?.classDate || !row?.studentId) return;
    const key = `${row.classDate}\u0000${row.studentId}`;
    if (classKeys.has(key)) {
      warnings.push(issue(`classLog[${index}]`, "duplicate_student_class", "Student already has a class row on this date."));
    } else {
      classKeys.set(key, index);
    }
  });
  return result(errors, warnings);
}

export class DomainValidationError extends Error {
  constructor(message, validation, options) {
    super(message, options);
    this.name = "DomainValidationError";
    this.validation = validation;
  }
}

export function assertValidState(state) {
  const validation = validateState(state);
  if (!validation.valid) throw new DomainValidationError("Class manager data is invalid.", validation);
  return validation;
}
