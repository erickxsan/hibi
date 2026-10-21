import { endOfMonth, isDateOnly, parseDateOnly } from "./dates.js";

/*
 * Daily and monthly repetition for class schedules.
 *
 * Persistence keeps `recurrence: "weekly"` for every repeating schedule so older
 * clients still see a repeating series. The optional `repeatRule` refines it:
 *   { kind: "daily" | "monthly", interval, dailyMode: "all" | "weekdays", monthlyMode: "dayOfMonth" | "nthWeekday" }
 * Weekly schedules carry no repeatRule, exactly as before.
 */
export const REPEAT_RULE_LIMITS = Object.freeze({ daily: 14, monthly: 12 });

function clampInterval(kind, value) {
  return Math.min(REPEAT_RULE_LIMITS[kind], Math.max(1, Math.trunc(Number(value)) || 1));
}

/** Returns a canonical rule, or null when the value does not describe daily or monthly repetition. */
export function normalizeRepeatRule(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(REPEAT_RULE_LIMITS, value.kind)) return null;
  return value.kind === "daily"
    ? {
        kind: "daily",
        interval: clampInterval("daily", value.interval),
        dailyMode: value.dailyMode === "weekdays" ? "weekdays" : "all",
      }
    : {
        kind: "monthly",
        interval: clampInterval("monthly", value.interval),
        monthlyMode: value.monthlyMode === "nthWeekday" ? "nthWeekday" : "dayOfMonth",
      };
}

function isoWeekday(date) {
  const day = parseDateOnly(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysBetween(left, right) {
  return Math.round((parseDateOnly(right).getTime() - parseDateOnly(left).getTime()) / 86400000);
}

function monthsBetween(left, right) {
  const a = parseDateOnly(left);
  const b = parseDateOnly(right);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
}

/** «El 3.er sábado»: 1–4, or 5 for «el último». */
export function nthWeekdayOf(date) {
  return Math.min(5, Math.ceil(parseDateOnly(date).getUTCDate() / 7));
}

/** The date of a monthly occurrence in the month of `month`, or "" when that month has no such day. */
export function monthlyOccurrenceIn(startDate, month, monthlyMode = "dayOfMonth") {
  const start = parseDateOnly(startDate);
  const last = parseDateOnly(endOfMonth(month));
  const monthStart = month.slice(0, 8) + "01";
  let day = start.getUTCDate();
  if (monthlyMode === "nthWeekday") {
    const weekday = start.getUTCDay();
    const nth = nthWeekdayOf(startDate);
    const firstWeekday = parseDateOnly(monthStart).getUTCDay();
    day =
      nth === 5
        ? last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
        : 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
  }
  if (day > last.getUTCDate()) return "";
  return `${monthStart.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/** True when a schedule with a daily or monthly rule has a class on `date` (bounds are checked by the caller). */
export function repeatRuleOccursOn(schedule, date) {
  const rule = normalizeRepeatRule(schedule?.repeatRule);
  if (!rule || !isDateOnly(schedule.startDate) || !isDateOnly(date) || date < schedule.startDate) return false;
  if (rule.kind === "daily") {
    if (rule.dailyMode === "weekdays" && isoWeekday(date) > 5) return false;
    return daysBetween(schedule.startDate, date) % rule.interval === 0;
  }
  if (monthsBetween(schedule.startDate, date) % rule.interval !== 0) return false;
  return monthlyOccurrenceIn(schedule.startDate, date, rule.monthlyMode) === date;
}

/**
 * Maps a picker rule ({kind, interval, days, dailyMode, monthlyMode}) to stored schedule fields.
 * Picker weekdays use 0 = Sunday; stored weekdays keep the legacy 1–7 (Sunday = 7).
 */
export function scheduleFieldsForRule(rule, startDate) {
  const kind = ["daily", "weekly", "monthly"].includes(rule?.kind) ? rule.kind : "weekly";
  const startDay = isDateOnly(startDate) ? isoWeekday(startDate) : 1;
  if (kind === "weekly") {
    const days = Array.isArray(rule?.days) ? rule.days.map((day) => (day === 0 ? 7 : Number(day))) : [startDay];
    return {
      recurrence: "weekly",
      intervalWeeks: Math.min(8, Math.max(1, Math.trunc(Number(rule?.interval)) || 1)),
      daysOfWeek: [...new Set(days)].sort((a, b) => a - b),
      repeatRule: null,
    };
  }
  const repeatRule = normalizeRepeatRule({ ...rule, kind });
  // Older clients only understand weekly repetition: keep an equivalent (daily) or close (monthly) weekly shape.
  return kind === "daily"
    ? {
        recurrence: "weekly",
        intervalWeeks: 1,
        daysOfWeek: repeatRule.dailyMode === "weekdays" ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7],
        repeatRule,
      }
    : { recurrence: "weekly", intervalWeeks: 4 * repeatRule.interval, daysOfWeek: [startDay], repeatRule };
}

/** Picker value for a stored schedule. */
export function pickerRuleForSchedule(schedule) {
  const rule = normalizeRepeatRule(schedule?.repeatRule);
  if (rule) return { ...rule, startDate: schedule.startDate };
  return {
    kind: "weekly",
    interval: Number(schedule?.intervalWeeks) || 1,
    days: (schedule?.daysOfWeek || []).map((day) => (day === 7 ? 0 : day)),
    startDate: schedule?.startDate,
    anchorDate: schedule?.recurrenceAnchorDate || schedule?.startDate,
  };
}
