import {
  ATTENDANCE_CODES,
  CLASS_STATUSES,
  DEFAULT_SETTINGS,
  GRADE_CATEGORIES,
  PAYMENT_METHODS,
  PAYMENT_RECORD_STATES,
  SCHEMA_VERSION,
  STUDENT_AVATAR_IDS,
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

function timeOnly(errors, value, path, label, { optional = false } = {}) {
  if (optional && (value === null || value === "" || value === undefined)) return;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    errors.push(issue(path, "invalid_time", `${label} must use HH:MM.`, value));
  }
}

function emailAddress(errors, value, path, label, { optional = false } = {}) {
  if (optional && (value === null || value === "" || value === undefined)) return;
  if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    errors.push(issue(path, "invalid_email", `${label} must be a valid email address.`, value));
  }
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
  finiteNumber(errors, group.hourlyRate, "hourlyRate", "Group hourly rate", { min: 0, optional: true });
  if (group.weeklySchedule !== undefined && !Array.isArray(group.weeklySchedule)) errors.push(issue("weeklySchedule", "invalid_type", "Weekly schedule must be an array."));
  (group.weeklySchedule || []).forEach((slot, index) => {
    requiredText(errors, slot?.id, `weeklySchedule[${index}].id`, "Schedule slot ID");
    finiteNumber(errors, slot?.dayOfWeek, `weeklySchedule[${index}].dayOfWeek`, "Schedule day", { min: 1, max: 7, integer: true });
    timeOnly(errors, slot?.startTime, `weeklySchedule[${index}].startTime`, "Schedule time");
    finiteNumber(errors, slot?.durationHours, `weeklySchedule[${index}].durationHours`, "Schedule duration", { min: 0 });
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
  if (student.avatarId) enumValue(errors, student.avatarId, STUDENT_AVATAR_IDS, "avatarId", "Student avatar");
  emailAddress(errors, student.studentEmail, "studentEmail", "Student email", { optional: true });
  if (state && duplicateIn(state.students, "code", student.code, student.id)) {
    errors.push(issue("code", "duplicate", "Student code must be unique.", student.code));
  }
  if (student.groupIds !== undefined && !Array.isArray(student.groupIds)) errors.push(issue("groupIds", "invalid_type", "Student groups must be an array."));
  if (student.isIndividual !== undefined && typeof student.isIndividual !== "boolean") errors.push(issue("isIndividual", "invalid_type", "Individual enrollment must be true or false."));
  finiteNumber(errors, student.customHourlyRate, "customHourlyRate", "Custom hourly rate", { min: 0, optional: true });
  const seenGroups = new Set();
  const legacyGroups = student.groupId ? [student.groupId] : [];
  for (const groupId of Array.isArray(student.groupIds) ? student.groupIds : legacyGroups) {
    if (seenGroups.has(groupId)) errors.push(issue("groupIds", "duplicate", "A student cannot be assigned to the same group twice.", groupId));
    seenGroups.add(groupId);
    if (state && groupId && !state.groups?.some((group) => group?.id === groupId)) {
      errors.push(issue("groupIds", "unknown_reference", "Student references a group that does not exist.", groupId));
    }
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

export function validateClassSchedule(item, state = null) {
  const errors = [];
  if (!isRecord(item)) return result([issue("", "invalid_type", "Class schedule must be an object.")]);
  requiredText(errors, item.id, "id", "Class schedule ID");
  enumValue(errors, item.recurrence, ["once", "weekly"], "recurrence", "Class frequency");
  enumValue(errors, item.format, ["group", "individual"], "format", "Class format");
  dateOnly(errors, item.startDate, "startDate", "Start date");
  timeOnly(errors, item.startTime, "startTime", "Start time");
  finiteNumber(errors, item.durationHours, "durationHours", "Class duration", { min: 0.25 });
  finiteNumber(errors, item.intervalWeeks, "intervalWeeks", "Repeat interval", { min: 1, integer: true });
  if (!Array.isArray(item.daysOfWeek)) errors.push(issue("daysOfWeek", "invalid_type", "Class days must be an array."));
  (item.daysOfWeek || []).forEach((day, index) => finiteNumber(errors, day, `daysOfWeek[${index}]`, "Class day", { min: 1, max: 7, integer: true }));
  if (item.recurrence === "weekly" && !(item.daysOfWeek || []).length) errors.push(issue("daysOfWeek", "required", "Choose at least one class day."));
  if (item.format === "group") requiredText(errors, item.groupId, "groupId", "Class group");
  if (item.format === "individual") requiredText(errors, item.studentId, "studentId", "Class student");
  if (state && item.groupId && !state.groups?.some((group) => group.id === item.groupId)) errors.push(issue("groupId", "unknown_reference", "Class schedule references a missing group."));
  if (state && item.studentId && !state.students?.some((student) => student.id === item.studentId)) errors.push(issue("studentId", "unknown_reference", "Class schedule references a missing student."));
  return result(errors, []);
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
  finiteNumber(errors, row.appliedHourlyRate, "appliedHourlyRate", "Applied hourly rate", { min: 0, optional: true });
  finiteNumber(errors, row.appliedCharge, "appliedCharge", "Applied charge", { min: 0, optional: true });
  timeOnly(errors, row.startTime, "startTime", "Class time", { optional: true });
  dateOnly(errors, row.paymentDate, "paymentDate", "Payment date", { optional: true });
  enumValue(errors, row.paymentMethod, PAYMENT_METHODS, "paymentMethod", "Payment method", { optional: true });
  enumValue(errors, row.paymentState, PAYMENT_RECORD_STATES, "paymentState", "Payment state", { optional: true });

  if (state && row.studentId && !state.students?.some((student) => student?.id === row.studentId)) {
    errors.push(issue("studentId", "unknown_reference", "Class row references a student that does not exist.", row.studentId));
  }
  if (state && row.groupId && !state.groups?.some((group) => group?.id === row.groupId)) {
    errors.push(issue("groupId", "unknown_reference", "Class row references a group that does not exist.", row.groupId));
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

function normalizeGroupIds(student) {
  const source = Array.isArray(student?.groupIds)
    ? student.groupIds
    : student?.groupId
      ? [student.groupId]
      : [];
  return [...new Set(source.map(normalizeText).filter(Boolean))];
}

export function normalizeState(input) {
  const source = isRecord(input) ? input : {};
  const sourceSettings = isRecord(source.settings) ? source.settings : {};
  const selectedMonth = isDateOnly(sourceSettings.selectedMonth)
    ? startOfMonth(sourceSettings.selectedMonth)
    : sourceSettings.selectedMonth ?? DEFAULT_SETTINGS.selectedMonth;
  const normalizedStudents = (Array.isArray(source.students) ? source.students : []).map((student) => ({
    id: normalizeText(student?.id),
    code: normalizeText(student?.code),
    fullName: normalizeText(student?.fullName),
    avatarId: STUDENT_AVATAR_IDS.includes(student?.avatarId) ? student.avatarId : "",
    groupIds: normalizeGroupIds(student),
    isIndividual: Boolean(student?.isIndividual),
    customHourlyRate: normalizeOptionalNumber(student?.customHourlyRate),
    studentEmail: normalizeText(student?.studentEmail ?? student?.email),
    guardianPhone: normalizeText(student?.guardianPhone ?? student?.parentPhone),
    phone: normalizeText(student?.phone),
    guardianContact: normalizeText(student?.guardianContact),
    notes: normalizeText(student?.notes),
    status: normalizeText(student?.status),
  }));
  const inferableGroupByStudent = new Map(normalizedStudents
    .filter((student) => student.groupIds.length === 1)
    .map((student) => [student.id, student.groupIds[0]]));

  const normalized = {
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
      hourlyRate: normalizeOptionalNumber(group?.hourlyRate),
      weeklySchedule: (Array.isArray(group?.weeklySchedule) ? group.weeklySchedule : []).map((slot, index) => ({
        id: normalizeText(slot?.id) || `slot_${normalizeText(group?.id)}_${index + 1}`,
        dayOfWeek: normalizeNumber(slot?.dayOfWeek, 1),
        startTime: normalizeText(slot?.startTime),
        durationHours: normalizeNumber(slot?.durationHours, sourceSettings.defaultClassHours ?? DEFAULT_SETTINGS.defaultClassHours),
      })),
      plannedSessionsPerMonth: normalizeNumber(group?.plannedSessionsPerMonth, 0),
      assistantContact: normalizeText(group?.assistantContact),
      notes: normalizeText(group?.notes),
    })),
    students: normalizedStudents,
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
      classSessionKey: normalizeText(grade?.classSessionKey),
    })),
    classLog: (Array.isArray(source.classLog) ? source.classLog : []).map((row) => ({
      id: normalizeText(row?.id),
      classDate: normalizeText(row?.classDate),
      studentId: normalizeText(row?.studentId),
      groupId: normalizeText(row?.groupId) || inferableGroupByStudent.get(normalizeText(row?.studentId)) || "",
      startTime: normalizeText(row?.startTime),
      classTitle: normalizeText(row?.classTitle),
      scheduleSlotId: normalizeText(row?.scheduleSlotId),
      scheduleOccurrenceDate: normalizeText(row?.scheduleOccurrenceDate),
      classStatus: normalizeText(row?.classStatus),
      attendance: normalizeOptionalText(row?.attendance),
      hours: normalizeOptionalNumber(row?.hours),
      appliedHourlyRate: normalizeOptionalNumber(row?.appliedHourlyRate),
      appliedCharge: normalizeOptionalNumber(row?.appliedCharge),
      amountPaid: normalizeOptionalNumber(row?.amountPaid),
      paymentState: PAYMENT_RECORD_STATES.includes(row?.paymentState) ? row.paymentState : "",
      paymentDate: normalizeOptionalText(row?.paymentDate),
      paymentMethod: normalizeText(row?.paymentMethod),
      paymentReference: normalizeText(row?.paymentReference),
      notes: normalizeText(row?.notes),
    })),
    classSchedules: (Array.isArray(source.classSchedules) ? source.classSchedules : []).map((item, index) => ({
      id: normalizeText(item?.id) || `class_schedule_${index + 1}`,
      recurrence: item?.recurrence === "weekly" ? "weekly" : "once",
      format: item?.format === "individual" ? "individual" : "group",
      groupId: normalizeText(item?.groupId),
      studentId: normalizeText(item?.studentId),
      startDate: normalizeText(item?.startDate),
      startTime: normalizeText(item?.startTime),
      durationHours: normalizeNumber(item?.durationHours, sourceSettings.defaultClassHours ?? DEFAULT_SETTINGS.defaultClassHours),
      intervalWeeks: normalizeNumber(item?.intervalWeeks, 1),
      daysOfWeek: [...new Set((Array.isArray(item?.daysOfWeek) ? item.daysOfWeek : []).map((day) => normalizeNumber(day, 1)))],
    })),
    scheduleExceptions: (Array.isArray(source.scheduleExceptions) ? source.scheduleExceptions : []).map((item, index) => ({
      id: normalizeText(item?.id) || `schedule_exception_${index + 1}`,
      groupId: normalizeText(item?.groupId),
      scheduleSlotId: normalizeText(item?.scheduleSlotId),
      occurrenceDate: normalizeText(item?.occurrenceDate),
      classDate: normalizeText(item?.classDate),
      startTime: normalizeText(item?.startTime),
      durationHours: normalizeOptionalNumber(item?.durationHours),
      status: normalizeText(item?.status) || "Scheduled",
      kind: item?.kind === "added" ? "added" : "override",
    })),
    scheduleChanges: (Array.isArray(source.scheduleChanges) ? source.scheduleChanges : []).map((item, index) => ({
      id: normalizeText(item?.id) || `schedule_change_${index + 1}`,
      groupId: normalizeText(item?.groupId),
      scheduleSlotId: normalizeText(item?.scheduleSlotId),
      effectiveFrom: normalizeText(item?.effectiveFrom),
      dayOfWeek: normalizeNumber(item?.dayOfWeek, 1),
      startTime: normalizeText(item?.startTime),
      durationHours: normalizeOptionalNumber(item?.durationHours),
    })),
  };

  const groupsById = new Map(normalized.groups.map((group) => [group.id, group]));
  const studentsById = new Map(normalized.students.map((student) => [student.id, student]));
  normalized.classLog.forEach((row) => {
    const student = studentsById.get(row.studentId);
    const group = groupsById.get(row.groupId);
    const inheritedRate = student?.customHourlyRate ?? group?.hourlyRate ?? normalized.settings.hourlyRate;
    if (row.appliedHourlyRate === null && Number.isFinite(inheritedRate)) row.appliedHourlyRate = inheritedRate;
    if (row.appliedCharge === null && Number.isFinite(row.appliedHourlyRate)) {
      const hours = row.hours === null ? normalized.settings.defaultClassHours : row.hours;
      row.appliedCharge = row.classStatus === "Cancelled" ? 0 : hours * row.appliedHourlyRate;
    }
  });
  return normalized;
}

