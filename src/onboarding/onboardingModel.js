import { firstBillingPeriod, normalizeGroupBilling } from "../domain/monthlyBilling";

export const ONBOARDING_VERSION = 2;

// The tutorial's monthly fee falls due on day 5; the teacher can change it later in Community.
export const TUTORIAL_DUE = Object.freeze({ type: "dayOfMonth", day: 5 });

export const ONBOARDING_DAYS = Object.freeze([
  { value: 1, label: "Monday", shortLabel: "Mon" },
  { value: 2, label: "Tuesday", shortLabel: "Tue" },
  { value: 3, label: "Wednesday", shortLabel: "Wed" },
  { value: 4, label: "Thursday", shortLabel: "Thu" },
  { value: 5, label: "Friday", shortLabel: "Fri" },
  { value: 6, label: "Saturday", shortLabel: "Sat" },
  { value: 7, label: "Sunday", shortLabel: "Sun" },
]);

// A setup left half done (any saved step past the first) starts the tutorial again.
function savedStep(settings = {}) {
  const value = Number(settings.onboardingStep);
  return Number.isFinite(value) ? Math.trunc(value) : 1;
}

export function shouldAutoStartOnboarding(state) {
  if (Number(state?.settings?.onboardingVersion) >= ONBOARDING_VERSION) return false;
  if (Number(state?.settings?.onboardingVersion) === 1) return true;
  if (savedStep(state?.settings) > 1) return true;
  return [state?.groups, state?.students, state?.grades, state?.classLog, state?.classSchedules].every(
    (collection) => !Array.isArray(collection) || collection.length === 0,
  );
}

export function nextOnboardingStudentCodes(students, count) {
  const used = new Set((Array.isArray(students) ? students : []).map((student) => String(student?.code || "")));
  const codes = [];
  let candidate = 1;
  while (codes.length < count) {
    const code = `HIBI-${String(candidate).padStart(3, "0")}`;
    if (!used.has(code)) codes.push(code);
    candidate += 1;
  }
  return codes;
}

// Students removed during setup leave the group. Those created by the setup and
// without history are deleted; anyone with records or other groups is kept.
export function removeOnboardingStudents(state, groupId, removedIds) {
  const removed = new Set((Array.isArray(removedIds) ? removedIds : []).filter(Boolean));
  if (!removed.size) return state;
  const hasHistory = (id) =>
    state.grades?.some((grade) => grade.studentId === id) || state.classLog?.some((row) => row.studentId === id);
  const deleted = new Set();
  const students = [];
  for (const student of state.students) {
    if (!removed.has(student.id)) {
      students.push(student);
      continue;
    }
    const groupIds = (student.groupIds || []).filter((id) => id !== groupId);
    if (!groupIds.length && !hasHistory(student.id)) {
      deleted.add(student.id);
      continue;
    }
    students.push({ ...student, groupIds });
  }
  const keepsParticipants = (item) =>
    !deleted.has(item.studentId) && !item.participantIds?.some((id) => deleted.has(id));
  return {
    ...state,
    students,
    classSchedules: deleted.size ? (state.classSchedules || []).filter(keepsParticipants) : state.classSchedules,
    scheduleExceptions: deleted.size
      ? (state.scheduleExceptions || []).filter(keepsParticipants)
      : state.scheduleExceptions,
  };
}

function minutesOf(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The tutorial's group form. A setup interrupted after its group was saved (a reload, or a setup left
 * by an earlier tutorial) comes back filled in, so saving again updates that group instead of adding one.
 */
export function initialOnboardingDraft(state) {
  const group = state.groups.find((item) => item.id === state.settings.onboardingGroupId);
  const slots = group?.weeklySchedule || [];
  const monthly = group?.billing?.mode === "monthly";
  let price = "";
  if (monthly) price = String(group.billing.monthlyFee ?? "");
  else if (Number.isFinite(group?.hourlyRate)) price = String(group.hourlyRate);
  return {
    id: group?.id || "",
    name: group?.name || "",
    days: slots.length ? [...new Set(slots.map((slot) => Number(slot.dayOfWeek)))] : [2, 4],
    time: slots[0]?.startTime || "17:30",
    billingMode: monthly ? "monthly" : "perClass",
    price,
  };
}

