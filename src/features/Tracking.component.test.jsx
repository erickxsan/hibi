// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Tracking from "./Tracking";

const state = {
  settings: { asOfDate: "2026-07-25", lowAttendanceThreshold: 0.8 },
  groups: [{ id: "g1", name: "Math" }],
  students: [
    { id: "s1", fullName: "Ana", code: "A-1", status: "Active", groupIds: ["g1"] },
    { id: "s2", fullName: "Ben", code: "B-2", status: "Active", groupIds: ["g1"] },
  ],
  grades: [
    {
      id: "grade-1",
      date: "2026-07-20",
      studentId: "s1",
      studentName: "Ana",
      assessment: "Fractions",
      score: 9,
      maxScore: 10,
      classSessionKey: "2026-07-20|g:g1|10:00",
    },
    {
      id: "grade-2",
      date: "2026-07-20",
      studentId: "s2",
      studentName: "Ben",
      assessment: "Fractions",
      score: 7,
      maxScore: 10,
      classSessionKey: "2026-07-20|g:g1|10:00",
    },
  ],
};

const classRows = [
  {
    id: "c1",
    classDate: "2026-07-20",
    startTime: "10:00",
    groupId: "g1",
    groupName: "Math",
    studentId: "s1",
    studentName: "Ana",
    classStatus: "Completed",
    attendance: "P",
    charge: 100,
    recognizedPaid: 100,
    outstanding: 0,
    paymentDate: "2026-07-20",
  },
  {
    id: "c2",
    classDate: "2026-07-20",
    startTime: "10:00",
    groupId: "g1",
    groupName: "Math",
    studentId: "s2",
    studentName: "Ben",
    classStatus: "Completed",
    attendance: "A",
    charge: 100,
    recognizedPaid: 0,
    outstanding: 100,
    paymentDate: "",
  },
];

function renderTracking({ notify = vi.fn(), openPage = vi.fn() } = {}) {
  return {
    notify,
    openPage,
    ...render(
      <Tracking state={state} derived={{ classLogRows: classRows }} actions={{ notify }} openPage={openPage} />,
    ),
  };
}

describe("Tracking attendance overview", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("opens the global P/A overview and preserves the existing breakdown", async () => {
    const user = userEvent.setup();
    const view = renderTracking();

    await user.click(screen.getByRole("tab", { name: "Attendance" }));

    const scope = screen.getByRole("group", { name: "Scope" });
    expect(within(scope).getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("All groups, students, and classes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Students requiring follow-up" })).toBeInTheDocument();
    expect(screen.getByText("P / (P + A)")).toBeInTheDocument();
    expect(screen.queryByText("Late")).not.toBeInTheDocument();
    expect(screen.queryByText("Excused")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "View related class" })[0]);
    expect(view.openPage).toHaveBeenCalledWith("classes", {
      type: "open-history-class",
      sessionKey: "2026-07-20|g:g1|10:00",
    });

    await user.click(within(scope).getByRole("button", { name: "Breakdown" }));

    expect(screen.getByRole("group", { name: "View by" })).toBeInTheDocument();
    expect(screen.getByText("Attendance summary")).toBeInTheDocument();
    expect(screen.queryByText("All groups, students, and classes")).not.toBeInTheDocument();
  });

  it("keeps report controls and payment analytics working alongside the attendance overview", async () => {
    const user = userEvent.setup();
    const view = renderTracking();
    const createObjectURL = vi.fn(() => "blob:tracking-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    expect(screen.getAllByText("9 / 10")).not.toHaveLength(0);
    await user.click(screen.getByRole("tab", { name: "Attendance" }));
    await user.type(screen.getByPlaceholderText("Search students or groups…"), "Ana");
    expect(screen.getByText("Ana")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export Excel" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(view.notify).toHaveBeenCalledWith("Excel export downloaded");

    await user.click(screen.getByRole("button", { name: "Report date" }));
    await user.click(screen.getByRole("button", { name: "Choose another date" }));
    const dateInput = screen.getByLabelText("Show data through");
    await user.clear(dateInput);
    await user.type(dateInput, "2026-07-20");
    await user.click(screen.getByRole("button", { name: "Apply date" }));
    expect(screen.getByText("Historical view")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Payments" }));
    expect(screen.getByText("Payment summary")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Payment evolution" }));
    expect(screen.getByRole("tab", { name: "Payment evolution" })).toHaveClass("active");

    anchorClick.mockRestore();
  });
});
