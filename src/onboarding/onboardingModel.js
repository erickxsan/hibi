export const ONBOARDING_VERSION = 2;
export const ONBOARDING_STEPS = 9;
export const ONBOARDING_SETUP_STEPS = 4;
export const ONBOARDING_TOUR_START_STEP = 5;

export const ONBOARDING_TOUR = Object.freeze({
  5: {
    page: "home",
    selector: '[data-onboarding-tour="home"]',
    title: "Your day starts here.",
    description: "See today’s classes and open the next session without searching through your agenda.",
    label: "Home",
    helper: "Classes and pending work for today",
    mascot: "/onboarding/hibi-welcome-transparent.png",
    mascotPosition: "home",
  },
  6: {
    page: "community",
    selector: '[data-onboarding-tour="community"]',
    title: "Your groups and students live together.",
    description: "Open a group to manage its members, schedule, and contact directory.",
    label: "Community",
    helper: "Groups, students, and contact details",
    mascot: "/onboarding/hibi-group-transparent.png",
    mascotPosition: "community",
  },
  7: {
    page: "classes",
    selector: '[data-onboarding-tour="classes"]',
    title: "Your agenda comes from each group’s schedule.",
    description: "Open a class to record attendance, payments, notes, and grades.",
    label: "Classes",
    helper: "Agenda and records for every session",
    mascot: "/onboarding/hibi-schedule-transparent.png",
    mascotPosition: "classes",
  },
  8: {
    page: "grades",
    selector: '[data-onboarding-tour="tracking"]',
    title: "Spot progress and pending work here.",
    description: "Compare attendance, grades, and payments without reviewing students one by one.",
    label: "Tracking",
    helper: "Academic progress and payments",
    mascot: "/onboarding/hibi-students-transparent.png",
    mascotPosition: "tracking",
  },
  9: {
    page: "settings",
    selector: '[data-onboarding-tour="settings"]',
    title: "Make Hibi work your way.",
    description: "You can reopen this tour and manage backups and security here.",
    label: "Settings",
    helper: "Preferences, help, and security",
    mascot: "/onboarding/hibi-welcome-transparent.png",
    mascotPosition: "settings",
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

export function normalizeStudentNames(rows) {
  return (Array.isArray(rows) ? rows : []).map((name) => String(name || "").trim()).filter(Boolean);
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

export function nextDateForDay(dayOfWeek, fromDate = new Date()) {
  const date = new Date(fromDate);
  date.setHours(12, 0, 0, 0);
  const currentDay = date.getDay() || 7;
  const delta = (Number(dayOfWeek) - currentDay + 7) % 7;
  date.setDate(date.getDate() + delta);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayLabel(dayOfWeek) {
  return ONBOARDING_DAYS.find((day) => day.value === Number(dayOfWeek))?.label || "Monday";
}

export function tourStep(step) {
  return ONBOARDING_TOUR[Number(step)] || null;
}