/** One class per chosen day, all at the form's time, in weekday order. A resumed group keeps its slots. */
export function draftSchedule(draft, state) {
  const previous = state.groups.find((group) => group.id === draft.id)?.weeklySchedule || [];
  const duration = Number(state.settings.defaultClassHours) || 1;
  return [...new Set(draft.days.map(Number))]
    .sort((a, b) => a - b)
    .map((dayOfWeek) => {
      const kept = previous.find((slot) => Number(slot.dayOfWeek) === dayOfWeek);
      return {
        id: kept?.id || `onboarding-slot-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${dayOfWeek}`}`,
        dayOfWeek,
        startTime: draft.time,
        durationHours: Number(kept?.durationHours) || duration,
      };
    });
}

/** A name, a day and a time are enough. An empty per-class price is the general rate; a monthly fee needs one. */
export function canSaveOnboardingDraft(draft) {
  const price = String(draft.price ?? "").trim();
  const priceOk = draft.billingMode === "monthly" ? Number(price) > 0 : price === "" || Number(price) >= 0;
  return Boolean(draft.name.trim() && draft.days.length && minutesOf(draft.time) !== null && priceOk);
}

/** What the form saves through `saveOnboardingGroup`. */
export function onboardingGroupPayload(draft, state, asOf) {
  const monthly = draft.billingMode === "monthly";
  const price = String(draft.price ?? "").trim();
  const weeklySchedule = draftSchedule(draft, state);
  const previous = state.groups.find((group) => group.id === draft.id);
  // A fee is never born overdue: once day 5 has passed, billing starts next month. Saving a resumed
  // setup again keeps the billing start it was created with.
  const savedBilling = normalizeGroupBilling(previous?.billing);
  const keptStart = savedBilling?.mode === "monthly" && savedBilling.effectiveFrom ? savedBilling : null;
  const billingStart = firstBillingPeriod({ mode: "monthly", due: TUTORIAL_DUE }, asOf);
  return {
    id: draft.id || undefined,
    name: draft.name.trim(),
    subject: previous?.subject || "",
    schedule: weeklySchedule.map((slot) => `${dayLabel(slot.dayOfWeek)} · ${slot.startTime}`).join("; "),
    weeklySchedule,
    plannedSessionsPerMonth: Math.max(4, weeklySchedule.length * 4),
    // The general rate stays in Settings; only a different price becomes the group's own.
    hourlyRate: !monthly && price !== "" && Number(price) !== Number(state.settings.hourlyRate) ? Number(price) : null,
    billing: monthly
      ? {
          mode: "monthly",
          monthlyFee: Number(price),
          due: { ...TUTORIAL_DUE },
          effectiveFrom: keptStart?.effectiveFrom || billingStart,
          ...(keptStart?.coveredFrom ? { coveredFrom: keptStart.coveredFrom } : {}),
        }
      : undefined,
  };
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// A class that already started today belongs to next week's agenda.
export function nextDateForDay(dayOfWeek, fromDate = new Date(), startTime = "") {
  const now = new Date(fromDate);
  const date = new Date(fromDate);
  date.setHours(12, 0, 0, 0);
  const currentDay = date.getDay() || 7;
  let delta = (Number(dayOfWeek) - currentDay + 7) % 7;
  const start = minutesOf(startTime);
  if (delta === 0 && start !== null && start <= now.getHours() * 60 + now.getMinutes()) delta = 7;
  date.setDate(date.getDate() + delta);
  return isoDate(date);
}

function addDays(isoValue, days) {
  const [year, month, day] = isoValue.split("-").map(Number);
  return isoDate(new Date(year, month - 1, day + days, 12));
}

// The next `count` classes of a weekly schedule in date order, across weeks.
export function upcomingClasses(slots, count, fromDate = new Date()) {
  const rows = Array.isArray(slots) ? slots : [];
  return rows
    .flatMap((slot) => {
      const first = nextDateForDay(slot.dayOfWeek, fromDate, slot.startTime);
      return Array.from({ length: count }, (_, week) => ({ slot, date: addDays(first, week * 7) }));
    })
    .sort((a, b) => `${a.date} ${a.slot.startTime}`.localeCompare(`${b.date} ${b.slot.startTime}`))
    .slice(0, count);
}

export function formatOnboardingDate(isoValue, locale) {
  const [year, month, day] = String(isoValue).split("-").map(Number);
  if (!year || !month || !day) return String(isoValue || "");
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(year, month - 1, day, 12),
  );
}

export function dayLabel(dayOfWeek) {
  return ONBOARDING_DAYS.find((day) => day.value === Number(dayOfWeek))?.label || "Monday";
}
