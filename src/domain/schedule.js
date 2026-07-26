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
  if (schedule.recurrence === "once") return date === schedule.startDate;
  if (!(schedule.daysOfWeek || []).includes(dayOfWeekForDate(date))) return false;
  return Math.floor(daysBetween(schedule.startDate, date) / 7) % Math.max(1, Number(schedule.intervalWeeks) || 1) === 0;
}

export function generateScheduledOccurrences(state, startDate, endDate) {
  if (!isDateOnly(startDate) || !isDateOnly(endDate) || startDate > endDate) return [];
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const exceptions = Array.isArray(state?.scheduleExceptions) ? state.scheduleExceptions : [];
  const classLog = Array.isArray(state?.classLog) ? state.classLog : [];
  const classSchedules = Array.isArray(state?.classSchedules) ? state.classSchedules : [];
  const exceptionByKey = new Map(exceptions
    .filter((item) => item.kind !== "added")
    .map((item) => [`${item.groupId}:${item.scheduleSlotId}:${item.occurrenceDate}`, item]));
  const result = [];
  const scanStart = addDays(startDate, -7);
  const scanEnd = addDays(endDate, 7);

  for (const group of groups) {
    for (const slot of group.weeklySchedule || []) {
      for (let date = scanStart; date <= scanEnd; date = addDays(date, 1)) {
        const rule = resolvedSlot(state, group, slot, date);
        if (dayOfWeekForDate(date) !== Number(rule.dayOfWeek)) continue;
        const exception = exceptionByKey.get(`${group.id}:${slot.id}:${date}`);
        const occurrence = {
          id: occurrenceId(group.id, slot.id, date),
          groupId: group.id,
          groupName: group.name,
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
        occurrence.recorded = classLog.some((row) => row.groupId === group.id
          && row.classDate === occurrence.classDate
          && (row.startTime || "") === (occurrence.startTime || ""));
        result.push(occurrence);
      }
    }
  }

  for (const exception of exceptions.filter((item) => item.kind === "added")) {
    if (!isDateInRange(exception.classDate, startDate, endDate)) continue;
    const group = groups.find((item) => item.id === exception.groupId);
    if (!group) continue;
    result.push({
      id: exception.id,
      groupId: group.id,
      groupName: group.name,
      scheduleSlotId: "",
      occurrenceDate: exception.occurrenceDate || exception.classDate,
      classDate: exception.classDate,
      startTime: exception.startTime,
      durationHours: exception.durationHours,
      status: exception.status || "Scheduled",
      kind: "added",
      exceptionId: exception.id,
      recorded: classLog.some((row) => row.groupId === group.id
        && row.classDate === exception.classDate
        && (row.startTime || "") === (exception.startTime || "")),
    });
  }

  for (const schedule of classSchedules) {
    const group = schedule.format === "group" ? groups.find((item) => item.id === schedule.groupId) : null;
    const student = schedule.format === "individual"
      ? (state.students || []).find((item) => item.id === schedule.studentId)
      : null;
    if ((schedule.format === "group" && !group) || (schedule.format === "individual" && !student)) continue;
    const from = schedule.startDate > startDate ? schedule.startDate : startDate;
    for (let date = from; date <= endDate; date = addDays(date, 1)) {
      if (!classScheduleOccursOn(schedule, date)) continue;
      const recorded = classLog.some((row) => row.classDate === date
        && (row.startTime || "") === (schedule.startTime || "")
        && (schedule.format === "group" ? row.groupId === schedule.groupId : row.studentId === schedule.studentId));
      result.push({
        id: `${schedule.id}:${date}`,
        classScheduleId: schedule.id,
        groupId: schedule.groupId || "",
        groupName: group?.name || student?.fullName || "",
        studentId: schedule.studentId || "",
        studentName: student?.fullName || "",
        format: schedule.format,
        scheduleSlotId: schedule.id,
        occurrenceDate: date,
        classDate: date,
        startTime: schedule.startTime,
        durationHours: schedule.durationHours,
        status: "Scheduled",
        kind: schedule.recurrence === "weekly" ? "recurring" : "added",
        recorded,
      });
    }
  }

  return result
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((left, right) => left.classDate.localeCompare(right.classDate) || left.startTime.localeCompare(right.startTime));
}
