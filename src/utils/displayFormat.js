import { addDays, isDateOnly, parseDateOnly } from "../domain/dates";

/*
 * Display helpers in the redesign's voice: «$2,395», «lun 12 oct», «4:00 – 6:00 p. m.».
 * All functions take the UI locale ("es-MX" or "en-MX").
 */
const cache = new Map();
function formatter(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options }));
  return cache.get(key);
}

function numberFormatter(locale, options) {
  const key = `n|${locale}|${JSON.stringify(options)}`;
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale, options));
  return cache.get(key);
}

const spanish = (locale) => String(locale).toLowerCase().startsWith("es");
const clean = (text) => String(text).replace(/\./g, "").trim();

/** «$2,395» (cents only when there are cents). */
export function formatMoney(value, locale = "es-MX") {
  const amount = Number(value) || 0;
  const cents = Math.round(Math.abs(amount) * 100) % 100 !== 0;
  const text = numberFormatter(locale, {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(Math.abs(amount));
  return `${amount < 0 ? "−" : ""}$${text}`;
}

/** «81%». */
export function formatPercent(ratio, locale = "es-MX") {
  return Number.isFinite(ratio) ? `${numberFormatter(locale, { maximumFractionDigits: 0 }).format(ratio * 100)}%` : "—";
}

/** «9.0». */
export function formatScore(value, locale = "es-MX") {
  return Number.isFinite(value)
    ? numberFormatter(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
    : "—";
}

export function weekdayShort(date, locale = "es-MX") {
  return isDateOnly(date) ? clean(formatter(locale, { weekday: "short" }).format(parseDateOnly(date))) : "";
}

export function weekdayLong(date, locale = "es-MX") {
  return isDateOnly(date) ? formatter(locale, { weekday: "long" }).format(parseDateOnly(date)) : "";
}

export function monthShort(date, locale = "es-MX") {
  return isDateOnly(date) ? clean(formatter(locale, { month: "short" }).format(parseDateOnly(date))) : "";
}

export function monthLong(date, locale = "es-MX") {
  return isDateOnly(date) ? formatter(locale, { month: "long" }).format(parseDateOnly(date)) : "";
}

export function dayNumber(date) {
  return isDateOnly(date) ? parseDateOnly(date).getUTCDate() : "";
}

/** «lun 12 oct» / «Mon 12 Oct». */
export function formatShortDate(date, locale = "es-MX", { weekday = true } = {}) {
  if (!isDateOnly(date)) return "";
  const parts = [weekday ? weekdayShort(date, locale) : "", dayNumber(date), monthShort(date, locale)];
  return parts.filter(Boolean).join(" ");
}

/** «12 de octubre» / «October 12». */
export function formatDayMonth(date, locale = "es-MX") {
  if (!isDateOnly(date)) return "";
  return spanish(locale)
    ? `${dayNumber(date)} de ${monthLong(date, locale)}`
    : formatter(locale, { month: "long", day: "numeric" }).format(parseDateOnly(date));
}

/** «lunes 12 de octubre» / «Monday, October 12». */
export function formatLongDate(date, locale = "es-MX") {
  if (!isDateOnly(date)) return "";
  return spanish(locale)
    ? `${weekdayLong(date, locale)} ${formatDayMonth(date, locale)}`
    : formatter(locale, { weekday: "long", month: "long", day: "numeric" }).format(parseDateOnly(date));
}

/** «octubre 2026» capitalized. */
export function formatMonthYear(date, locale = "es-MX") {
  if (!isDateOnly(date)) return "";
  const text = formatter(locale, { month: "long", year: "numeric" }).format(parseDateOnly(date)).replace(" de ", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function minutesOf(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function periodSuffix(minutes, locale) {
  const pm = Math.floor(minutes / 60) % 24 >= 12;
  return spanish(locale) ? (pm ? "p. m." : "a. m.") : pm ? "p.m." : "a.m.";
}

function clock(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60) % 12 || 12;
  return `${hours}:${String(total % 60).padStart(2, "0")}`;
}

/** «4:00 p. m.». */
export function formatTime(time, locale = "es-MX") {
  const minutes = typeof time === "number" ? time : minutesOf(time);
  return minutes === null ? "" : `${clock(minutes)} ${periodSuffix(minutes, locale)}`;
}

/** «4:00 – 6:00 p. m.» (one suffix when both ends share it). */
export function formatTimeRange(time, durationHours, locale = "es-MX") {
  const start = typeof time === "number" ? time : minutesOf(time);
  if (start === null) return "";
  const end = start + Math.round((Number(durationHours) || 0) * 60);
  const same = periodSuffix(start, locale) === periodSuffix(end, locale);
  return same
    ? `${clock(start)} – ${clock(end)} ${periodSuffix(end, locale)}`
    : `${formatTime(start, locale)} – ${formatTime(end, locale)}`;
}

/** «2 h», «1.5 h», «1:30 h» style used in class meta lines. */
export function formatHours(hours, locale = "es-MX") {
  const value = Number(hours) || 0;
  return `${numberFormatter(locale, { maximumFractionDigits: 2 }).format(value)} h`;
}

/** «3 h 30 min». */
export function formatSpan(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** «Hoy», «Mañana», «Ayer» or the short date. Returns a translation key or a formatted date. */
export function relativeDay(date, today) {
  if (date === today) return { key: "Today" };
  if (date === addDays(today, 1)) return { key: "Tomorrow" };
  if (date === addDays(today, -1)) return { key: "Yesterday" };
  return null;
}

/** Current local time as HH:mm for a date (end of day for other dates). */
export function nowTimeFor(date, today) {
  if (date !== today) return date < today ? "23:59" : "00:00";
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
