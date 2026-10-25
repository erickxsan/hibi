// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Classes from "./Classes";
import { EditClassDrawer } from "./EditClassDrawer";
import { buildClassWorkspaceSessions } from "./classesWorkspaceModel";
import { formatShortDate } from "../utils/displayFormat";

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

function renderClasses(state = classState(), overrides = {}) {
  let navigationBlocker = () => "";
  const registerNavigationBlocker = vi.fn((blocker) => {
    navigationBlocker = blocker;
    return () => {};
  });
  const props = {
    state,
    ...overrides,
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

async function markAnaPresent(user) {
  const attendance = screen.getByRole("group", { name: "Attendance for Ana" });
  await user.click(within(attendance).getByRole("button", { name: "Present" }));
  return within(attendance).getByRole("button", { name: "Present" });
}

describe("Classes remote draft safety", () => {
  it("starts new attendance unmarked", () => {
    renderClasses();
    const attendance = screen.getByRole("group", { name: "Attendance for Ana" });
    expect(within(attendance).getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "false");
    expect(within(attendance).getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not rehydrate a dirty draft for an unrelated state update", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    const present = await markAnaPresent(user);

    view.rerenderState({
      ...state,
      students: state.students.map((student) =>
        student.id === "s2" ? { ...student, fullName: "Ben Updated Elsewhere" } : student,
      ),
    });

    expect(present).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);
  });

  it("keeps the open session when the remote update completes that class", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    const present = await markAnaPresent(user);

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
    expect(present).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);
  });

  it("keeps or reloads the draft only after an explicit choice", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    const present = await markAnaPresent(user);

    view.rerenderState(withRemoteGrade(state));
    expect(await screen.findByRole("alert")).toHaveTextContent("Newer class data is available");
    expect(present).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save class" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Keep my draft" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(present).toHaveAttribute("aria-pressed", "true");
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);

    view.rerenderState({ ...withRemoteGrade(state), grades: [] });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload remote version" }));
    expect(
      within(screen.getByRole("group", { name: "Attendance for Ana" })).getByRole("button", { name: "Present" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(view.navigationWarning()).toBe("");
  });

  it("rebases local fields onto the latest remote class data", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    await markAnaPresent(user);

    view.rerenderState(withRemoteGrade(state));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rebase my draft" }));

    expect(
      within(screen.getByRole("group", { name: "Attendance for Ana" })).getByRole("button", { name: "Present" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Assignment name" })).toHaveValue("Remote quiz");
    expect(screen.getByRole("textbox", { name: /Grade for Ana/ })).toHaveValue("12");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.navigationWarning()).toMatch(/Discard your unsaved class changes/);
  });

  it("saves the merged remote data without losing local attendance or payment", async () => {
    const user = userEvent.setup();
    const state = classState();
    const view = renderClasses(state);
    await markAnaPresent(user);
    await user.click(
      within(screen.getByRole("group", { name: "Payment for Ana" })).getByRole("button", { name: "Paid" }),
    );

    view.rerenderState(withRemoteGrade(state));
    await user.click(await screen.findByRole("button", { name: "Rebase my draft" }));
    await user.click(screen.getByRole("button", { name: "Save class" }));

    await waitFor(() => expect(view.actions.saveProgress).toHaveBeenCalledOnce());
    expect(view.actions.saveProgress).toHaveBeenCalledWith({
      classRecords: [
        expect.objectContaining({ studentId: "s1", attendance: "P", paymentState: "Paid", amountPaid: 200 }),
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
    const nativeConfirm = vi.spyOn(globalThis, "confirm");
    const view = renderClasses();
    await markAnaPresent(user);

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    const question = screen.getByRole("alertdialog", { name: "Discard your unsaved class changes?" });
    expect(within(question).getByRole("button", { name: "Discard changes" })).toHaveClass("button-danger");
    await user.click(within(question).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Next class" })).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByRole("group", { name: "Attendance for Ana" })).getByRole("button", { name: "Present" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Next month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: /^July 15, 1 class/ }));
    await user.click(screen.getByRole("button", { name: "Record class" }));

    expect(screen.getByRole("tab", { name: "Next class" })).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByRole("group", { name: "Attendance for Ana" })).getByRole("button", { name: "Present" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(view.navigationWarning()).toBe("");
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
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

describe("historical settlement", () => {
  it.each([50, 200])("settles the frozen charge after the live rate becomes %s", async (rate) => {
    const user = userEvent.setup();
    const state = classState();
    state.groups[0].hourlyRate = rate;
    state.classLog = [
      {
        id: "historic",
        classDate: AS_OF_DATE,
        studentId: "s1",
        groupId: "g1",
        startTime: "10:00",
        classStatus: "Completed",
        attendance: "P",
        hours: 2,
        appliedHourlyRate: 100,
        appliedCharge: 175.5,
        amountPaid: 25,
        paymentDate: AS_OF_DATE,
        paymentState: "Pending",
      },
    ];
    const session = buildClassWorkspaceSessions(state, AS_OF_DATE).find((item) =>
      item.rows?.some((row) => row.id === "historic"),
    );
    const view = renderClasses(state, {
      intent: { type: "open-history-class", sessionKey: session.key },
      clearIntent: vi.fn(),
    });
    await user.click(await screen.findByRole("button", { name: "Edit record" }));
    await screen.findByRole("button", { name: "Save changes" });
    await user.click(
      within(screen.getByRole("group", { name: "Payment for Ana" })).getByRole("button", { name: "Paid" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(view.actions.saveProgress).toHaveBeenCalledOnce());
    const payload = view.actions.saveProgress.mock.calls[0][0];
    expect(payload.classRecords[0]).toMatchObject({ appliedCharge: 175.5, appliedHourlyRate: 100, amountPaid: 175.5 });
  });
});

describe("recording a class without native dialogs", () => {
  it("asks in-app before saving with unmarked students", async () => {
    const user = userEvent.setup();
    const nativeConfirm = vi.spyOn(globalThis, "confirm");
    const view = renderClasses();

    await user.click(screen.getByRole("button", { name: "Save class" }));
    const question = screen.getByRole("alertdialog", { name: "1 student is still unmarked. Save anyway?" });
    expect(within(question).getByRole("button", { name: "Save anyway" })).toHaveClass("button-primary");
    await user.click(within(question).getByRole("button", { name: "Keep marking" }));
    expect(view.actions.saveProgress).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save class" }));
    await user.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(view.actions.saveProgress).toHaveBeenCalledOnce());
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("keeps «Mark cancelled» away from Save and cancels only after a destructive confirmation", async () => {
    const user = userEvent.setup();
    const view = renderClasses();
    const bar = document.querySelector(".sheet-bar-actions");
    expect(within(bar).getByRole("button", { name: "Save class" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Mark cancelled" })).not.toBeInTheDocument();

    const cancel = screen.getByRole("button", { name: "Mark cancelled" });
    await user.click(cancel);
    const question = screen.getByRole("alertdialog", { name: "Mark this class as cancelled?" });
    expect(question).toHaveAccessibleDescription("Existing payments will be preserved.");
    expect(within(question).getByRole("button", { name: "Keep class" })).toHaveFocus();
    expect(within(question).getByRole("button", { name: "Mark cancelled" })).toHaveClass("button-danger");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(cancel).toHaveFocus();
    expect(view.actions.saveProgress).not.toHaveBeenCalled();

    await user.click(cancel);
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark cancelled" }));
    await waitFor(() => expect(view.actions.saveProgress).toHaveBeenCalledOnce());
    expect(view.actions.saveProgress.mock.calls[0][0].classRecords[0]).toMatchObject({ classStatus: "Cancelled" });
  });

  it("uses a one-row mobile dock with Save only and a quiet cancel action below the roster", async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    try {
      renderClasses();
      const dock = document.querySelector(".register-dock");
      expect(
        within(dock)
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Save class"]);
      expect(dock).toHaveTextContent("Nobody marked yet");
      expect(screen.queryByRole("button", { name: "Cancelled" })).not.toBeInTheDocument();
      const row = document.querySelector(".register-cancel-row");
      expect(row).toHaveTextContent("Class didn't happen?");
      await user.click(within(row).getByRole("button", { name: "Mark cancelled" }));
      expect(screen.getByRole("alertdialog", { name: "Mark this class as cancelled?" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });
});

describe("class notes and the «Not recorded» list", () => {
  it("dates every row that is still waiting to be recorded", () => {
    const state = classState();
    state.classSchedules.push({
      id: "cs2",
      recurrence: "weekly",
      format: "group",
      groupId: "g2",
      startDate: "2026-07-01",
      startTime: "17:00",
      durationHours: 2,
      intervalWeeks: 1,
      daysOfWeek: [2, 6],
    });
    renderClasses(state);
    const rail = screen.getByRole("complementary", { name: "Week schedule" });
    const rows = within(rail)
      .getAllByRole("button")
      .filter((button) => button.classList.contains("agenda-item"));
    const pending = rows.filter((row) => row.classList.contains("has-date"));
    expect(pending.map((row) => row.querySelector("time").textContent)).toEqual([
      `${formatShortDate("2026-07-04", "en-MX")}5:00 p.m.`,
      `${formatShortDate("2026-07-07", "en-MX")}5:00 p.m.`,
      `${formatShortDate("2026-07-11", "en-MX")}5:00 p.m.`,
      "Yesterday5:00 p.m.",
    ]);
    expect(pending[3].querySelector(".agenda-date")).toHaveTextContent("Yesterday");
    // Upcoming classes stay under their day headings, with only the time on the row.
    expect(
      rows.filter((row) => !row.classList.contains("has-date")).map((row) => row.querySelector("time").textContent),
    ).toEqual(["10:00 a.m.", "5:00 p.m."]);
  });

  it("says how many classes a debt spans", () => {
    const owed = (classDate, outstanding) => ({
      studentId: "s1",
      groupId: "g1",
      classDate,
      classStatus: "Completed",
      attendance: "P",
      outstanding,
    });
    const view = renderClasses(classState(), {
      derived: { classLog: [owed("2026-07-01", 200), owed("2026-07-08", 150)] },
    });
    const since = formatShortDate("2026-07-01", "en-MX", { weekday: false });
    expect(screen.getByText(`Owes $350 from 2 classes since ${since}`)).toBeInTheDocument();
    view.unmount();

    renderClasses(classState(), { derived: { classLog: [owed("2026-07-08", 150)] } });
    const on = formatShortDate("2026-07-08", "en-MX", { weekday: false });
    expect(screen.getByText(`Owes $150 from the class on ${on}`)).toBeInTheDocument();
  });
});

describe("new recurring class for a group", () => {
  it("opens on a free time, blocks a duplicate slot and points to the weekly schedule", async () => {
    const user = userEvent.setup();
    const openPage = vi.fn(() => true);
    const state = classState();
    // Math meets Wed 10:00 (today) and Thu 16:00.
    state.classSchedules.push({ ...state.classSchedules[0], id: "cs2", startTime: "16:00", daysOfWeek: [4] });
    const view = renderClasses(state, { openPage });

    await user.click(screen.getByRole("button", { name: "New class" }));
    const drawer = screen.getByRole("dialog", { name: "New class" });
    // Today's 10:00 is taken, so the draft starts at the next usual free time and says nothing about the schedule.
    expect(within(drawer).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(drawer).queryByText("Weekly schedule of Math")).not.toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Create class" })).toBeEnabled();

    // Adding Thursday repeats the Thu 4:00 p.m. slot: the schedule note appears with the warning.
    await user.click(within(drawer).getByRole("button", { name: "Thursday" }));
    expect(within(drawer).getByText("Weekly schedule of Math")).toBeInTheDocument();
    expect(within(drawer).getByRole("alert")).toHaveTextContent(/This group already meets at this time \(Thu 4:00/);
    expect(within(drawer).getByRole("button", { name: "Create class" })).toBeDisabled();

    await user.click(within(drawer).getByRole("button", { name: "Edit weekly schedule" }));
    expect(openPage).toHaveBeenCalledWith("community", "groups");
    expect(view.actions.upsertClassSchedule).not.toHaveBeenCalled();
  });
});

describe("month calendar labels", () => {
  it("shows the hour as a time, keeps full names in the tooltip and accessible name, and fits four classes", async () => {
    const user = userEvent.setup();
    const state = classState();
    const extra = (id, startTime, daysOfWeek) => ({
      id,
      recurrence: "weekly",
      format: "group",
      groupId: "g2",
      startDate: AS_OF_DATE,
      startTime,
      durationHours: 1,
      intervalWeeks: 1,
      daysOfWeek,
    });
    state.classSchedules.push(
      extra("f1", "08:00", [5, 6]),
      extra("f2", "12:00", [5, 6]),
      extra("f3", "14:30", [5, 6]),
      extra("f4", "16:00", [5, 6]),
      extra("s5", "18:00", [6]),
    );
    renderClasses(state);
    await user.click(screen.getByRole("tab", { name: "Calendar" }));

    const today = screen.getByRole("button", { name: "July 15, 1 class: 10:00 a.m. Math" });
    const chip = today.querySelector(".cal-chip");
    // The fixed date is in the past, so «now» is 23:59 and today's 10:00 class already ended unrecorded,
    // the same «Sin registrar» Inicio shows (it used to read «Siguiente» here).
    expect(chip).toHaveAttribute("title", "10:00 a.m. Math · Not recorded");
    expect(chip.querySelector(".cal-chip-time")).toHaveTextContent("10a");
    expect(chip.querySelector(".cal-chip-name")).toHaveTextContent("Math");

    const friday = screen.getByRole("button", {
      name: /^July 17, 4 classes: 8:00 a\.m\. Science, 12:00 p\.m\. Science/,
    });
    expect(friday.querySelectorAll(".cal-chip")).toHaveLength(4);
    expect(friday.querySelector(".cal-more")).toBeNull();
    expect([...friday.querySelectorAll(".cal-chip-time")].map((node) => node.textContent)).toEqual([
      "8a",
      "12p",
      "2:30p",
      "4p",
    ]);

    const saturday = screen.getByRole("button", { name: /^July 18, 5 classes: .*6:00 p\.m\. Science$/ });
    expect(saturday.querySelectorAll(".cal-chip")).toHaveLength(3);
    expect(saturday.querySelector(".cal-more")).toHaveTextContent("+2 more");
  });
});

describe("edit class drawer confirmations", () => {
  function renderEditor() {
    const state = classState();
    const session = buildClassWorkspaceSessions(state, AS_OF_DATE).find((item) => item.classDate === AS_OF_DATE);
    const actions = {
      editScheduledClass: vi.fn().mockResolvedValue(true),
      removeScheduledClass: vi.fn().mockResolvedValue(true),
    };
    const onClose = vi.fn();
    render(
      <EditClassDrawer
        open
        session={session}
        state={state}
        actions={actions}
        asOfDate={AS_OF_DATE}
        futureSupported
        onClose={onClose}
      />,
    );
    return { actions, onClose };
  }

  it("deletes only after a destructive in-app confirmation; Escape closes the question, not the drawer", async () => {
    const user = userEvent.setup();
    const { actions } = renderEditor();
    const drawer = screen.getByRole("dialog", { name: "Edit class" });

    await user.click(within(drawer).getByRole("button", { name: "Delete class" }));
    const question = screen.getByRole("alertdialog", { name: "Delete only this class?" });
    expect(question).toHaveAccessibleDescription("Past classes and saved records will remain unchanged.");
    expect(within(question).getByRole("button", { name: "Delete class" })).toHaveClass("button-danger");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit class" })).toBeInTheDocument();
    expect(actions.removeScheduledClass).not.toHaveBeenCalled();

    await user.click(within(drawer).getByRole("button", { name: "Delete class" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete class" }));
    await waitFor(() => expect(actions.removeScheduledClass).toHaveBeenCalledOnce());
  });

  it("asks before closing with unsaved schedule edits", async () => {
    const user = userEvent.setup();
    const { onClose } = renderEditor();
    const drawer = screen.getByRole("dialog", { name: "Edit class" });

    await user.click(within(drawer).getByRole("button", { name: "Longer" }));
    await user.click(within(drawer).getByRole("button", { name: "Cancel" }));
    const question = screen.getByRole("alertdialog", { name: "Discard the class schedule changes?" });
    await user.click(within(question).getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(drawer).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("class history rows", () => {
  it("shows one status per row and none for a class that went fine", async () => {
    const user = userEvent.setup();
    const state = classState();
    state.classSchedules[0].startDate = "2026-07-08";
    state.classLog = [
      {
        id: "done",
        classDate: AS_OF_DATE,
        studentId: "s1",
        groupId: "g1",
        startTime: "10:00",
        classStatus: "Completed",
        attendance: "P",
        hours: 2,
        appliedHourlyRate: 100,
        appliedCharge: 200,
        amountPaid: 200,
        paymentDate: AS_OF_DATE,
        paymentState: "Paid",
      },
    ];
    const { container } = renderClasses(state);
    await user.click(screen.getByRole("tab", { name: "History" }));
    const rows = [...container.querySelectorAll(".history-row-button")];
    expect(rows).toHaveLength(2);
    const [done, pending] = rows;
    // «Sin registrar» once, not under the title, in an action column and again as the status.
    expect(pending.textContent.match(/Not recorded/g)).toHaveLength(1);
    expect(pending).not.toHaveTextContent("Record attendance and payment");
    // A recorded, paid class with no assignment flags nothing: no «Sin tarea», «Todo en orden» or badge.
    expect(done).not.toHaveTextContent(/No assignment|All in order/);
    expect(done.querySelector(".st")).toBeNull();
  });
});
