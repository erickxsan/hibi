import { addDays } from "../domain/dates";
import { formatTime, formatTimeRange, weekdayLong, weekdayShort } from "../utils/displayFormat";

// 2024-01-01 is a Monday; stored weekdays use 1 = Monday … 7 = Sunday.
const dateForWeekday = (day) => addDays("2024-01-01", (Number(day) || 1) - 1);

/** Three-letter mark for a group («PRE», «SEC») or its short code («5A»). */
export function groupMark(name = "") {
  const code = String(name).match(/\b\d+[A-Za-z]?\b/);
  if (code && code[0].length <= 3) return code[0].toUpperCase();
  const letters = String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "");
  return letters.slice(0, 3).toUpperCase() || "—";
}

function sortedSlots(group) {
  return [...(group?.weeklySchedule || [])].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || String(a.startTime).localeCompare(String(b.startTime)),
  );
}

function joinDays(days, locale, long) {
  const names = [...new Set(days)].map((day) => (long ? weekdayLong : weekdayShort)(dateForWeekday(day), locale));
  return new Intl.ListFormat(locale, { type: "conjunction", style: long ? "long" : "short" }).format(names);
}

/** «mar y vie · 5:00 p. m.» */
export function groupScheduleShort(group, locale) {
  const slots = sortedSlots(group);
  if (!slots.length) return "";
  return `${joinDays(
    slots.map((slot) => slot.dayOfWeek),
    locale,
    false,
  )} · ${formatTime(slots[0].startTime, locale)}`;
}

/** «Lunes y jueves · 4:00 – 6:00 p. m.» */
export function groupScheduleLong(group, locale) {
  const slots = sortedSlots(group);
  if (!slots.length) return "";
  const days = joinDays(
    slots.map((slot) => slot.dayOfWeek),
    locale,
    true,
  );
  return `${days.charAt(0).toUpperCase()}${days.slice(1)} · ${formatTimeRange(slots[0].startTime, slots[0].durationHours, locale)}`;
}

/** «Lunes y jueves» */
export function groupDaysLong(group, locale) {
  const slots = sortedSlots(group);
  if (!slots.length) return "";
  const days = joinDays(
    slots.map((slot) => slot.dayOfWeek),
    locale,
    true,
  );
  return `${days.charAt(0).toUpperCase()}${days.slice(1)}`;
}

export function activeGroupMembers(state, groupId) {
  return (state.students || []).filter(
    (student) =>
      student.status !== "Inactive" &&
      (Array.isArray(student.groupIds) ? student.groupIds : student.groupId ? [student.groupId] : []).includes(groupId),
  );
}

export function studentGroupIdsOf(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}
