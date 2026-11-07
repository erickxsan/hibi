// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrade, createGroup, createStarterState, createStudent } from "../domain";
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

function Harness({ persistence, openPage, intent = undefined }) {
  const manager = useClassManager({ persistence });
  return (
    <I18nProvider>
      <Tracking {...manager} openPage={openPage} intent={intent} clearIntent={() => {}} />
    </I18nProvider>
  );
}

function setup(state = trackingState(), intent = undefined) {
  const persistence = { initialState: state, mode: "cloud", save: vi.fn(async (next) => next) };
  const openPage = vi.fn();
  render(<Harness persistence={persistence} openPage={openPage} intent={intent} />);
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
  it("opens on the attendance calendar and filters the list from a picked mark", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("tab", { name: "Attendance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Attendance day by day" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Chart view" })).toHaveTextContent("Calendar");
    const list = screen.getByRole("complementary", { name: "Students · lowest attendance first" });
    const names = within(list)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names[0]).toContain("Luna López");
    await user.click(screen.getByRole("combobox", { name: "Chart view" }));
    await user.click(screen.getByRole("option", { name: "Map" }));
    expect(screen.getByRole("heading", { name: "Each student's latest classes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Luna López:/ }));
    const filtered = screen.getByRole("complementary", { name: /Students · 1 in the filter/ });
    expect(within(filtered).getAllByRole("button")).toHaveLength(1);
    expect(within(filtered).getByText("Luna López")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("complementary", { name: "Students · lowest attendance first" })).toBeInTheDocument();
  });

  it("lists the tabs as attendance, grades, payments", () => {
    setup();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Attendance", "Grades", "Payments"]);
  });

  it("does not paint any day green when nothing was recorded", () => {
    const state = trackingState();
    state.classLog = [];
    setup(state);
    expect(document.querySelector(".cv-day.is-high, .cv-day.is-mid")).toBeNull();
    expect(document.querySelector(".tracking-kpis")).toBeNull();
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
    await user.click(screen.getByRole("combobox", { name: "Filter by group" }));
    await user.click(screen.getByRole("option", { name: "Prepa" }));
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

  it("lands an Inicio alert on the students and fees it named", () => {
    setup(trackingState(), {
      type: "open-tracking",
      tab: "payments",
      spotlight: { kind: "students", ids: ["s1"] },
    });
    expect(screen.getByRole("tab", { name: "Payments" })).toHaveAttribute("aria-selected", "true");
    const lit = document.querySelectorAll(".is-spotlit");
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveClass("tsr");
    expect(lit[0]).toHaveTextContent("Luna López");
  });

  it("marks the monthly fee a «mensualidad vencida» alert counts", () => {
    setup(trackingState(), {
      type: "open-tracking",
      tab: "payments",
      spotlight: { kind: "fees", ids: ["s3:g2"] },
    });
    const lit = document.querySelectorAll(".is-spotlit");
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveClass("mrow");
    expect(lit[0]).toHaveTextContent("Sofía Martín");
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

  it("consults a custom range of days", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("combobox", { name: "Report period" }));
    await user.click(screen.getByRole("option", { name: "Custom range…" }));
    const drawer = screen.getByRole("dialog", { name: "Custom range" });
    await waitFor(() => expect(within(drawer).getByRole("combobox", { name: "From" })).toBeEnabled());
    await user.click(within(drawer).getByRole("combobox", { name: "From" }));
    await user.click(screen.getByRole("button", { name: "Monday, October 12, 2026" }));
    await user.click(within(drawer).getByRole("combobox", { name: "To" }));
    await user.click(screen.getByRole("button", { name: "Monday, October 12, 2026" }));
    await user.click(within(drawer).getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("combobox", { name: "Report period" })).toHaveTextContent(/^Range · /);
    await user.click(screen.getByRole("button", { name: "Breakdown" }));
    const rows = within(screen.getByRole("table", { name: "Records" }))
      .getAllByRole("row")
      .slice(1);
    expect(rows).toHaveLength(2);

    // The Excel export covers the same days: its name, its title and its rows.
    const blobs = [];
    const downloads = [];
    URL.createObjectURL = vi.fn((blob) => blobs.push(blob) && "blob:hibi");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function save() {
      downloads.push(this.download);
    });
    await user.click(screen.getByRole("button", { name: "Export Excel" }));
    expect(downloads).toEqual(["hibi-attendance-2026-10-12-2026-10-12.xls"]);
    const sheet = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blobs[0]);
    });
    expect(sheet).toContain("2026-10-12");
    expect(sheet).not.toContain("2026-10-05");
    expect(sheet).not.toContain("2026-10-19");
    click.mockRestore();
  });
});

