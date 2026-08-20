// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Classes from "./Classes";
import { buildClassWorkspaceSessions } from "./classesWorkspaceModel";

const AS_OF_DATE = "2026-07-15";

function classState() {
  return {
    settings: { asOfDate: AS_OF_DATE, defaultClassHours: 2, hourlyRate: 100 },
    groups: [
      { id: "g1", name: "Math", hourlyRate: 100, weeklySchedule: [] },
      { id: "g2", name: "Science", hourlyRate: 100, weeklySchedule: [] },
    ],
    students: [
      { id: "s1", code: "A-1", fullName: "Ana", groupIds: ["g1"], status: "Active" },
      { id: "s2", code: "B-2", fullName: "Ben", groupIds: ["g2"], status: "Active" },
    ],
    classSchedules: [
      {
        id: "cs1",
        recurrence: "weekly",
        format: "group",
        groupId: "g1",
        startDate: AS_OF_DATE,
        startTime: "10:00",
        durationHours: 2,
        intervalWeeks: 1,
        daysOfWeek: [3],
      },
    ],
    classLog: [],
    grades: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

function withRemoteGrade(state) {
  const session = buildClassWorkspaceSessions(state, AS_OF_DATE).find((item) => item.classDate === AS_OF_DATE);
  return {
    ...state,
    grades: [
      {
        id: "grade-remote",
        date: AS_OF_DATE,
        studentId: "s1",
        assessment: "Remote quiz",
        score: 12,
        maxScore: 20,
        classSessionKey: session.key,
      },
    ],
  };
}

function renderClasses(state = classState()) {
  let navigationBlocker = () => "";
  const registerNavigationBlocker = vi.fn((blocker) => {
    navigationBlocker = blocker;
    return () => {};
  });
  const props = {
    state,
    actions: {
      saveProgress: vi.fn().mockResolvedValue(true),
      upsertClassSchedule: vi.fn().mockResolvedValue(true),
      notify: vi.fn(),
    },
    asOfDate: AS_OF_DATE,
    registerNavigationBlocker,
  };
  const view = render(<Classes {...props} />);
  return {
    ...view,
    actions: props.actions,
    rerenderState(nextState) {
      props.state = nextState;
      view.rerender(<Classes {...props} />);
    },
    navigationWarning: () => navigationBlocker(),
  };
}

async function markAnaAbsent(user) {
  const attendance = screen.getByRole("group", { name: "Attendance for Ana" });
  await user.click(within(attendance).getByTitle("Absent"));
  return within(attendance).getByTitle("Absent");
}

describe("Classes remote draft safety", () => {
  it("does not rehydrate a dirty draft for an unrelated state update", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    const absent = await markAnaAbsent(user);

    view.rerenderState({
      ...state,
      students: state.students.map((student) =>
        student.id === "s2" ? { ...student, fullName: "Ben Updated Elsewhere" } : student,
      ),
    });

    expect(absent).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);
  });

  it("keeps the open session when the remote update completes that class", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    const absent = await markAnaAbsent(user);

    view.rerenderState({
      ...state,
      classLog: [
        {
          id: "class-remote",
          classDate: AS_OF_DATE,
          studentId: "s1",
          groupId: "g1",
          startTime: "10:00",
          classStatus: "Completed",
          attendance: "P",
          hours: 2,
          amountPaid: 200,
          paymentState: "Paid",
        },
      ],
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(absent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);
  });

  it("keeps or reloads the draft only after an explicit choice", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    const absent = await markAnaAbsent(user);

    view.rerenderState(withRemoteGrade(state));
    expect(await screen.findByRole("alert")).toHaveTextContent("Newer class data is available");
    expect(absent).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save class" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Keep my draft" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(absent).toHaveAttribute("aria-pressed", "true");
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);

    view.rerenderState({ ...withRemoteGrade(state), grades: [] });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload remote version" }));
    expect(within(screen.getByRole("group", { name: "Attendance for Ana" })).getByTitle("Present")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.navigationWarning()).toBe("");
  });

  it("rebases local fields onto the latest remote class data", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    await markAnaAbsent(user);

    view.rerenderState(withRemoteGrade(state));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rebase my draft" }));

    expect(within(screen.getByRole("group", { name: "Attendance for Ana" })).getByTitle("Absent")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Assignment name" })).toHaveValue("Remote quiz");
    expect(screen.getByRole("spinbutton", { name: /Grade for Ana/ })).toHaveValue(12);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);
  });

  it("saves the merged remote data without losing local attendance or payment", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    await markAnaAbsent(user);
    await user.click(
      within(screen.getByRole("group", { name: "Payment for Ana" })).getByRole("button", { name: "Paid" }),
    );

    view.rerenderState(withRemoteGrade(state));
    await user.click(await screen.findByRole("button", { name: "Rebase my draft" }));
    await user.click(screen.getByRole("button", { name: "Save class" }));

    await waitFor(() => expect(view.actions.saveProgress).toHaveBeenCalledOnce());
    expect(view.actions.saveProgress).toHaveBeenCalledWith({
      classRecords: [
        expect.objectContaining({ studentId: "s1", attendance: "A", paymentState: "Paid", amountPaid: 200 }),
      ],
      gradeRecords: [
        expect.objectContaining({
          id: "grade-remote",
          studentId: "s1",
          assessment: "Remote quiz",
          score: 12,
          maxScore: 20,
        }),
      ],
    });
    expect(view.navigationWarning()).toBe("");
  });

  it("keeps a dirty draft when navigation is rejected and discards it only after confirmation", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(globalThis, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const view = renderClasses();
    await markAnaAbsent(user);

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("tab", { name: "Next class" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("group", { name: "Attendance for Ana" })).getByTitle("Absent")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: /Wednesday, July 15, 1 class/ }));
    const calendarView = screen.getByRole("group", { name: "Calendar view" });
    await user.click(within(calendarView).getByRole("button", { name: "Week" }));
    await user.click(screen.getByRole("checkbox", { name: "Show weekends" }));
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await user.click(screen.getByRole("button", { name: "Today" }));
    const ownerFilter = screen.getByRole("combobox", { name: "Filter calendar by student or group" });
    await user.click(ownerFilter);
    await user.click(screen.getByRole("option", { name: "Math" }));
    await user.click(ownerFilter);
    await user.click(screen.getByRole("option", { name: "All classes" }));
    await user.click(screen.getByRole("button", { name: "Search calendar" }));

    const agenda = screen.getByRole("complementary", { name: /Classes on/ });
    await user.click(within(agenda).getByText("Math"));
    await user.click(within(agenda).getByRole("button", { name: "Open class" }));

    expect(screen.getByRole("tab", { name: "Next class" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("group", { name: "Attendance for Ana" })).getByTitle("Present")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(view.navigationWarning()).toBe("");
    confirm.mockRestore();
  }, 10_000);

  it("creates a class through the same workspace after draft-safe navigation", async () => {
    const user = userEvent.setup();
    const view = renderClasses();

    await user.click(screen.getByRole("button", { name: "New class" }));
    await user.click(within(screen.getByRole("group", { name: "Class frequency" })).getAllByRole("button")[0]);
    await user.click(screen.getByRole("button", { name: "Create class" }));

    await waitFor(() => expect(view.actions.upsertClassSchedule).toHaveBeenCalledOnce());
    expect(view.actions.upsertClassSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence: "once", format: "group", groupId: "g1", startDate: AS_OF_DATE }),
    );
  });
});
