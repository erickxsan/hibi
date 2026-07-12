const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function utcDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  // Years 0-99 are treated specially by Date.UTC; correct them explicitly.
  if (year >= 0 && year < 100) value.setUTCFullYear(year);
  return value;
}

export function isDateOnly(value) {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = utcDate(year, month, day);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

export function parseDateOnly(value) {
  if (!isDateOnly(value)) throw new TypeError(`Invalid date-only value: ${String(value)}`);
  const [year, month, day] = value.split("-").map(Number);
  return utcDate(year, month, day);
}

export function formatDateOnly(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Expected a valid Date");
  }
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
}

/** Convert a Date using local calendar fields, or validate an existing date-only string. */
export function toDateOnly(value) {
  if (typeof value === "string") {
    if (!isDateOnly(value)) throw new TypeError(`Invalid date-only value: ${value}`);
    return value;
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Expected a date-only string or valid Date");
  }
  return `${String(value.getFullYear()).padStart(4, "0")}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function todayDateOnly(now = new Date()) {
  return toDateOnly(now);
}

export function compareDateOnly(left, right) {
  if (!isDateOnly(left) || !isDateOnly(right)) {
    throw new TypeError("compareDateOnly expects valid YYYY-MM-DD values");
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addDays(value, amount) {
  if (!Number.isInteger(amount)) throw new TypeError("Day offset must be an integer");
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

export function addMonths(value, amount) {
  if (!Number.isInteger(amount)) throw new TypeError("Month offset must be an integer");
  const date = parseDateOnly(startOfMonth(value));
  date.setUTCMonth(date.getUTCMonth() + amount);
  return formatDateOnly(date);
}

export function startOfMonth(value) {
  const date = parseDateOnly(value);
  date.setUTCDate(1);
  return formatDateOnly(date);
}

export function endOfMonth(value) {
  return addDays(addMonths(startOfMonth(value), 1), -1);
}

export function daysInMonth(value) {
  return parseDateOnly(endOfMonth(value)).getUTCDate();
}

/** ISO-style week start (Monday by default). weekStartsOn uses 0=Sun ... 6=Sat. */
export function startOfWeek(value, weekStartsOn = 1) {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new RangeError("weekStartsOn must be an integer from 0 to 6");
  }
  const date = parseDateOnly(value);
  const distance = (date.getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(value, -distance);
}

export function isDateInRange(value, startInclusive, endInclusive) {
  if (!isDateOnly(value)) return false;
  return compareDateOnly(value, startInclusive) >= 0 && compareDateOnly(value, endInclusive) <= 0;
}

export function minDateOnly(...values) {
  const valid = values.filter(isDateOnly);
  if (!valid.length) throw new TypeError("minDateOnly needs at least one valid date");
  return valid.reduce((smallest, value) => (value < smallest ? value : smallest));
}

export function maxDateOnly(...values) {
  const valid = values.filter(isDateOnly);
  if (!valid.length) throw new TypeError("maxDateOnly needs at least one valid date");
  return valid.reduce((largest, value) => (value > largest ? value : largest));
}
