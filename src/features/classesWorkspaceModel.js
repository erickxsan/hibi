import { addDays, todayDateOnly } from "../domain/dates";
import { generateScheduledOccurrences } from "../domain/schedule";
import { classSessionIdentity } from "../domain/semanticIdentity";
import { isGroupArchived } from "../domain/groupArchiving";
import { minutesFromTime } from "./classesCalendarModel";

function studentGroupIds(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}

/** Status word and dot for each workspace status. */
export const STATUS_LOOK = {
  Registered: { label: "Completed", className: "st-done" },
  Pending: { label: "Not recorded", className: "st-pend" },
  Cancelled: { label: "Cancelled", className: "st-prog" },
  Rescheduled: { label: "Rescheduled", className: "st-prog" },
  Scheduled: { label: "Scheduled", className: "st-prog" },
  Live: { label: "In progress", className: "st-next" },
};

/**
 * A class's status at this moment, the same word Inicio's timeline uses: a class of today that already
 * ended without a record is «Sin registrar» and one under way is «En curso», instead of «Programada»
 * until midnight. Only for display; `statusLabel` keeps the day-based status the rest of the app reads.
 */
export function classMomentStatus(session, asOfDate, nowTime) {
  const status = session?.statusLabel;
  if (
    !["Scheduled", "Rescheduled"].includes(status) ||
    session.classDate !== asOfDate ||
    !session.startTime ||
    !nowTime
  )
    return status;
  const start = minutesFromTime(session.startTime);
  const now = minutesFromTime(nowTime);
  if (start + Math.round((Number(session.durationHours) || 0) * 60) <= now) return "Pending";
  return start <= now ? "Live" : status;
}

export function classWorkspaceSessionKey(item = {}) {
  return classSessionIdentity(item);
}

function scheduledStatus(session, asOfDate) {
  if (session.rows?.some((row) => row.classStatus === "Cancelled") || session.status === "Cancelled")
    return "Cancelled";
  if (session.rows?.some((row) => row.classStatus === "Completed")) return "Registered";
  if (session.kind === "override" && session.occurrenceDate && session.occurrenceDate !== session.classDate)
    return "Rescheduled";
  return session.classDate < asOfDate ? "Pending" : "Scheduled";
}

function assembleSessions(state, occurrences, classLog, asOfDate) {
  const students = Array.isArray(state.students) ? state.students : [];
  const groups = Array.isArray(state.groups) ? state.groups : [];
  const studentsById = new Map(students.map((student) => [student.id, student]));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const sessions = new Map();

  for (const occurrence of occurrences) {
    const format = occurrence.format || (occurrence.studentId ? "individual" : "group");
    const key = classWorkspaceSessionKey(occurrence);
    sessions.set(key, {
      ...occurrence,
      key,
      format,
      rows: [],
      title: occurrence.groupName || occurrence.studentName || "Class",
    });
  }

  for (const row of classLog) {
    if (!row?.classDate || !row?.studentId) continue;
    const student = studentsById.get(row.studentId);
    const groupId = row.groupId || "";
    const group = groupsById.get(groupId);
    if (
      isGroupArchived(group) &&
      (row.classDate > asOfDate || (row.classDate === asOfDate && row.classStatus !== "Completed"))
    )
      continue;
    const key = classWorkspaceSessionKey({ ...row, groupId, studentId: groupId ? "" : row.studentId });
    const current = sessions.get(key) || {
      key,
      classDate: row.classDate,
      startTime: row.startTime || "",
      durationHours: row.hours ?? state.settings?.defaultClassHours ?? 2,
      groupId,
      studentId: groupId ? "" : row.studentId,
      groupName: group?.name || "",
      studentName: groupId ? "" : student?.fullName || "",
      title: group?.name || student?.fullName || row.classTitle || "Individual class",
      format: groupId ? "group" : "individual",
      kind: row.scheduleSlotId ? "recurring" : "added",
      occurrenceDate: row.scheduleOccurrenceDate || row.classDate,
      scheduleSlotId: row.scheduleSlotId || "",
      rows: [],
    };
    current.rows = [...(current.rows || []), row];
    if (!current.durationHours && row.hours != null) current.durationHours = row.hours;
    sessions.set(key, current);
  }

  return [...sessions.values()]
    .map((session) => ({ ...session, statusLabel: scheduledStatus(session, asOfDate) }))
    .sort(
      (left, right) =>
        left.classDate.localeCompare(right.classDate) ||
        (left.startTime || "").localeCompare(right.startTime || "") ||
        left.title.localeCompare(right.title),
    );
}

