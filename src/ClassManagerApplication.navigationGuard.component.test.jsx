// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClassManagerApplication from "./ClassManagerApplication";
import { createGroup, createStarterState, createStudent, serializeState, STORAGE_KEY } from "./domain";
import { I18nProvider } from "./i18n";

function seededState() {
  const state = createStarterState({ settings: { onboardingVersion: 2, onboardingStep: 9, hourlyRate: 100 } });
  state.groups = [
    createGroup({
      id: "g1",
      name: "Math",
      hourlyRate: 100,
      // Every day at 10:00, so there is always a class to record today.
      weeklySchedule: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        id: `slot-${day}`,
        dayOfWeek: day,
        startTime: "10:00",
        durationHours: 1,
      })),
    }),
  ];
  state.students = [createStudent({ id: "s1", code: "A-1", fullName: "Ana", groupIds: ["g1"], status: "Active" })];
  return state;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hibi:language:v1", "en");
  localStorage.setItem(STORAGE_KEY, serializeState(seededState()));
  window.history.replaceState({}, "", "/");
});

const markAnaPresent = async (user) => {
  const attendance = await screen.findByRole("group", { name: "Attendance for Ana" });
  await user.click(within(attendance).getByRole("button", { name: "Present" }));
};
const go = (user, name) =>
  user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name }));
const classesHeading = () => screen.queryByRole("heading", { name: "Classes", level: 1 });

describe("unsaved class changes guard", () => {
  it("asks in-app before leaving, for links and for browser Back, and finishes the move once accepted", async () => {
    const user = userEvent.setup();
    const nativeConfirm = vi.spyOn(globalThis, "confirm");
    render(
      <I18nProvider>
        <ClassManagerApplication />
      </I18nProvider>,
    );
    await screen.findByRole("navigation", { name: "Primary navigation" });
    await go(user, "Classes");
    await screen.findByRole("heading", { name: "Classes", level: 1 });
    await markAnaPresent(user);

    // A navigation link: «Seguir editando» stays, with the draft intact.
    await go(user, "Home");
    const question = await screen.findByRole("alertdialog", { name: "Discard your unsaved class changes?" });
    await user.click(within(question).getByRole("button", { name: "Keep editing" }));
    expect(window.location.pathname).toBe("/classes");
    expect(
      within(screen.getByRole("group", { name: "Attendance for Ana" })).getByRole("button", { name: "Present" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Browser Back: blocked and restored while the question is open, then replayed after the answer.
    window.history.back();
    const backQuestion = await screen.findByRole("alertdialog", { name: "Discard your unsaved class changes?" });
    await waitFor(() => expect(window.location.pathname).toBe("/classes"));
    expect(classesHeading()).toBeInTheDocument();
    await user.click(within(backQuestion).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await waitFor(() => expect(classesHeading()).not.toBeInTheDocument());

    // Forward still leads to Classes: the replay moved through history instead of pushing a new entry.
    window.history.forward();
    await screen.findByRole("heading", { name: "Classes", level: 1 });
    expect(window.location.pathname).toBe("/classes");

    // «Descartar cambios» after a link replays the same click.
    await markAnaPresent(user);
    await go(user, "Home");
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(classesHeading()).not.toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  }, 30_000);
});

describe("unsaved Community changes guard", () => {
  it("asks once when Back leaves the page from a non-default view with an open, edited student", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <ClassManagerApplication />
      </I18nProvider>,
    );
    await go(user, "Community");
    await screen.findByRole("heading", { name: "Community", level: 1 }, { timeout: 15000 });
    await user.click(screen.getByRole("tab", { name: "Students" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Students" })).toHaveAttribute("aria-selected", "true"));
    await user.click(await screen.findByRole("button", { name: "Open Ana" }, { timeout: 10000 }));
    await user.type(await screen.findByLabelText("Short notes"), "dirty");

    // Back two entries (Students view, then Home): the view and drawer guards must not ask again.
    window.history.go(-2);
    const question = await screen.findByRole("alertdialog");
    await waitFor(() => expect(window.location.pathname).toBe("/community"));
    await user.click(within(question).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Community", level: 1 })).not.toBeInTheDocument());
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0);
  }, 30_000);
});