describe("Tracking and lost payments", () => {
  function lostState() {
    const state = trackingState();
    state.classLog.push(row("old", "2026-08-03", "s1", "P", 0));
    state.students[0].lostPayments = [{ kind: "class", classId: "old", lostAt: "2026-10-20" }];
    state.students[2].lostPayments = [{ kind: "monthly", groupId: "g2", period: "2026-10", lostAt: "2026-10-20" }];
    return state;
  }
  async function openPayments(user) {
    await user.click(screen.getByRole("tab", { name: "Payments" }));
  }

  it("shows a debt as owed, with nothing to recover, in a report dated before it was given up", async () => {
    const user = userEvent.setup();
    setup(lostState());
    await openPayments(user);
    expect(document.querySelector(".tlist-foot")).toHaveTextContent("Lost");
    // Nobody left to expect money from: no «0 of 0».
    expect(document.querySelector(".mhd-sum")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Report date" }));
    const dialog = screen.getByRole("dialog", { name: "Report date" });
    await user.click(within(dialog).getByRole("combobox", { name: "Report date" }));
    await user.click(screen.getByRole("button", { name: "Thursday, October 15, 2026" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect([...document.querySelectorAll(".tlist-foot")].map((item) => item.textContent).join()).not.toContain("Lost");
    await user.click(screen.getByRole("button", { name: /Luna López/ }));
    const debts = document.querySelector(".debts");
    expect(within(debts).queryByRole("button", { name: /^Recover/ })).not.toBeInTheDocument();
    expect(debts).not.toHaveTextContent("Lost");
    expect(within(debts).queryByRole("button", { name: /^Mark as lost/ })).not.toBeInTheDocument();
    // A class paid after that day reads as owed, and must not be paid again with today's date.
    expect(within(debts).queryByRole("button", { name: /^Mark paid/ })).not.toBeInTheDocument();
  });

  it("sums months and classes in words, and adds the lost column to the Excel", async () => {
    const user = userEvent.setup();
    const state = lostState();
    state.students[0].groupIds = ["g1", "g2"];
    state.students[0].lostPayments.push({ kind: "monthly", groupId: "g2", period: "2026-10", lostAt: "2026-10-20" });
    setup(state);
    await openPayments(user);
    await user.click(within(document.querySelector(".tlist")).getAllByRole("button", { name: "View" }).at(-1));
    expect(await screen.findByText("1 month and 1 class")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const blobs = [];
    URL.createObjectURL = vi.fn((blob) => blobs.push(blob) && "blob:hibi");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Export Excel" }));
    const sheet = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blobs[0]);
    });
    expect(sheet).toContain("<th>Lost</th>");
    expect(sheet).toContain("<td>1350</td>");
    click.mockRestore();
  });
});

describe("Tracking on mobile", () => {
  it("puts the title first, keeps the tab order and draws one calendar day per date", async () => {
    setCompact(true);
    const state = trackingState();
    // Two classes on the same day must not read «19 19» on the axis.
    state.classLog.push({ ...row("r7", "2026-10-19", "s2", "P", 0), startTime: "18:00", scheduleSlotId: "" });
    setup(state);
    const head = document.querySelector(".tracking-head");
    expect(head.firstElementChild.firstElementChild.tagName).toBe("H1");
    expect(screen.queryByText("Report date")).not.toBeInTheDocument();
    const switcher = screen.getByRole("group", { name: "Tracking views" });
    expect(
      within(switcher)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Attendance", "Grades", "Payments"]);
    expect(screen.getByRole("combobox", { name: "Chart view" })).toHaveTextContent("Calendar");
    await waitFor(() => expect(document.querySelector(".tracking-view .cv-cal")).not.toBeNull());
    // Two classes on the 19th are still one day of the calendar.
    expect(screen.getAllByRole("button", { name: /\b19\b.*: \d+%$/ })).toHaveLength(1);
  });

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

  it("marks the students an alert named in the phone list", () => {
    setCompact(true);
    setup(trackingState(), {
      type: "open-tracking",
      tab: "attendance",
      spotlight: { kind: "students", ids: ["s1", "s2"] },
    });
    const list = screen.getByRole("heading", { name: "Students" }).closest("section");
    const lit = [...list.querySelectorAll(".list-row.is-spotlit")].map((row) => row.textContent);
    expect(lit).toHaveLength(2);
    expect(lit.join(" ")).toContain("Luna López");
    expect(lit.join(" ")).toContain("Diego Soto");
    expect(within(list).getByText("Sofía Martín").closest(".list-row")).not.toHaveClass("is-spotlit");
  });

  it("scopes the figures to one group on a phone too", async () => {
    setCompact(true);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("combobox", { name: "Filter by group" }));
    await user.click(screen.getByRole("option", { name: "Prepa" }));
    const list = screen.getByRole("heading", { name: "Students" }).closest("section");
    expect(within(list).getByText("1 student")).toBeInTheDocument();
    expect(within(list).getByText("Sofía Martín")).toBeInTheDocument();
    expect(within(list).queryByText("Diego Soto")).not.toBeInTheDocument();
  });

  it("opens a student's sheet with the figures as tabs and marks a class from its calendar", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const { openPage, saved } = setup();
    await user.click(screen.getByRole("button", { name: /Luna López/ }));
    const sheet = await screen.findByRole("dialog", { name: "Luna López" });
    // The name shows once (no sheet title, no table) and the tab you came from is open.
    expect(within(sheet).getAllByText("Luna López")).toHaveLength(1);
    expect(within(sheet).queryByRole("table")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Attendance: 33% · Low attendance" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sheet).getByRole("button", { name: /^Payments: \$150/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(sheet).getByText("1 of 3 classes")).toBeInTheDocument();
    expect(within(sheet).getByText("Group 67%")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "October 19 · Present" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByRole("button", { name: "October 26 · Upcoming" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "October 12 · Absent" }));
    await user.click(within(sheet).getByRole("button", { name: "Present" }));
    await waitFor(() => expect(saved().classLog.find((item) => item.id === "r3").attendance).toBe("P"));
    expect(await within(sheet).findByRole("button", { name: "Attendance: 67% · Low attendance" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: /View profile/ }));
    expect(openPage).toHaveBeenCalledWith("community", { type: "open-student", id: "s1" });
  });

  it("shows a student's grades against the group and opens the class of a missing one", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const state = trackingState();
    const grade = (id, date, studentId, assessment, score) =>
      createGrade({ id, date, studentId, assessment, score, maxScore: 10, classSessionKey: `${date}|g:g1|16:00` });
    state.grades = [
      grade("gr1", "2026-10-19", "s1", "Quiz", 8),
      grade("gr2", "2026-10-19", "s2", "Quiz", 9),
      grade("gr3", "2026-10-12", "s1", "Essay", null),
    ];
    const { openPage } = setup(state);
    await user.click(screen.getByRole("button", { name: /Luna López/ }));
    const sheet = await screen.findByRole("dialog", { name: "Luna López" });
    await user.click(within(sheet).getByRole("button", { name: "Grades: 8.0 · Needs a grade" }));
    expect(within(sheet).getByText("Group 8.5")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("img", { name: "Essay: Needs a grade · Quiz: 8.0 · Group 8.5" }),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Grade Essay" }));
    expect(openPage).toHaveBeenCalledWith("classes", {
      type: "open-history-class",
      sessionKey: "2026-10-12|g:g1|16:00",
    });
  });

  it("asks before marking a paid class absent, which would remove its payment", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: /Diego Soto/ }));
    const sheet = await screen.findByRole("dialog", { name: "Diego Soto" });
    await user.click(within(sheet).getByRole("button", { name: "October 5 · Present" }));
    await user.click(within(sheet).getByRole("button", { name: "Absent" }));
    const question = await screen.findByRole("alertdialog", { name: "Mark as absent?" });
    expect(within(question).getByText(/^The \$150(\.00)? paid for this class will be removed\.$/)).toBeInTheDocument();
    await user.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(saved()).toBeUndefined();
    await user.click(within(sheet).getByRole("button", { name: "Absent" }));
    await user.click(await screen.findByRole("button", { name: "Mark absent" }));
    await waitFor(() => expect(saved().classLog.find((item) => item.id === "r2").attendance).toBe("A"));
  });

  it("lists a class debt from before the period under the amount owed", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const state = trackingState();
    state.classLog.push(row("r0", "2026-09-28", "s1", "P", 0));
    const { openPage } = setup(state);
    await user.click(screen.getByRole("button", { name: /Luna López/ }));
    const sheet = await screen.findByRole("dialog", { name: "Luna López" });
    await user.click(within(sheet).getByRole("button", { name: /^Payments: \$300/ }));
    await user.click(within(sheet).getByRole("button", { name: /^Open class · Mon 28 Sep/ }));
    expect(openPage).toHaveBeenCalledWith("classes", {
      type: "open-history-class",
      sessionKey: "2026-09-28|g:g1|16:00",
    });
  });

  it("pays and takes back a monthly fee from the student's sheet", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: /Sofía Martín/ }));
    const sheet = await screen.findByRole("dialog", { name: "Sofía Martín" });
    await user.click(within(sheet).getByRole("button", { name: /^Payments:/ }));
    expect(within(sheet).getByRole("button", { name: "October · Prepa · Overdue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(sheet).getByRole("button", { name: "November · Prepa · Pending" })).toBeInTheDocument();
    expect(within(sheet).getByText("Overdue · 5 Oct")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Mark paid" }));
    await waitFor(() =>
      expect(saved().students.find((student) => student.id === "s3").monthlyPayments).toEqual([
        expect.objectContaining({ groupId: "g2", period: "2026-10", amount: 1200 }),
      ]),
    );
    expect(await within(sheet).findByText("Paid · today")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(saved().students.find((student) => student.id === "s3").monthlyPayments ?? []).toEqual([]),
    );
  });
});