export function buildClassWorkspaceSessions(state = {}, asOfDate = todayDateOnly()) {
  const classLog = Array.isArray(state.classLog) ? state.classLog : [];
  const occurrences = generateScheduledOccurrences(state, addDays(asOfDate, -180), addDays(asOfDate, 60));
  return assembleSessions(state, occurrences, classLog, asOfDate);
}

export function buildClassWorkspaceSessionsForRange(state = {}, startDate, endDate, asOfDate = todayDateOnly()) {
  const occurrences = generateScheduledOccurrences(state, startDate, endDate);
  const classLog = (Array.isArray(state.classLog) ? state.classLog : []).filter(
    (row) => row?.classDate >= startDate && row?.classDate <= endDate,
  );
  return assembleSessions(state, occurrences, classLog, asOfDate);
}

export function selectPrimaryClassSession(sessions = [], asOfDate = todayDateOnly(), nowTime = "23:59") {
  const available = sessions.filter((session) => !["Registered", "Cancelled"].includes(session.statusLabel));
  const today = available.filter((session) => session.classDate === asOfDate);
  const nowMinutes = minutesFromTime(nowTime);
  const activeToday = today
    .filter((session) => {
      const durationMinutes = Number(session.durationHours) * 60;
      const startMinutes = minutesFromTime(session.startTime);
      return (
        session.startTime &&
        durationMinutes > 0 &&
        startMinutes <= nowMinutes &&
        nowMinutes < startMinutes + durationMinutes
      );
    })
    .at(-1);
  if (activeToday) return activeToday;

  const nextToday = today.find((session) => minutesFromTime(session.startTime) > nowMinutes);
  if (nextToday) return nextToday;

  const pendingToday = today.filter((session) => minutesFromTime(session.startTime) <= nowMinutes).at(-1);
  if (pendingToday) return pendingToday;

  return available.find((session) => session.classDate > asOfDate) || null;
}

export function rosterForClassSession(state = {}, session) {
  if (!session) return [];
  const students = Array.isArray(state.students) ? state.students : [];
  const savedStudentIds = [...new Set((session.rows || []).map((row) => row.studentId).filter(Boolean))];
  if (savedStudentIds.length) {
    const savedOrder = new Map(savedStudentIds.map((id, index) => [id, index]));
    return students
      .filter((student) => savedOrder.has(student.id))
      .sort((left, right) => savedOrder.get(left.id) - savedOrder.get(right.id));
  }
  if (session.participantMode === "custom") {
    const participantIds = new Set(session.participantIds || []);
    return students
      .filter((student) => participantIds.has(student.id))
      .sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
  }
  if (session.format === "individual") {
    const student = students.find((item) => item.id === session.studentId);
    return student ? [student] : [];
  }
  return students
    .filter((student) => student.status !== "Inactive" && studentGroupIds(student).includes(session.groupId))
    .sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
}

export function paymentRecordState(row, charge = 0) {
  if (["Paid", "Pending", "Unpaid"].includes(row?.paymentState)) return row.paymentState;
  return Number(row?.amountPaid || 0) >= charge && charge > 0 ? "Paid" : "Pending";
}

