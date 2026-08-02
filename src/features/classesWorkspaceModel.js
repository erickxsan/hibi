import { addDays, todayDateOnly } from "../domain/dates";
import { generateScheduledOccurrences } from "../domain/schedule";

function studentGroupIds(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}

export function classWorkspaceSessionKey(item = {}) {
  const owner = item.groupId ? `g:${item.groupId}` : `s:${item.studentId || "unknown"}`;
  return `${item.classDate || ""}|${owner}|${item.startTime || ""}`;
}

function scheduledStatus(session, asOfDate) {
  if (session.rows?.some((row) => row.classStatus === "Cancelled") || session.status === "Cancelled") return "Cancelled";
  if (session.rows?.some((row) => row.classStatus === "Completed")) return "Registered";
  if (session.kind === "override" && session.occurrenceDate && session.occurrenceDate !== session.classDate) return "Rescheduled";
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
    .sort((left, right) => left.classDate.localeCompare(right.classDate) || (left.startTime || "").localeCompare(right.startTime || "") || left.title.localeCompare(right.title));
}

export function buildClassWorkspaceSessions(state = {}, asOfDate = todayDateOnly()) {
  const classLog = Array.isArray(state.classLog) ? state.classLog : [];
  const occurrences = generateScheduledOccurrences(state, addDays(asOfDate, -180), addDays(asOfDate, 60));
  return assembleSessions(state, occurrences, classLog, asOfDate);
}

export function buildClassWorkspaceSessionsForRange(state = {}, startDate, endDate, asOfDate = todayDateOnly()) {
  const occurrences = generateScheduledOccurrences(state, startDate, endDate);
  const classLog = (Array.isArray(state.classLog) ? state.classLog : [])
    .filter((row) => row?.classDate >= startDate && row?.classDate <= endDate);
  return assembleSessions(state, occurrences, classLog, asOfDate);
}

export function selectPrimaryClassSession(sessions = [], asOfDate = todayDateOnly(), nowTime = "23:59") {
  const available = sessions.filter((session) => !["Registered", "Cancelled"].includes(session.statusLabel));
  const today = available.filter((session) => session.classDate === asOfDate);
  const nextToday = today.find((session) => (session.startTime || "00:00") > nowTime);
  if (nextToday) return nextToday;

  const pendingToday = today.filter((session) => (session.startTime || "00:00") <= nowTime).at(-1);
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
  const needle = String(filters.search || "").trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    if (session.statusLabel === "Scheduled") return false;
    const hasSavedRows = Array.isArray(session.rows) && session.rows.length > 0;
    const isExplicitScheduleEvent = ["Cancelled", "Rescheduled"].includes(session.statusLabel);
    if (!hasSavedRows && !isExplicitScheduleEvent) return false;
    if (needle && !`${session.title} ${session.groupName || ""} ${session.studentName || ""}`.toLocaleLowerCase().includes(needle)) return false;
    if (filters.dateFrom && session.classDate < filters.dateFrom) return false;
    if (filters.dateTo && session.classDate > filters.dateTo) return false;
    if (filters.ownerId && session.groupId !== filters.ownerId && session.studentId !== filters.ownerId) return false;
    if (filters.status && session.statusLabel !== filters.status) return false;
    return true;
  }).sort((left, right) => right.classDate.localeCompare(left.classDate) || (right.startTime || "").localeCompare(left.startTime || ""));
}
