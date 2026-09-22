// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createGroup, createStarterState, createStudent, deriveAll } from "../domain";
import { I18nProvider } from "../i18n";
import Community from "./Community";

function CommunityHarness() {
  const [state, setState] = useState(() => {
    const initial = createStarterState("2026-09-22");
    initial.students = [
      createStudent({ id: "active", code: "ACTIVE-1", fullName: "Active student", status: "Active" }),
      createStudent({ id: "inactive", code: "INACTIVE-1", fullName: "Inactive student", status: "Inactive" }),
    ];
    initial.groups = [createGroup({ id: "group", name: "Test group" })];
    initial.students = initial.students.map((student) => ({ ...student, groupIds: ["group"] }));
    return initial;
  });
  const derived = useMemo(() => deriveAll(state, "2026-09-22"), [state]);
  const actions = {
    archiveStudent: async (id) => {
      setState((current) => ({
        ...current,
        students: current.students.map((student) => (student.id === id ? { ...student, status: "Inactive" } : student)),
      }));
      return true;
    },
    deleteStudent: vi.fn(),
    deleteGroup: vi.fn(),
    upsertStudent: async (updated) => {
      setState((current) => ({
        ...current,
        students: current.students.map((student) => (student.id === updated.id ? updated : student)),
      }));
      return true;
    },
    upsertGroup: vi.fn(),
  };

  return (
    <I18nProvider>
      <Community state={state} derived={derived} actions={actions} registerNavigationBlocker={() => () => {}} />
    </I18nProvider>
  );
}

describe("Community active student count", () => {
  it("decrements after an active student is deactivated", async () => {
    const user = userEvent.setup();
    render(<CommunityHarness />);

    const counter = screen.getByText("Active students").closest(".community-active-count");
    expect(within(counter).getByText("1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deactivate student" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Active student?" });
    await user.click(within(dialog).getByRole("button", { name: "Deactivate student" }));

    expect(within(counter).getByText("0")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Groups", exact: true }));
    const detail = screen.getByRole("region", { name: "Test group" });
    expect(within(detail).getByText("0 students")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Manage students" }));
    const manager = screen.getByRole("region", { name: "Manage group students" });
    expect(within(manager).getAllByRole("checkbox")).toHaveLength(2);
    within(manager)
      .getAllByRole("checkbox")
      .forEach((checkbox) => expect(checkbox).toBeChecked());
  });

  it("excludes inactive students from assigned-group and group-detail counts", async () => {
    const user = userEvent.setup();
    render(<CommunityHarness />);
    expect(screen.getByText("1 member")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Groups", exact: true }));
    const detail = screen.getByRole("region", { name: "Test group" });
    expect(within(detail).getByText("1 student")).toBeInTheDocument();
    expect(within(detail).queryByText("Inactive student")).not.toBeInTheDocument();
  });
});

describe("Community archived students", () => {
  it("hides inactive students until expanded and returns reactivated students to the main list", async () => {
    const user = userEvent.setup();
    render(<CommunityHarness />);
    await user.click(screen.getByRole("tab", { name: "Students", exact: true }));
    const archive = screen.getByRole("button", { name: /Archived/ });
    expect(archive).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Inactive student")).not.toBeInTheDocument();
    await user.click(archive);
    expect(archive).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: /Inactive student INACTIVE-1/ }));
    expect(screen.getByDisplayValue("Inactive student")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reactivate", exact: true }));
    expect(screen.getByRole("button", { name: "Open Inactive student" })).toBeInTheDocument();
    expect(archive).toHaveTextContent("0");
    const counter = screen.getByText("Active students").closest(".community-active-count");
    expect(counter).toHaveTextContent("2");
    await user.click(archive);
    expect(screen.getByRole("button", { name: "Open Inactive student" })).toBeInTheDocument();
  });

  it("moves a deactivated student into the collapsed archive", async () => {
    const user = userEvent.setup();
    render(<CommunityHarness />);
    await user.click(screen.getByRole("button", { name: "Deactivate student" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Active student?" });
    await user.click(within(dialog).getByRole("button", { name: "Deactivate student" }));
    expect(screen.queryByRole("button", { name: "Open Active student" })).not.toBeInTheDocument();
    const archive = screen.getByRole("button", { name: /Archived/ });
    expect(archive).toHaveAttribute("aria-expanded", "false");
    expect(archive).toHaveTextContent("2");
    await user.click(archive);
    expect(screen.getByRole("button", { name: /Active student ACTIVE-1/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Inactive student INACTIVE-1/ }));
    await user.click(archive);
    expect(screen.queryByDisplayValue("Inactive student")).not.toBeInTheDocument();
  });
});