function validateScheduleException(item, state) {
  const errors = [];
  requiredText(errors, item?.id, "id", "Schedule exception ID");
  requiredText(errors, item?.groupId, "groupId", "Schedule exception group");
  dateOnly(errors, item?.occurrenceDate, "occurrenceDate", "Original occurrence date");
  dateOnly(errors, item?.classDate, "classDate", "Exception class date");
  timeOnly(errors, item?.startTime, "startTime", "Exception time");
  finiteNumber(errors, item?.durationHours, "durationHours", "Exception duration", { min: 0 });
  enumValue(errors, item?.status, CLASS_STATUSES, "status", "Exception status");
  if (!['override', 'added'].includes(item?.kind)) errors.push(issue("kind", "invalid_enum", "Exception kind must be override or added."));
  if (state && !state.groups.some((group) => group.id === item.groupId)) errors.push(issue("groupId", "unknown_reference", "Schedule exception references a missing group."));
  return result(errors, []);
}

function validateScheduleChange(item, state) {
  const errors = [];
  requiredText(errors, item?.id, "id", "Schedule change ID");
  requiredText(errors, item?.groupId, "groupId", "Schedule change group");
  requiredText(errors, item?.scheduleSlotId, "scheduleSlotId", "Schedule slot");
  dateOnly(errors, item?.effectiveFrom, "effectiveFrom", "Effective date");
  finiteNumber(errors, item?.dayOfWeek, "dayOfWeek", "Schedule day", { min: 1, max: 7, integer: true });
  timeOnly(errors, item?.startTime, "startTime", "Schedule time");
  finiteNumber(errors, item?.durationHours, "durationHours", "Schedule duration", { min: 0 });
  if (state && !state.groups.some((group) => group.id === item.groupId)) errors.push(issue("groupId", "unknown_reference", "Schedule change references a missing group."));
  return result(errors, []);
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
  for (const key of ["classSchedules", "scheduleExceptions", "scheduleChanges"]) {
    if (input[key] !== undefined && !Array.isArray(input[key])) errors.push(issue(key, "invalid_type", `${key} must be an array.`));
  }
  if (errors.some((entry) => entry.code === "invalid_type" && ["groups", "students", "grades", "classLog", "classSchedules", "scheduleExceptions", "scheduleChanges"].includes(entry.path))) {
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
  (state.classSchedules || []).forEach((item, index) => {
    const checked = withPrefix(validateClassSchedule(item, state), `classSchedules[${index}]`);
    errors.push(...checked.errors);
  });
  (state.scheduleExceptions || []).forEach((item, index) => {
    const checked = withPrefix(validateScheduleException(item, state), `scheduleExceptions[${index}]`);
    errors.push(...checked.errors);
  });
  (state.scheduleChanges || []).forEach((item, index) => {
    const checked = withPrefix(validateScheduleChange(item, state), `scheduleChanges[${index}]`);
    errors.push(...checked.errors);
  });

  errors.push(...duplicateIdErrors(state.groups, "groups"));
  errors.push(...duplicateIdErrors(state.students, "students"));
  errors.push(...duplicateIdErrors(state.grades, "grades"));
  errors.push(...duplicateIdErrors(state.classLog, "classLog"));
  errors.push(...duplicateIdErrors(state.classSchedules || [], "classSchedules"));
  errors.push(...duplicateIdErrors(state.scheduleExceptions || [], "scheduleExceptions"));
  errors.push(...duplicateIdErrors(state.scheduleChanges || [], "scheduleChanges"));
  errors.push(...duplicateFieldErrors(state.groups, "name", "groups", "Group name"));
  errors.push(...duplicateFieldErrors(state.students, "code", "students", "Student code"));

  const classKeys = new Map();
  state.classLog.forEach((row, index) => {
    if (!row?.classDate || !row?.studentId) return;
    const key = `${row.classDate}\u0000${row.studentId}\u0000${row.startTime || ""}`;
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
