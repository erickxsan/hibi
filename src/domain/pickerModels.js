import { addDays, addMonths, endOfMonth, isDateOnly, parseDateOnly, startOfMonth, startOfWeek } from "./dates.js";

export const RECURRENCE_LIMITS = Object.freeze({ daily: 14, weekly: 8, monthly: 12 });
export const WEEKDAY_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 0]);

/** Normalize picker values without changing stored schedules or legacy weekday IDs (1–7).
 * @param {{kind?: string, startDate?: string, anchorDate?: string, interval?: number|string, intervalWeeks?: number, days?: number[], daysOfWeek?: number[], dailyMode?: string, monthlyMode?: string}|null} value
 */
export function normalizeRecurrence(value = {}, startDate = value?.startDate) {
  const source = value && typeof value === "object" ? value : {};
  const kind = Object.hasOwn(RECURRENCE_LIMITS, source.kind) ? source.kind : "weekly";
  const date = isDateOnly(source.startDate) ? source.startDate : isDateOnly(startDate) ? startDate : "";
  const interval = Math.min(
    RECURRENCE_LIMITS[kind],
    Math.max(1, Math.trunc(Number(source.interval ?? source.intervalWeeks)) || 1),
  );
  const days = Array.isArray(source.days)
    ? source.days
    : Array.isArray(source.daysOfWeek)
      ? source.daysOfWeek.map((day) => (day === 7 ? 0 : day))
      : date
        ? [parseDateOnly(date).getUTCDay()]
        : [];
  return {
    kind,
    interval,
    startDate: date,
    days: WEEKDAY_ORDER.filter((day) => days.includes(day)),
    dailyMode: source.dailyMode === "weekdays" ? "weekdays" : "all",
    monthlyMode: source.monthlyMode === "nthWeekday" ? "nthWeekday" : "dayOfMonth",
    ...(isDateOnly(source.anchorDate)
      ? { anchorDate: source.anchorDate }
      : Array.isArray(source.daysOfWeek) && date
        ? { anchorDate: date }
        : {}),
  };
}

export function nextRecurrenceDates(value, count = 4) {
  const rule = normalizeRecurrence(value);
  if (!rule.startDate || count <= 0 || (rule.kind === "weekly" && !rule.days.length)) return [];
  const start = parseDateOnly(rule.startDate);
  const result = [];
  const limit = Math.min(3660, Math.max(0, Math.trunc(count)));
  if (rule.kind === "monthly") {
    for (let offset = 0; result.length < limit && offset < limit * rule.interval * 24; offset += rule.interval) {
      const month = addMonths(rule.startDate, offset);
      const last = parseDateOnly(endOfMonth(month));
      let day = start.getUTCDate();
      if (rule.monthlyMode === "nthWeekday") {
        const weekday = start.getUTCDay();
        const nth = Math.ceil(day / 7);
        day =
          nth === 5
            ? last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
            : 1 + ((weekday - parseDateOnly(month).getUTCDay() + 7) % 7) + (nth - 1) * 7;
      }
      if (day > last.getUTCDate()) continue;
      const date = addDays(month, day - 1);
      if (date >= rule.startDate) result.push(date);
    }
    return result;
  }
  const anchor = rule.anchorDate || startOfWeek(rule.startDate);
  for (
    let offset = 0;
    result.length < limit && offset < limit * 112 + 14;
    offset += rule.kind === "daily" ? rule.interval : 1
  ) {
    const date = addDays(rule.startDate, offset);
    const day = parseDateOnly(date).getUTCDay();
    if (rule.kind === "daily") {
      if (rule.dailyMode === "all" || (day > 0 && day < 6)) result.push(date);
    } else {
      const week = Math.floor((parseDateOnly(date).getTime() - parseDateOnly(anchor).getTime()) / 604800000);
      if (week % rule.interval === 0 && rule.days.includes(day)) result.push(date);
    }
  }
  return result;
}

export function calendarDays(month) {
  if (!isDateOnly(month)) return [];
  const first = startOfMonth(month);
  const gridStart = startOfWeek(first);
  const cells = Math.max(
    35,
    Math.ceil((((parseDateOnly(first).getUTCDay() + 6) % 7) + parseDateOnly(endOfMonth(first)).getUTCDate()) / 7) * 7,
  );
  return Array.from({ length: cells }, (_, index) => addDays(gridStart, index));
}

export function timeToMinutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value) {
  const minutes = ((Math.trunc(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function slotAvailability(start, duration = 60, busy = [], min = 480, max = 1260) {
  const inRange =
    Number.isFinite(start) && Number.isFinite(duration) && duration > 0 && start >= min && start + duration <= max;
  const conflicts = busy.filter((block) => start < block.end && start + duration > block.start);
  return { inRange, conflicts, available: inRange && !conflicts.length };
}

export function hourAvailability(hour, duration = 60, busy = [], min = 480, max = 1260) {
  const quarters = [0, 15, 30, 45].map((minute) => hour * 60 + minute);
  const within = quarters.filter((minute) => slotAvailability(minute, duration, busy, min, max).inRange);
  const free = within.filter((minute) => slotAvailability(minute, duration, busy, min, max).available);
  return { off: !within.length, busy: Boolean(within.length && !free.length), firstFree: free[0] ?? null };
}

export function clockPoint(degrees, radius = 88) {
  return {
    x: 120 + radius * Math.sin((degrees * Math.PI) / 180),
    y: 120 - radius * Math.cos((degrees * Math.PI) / 180),
  };
}

export function clockArc(start, end, base = 0) {
  const from = Math.max(start, base);
  const to = Math.min(end, base + 720);
  if (to <= from) return "";
  const degrees = Math.min(359.99, (to - base) / 2);
  const p1 = clockPoint((from - base) / 2, 112);
  const p2 = clockPoint(degrees, 112);
  return `M${p1.x} ${p1.y} A112 112 0 ${degrees - (from - base) / 2 > 180 ? 1 : 0} 1 ${p2.x} ${p2.y}`;
}

export function pickerDateLabel(value, locale, options = {}) {
  return isDateOnly(value)
    ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }).format(parseDateOnly(value))
    : "";
}
