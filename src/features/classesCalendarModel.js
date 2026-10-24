import { addDays, endOfMonth, parseDateOnly, startOfMonth, startOfWeek } from "../domain/dates";

export function calendarMonthRange(anchorDate) {
  const monthStart = startOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart, 0);
  const monthEnd = endOfMonth(anchorDate);
  const trailingDays = (6 - parseDateOnly(monthEnd).getUTCDay() + 7) % 7;
  return { startDate: gridStart, endDate: addDays(monthEnd, trailingDays) };
}

export function calendarMonthDays(anchorDate) {
  const { startDate, endDate } = calendarMonthRange(anchorDate);
  const days = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) days.push(date);
  return days;
}

export function calendarWeekRange(anchorDate) {
  const startDate = startOfWeek(anchorDate, 1);
  return { startDate, endDate: addDays(startDate, 6) };
}

export function calendarWeekDays(anchorDate) {
  const { startDate } = calendarWeekRange(anchorDate);
  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
}

export function filterCalendarSessions(sessions = [], { search = "", ownerId = "" } = {}) {
  const needle = String(search).trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    if (ownerId && session.groupId !== ownerId && session.studentId !== ownerId) return false;
    if (!needle) return true;
    return `${session.title || ""} ${session.groupName || ""} ${session.studentName || ""}`
      .toLocaleLowerCase()
      .includes(needle);
  });
}

export function groupCalendarSessionsByDate(sessions = []) {
  const grouped = new Map();
  for (const session of sessions) {
    if (!grouped.has(session.classDate)) grouped.set(session.classDate, []);
    grouped.get(session.classDate).push(session);
  }
  return grouped;
}

export function calendarSessionTone(session = {}) {
  const value = String(session.groupId || session.studentId || session.title || "class");
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return ["green", "amber", "blue", "lavender"][Math.abs(hash) % 4];
}

export function minutesFromTime(value = "00:00") {
  const [hours = 0, minutes = 0] = String(value).split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

/**
 * Start time short enough to sit in front of a class name in the month grid: «4p», «10:30a», «12p».
 * It is styled apart from the name (and the full time goes in the tooltip and accessible name), so it
 * never reads like a count. Empty for a missing or malformed time.
 */
export function compactClock(value = "") {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value));
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return `${hours % 12 || 12}${minutes ? `:${match[2]}` : ""}${hours >= 12 ? "p" : "a"}`;
}
