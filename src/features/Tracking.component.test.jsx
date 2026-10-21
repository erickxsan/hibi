// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroup, createStarterState, createStudent } from "../domain";
import { useClassManager } from "../hooks/useClassManager";
import { I18nProvider } from "../i18n";
import { LANGUAGE_STORAGE_KEY } from "../i18n/translations";
import Tracking from "./Tracking";

const AS_OF = "2026-10-21";

function row(id, classDate, studentId, attendance, amountPaid, groupId = "g1") {
  return {
    id,
    classDate,
    studentId,
    groupId,
    startTime: "16:00",
    scheduleSlotId: "slot-mon",
    scheduleOccurrenceDate: classDate,
    classStatus: "Completed",
    attendance,
    hours: 2,
    appliedHourlyRate: 75,
    appliedCharge: attendance === "A" ? 0 : 150,
    amountPaid,
    paymentState: attendance === "A" ? "" : amountPaid ? "Paid" : "Pending",
    paymentDate: amountPaid ? classDate : null,
    paymentMethod: amountPaid ? "Cash" : "",
    paymentReference: "",
    notes: "",
  };
}

function trackingState() {
  const state = createStarterState({
    settings: { onboardingVersion: 2, onboardingStep: 9, asOfDate: AS_OF, hourlyRate: 100, defaultClassHours: 2 },
  });
  state.groups = [
    createGroup({
      id: "g1",
      name: "Primaria 5A",
      hourlyRate: 75,
      weeklySchedule: [{ id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 }],
    }),
    createGroup({
      id: "g2",
      name: "Prepa",
      weeklySchedule: [{ id: "slot-tue", dayOfWeek: 2, startTime: "17:00", durationHours: 1 }],
      billing: { mode: "monthly", monthlyFee: 1200, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
    }),
  ];
  state.students = [
    createStudent({ id: "s1", code: "LUN-1", fullName: "Luna López", groupIds: ["g1"], avatarId: "rabbit" }),
    createStudent({ id: "s2", code: "DIE-2", fullName: "Diego Soto", groupIds: ["g1"], avatarId: "bear" }),
    createStudent({ id: "s3", code: "SOF-3", fullName: "Sofía Martín", groupIds: ["g2"], avatarId: "owl" }),
  ];
  state.classLog = [
    row("r1", "2026-10-05", "s1", "A", 0),
    row("r2", "2026-10-05", "s2", "P", 150),
    row("r3", "2026-10-12", "s1", "A", 0),
    row("r4", "2026-10-12", "s2", "P", 150),
    row("r5", "2026-10-19", "s1", "P", 0),
    row("r6", "2026-10-19", "s2", "P", 150),
  ];
  return state;
}

function Harness({ persistence, openPage }) {
  const manager = useClassManager({ persistence });
  return (
    <I18nProvider>
      <Tracking {...manager} openPage={openPage} />
    </I18nProvider>
  );
}

function setup(state = trackingState()) {
  const persistence = { initialState: state, mode: "cloud", save: vi.fn(async (next) => next) };
  const openPage = vi.fn();
  render(<Harness persistence={persistence} openPage={openPage} />);
  return { persistence, openPage, saved: () => persistence.save.mock.calls.at(-1)?.[0] };
}

function setCompact(matches) {
  window.matchMedia.mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  setCompact(false);
});

describe("Tracking on desktop", () => {
  it("opens on attendance and filters the list from a figure", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("tab", { name: "Attendance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Average attendance")).toBeInTheDocument();
    const list = screen.getByRole("complementary", { name: "Students · lowest attendance first" });
    const names = within(list)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names[0]).toContain("Luna López");
    await user.click(screen.getByRole("button", { name: /Below 80%/ }));
    const filtered = screen.getByRole("complementary", { name: /Students · 1 in the filter/ });
    expect(within(filtered).getAllByRole("button")).toHaveLength(1);
    expect(within(filtered).getByText("Luna López")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("complementary", { name: "Students · lowest attendance first" })).toBeInTheDocument();
  });

  it("opens a student's history and leads to their profile", async () => {
    const user = userEvent.setup();
    const { openPage } = setup();
    await user.click(screen.getByRole("button", { name: /Diego Soto/ }));
    const history = screen.getByRole("region", { name: "Diego Soto" });
    expect(within(history).getByRole("table", { name: "History of Diego Soto" })).toBeInTheDocument();
    expect(within(history).getAllByRole("row").length).toBeGreaterThan(1);
    await user.click(within(history).getByRole("button", { name: "View profile" }));
    expect(openPage).toHaveBeenCalledWith("community", { type: "open-student", id: "s2" });
  });

  it("scopes the figures to one group", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Prepa" }));
    const list = screen.getByRole("complementary", { name: "Students · lowest attendance first" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(within(list).getByText("Sofía Martín")).toBeInTheDocument();
  });

  it("marks a monthly fee as paid from the Payments tab", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("tab", { name: "Payments" }));
    expect(screen.getByText("Monthly fees · October")).toBeInTheDocument();
    expect(screen.getByText("0 of 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark paid" }));
    await waitFor(() =>
      expect(saved().students.find((student) => student.id === "s3").monthlyPayments).toEqual([
        expect.objectContaining({ groupId: "g2", period: "2026-10", amount: 1200 }),
      ]),
    );
    expect(await screen.findByText("1 of 1")).toBeInTheDocument();
  });

  it("lists every record in the breakdown without charging absences", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Breakdown" }));
    const table = screen.getByRole("table", { name: "Records" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    const absent = rows.filter((item) => item.textContent.includes("Absent"));
    expect(absent).toHaveLength(2);
    for (const item of absent) expect(item.textContent).not.toMatch(/Pending|Paid/);
  });
});

describe("Tracking on mobile", () => {
  it("shows the bars, the filter chips and the student sheet", async () => {
    setCompact(true);
    const user = userEvent.setup();
    setup();
    const chips = screen.getByRole("group", { name: "Filter students" });
    await user.click(within(chips).getByRole("button", { name: /With absences/ }));
    expect(screen.getAllByRole("button", { name: /^Open |Luna López/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Diego Soto")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Luna López/ }));
    expect(await screen.findByRole("dialog", { name: "Luna López" })).toBeInTheDocument();
  });
});
