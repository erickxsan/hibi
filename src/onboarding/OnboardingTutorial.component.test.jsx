// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain";
import { I18nProvider } from "../i18n";
import OnboardingTutorial from "./OnboardingTutorial";

function renderTutorial() {
  const state = createStarterState();
  const savedStudent = {
    id: "student-1",
    code: "HIBI-001",
    fullName: "Ada Lovelace",
    avatarId: "cat",
    groupIds: ["group-1"],
  };
  const actions = {
    setOnboardingStep: vi.fn(async () => true),
    dismissOnboarding: vi.fn(async () => true),
    saveOnboardingGroup: vi.fn(async () => "group-1"),
    saveOnboardingStudents: vi.fn(async () => [savedStudent]),
  };
  const onComplete = vi.fn();
  render(
    <I18nProvider>
      <OnboardingTutorial open state={state} actions={actions} onDismiss={vi.fn()} onComplete={onComplete} />
    </I18nProvider>,
  );
  return { actions, onComplete };
}

describe("OnboardingTutorial", () => {
  it("creates a recurring multi-day workspace and continues into the contextual tour", async () => {
    const user = userEvent.setup();
    const { actions, onComplete } = renderTutorial();

    expect(screen.getByRole("dialog", { name: "Welcome to Hibi!" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(actions.setOnboardingStep).toHaveBeenCalledWith(2);

    await user.type(screen.getByRole("textbox", { name: /Group name/ }), "Advanced English");
    await user.type(screen.getByRole("textbox", { name: /Subject/ }), "English");
    await user.click(screen.getByRole("button", { name: "Add another day" }));
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(actions.saveOnboardingGroup).toHaveBeenCalledTimes(1));
    expect(actions.saveOnboardingGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Advanced English",
        subject: "English",
        plannedSessionsPerMonth: 8,
        weeklySchedule: expect.arrayContaining([
          expect.objectContaining({ dayOfWeek: 1 }),
          expect.objectContaining({ dayOfWeek: 2 }),
        ]),
      }),
    );

    await user.type(screen.getByRole("textbox", { name: "Student 1" }), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(actions.saveOnboardingStudents).toHaveBeenCalledTimes(1));
    expect(actions.saveOnboardingStudents).toHaveBeenCalledWith(
      "group-1",
      expect.arrayContaining([expect.objectContaining({ fullName: "Ada Lovelace" })]),
    );

    expect(screen.getByRole("heading", { name: "Your recurring agenda is ready" })).toBeInTheDocument();
    expect(screen.getAllByText("Next class")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Meet Hibi" }));
    expect(await screen.findByRole("dialog", { name: "Home tour" })).toBeInTheDocument();

    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    await user.click(screen.getByRole("button", { name: "Finish tour" }));
    await waitFor(() => expect(actions.dismissOnboarding).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
