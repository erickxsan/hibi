import { describe, expect, it } from "vitest";
import { createStarterState } from "../domain";
import {
  nextDateForDay,
  nextOnboardingStudentCodes,
  normalizeStudentNames,
  onboardingStep,
  shouldAutoStartOnboarding,
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
});
