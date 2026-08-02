import { addDays, isDateInRange, isDateOnly, parseDateOnly } from "./dates.js";

export const DAY_OPTIONS = Object.freeze([
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
]);

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function dayOfWeekForDate(value) {
  if (!isDateOnly(value)) return null;
  const day = parseDateOnly(value).getUTCDay();
  return day === 0 ? 7 : day;
}

export function formatWeeklySchedule(slots = []) {
  if (!Array.isArray(slots) || !slots.length) return "";
  return slots
    .slice()
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.startTime.localeCompare(right.startTime))
    .map((slot) => `${DAY_OPTIONS.find((day) => day.value === slot.dayOfWeek)?.short || "Day"} ${slot.startTime}`)
    .join(" · ");
}

export function resolveHourlyRate(state, studentOrId, groupOrId = "") {
  const students = Array.isArray(state?.students) ? state.students : [];
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const student = typeof studentOrId === "object" ? studentOrId : students.find((item) => item.id === studentOrId);
  const group = typeof groupOrId === "object" ? groupOrId : groups.find((item) => item.id === groupOrId);
  if (finiteNumber(student?.customHourlyRate)) return student.customHourlyRate;
  if (finiteNumber(group?.hourlyRate)) return group.hourlyRate;
  return finiteNumber(state?.settings?.hourlyRate) ? state.settings.hourlyRate : null;
}

function resolvedSlot(state, group, slot, date) {
  const changes = (state.scheduleChanges || [])
    .filter((change) => change.groupId === group.id && change.scheduleSlotId === slot.id && change.effectiveFrom <= date)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  return changes.length ? { ...slot, ...changes.at(-1) } : slot;
}

function occurrenceId(groupId, scheduleSlotId, occurrenceDate) {
  return `${groupId}:${scheduleSlotId}:${occurrenceDate}`;
}

function daysBetween(left, right) {
  return Math.round((parseDateOnly(right).getTime() - parseDateOnly(left).getTime()) / 86400000);
}

function classScheduleOccursOn(schedule, date) {
  if (date < schedule.startDate) return false;
  if (schedule.endDate && date > schedule.endDate) return false;
  if (schedule.recurrence === "once") return date === schedule.startDate;
  if (!(schedule.daysOfWeek || []).includes(dayOfWeekForDate(date))) return false;
  return Math.floor(daysBetween(schedule.startDate, date) / 7) % Math.max(1, Number(schedule.intervalWeeks) || 1) === 0;
}

function exceptionSourceKey(item) {
  if (item.classScheduleId) return `class:${item.classScheduleId}:${item.occurrenceDate}`;
  const groupId = item.sourceGroupId || item.groupId;
  const scheduleSlotId = item.sourceScheduleSlotId || item.scheduleSlotId;
  return `group:${groupId}:${scheduleSlotId}:${item.occurrenceDate}`;
}

function targetOwner(state, source, exception = null) {
  const format = exception?.format || source.format || (source.studentId ? "individual" : "group");
  const groupId = format === "group" ? (exception?.groupId || source.groupId || "") : "";
  const studentId = format === "individual" ? (exception?.studentId || source.studentId || "") : "";
  const group = format === "group" ? (state.groups || []).find((item) => item.id === groupId) : null;
  const student = format === "individual" ? (state.students || []).find((item) => item.id === studentId) : null;
  if ((format === "group" && !group) || (format === "individual" && !student)) return null;
  return {
    format,
    groupId,
    studentId,
    groupName: group?.name || student?.fullName || "",
    studentName: student?.fullName || "",
    participantMode: exception?.participantMode || source.participantMode || "default",
    participantIds: exception?.participantMode === "custom"
      ? [...(exception.participantIds || [])]
      : source.participantMode === "custom" ? [...(source.participantIds || [])] : [],
  };
}

function hasRecordedRows(classLog, occurrence) {
  return classLog.some((row) => row.classDate === occurrence.classDate
    && (row.startTime || "") === (occurrence.startTime || "")
    && (occurrence.format === "group" ? row.groupId === occurrence.groupId : row.studentId === occurrence.studentId));
}

