export const ONBOARDING_VERSION = 2;
export const ONBOARDING_STEPS = 9;
export const ONBOARDING_SETUP_STEPS = 4;
export const ONBOARDING_TOUR_START_STEP = 5;
export const ONBOARDING_MAX_STUDENTS = 40;

// Each step points at the most specific target available. When the setup group
// is known, Community highlights that group instead of the whole directory.
export const ONBOARDING_TOUR = Object.freeze({
  5: {
    page: "home",
    selector: '[data-onboarding-tour="home"]',
    title: "Your day starts here",
    description: "See today’s classes and open each session from here.",
    label: "Home",
    focus: "nextClass",
  },
  6: {
    page: "community",
    selector: '[data-onboarding-tour="community"]',
    groupSelector: (groupId) => `[data-onboarding-group=${JSON.stringify(String(groupId))}]`,
    title: "Your groups and students",
    description: "Open a group to manage its members, schedule, and contact directory.",
    label: "Community",
    focus: "group",
  },
  7: {
    page: "classes",
    selector: '[data-onboarding-tour="classes"]',
    title: "Your class agenda",
    description: "Open a class to record attendance, payments, notes, and grades.",
    label: "Classes",
    focus: "nextClass",
  },
  8: {
    page: "grades",
    selector: '[data-onboarding-tour="tracking"]',
    title: "See their progress",
    description: "Compare attendance, grades, and payments without reviewing students one by one.",
    label: "Tracking",
  },
  9: {
    page: "settings",
    selector: '[data-onboarding-tour="settings"]',
    title: "Make Hibi your own",
    description: "You can reopen this tour and manage backups and security here.",
    label: "Settings",
  },
});

export const ONBOARDING_DAYS = Object.freeze([
  { value: 1, label: "Monday", shortLabel: "Mon" },
  { value: 2, label: "Tuesday", shortLabel: "Tue" },
  { value: 3, label: "Wednesday", shortLabel: "Wed" },
  { value: 4, label: "Thursday", shortLabel: "Thu" },
  { value: 5, label: "Friday", shortLabel: "Fri" },
  { value: 6, label: "Saturday", shortLabel: "Sat" },
  { value: 7, label: "Sunday", shortLabel: "Sun" },
]);

export function onboardingStep(settings = {}) {
  const value = Number(settings.onboardingStep);
  if (!Number.isFinite(value)) return 1;
  if (Number(settings.onboardingVersion) === 1 && value >= 4) return ONBOARDING_TOUR_START_STEP;
  return Math.min(ONBOARDING_STEPS, Math.max(1, Math.trunc(value)));
}

export function shouldAutoStartOnboarding(state) {
  if (Number(state?.settings?.onboardingVersion) >= ONBOARDING_VERSION) return false;
  if (Number(state?.settings?.onboardingVersion) === 1) return true;
  if (onboardingStep(state?.settings) > 1) return true;
  return [state?.groups, state?.students, state?.grades, state?.classLog, state?.classSchedules].every(
    (collection) => !Array.isArray(collection) || collection.length === 0,
  );
}

// Setup paused with "Continue later" (or an interrupted replay) resumes at its
// saved form step; otherwise a guided setup starts at the group form.
export function setupResumeStep(settings = {}) {
  const step = onboardingStep(settings);
  if (step < 2 || step >= ONBOARDING_TOUR_START_STEP) return null;
  const unfinished = Number(settings.onboardingVersion) < ONBOARDING_VERSION;
  return unfinished || settings.onboardingGroupId ? step : null;
}

export function normalizeStudentNames(rows) {
  return (Array.isArray(rows) ? rows : []).map((name) => String(name || "").trim()).filter(Boolean);
}

// A pasted class list arrives as one name per line (or per spreadsheet cell).
export function splitPastedStudentNames(text) {
  return normalizeStudentNames(String(text || "").split(/\r?\n|\t/));
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

export function scheduleIssue(slots) {
  const rows = Array.isArray(slots) ? slots : [];
  if (!rows.length) return "Add at least one class day.";
  if (rows.some((slot) => minutesOf(slot.startTime) === null)) return "Choose a time for each class day.";
  const keys = rows.map((slot) => `${slot.dayOfWeek}|${slot.startTime}`);
  if (new Set(keys).size !== keys.length) return "Each class day and time must be unique.";
  const overlaps = rows.some((slot, index) =>
    rows.slice(index + 1).some((other) => {
      if (Number(other.dayOfWeek) !== Number(slot.dayOfWeek)) return false;
      const start = minutesOf(slot.startTime);
      const otherStart = minutesOf(other.startTime);
      return (
        start < otherStart + Number(other.durationHours) * 60 && otherStart < start + Number(slot.durationHours) * 60
      );
    }),
  );
  return overlaps ? "Classes on the same day can’t overlap." : "";
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

export function nextClassForSchedule(slots, fromDate = new Date()) {
  return upcomingClasses(slots, 1, fromDate)[0] || null;
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

export function dayShortLabel(dayOfWeek) {
  return ONBOARDING_DAYS.find((day) => day.value === Number(dayOfWeek))?.shortLabel || "Mon";
}

export function tourStep(step) {
  return ONBOARDING_TOUR[Number(step)] || null;
}
