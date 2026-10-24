// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain";
import { I18nProvider } from "../i18n";
import OnboardingTutorial from "./OnboardingTutorial";

function renderTutorial({ initialStep = 1, withTargets = true, mode, prepareState } = {}) {
  localStorage.setItem("hibi:language:v1", "en");
  if (withTargets) {
    for (const page of ["home", "community", "classes", "tracking", "settings"]) {
      const target = document.createElement("section");
      target.dataset.onboardingTour = page;
      target.getBoundingClientRect = () => ({ left: 220, top: 100, right: 760, bottom: 260, width: 540, height: 160 });
      document.body.append(target);
    }
  }
  const state = createStarterState();
  prepareState?.(state);
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
  const onDismiss = vi.fn();
  render(
    <I18nProvider>
      <OnboardingTutorial
        open
        state={state}
        actions={actions}
        initialStep={initialStep}
        mode={mode}
        onDismiss={onDismiss}
        onComplete={onComplete}
      />
    </I18nProvider>,
  );
  return { actions, onComplete, onDismiss };
}

describe("OnboardingTutorial", () => {
  it("creates a recurring multi-day workspace and continues into the contextual tour", async () => {
    const user = userEvent.setup();
    const { actions, onComplete } = renderTutorial();

    expect(screen.getByRole("dialog", { name: "Hi, teacher! This is Hibi" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(actions.setOnboardingStep).toHaveBeenCalledWith(2);

    await user.type(screen.getByRole("textbox", { name: /Group name/ }), "Advanced English");
    await user.type(screen.getByRole("textbox", { name: /Subject/ }), "English");
    await user.click(screen.getByRole("button", { name: "Add another day" }));
    const preview = screen.getByText("Upcoming classes").closest(".onboarding-schedule-preview");
    expect(within(preview).getAllByRole("listitem")).toHaveLength(3);
    expect(preview).toHaveTextContent("2 per week · 8 a month");
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
      [],
    );

    expect(screen.getByRole("heading", { name: "Your recurring agenda is ready" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText("Next class")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Meet Hibi" }));
    expect(await screen.findByRole("dialog", { name: "Home tour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();

    for (let step = 0; step < 4; step += 1) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
      expect(screen.getAllByRole("button", { name: "Next" })).toHaveLength(1);
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Finish tour" })).toBeEnabled());
    expect(actions.setOnboardingStep).toHaveBeenLastCalledWith(9);
    await user.click(screen.getByRole("button", { name: "Finish tour" }));
    await waitFor(() => expect(actions.dismissOnboarding).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("dialog", { name: "You’re all set!" })).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Open my next class" }));
    expect(onComplete).toHaveBeenCalledWith("classes");
  });

  it("defers setup at the current step without marking the tutorial complete", async () => {
    const user = userEvent.setup();
    const { actions, onDismiss, onComplete } = renderTutorial({ initialStep: 3 });
    await user.click(screen.getByRole("button", { name: "Continue later" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(actions.setOnboardingStep).toHaveBeenCalledWith(3);
    expect(actions.dismissOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("keeps an exit available while a tour destination is loading", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial({ initialStep: 5, withTargets: false });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Opening this section");
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(actions.dismissOnboarding).toHaveBeenCalledTimes(1);
  });

  it("keeps replayed tours out of setup and closes them with Escape without saving", async () => {
    const user = userEvent.setup();
    const { actions, onDismiss, onComplete } = renderTutorial({
      initialStep: 5,
      mode: "tour",
      prepareState: (state) => {
        state.settings.onboardingVersion = 2;
      },
    });
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(actions.setOnboardingStep).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(actions.dismissOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("pauses a first-run tour with Escape and can return to the agenda review", async () => {
    const user = userEvent.setup();
    const { actions, onDismiss } = renderTutorial({ initialStep: 5 });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Your recurring agenda is ready" })).toBeInTheDocument();
    expect(actions.setOnboardingStep).toHaveBeenLastCalledWith(4);
    await user.click(screen.getByRole("button", { name: "Meet Hibi" }));
    await screen.findByRole("dialog", { name: "Home tour" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(actions.setOnboardingStep).toHaveBeenLastCalledWith(5);
    expect(actions.dismissOnboarding).not.toHaveBeenCalled();
  });

  it("explains schedule conflicts next to the class days", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial({ initialStep: 2 });
    await user.type(screen.getByRole("textbox", { name: /Group name/ }), "Advanced English");
    await user.type(screen.getByRole("textbox", { name: /Subject/ }), "English");
    await user.click(screen.getByRole("button", { name: "Add another day" }));
    await user.click(screen.getAllByRole("combobox", { name: "Day" })[1]);
    await user.click(screen.getByRole("option", { name: "Monday" }));
    await user.click(screen.getAllByRole("combobox", { name: "Time" })[1]);
    await user.click(screen.getByRole("button", { name: /^10:00/ }));
    await user.click(screen.getByRole("button", { name: "30 minutes" }));
    expect(screen.getByText("Classes on the same day can’t overlap.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Classes on the same day can’t overlap.");
    expect(actions.saveOnboardingGroup).not.toHaveBeenCalled();
  });

  it("marks required fields, focuses the first invalid one and clears each error once it is fixed", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial({ initialStep: 2 });
    const name = screen.getByRole("textbox", { name: /Group name/ });
    const subject = screen.getByRole("textbox", { name: /Subject/ });
    const price = screen.getByRole("textbox", { name: "Price per hour" });
    expect(subject).toHaveAttribute("aria-required", "true");
    expect(subject.closest(".field").querySelector(".field-label .req")).toHaveTextContent("*");

    await user.clear(price);
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(name).toHaveFocus());
    expect(actions.saveOnboardingGroup).not.toHaveBeenCalled();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(subject).toHaveAttribute("aria-invalid", "true");
    expect(price).toHaveAttribute("aria-invalid", "true");
    const priceError = document.getElementById(price.getAttribute("aria-describedby"));
    expect(priceError).toHaveTextContent("Enter a price.");
    expect(priceError).toHaveClass("field-error");
    expect(priceError).toHaveAttribute("role", "alert");

    await user.type(name, "Advanced English");
    expect(screen.queryByText("Enter a group name.")).not.toBeInTheDocument();
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Enter a subject.")).toBeInTheDocument();
    await user.type(subject, "English");
    expect(screen.queryByText("Enter a subject.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(price).toHaveFocus());
    await user.type(price, "200");
    expect(screen.queryByText("Enter a price.")).not.toBeInTheDocument();
    expect(price).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById(price.getAttribute("aria-describedby"))).toHaveTextContent(
      "You can adjust it per student later",
    );
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(actions.saveOnboardingGroup).toHaveBeenCalledTimes(1));
  });

  it("suggests a monthly fee and starts billing next month once day 5 has passed", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial({
      initialStep: 2,
      prepareState: (state) => {
        state.settings.asOfDate = "2026-10-22";
        state.settings.hourlyRate = 200;
        state.settings.defaultClassHours = 1;
      },
    });
    await user.type(screen.getByRole("textbox", { name: /Group name/ }), "Inglés A1");
    await user.type(screen.getByRole("textbox", { name: /Subject/ }), "Inglés");
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    // Mondays at $200 an hour: November 2026 has five of them.
    const fee = screen.getByRole("textbox", { name: "Monthly fee" });
    expect(fee).toHaveValue("1000");
    const hint = document.getElementById(fee.getAttribute("aria-describedby"));
    expect(hint).toHaveTextContent("Suggested $1,000 (5 classes × $200).");
    expect(hint).toHaveTextContent("Billing starts in November and is due on day 5 of each month");

    await user.clear(fee);
    await user.type(fee, "900");
    await user.click(screen.getByRole("button", { name: "Per class" }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("textbox", { name: "Monthly fee" })).toHaveValue("900");

    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(actions.saveOnboardingGroup).toHaveBeenCalledTimes(1));
    expect(actions.saveOnboardingGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        billing: { mode: "monthly", monthlyFee: 900, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-11" },
      }),
    );
  });

  it("builds the roster from a pasted list and Enter, and removes saved students", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial({
      initialStep: 3,
      prepareState: (state) => {
        state.groups.push({ id: "group-1", name: "Advanced English", subject: "English", weeklySchedule: [] });
        state.students.push({ id: "student-9", code: "HIBI-009", fullName: "Grace Hopper", groupIds: ["group-1"] });
        state.settings.onboardingGroupId = "group-1";
      },
    });
    await user.click(screen.getByRole("button", { name: "Add another student" }));
    await user.click(screen.getByRole("button", { name: "Remove student 1" }));
    expect(screen.queryByDisplayValue("Grace Hopper")).not.toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: "Student 1" }));
    await user.paste("Ada Lovelace\nAlan Turing\n\nKatherine Johnson");
    expect(screen.getByRole("textbox", { name: "Student 1" })).toHaveValue("Ada Lovelace");
    expect(screen.getByRole("textbox", { name: "Student 3" })).toHaveValue("Katherine Johnson");

    await user.keyboard("{Enter}");
    const added = screen.getByRole("textbox", { name: "Student 4" });
    expect(added).toHaveFocus();
    await user.keyboard("Mary Jackson{Enter}");
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Your recurring agenda is ready" });
    expect(actions.saveOnboardingStudents).toHaveBeenCalledTimes(1);
    expect(actions.saveOnboardingStudents).toHaveBeenCalledWith(
      "group-1",
      [
        expect.objectContaining({ fullName: "Ada Lovelace" }),
        expect.objectContaining({ fullName: "Alan Turing" }),
        expect.objectContaining({ fullName: "Katherine Johnson" }),
        expect.objectContaining({ fullName: "Mary Jackson" }),
        expect.objectContaining({ fullName: "" }),
      ],
      ["student-9"],
    );
  });
});
