import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain";
import {
  canSaveOnboardingDraft,
  draftSchedule,
  formatOnboardingDate,
  initialOnboardingDraft,
  nextDateForDay,
  nextOnboardingStudentCodes,
  onboardingGroupPayload,
  removeOnboardingStudents,
  shouldAutoStartOnboarding,
  upcomingClasses,
} from "./onboardingModel";

describe("onboarding model", () => {
  it("starts automatically only for unfinished empty or resumed workspaces", () => {
    const empty = createStarterState();
    expect(shouldAutoStartOnboarding(empty)).toBe(true);

    empty.settings.onboardingStep = 3;
    empty.groups.push({ id: "group-1" });
    expect(shouldAutoStartOnboarding(empty)).toBe(true);

    empty.settings.onboardingVersion = 1;
    empty.settings.onboardingStep = 1;
    expect(shouldAutoStartOnboarding(empty)).toBe(true);

    empty.settings.onboardingVersion = 2;
    expect(shouldAutoStartOnboarding(empty)).toBe(false);

    const existing = createStarterState();
    existing.groups.push({ id: "existing" });
    expect(shouldAutoStartOnboarding(existing)).toBe(false);
    existing.settings.onboardingStep = "bad";
    expect(shouldAutoStartOnboarding(existing)).toBe(false);
  });

  it("generates collision-free student codes", () => {
    expect(nextOnboardingStudentCodes([{ code: "HIBI-001" }, { code: "CUSTOM" }], 2)).toEqual(["HIBI-002", "HIBI-003"]);
  });

  it("moves a class that already started today to next week", () => {
    const mondayMorning = new Date("2026-08-31T09:00:00");
    const mondayEvening = new Date("2026-08-31T18:00:00");
    expect(nextDateForDay(1, new Date("2026-08-27T12:00:00"))).toBe("2026-08-31");
    expect(nextDateForDay(1, mondayMorning, "10:00")).toBe("2026-08-31");
    expect(nextDateForDay(1, mondayEvening, "10:00")).toBe("2026-09-07");
    expect(formatOnboardingDate("2026-08-31", "en-US")).toBe("Mon, Aug 31");
  });

  it("lists upcoming classes in date order across weeks", () => {
    const tuesdayNoon = new Date("2026-09-29T12:00:00");
    const schedule = [
      { id: "mon", dayOfWeek: 1, startTime: "10:00" },
      { id: "tue-early", dayOfWeek: 2, startTime: "09:00" },
      { id: "tue-late", dayOfWeek: 2, startTime: "17:30" },
      { id: "wed", dayOfWeek: 3, startTime: "10:00" },
    ];
    const agenda = upcomingClasses(schedule, schedule.length, tuesdayNoon);
    expect(agenda.map(({ slot, date }) => `${slot.id} ${date}`)).toEqual([
      "tue-late 2026-09-29",
      "wed 2026-09-30",
      "mon 2026-10-05",
      "tue-early 2026-10-06",
    ]);
    expect(upcomingClasses([], 3, tuesdayNoon)).toEqual([]);
  });

  it("deletes removed setup students without history and only unlinks the rest", () => {
    const state = createStarterState();
    state.students = [
      { id: "new", groupIds: ["g1"] },
      { id: "shared", groupIds: ["g1", "g2"] },
      { id: "graded", groupIds: ["g1"] },
      { id: "kept", groupIds: ["g1"] },
    ];
    state.grades = [{ id: "grade", studentId: "graded" }];
    state.classSchedules = [
      { id: "solo", studentId: "new" },
      { id: "group", groupId: "g1" },
    ];
    const result = removeOnboardingStudents(state, "g1", ["new", "shared", "graded"]);
    expect(result.students).toEqual([
      { id: "shared", groupIds: ["g2"] },
      { id: "graded", groupIds: [] },
      { id: "kept", groupIds: ["g1"] },
    ]);
    expect(result.classSchedules.map((item) => item.id)).toEqual(["group"]);
    expect(removeOnboardingStudents(state, "g1", [])).toBe(state);
  });

  it("starts the group form on Tuesday and Thursday at 5:30 p. m., or from the group a setup left", () => {
    const state = createStarterState();
    expect(initialOnboardingDraft(state)).toEqual({
      id: "",
      name: "",
      days: [2, 4],
      time: "17:30",
      billingMode: "perClass",
      price: "",
    });
    state.groups.push({
      id: "g1",
      name: "Inglés B1",
      weeklySchedule: [
        { id: "s1", dayOfWeek: 1, startTime: "09:00", durationHours: 1.5 },
        { id: "s2", dayOfWeek: 3, startTime: "09:00", durationHours: 1.5 },
      ],
      billing: { mode: "monthly", monthlyFee: 900 },
    });
    state.settings.onboardingGroupId = "g1";
    expect(initialOnboardingDraft(state)).toEqual({
      id: "g1",
      name: "Inglés B1",
      days: [1, 3],
      time: "09:00",
      billingMode: "monthly",
      price: "900",
    });
  });

  it("asks only for a name, a day and a time; a monthly fee also needs its amount", () => {
    const draft = { id: "", name: "Inglés", days: [2], time: "17:30", billingMode: "perClass", price: "" };
    expect(canSaveOnboardingDraft(draft)).toBe(true);
    expect(canSaveOnboardingDraft({ ...draft, name: "  " })).toBe(false);
    expect(canSaveOnboardingDraft({ ...draft, days: [] })).toBe(false);
    expect(canSaveOnboardingDraft({ ...draft, time: "" })).toBe(false);
    expect(canSaveOnboardingDraft({ ...draft, price: "1.2.3" })).toBe(false);
    expect(canSaveOnboardingDraft({ ...draft, billingMode: "monthly" })).toBe(false);
    expect(canSaveOnboardingDraft({ ...draft, billingMode: "monthly", price: "0" })).toBe(false);
    expect(canSaveOnboardingDraft({ ...draft, billingMode: "monthly", price: "1200" })).toBe(true);
  });

  it("saves one class per day at the form's time and keeps the slots of a resumed group", () => {
    const state = createStarterState();
    state.settings.defaultClassHours = 2;
    state.groups.push({
      id: "g1",
      weeklySchedule: [{ id: "kept", dayOfWeek: 4, startTime: "09:00", durationHours: 1 }],
    });
    const slots = draftSchedule({ id: "g1", days: [4, 2, 4], time: "17:30" }, state);
    expect(slots.map(({ dayOfWeek, startTime, durationHours }) => [dayOfWeek, startTime, durationHours])).toEqual([
      [2, "17:30", 2],
      [4, "17:30", 1],
    ]);
    expect(slots[1].id).toBe("kept");
    expect(slots[0].id).toMatch(/^onboarding-slot-/);
  });

  it("builds the group: the general rate unless another price is typed, a monthly fee due on day 5", () => {
    const state = createStarterState();
    state.settings.hourlyRate = 250;
    const draft = { id: "", name: " Inglés B1 ", days: [2, 4], time: "17:30", billingMode: "perClass", price: "" };
    const perClass = onboardingGroupPayload(draft, state, "2026-11-07");
    expect(perClass).toMatchObject({
      id: undefined,
      name: "Inglés B1",
      subject: "",
      schedule: "Tuesday · 17:30; Thursday · 17:30",
      plannedSessionsPerMonth: 8,
      hourlyRate: null,
      billing: undefined,
    });
    expect(onboardingGroupPayload({ ...draft, price: "250" }, state, "2026-11-07").hourlyRate).toBeNull();
    expect(onboardingGroupPayload({ ...draft, price: "300" }, state, "2026-11-07").hourlyRate).toBe(300);
    // After day 5 the first fee is next month's, so it is never born overdue.
    const monthly = onboardingGroupPayload({ ...draft, billingMode: "monthly", price: "1200" }, state, "2026-11-07");
    expect(monthly.hourlyRate).toBeNull();
    expect(monthly.billing).toEqual({
      mode: "monthly",
      monthlyFee: 1200,
      due: { type: "dayOfMonth", day: 5 },
      effectiveFrom: "2026-12",
    });
    expect(
      onboardingGroupPayload({ ...draft, billingMode: "monthly", price: "1200" }, state, "2026-11-03").billing
        .effectiveFrom,
    ).toBe("2026-11");
  });

  it("keeps the billing start and subject of a group saved again from a resumed setup", () => {
    const state = createStarterState();
    state.groups.push({
      id: "g1",
      name: "Inglés B1",
      subject: "Inglés",
      weeklySchedule: [],
      billing: {
        mode: "monthly",
        monthlyFee: 900,
        due: { type: "dayOfMonth", day: 5 },
        effectiveFrom: "2026-10",
        coveredFrom: "2026-10-20",
      },
    });
    const draft = { id: "g1", name: "Inglés B1", days: [1], time: "09:00", billingMode: "monthly", price: "950" };
    const payload = onboardingGroupPayload(draft, state, "2026-11-07");
    expect(payload).toMatchObject({ id: "g1", subject: "Inglés" });
    expect(payload.billing).toMatchObject({ monthlyFee: 950, effectiveFrom: "2026-10", coveredFrom: "2026-10-20" });
  });
});