export function filterClassHistory(sessions = [], filters = {}) {
  const needle = String(filters.search || "")
    .trim()
    .toLocaleLowerCase();
  return sessions
    .filter((session) => {
      if (session.statusLabel === "Scheduled") return false;
      const hasSavedRows = Array.isArray(session.rows) && session.rows.length > 0;
      const isExplicitScheduleEvent = ["Cancelled", "Rescheduled"].includes(session.statusLabel);
      if (!hasSavedRows && !isExplicitScheduleEvent) return false;
      if (
        needle &&
        !`${session.title} ${session.groupName || ""} ${session.studentName || ""}`.toLocaleLowerCase().includes(needle)
      )
        return false;
      if (filters.dateFrom && session.classDate < filters.dateFrom) return false;
      if (filters.dateTo && session.classDate > filters.dateTo) return false;
      if (filters.ownerId && session.groupId !== filters.ownerId && session.studentId !== filters.ownerId) return false;
      if (filters.status && session.statusLabel !== filters.status) return false;
      return true;
    })
    .sort(
      (left, right) =>
        right.classDate.localeCompare(left.classDate) || (right.startTime || "").localeCompare(left.startTime || ""),
    );
}

/**
 * Weekly slots a group already repeats on from `fromDate`: its weekly schedule (with any schedule change
 * already in effect) plus the recurring class series created for it from «Nueva clase». Weekdays use the
 * stored numbering, 1 = Monday … 7 = Sunday.
 * @returns {{ source: "weekly" | "series", dayOfWeek: number, startTime: string, durationHours: number }[]}
 */
export function groupRecurringSlots(state = {}, groupId = "", fromDate = todayDateOnly()) {
  if (!groupId) return [];
  const group = (Array.isArray(state.groups) ? state.groups : []).find((item) => item.id === groupId);
  const changes = Array.isArray(state.scheduleChanges) ? state.scheduleChanges : [];
  /** @type {{ source: "weekly" | "series", dayOfWeek: number, startTime: string, durationHours: number }[]} */
  const slots = [];
  for (const slot of group?.weeklySchedule || []) {
    const change = changes
      .filter((item) => item.groupId === groupId && item.scheduleSlotId === slot.id && item.effectiveFrom <= fromDate)
      .sort((left, right) => String(left.effectiveFrom).localeCompare(String(right.effectiveFrom)))
      .at(-1);
    const resolved = change ? { ...slot, ...change } : slot;
    if (resolved.status === "Cancelled") continue;
    slots.push({
      source: "weekly",
      dayOfWeek: Number(resolved.dayOfWeek),
      startTime: resolved.startTime,
      durationHours: Number(resolved.durationHours) || 0,
    });
  }
  for (const schedule of Array.isArray(state.classSchedules) ? state.classSchedules : []) {
    if (schedule.groupId !== groupId || schedule.format === "individual" || schedule.recurrence === "once") continue;
    if (schedule.status === "Cancelled" || (schedule.endDate && schedule.endDate < fromDate)) continue;
    // Monthly series do not hold a weekly slot.
    if (schedule.repeatRule?.kind === "monthly") continue;
    for (const day of schedule.daysOfWeek || []) {
      slots.push({
        source: "series",
        dayOfWeek: Number(day),
        startTime: schedule.startTime,
        durationHours: Number(schedule.durationHours) || 0,
      });
    }
  }
  return slots.sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.startTime.localeCompare(right.startTime));
}

/**
 * Existing slots that a new recurring class of the same group would repeat: same weekday and same start time.
 * `days` uses the picker numbering (0 = Sunday … 6 = Saturday).
 */
export function duplicateRecurringSlots(slots = [], { days = [], startTime = "" } = {}) {
  const isoDays = new Set(days.map((day) => (Number(day) === 0 ? 7 : Number(day))));
  return slots.filter((slot) => isoDays.has(slot.dayOfWeek) && slot.startTime === startTime);
}
