// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ClassManagerApplication from "./ClassManagerApplication.jsx";
import { createStarterState, STORAGE_KEY } from "./domain/index.js";
import { I18nProvider } from "./i18n/index.jsx";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hibi:language:v1", "en");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(createStarterState({ settings: { onboardingVersion: 2 } })));
});
describe("application with the real local manager", () => {
  it("creates a scheduled group and student through the routed UI, and retains both after remount", async () => {
    const user = userEvent.setup();
    const view = render(
      <I18nProvider>
        <ClassManagerApplication />
      </I18nProvider>,
    );
    await screen.findByRole("navigation", { name: "Primary navigation" });
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Community" }),
    );
    await screen.findByRole("heading", { name: "Community", exact: true });
    await user.click(screen.getByRole("button", { name: "Create group", exact: true }));
    const group = await screen.findByRole("dialog", { name: "Create group" });
    fireEvent.change(within(group).getByLabelText(/Group name/), { target: { value: "Home" } });
    await user.click(within(group).getByRole("button", { name: "Add time" }));
    fireEvent.change(within(group).getByLabelText("Time"), { target: { value: "18:30" } });
    await user.click(within(group).getByRole("button", { name: "Save group" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create group" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Add student", exact: true }));
    const student = await screen.findByRole("dialog", { name: "Add student" });
    fireEvent.change(within(student).getByLabelText(/Student ID/), { target: { value: "APP-1" } });
    fireEvent.change(within(student).getByLabelText(/Full name/), { target: { value: "Tracking" } });
    await user.click(within(student).getByRole("button", { name: "Save student" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add student" })).not.toBeInTheDocument());
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(stored.groups[0]).toMatchObject({
      name: "Home",
      weeklySchedule: [expect.objectContaining({ startTime: "18:30" })],
    });
    expect(stored.students[0]).toMatchObject({ code: "APP-1", fullName: "Tracking" });
    view.unmount();
    render(
      <I18nProvider>
        <ClassManagerApplication />
      </I18nProvider>,
    );
    expect(await screen.findByRole("button", { name: "Open Tracking", exact: true })).toBeInTheDocument();
  }, 30000);
});
