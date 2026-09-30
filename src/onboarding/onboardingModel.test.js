import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain";
import {
  formatOnboardingDate,
  nextClassForSchedule,
  nextDateForDay,
  nextOnboardingStudentCodes,
  normalizeStudentNames,
  onboardingStep,
  removeOnboardingStudents,
  scheduleIssue,
  setupResumeStep,
  shouldAutoStartOnboarding,
  splitPastedStudentNames,
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
    empty.settings.onboardingStep = 4;
    expect(shouldAutoStartOnboarding(empty)).toBe(true);
    expect(onboardingStep(empty.settings)).toBe(5);

    empty.settings.onboardingVersion = 2;
    expect(shouldAutoStartOnboarding(empty)).toBe(false);

    const existing = createStarterState();
    existing.groups.push({ id: "existing" });
    expect(shouldAutoStartOnboarding(existing)).toBe(false);
  });

  it("normalizes progress, names, dates, and collision-free generated codes", () => {
    expect(onboardingStep({ onboardingStep: 99 })).toBe(9);
    expect(onboardingStep({ onboardingStep: "bad" })).toBe(1);
    expect(normalizeStudentNames([" Ada ", "", null, "Lin"])).toEqual(["Ada", "Lin"]);
    expect(nextOnboardingStudentCodes([{ code: "HIBI-001" }, { code: "CUSTOM" }], 2)).toEqual(["HIBI-002", "HIBI-003"]);
    expect(nextDateForDay(1, new Date("2026-08-27T12:00:00"))).toBe("2026-08-31");
  });

  it("moves a class that already started today to next week", () => {
    const mondayMorning = new Date("2026-08-31T09:00:00");
    const mondayEvening = new Date("2026-08-31T18:00:00");
    expect(nextDateForDay(1, mondayMorning, "10:00")).toBe("2026-08-31");
    expect(nextDateForDay(1, mondayEvening, "10:00")).toBe("2026-09-07");
    expect(
      nextClassForSchedule(
        [
          { dayOfWeek: 3, startTime: "08:00" },
          { dayOfWeek: 1, startTime: "19:00" },
        ],
        mondayEvening,
      ),
    ).toMatchObject({ date: "2026-08-31", slot: { dayOfWeek: 1 } });
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
    expect(upcomingClasses([schedule[0]], 3, tuesdayNoon).map((item) => item.date)).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(upcomingClasses([], 3, tuesdayNoon)).toEqual([]);
  });

  it("reports missing, repeated, and overlapping class times", () => {
    const slot = (dayOfWeek, startTime, durationHours = 1) => ({ dayOfWeek, startTime, durationHours });
    expect(scheduleIssue([])).toBe("Add at least one class day.");
    expect(scheduleIssue([slot(1, "")])).toBe("Choose a time for each class day.");
    expect(scheduleIssue([slot(1, "10:00"), slot(1, "10:00")])).toBe("Each class day and time must be unique.");
    expect(scheduleIssue([slot(1, "10:00", 2), slot(1, "11:00")])).toBe("Classes on the same day can’t overlap.");
    expect(scheduleIssue([slot(1, "10:00"), slot(1, "11:00"), slot(2, "10:30")])).toBe("");
  });

  it("splits pasted rosters and resumes only unfinished setups", () => {
    expect(splitPastedStudentNames("Ada\r\n\nLin\tGrace ")).toEqual(["Ada", "Lin", "Grace"]);
    expect(setupResumeStep({ onboardingVersion: 0, onboardingStep: 3 })).toBe(3);
    expect(setupResumeStep({ onboardingVersion: 2, onboardingStep: 3, onboardingGroupId: "" })).toBeNull();
    expect(setupResumeStep({ onboardingVersion: 2, onboardingStep: 3, onboardingGroupId: "g1" })).toBe(3);
    expect(setupResumeStep({ onboardingVersion: 0, onboardingStep: 7 })).toBeNull();
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
});
