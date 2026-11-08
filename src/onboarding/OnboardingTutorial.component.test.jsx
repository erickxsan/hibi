// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createStarterState } from "../domain";
import { I18nProvider } from "../i18n";
import OnboardingTutorial from "./OnboardingTutorial";

function renderTutorial({ language = "en", saveGroup = async () => "group-1" } = {}) {
  localStorage.setItem("hibi:language:v1", language);
  const shell = document.createElement("div");
  shell.className = "hibi-shell";
  document.body.append(shell);
  const state = createStarterState();
  state.settings.hourlyRate = 250;
  const actions = {
    saveOnboardingGroup: vi.fn(saveGroup),
    dismissOnboarding: vi.fn(async () => true),
  };
  const onClose = vi.fn();
  const view = render(
    <I18nProvider>
      <OnboardingTutorial state={state} actions={actions} onClose={onClose} />
    </I18nProvider>,
  );
  return { actions, onClose, shell, view };
}

const heading = (name) => screen.getByRole("heading", { level: 1, name });

describe("OnboardingTutorial", () => {
  it("tells the day in six moments that only move on with the teacher's click", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    renderTutorial();
    expect(heading("Your day, at a glance")).toBeInTheDocument();
    // The moment acts out its own example (two notices get seen) but never moves on by itself.
    act(() => vi.advanceTimersByTime(30_000));
    expect(heading("Your day, at a glance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diego got 6.0 in Practice 9" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1 Physics fee overdue" })).toHaveAttribute("aria-pressed", "false");

    const titles = [
      "A group builds your agenda",
      "Take attendance in seconds",
      "Get paid without keeping count",
      "See who needs help",
      "And rest",
    ];
    for (const title of titles) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(heading(title)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(heading("See who needs help")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to 11:00 a.m." }));
    expect(heading("A group builds your agenda")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to 10:00 p.m." }));
    fireEvent.click(screen.getByRole("button", { name: "Your turn" }));
    expect(heading("Now you teach it")).toBeInTheDocument();
  });

  it("practices a class with sample students, one tap at a time, without saving anything", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Teach my practice class" }));
    const guide = screen.getByRole("region", { name: "Guide" });
    expect(guide).toHaveTextContent("Your turn: open your class");

    await user.click(screen.getByRole("button", { name: "Record class" }));
    expect(heading("Classes")).toBeInTheDocument();
    expect(guide).toHaveTextContent("0 of 4 students");
    expect(screen.getByRole("button", { name: "Save class" })).toBeDisabled();
    const marks = { "Emilio Castro": "Present", "Iker Morales": "Present", "Renata Ortiz": "Absent" };
    for (const [student, mark] of Object.entries(marks)) {
      await user.click(within(screen.getByRole("group", { name: `Attendance for ${student}` })).getByLabelText(mark));
    }
    expect(screen.getByText("— absent · not charged")).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "Attendance for Ximena Flores" })).getByLabelText("Present"),
    );
    await waitFor(() => expect(screen.getByRole("region", { name: "Guide" })).toHaveTextContent("Record a payment"));

    await user.click(within(screen.getByRole("group", { name: "Payment for Emilio Castro" })).getByLabelText("Paid"));
    await waitFor(() => expect(screen.getByRole("region", { name: "Guide" })).toHaveTextContent("Save it"));
    expect(screen.getByText("$280 collected today")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save class" }));
    expect(await screen.findByText("Class result", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("3 present and $280 collected.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tracking" }));
    expect(heading("Tracking")).toBeInTheDocument();
    expect(screen.getByText("Paid $280")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Community" }));
    expect(heading("Community")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Now mine" }));
    expect(heading("Your first group")).toBeInTheDocument();
    expect(actions.saveOnboardingGroup).not.toHaveBeenCalled();
    expect(actions.dismissOnboarding).not.toHaveBeenCalled();
  });

  it("creates the first real group, marks the tutorial done and leaves the teacher in Home", async () => {
    const user = userEvent.setup();
    const { actions, onClose } = renderTutorial();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Skip to creating my group" }));
    const create = screen.getByRole("button", { name: "Create my agenda" });
    expect(create).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thursday" })).toHaveAttribute("aria-pressed", "true");
    await user.type(screen.getByRole("textbox", { name: "Group name" }), "Advanced English");
    await user.click(screen.getByRole("button", { name: "Thursday" }));
    await user.click(screen.getByRole("button", { name: "Friday" }));
    await user.type(screen.getByRole("textbox", { name: "Price per hour" }), "300");
    await user.click(create);

    await waitFor(() => expect(actions.dismissOnboarding).toHaveBeenCalledTimes(1));
    expect(actions.saveOnboardingGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Advanced English",
        hourlyRate: 300,
        billing: undefined,
        weeklySchedule: [
          expect.objectContaining({ dayOfWeek: 2, startTime: "17:30" }),
          expect.objectContaining({ dayOfWeek: 5, startTime: "17:30" }),
        ],
      }),
    );
    expect(heading("Now you know how to teach with Hibi")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enter my Hibi" }));
    expect(onClose).toHaveBeenCalledWith("home");
  });

  it("asks for the amount of a monthly fee and explains when it is first due", async () => {
    const user = userEvent.setup();
    const { actions } = renderTutorial();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Skip to creating my group" }));
    await user.type(screen.getByRole("textbox", { name: "Group name" }), "Physics");
    await user.click(screen.getByRole("button", { name: "Monthly fee" }));
    expect(screen.getByRole("button", { name: "Create my agenda" })).toBeDisabled();
    // 21 October is past day 5, so the first fee is November's.
    expect(screen.getByText(/Billing starts in November/)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Monthly fee" }), "1200");
    await user.click(screen.getByRole("button", { name: "Create my agenda" }));
    await waitFor(() => expect(actions.saveOnboardingGroup).toHaveBeenCalledTimes(1));
    expect(actions.saveOnboardingGroup.mock.calls[0][0].billing).toMatchObject({
      mode: "monthly",
      monthlyFee: 1200,
      effectiveFrom: "2026-11",
    });
  });

  it("closes with «Not now» without creating anything, and keeps the form when saving fails", async () => {
    const user = userEvent.setup();
    const failing = renderTutorial({ saveGroup: async () => false });
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Skip to creating my group" }));
    await user.type(screen.getByRole("textbox", { name: "Group name" }), "Taken name");
    await user.click(screen.getByRole("button", { name: "Create my agenda" }));
    await waitFor(() => expect(failing.actions.saveOnboardingGroup).toHaveBeenCalledTimes(1));
    expect(failing.actions.dismissOnboarding).not.toHaveBeenCalled();
    expect(heading("Your first group")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(failing.onClose).toHaveBeenCalledWith());
    expect(failing.actions.dismissOnboarding).toHaveBeenCalledTimes(1);
  });

  it("keeps the app behind inert while it is open", () => {
    const { shell, view } = renderTutorial();
    expect(screen.getByRole("dialog", { name: "Welcome tutorial" })).toHaveAttribute("aria-modal", "true");
    expect(shell).toHaveAttribute("inert");
    expect(document.body).toHaveClass("onboarding-open");
    view.unmount();
    expect(shell).not.toHaveAttribute("inert");
    expect(document.body).not.toHaveClass("onboarding-open");
  });

  it("speaks Spanish", async () => {
    const user = userEvent.setup();
    renderTutorial({ language: "es" });
    expect(screen.getByRole("dialog", { name: "Tutorial de bienvenida" })).toBeInTheDocument();
    expect(heading("Tu día, de un vistazo")).toBeInTheDocument();
    expect(screen.getByText("7:30 a. m. · Inicio")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Saltar" }));
    expect(heading("Ahora dalo tú")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dar mi clase de práctica" }));
    expect(screen.getByRole("region", { name: "Guía" })).toHaveTextContent("Te toca: abre tu clase");
    expect(screen.getByText("Práctica · nada se guarda")).toBeInTheDocument();
  });
});