export function generateScheduledOccurrences(state, startDate, endDate) {
  if (!isDateOnly(startDate) || !isDateOnly(endDate) || startDate > endDate) return [];
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const exceptions = Array.isArray(state?.scheduleExceptions) ? state.scheduleExceptions : [];
  const classLog = Array.isArray(state?.classLog) ? state.classLog : [];
  const classSchedules = Array.isArray(state?.classSchedules) ? state.classSchedules : [];
  const exceptionByKey = new Map(exceptions
    .filter((item) => item.kind !== "added")
    .map((item) => [exceptionSourceKey(item), item]));
  const result = [];
  const scanStart = addDays(startDate, -7);
  const scanEnd = addDays(endDate, 7);

  for (const group of groups) {
    for (const slot of group.weeklySchedule || []) {
      for (let date = scanStart; date <= scanEnd; date = addDays(date, 1)) {
        const rule = resolvedSlot(state, group, slot, date);
        if (rule.status === "Cancelled") continue;
        if (dayOfWeekForDate(date) !== Number(rule.dayOfWeek)) continue;
        const exception = exceptionByKey.get(`group:${group.id}:${slot.id}:${date}`);
        const owner = targetOwner(state, { format: "group", groupId: group.id }, exception);
        if (!owner) continue;
        const occurrence = {
          id: occurrenceId(group.id, slot.id, date),
          ...owner,
          sourceGroupId: group.id,
          sourceScheduleSlotId: slot.id,
          scheduleSlotId: slot.id,
          occurrenceDate: date,
          classDate: exception?.classDate || date,
          startTime: exception?.startTime || rule.startTime,
          durationHours: finiteNumber(exception?.durationHours) ? exception.durationHours : rule.durationHours,
          status: exception?.status || "Scheduled",
          kind: exception ? "override" : "recurring",
          exceptionId: exception?.id || "",
        };
        if (!isDateInRange(occurrence.classDate, startDate, endDate)) continue;
        occurrence.recorded = hasRecordedRows(classLog, occurrence);
        result.push(occurrence);
      }
    }
  }

  for (const exception of exceptions.filter((item) => item.kind === "added")) {
    if (!isDateInRange(exception.classDate, startDate, endDate)) continue;
    const owner = targetOwner(state, exception, exception);
    if (!owner) continue;
    const occurrence = {
      ...owner,
      id: exception.id,
      classScheduleId: "",
      sourceGroupId: exception.sourceGroupId || exception.groupId || "",
      sourceScheduleSlotId: exception.sourceScheduleSlotId || "",
      scheduleSlotId: "",
      occurrenceDate: exception.occurrenceDate || exception.classDate,
      classDate: exception.classDate,
      startTime: exception.startTime,
      durationHours: exception.durationHours,
      status: exception.status || "Scheduled",
      kind: "added",
      exceptionId: exception.id,
    };
    occurrence.recorded = hasRecordedRows(classLog, occurrence);
    result.push({
      ...occurrence,
    });
  }

  for (const schedule of classSchedules) {
    const baseOwner = targetOwner(state, schedule);
    if (!baseOwner) continue;
    const from = schedule.startDate > scanStart ? schedule.startDate : scanStart;
    for (let date = from; date <= scanEnd; date = addDays(date, 1)) {
      if (!classScheduleOccursOn(schedule, date)) continue;
      const exception = exceptionByKey.get(`class:${schedule.id}:${date}`);
      const owner = targetOwner(state, schedule, exception);
      if (!owner) continue;
      const occurrence = {
        id: `${schedule.id}:${date}`,
        classScheduleId: schedule.id,
        ...owner,
        scheduleSlotId: schedule.id,
        occurrenceDate: date,
        classDate: exception?.classDate || date,
        startTime: exception?.startTime || schedule.startTime,
        durationHours: finiteNumber(exception?.durationHours) ? exception.durationHours : schedule.durationHours,
        status: exception?.status || "Scheduled",
        kind: exception ? "override" : schedule.recurrence === "weekly" ? "recurring" : "added",
        exceptionId: exception?.id || "",
      };
      if (!isDateInRange(occurrence.classDate, startDate, endDate)) continue;
      occurrence.recorded = hasRecordedRows(classLog, occurrence);
      result.push(occurrence);
    }
  }

  // A one-off occurrence can be moved farther than the normal scan padding.
  // Materialize it from its source rule so it remains visible in the target month.
  for (const exception of exceptions.filter((item) => item.kind !== "added" && isDateInRange(item.classDate, startDate, endDate))) {
    let source = null;
    let id = "";
    if (exception.classScheduleId) {
      source = classSchedules.find((item) => item.id === exception.classScheduleId) || null;
      if (!source || !classScheduleOccursOn(source, exception.occurrenceDate)) continue;
      id = `${source.id}:${exception.occurrenceDate}`;
    } else {
      const sourceGroupId = exception.sourceGroupId || exception.groupId;
      const sourceSlotId = exception.sourceScheduleSlotId || exception.scheduleSlotId;
      const sourceGroup = groups.find((item) => item.id === sourceGroupId);
      const sourceSlot = sourceGroup?.weeklySchedule?.find((item) => item.id === sourceSlotId);
      if (!sourceGroup || !sourceSlot) continue;
      source = { ...sourceSlot, format: "group", groupId: sourceGroup.id };
      id = occurrenceId(sourceGroup.id, sourceSlot.id, exception.occurrenceDate);
    }
    if (result.some((item) => item.id === id)) continue;
    const owner = targetOwner(state, source, exception);
    if (!owner) continue;
    const occurrence = {
      id,
      ...owner,
      classScheduleId: exception.classScheduleId || "",
      sourceGroupId: exception.sourceGroupId || source.groupId || "",
      sourceScheduleSlotId: exception.sourceScheduleSlotId || source.id || "",
      scheduleSlotId: exception.classScheduleId || exception.sourceScheduleSlotId || exception.scheduleSlotId || "",
      occurrenceDate: exception.occurrenceDate,
      classDate: exception.classDate,
      startTime: exception.startTime,
      durationHours: exception.durationHours,
      status: exception.status || "Scheduled",
      kind: "override",
      exceptionId: exception.id,
    };
    occurrence.recorded = hasRecordedRows(classLog, occurrence);
    result.push(occurrence);
  }

  return result
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((left, right) => left.classDate.localeCompare(right.classDate) || left.startTime.localeCompare(right.startTime));
}
