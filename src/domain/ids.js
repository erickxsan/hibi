const PREFIX_RE = /[^a-z0-9_-]+/gi;

function safePrefix(prefix) {
  const normalized = String(prefix || "item").replace(PREFIX_RE, "-").replace(/^-+|-+$/g, "");
  return normalized || "item";
}

export function createStableId(prefix = "item") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${safePrefix(prefix)}_${uuid}`;

  // The fallback is only for older browsers. The id is persisted immediately and
  // never regenerated during normalization or import.
  const random = Math.random().toString(36).slice(2, 12);
  return `${safePrefix(prefix)}_${Date.now().toString(36)}_${random}`;
}

export function createGroup(overrides = {}) {
  return {
    id: createStableId("group"),
    name: "",
    grade: "",
    subject: "",
    schedule: "",
    hourlyRate: null,
    weeklySchedule: [],
    plannedSessionsPerMonth: 8,
    assistantContact: "",
    notes: "",
    ...overrides,
  };
}

export function createStudent(overrides = {}) {
  return {
    id: createStableId("student"),
    code: "",
    fullName: "",
    avatarId: "cat",
    groupIds: [],
    isIndividual: false,
    customHourlyRate: null,
    phone: "",
    guardianContact: "",
    notes: "",
    status: "Active",
    ...overrides,
  };
}

export function createGrade(overrides = {}) {
  return {
    id: createStableId("grade"),
    date: "",
    studentId: "",
    assessment: "",
    category: "Quiz",
    score: null,
    maxScore: null,
    workStatus: "On time",
    feedback: "",
    classSessionKey: "",
    ...overrides,
  };
}

export function createClassLogRow(overrides = {}) {
  return {
    id: createStableId("class"),
    classDate: "",
    studentId: "",
    groupId: "",
    startTime: "",
    classTitle: "",
    scheduleSlotId: "",
    scheduleOccurrenceDate: "",
    classStatus: "Completed",
    attendance: "P",
    hours: null,
    appliedHourlyRate: null,
    appliedCharge: null,
    amountPaid: null,
    paymentState: "Pending",
    paymentDate: null,
    paymentMethod: "",
    paymentReference: "",
    notes: "",
    ...overrides,
  };
}

export function createClassSchedule(overrides = {}) {
  return {
    id: createStableId("class-schedule"),
    recurrence: "once",
    format: "group",
    groupId: "",
    studentId: "",
    startDate: "",
    startTime: "",
    durationHours: 2,
    intervalWeeks: 1,
    daysOfWeek: [],
    ...overrides,
  };
}

export function createScheduleException(overrides = {}) {
  return {
    id: createStableId("schedule-exception"),
    groupId: "",
    scheduleSlotId: "",
    occurrenceDate: "",
    classDate: "",
    startTime: "",
    durationHours: null,
    status: "Scheduled",
    kind: "override",
    ...overrides,
  };
}

export function createScheduleChange(overrides = {}) {
  return {
    id: createStableId("schedule-change"),
    groupId: "",
    scheduleSlotId: "",
    effectiveFrom: "",
    dayOfWeek: 1,
    startTime: "",
    durationHours: null,
    ...overrides,
  };
}
