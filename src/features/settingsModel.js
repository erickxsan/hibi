import { REAL_ROSTER_BACKUP_KEY, STORAGE_KEY } from "../domain/constants.js";
import { toDateOnly } from "../domain/dates";
import { roundMoney } from "../domain/money.js";
import { isMonthlyGroup, periodOf } from "../domain/monthlyBilling";
import { safeLoadState } from "../domain/storage.js";
import { formatShortDate } from "../utils/displayFormat";
import { monthProjection } from "./homeDashboardModel";
import { trackingRange, trackingStudents } from "./trackingModel";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** The draft as the settings it would save, so the preview reads exactly what «Save» stores. */
export function draftSettings(settings, draft) {
  return {
    ...settings,
    hourlyRate: Number(draft.hourlyRateMxn ?? draft.hourlyRate),
    defaultClassHours: Number(draft.defaultClassHours),
    recentProjectionWeeks: Number(draft.recentProjectionWeeks),
    lowGradeThreshold: Number(draft.lowGradeThreshold),
    lowAttendanceThreshold: Number(draft.lowAttendanceThreshold),
  };
}

/** «Con estos valores»: what the class values change this month, before saving them. */
export function settingsEffects(state, derived, draft, asOf) {
  const settings = draftSettings(state.settings, draft);
  const preview = { ...state, settings };
  const period = periodOf(asOf);
  const ownRateGroups = (state.groups || [])
    .filter(
      (group) =>
        group.status !== "Inactive" &&
        (isMonthlyGroup(group, period) || (finite(group.hourlyRate) && group.hourlyRate !== settings.hourlyRate)),
    )
    .map((group) => group.name);
  const ownRateStudents = (state.students || [])
    .filter(
      (student) =>
        student.status !== "Inactive" &&
        finite(student.customHourlyRate) &&
        student.customHourlyRate !== settings.hourlyRate,
    )
    .map((student) => student.fullName.split(" ")[0]);
  const ownRates = [...ownRateGroups, ...ownRateStudents];
  const students = trackingStudents(state, derived, trackingRange(asOf, "month"), "all");
  const lowGrade = settings.lowGradeThreshold * 10;
  const lowGrades = students
    .flatMap((row) =>
      row.gradeItems
        .filter((grade) => grade.value < lowGrade)
        .map((grade) => ({
          studentId: row.student.id,
          name: row.student.fullName,
          value: grade.value,
          assessment: grade.item.assessment,
          date: grade.item.date,
        })),
    )
    .sort((left, right) => right.date.localeCompare(left.date));
  return {
    classCost: roundMoney((settings.defaultClassHours || 0) * (settings.hourlyRate || 0)),
    ownRates,
    ownRateGroups,
    ownRateStudents,
    projection: monthProjection(preview, derived?.classLog || [], asOf).projected,
    lowAttendance: students
      .filter((row) => row.classes && row.attendance < settings.lowAttendanceThreshold)
      .sort((left, right) => left.attendance - right.attendance),
    lowGrades,
    lowGradeCount: new Set(lowGrades.map((item) => item.studentId)).size,
  };
}

/** «Inglés, Francés y Taller +2»: whole names (group names are not cut to their first word). */
export function nameList(names, locale = "es-MX", limit = 3) {
  const shown = names.filter(Boolean).slice(0, limit);
  const rest = names.filter(Boolean).length - shown.length;
  const list = new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
  return rest > 0 ? `${list} +${rest}` : list;
}

/**
 * «El grupo Inglés conserva su tarifa.» — one translatable sentence per kind, singular or plural.
 * @returns {{ key: string, values: { names: string } }[]}
 */
export function ownRateSentences(effects, locale = "es-MX") {
  const groups = effects?.ownRateGroups || [];
  const students = effects?.ownRateStudents || [];
  const sentences = [];
  if (groups.length) {
    sentences.push({
      key: groups.length === 1 ? "The {names} group keeps its own rate." : "The {names} groups keep their own rate.",
      values: { names: nameList(groups, locale) },
    });
  }
  if (students.length) {
    sentences.push({
      key: students.length === 1 ? "{names} keeps their own rate." : "{names} keep their own rate.",
      values: { names: nameList(students, locale) },
    });
  }
  return sentences;
}

/** Plain-language line for how this session was unlocked; never shows the internal method id. */
export function unlockMethodCopy(method) {
  if (method === "remembered-device")
    return "This browser remembers your key, so Hibi opened without asking for your password.";
  if (method === "password") return "You unlocked Hibi with your encryption password.";
  if (method === "rotated-password") return "You renewed the key and unlocked Hibi with your encryption password.";
  if (method === "recovery-key") return "You unlocked Hibi with your recovery key.";
  return "Hibi is unlocked on this browser.";
}

/** A key or device date as «26 ago 2026» / «26 Aug 2026» (local calendar day). */
export function formatKeyDate(timestamp, locale = "es-MX") {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${formatShortDate(toDateOnly(date), locale, { weekday: false })} ${date.getFullYear()}`;
}

/** Active (not revoked) wrappers and whether a recovery key is among them. */
export function encryptionAccess(encryption) {
  const active = (encryption?.wrappers || []).filter((wrapper) => !wrapper.revokedAt);
  return { active, hasRecoveryKey: active.some((wrapper) => wrapper.type === "recovery") };
}

/** Why a key cannot be revoked right now, or "" when it can. */
export function revokeBlockedReason(wrapper, activeCount) {
  if (wrapper.type === "password") return "Your password can't be revoked. You can change it instead.";
  if (activeCount <= 1) return "It's your only way to unlock, so it can't be revoked.";
  return "";
}

const LEGACY_COLLECTIONS = ["groups", "students", "grades", "classLog"];

/**
 * Whether this browser still holds the readable (unencrypted) workspace copy from before signing in. An empty
 * starter copy does not count; unreadable bytes do, so they can still be removed.
 */
export function hasLegacyBrowserCopy(storage = globalThis.localStorage) {
  try {
    if (!storage) return false;
    if (storage.getItem(REAL_ROSTER_BACKUP_KEY) !== null) return true;
    if (storage.getItem(STORAGE_KEY) === null) return false;
    const { state, error } = safeLoadState(storage);
    return Boolean(error) || LEGACY_COLLECTIONS.some((key) => Array.isArray(state?.[key]) && state[key].length > 0);
  } catch {
    return false;
  }
}
