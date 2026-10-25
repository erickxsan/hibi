// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAll } from "../domain";
import { I18nProvider } from "../i18n";
import Home from "./Home";

const AS_OF = "2026-10-21";

function row(id, classDate, studentId, attendance, amountPaid) {
  return {
    id,
    classDate,
    studentId,
    groupId: "g1",
    startTime: "16:00",
    scheduleSlotId: "slot-mon",
    scheduleOccurrenceDate: classDate,
    classStatus: "Completed",
    attendance,
    hours: 2,
    appliedHourlyRate: 100,
    appliedCharge: attendance === "A" ? 0 : 200,
    amountPaid,
    paymentState: attendance === "A" ? "" : amountPaid ? "Paid" : "Pending",
    paymentDate: amountPaid ? classDate : null,
    paymentMethod: amountPaid ? "Cash" : "",
  };
}

function homeState() {
  return {
    version: 1,
    settings: {
      asOfDate: AS_OF,
      hourlyRate: 100,
      defaultClassHours: 2,
      lowAttendanceThreshold: 0.8,
      lowGradeThreshold: 0.7,
    },
    groups: [
      {
        id: "g1",
        name: "Reading",
        hourlyRate: 100,
        weeklySchedule: [
          { id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 },
          { id: "slot-wed", dayOfWeek: 3, startTime: "16:00", durationHours: 2 },
        ],
      },
    ],
    students: [
      { id: "s1", code: "S1", fullName: "Maya Torres", groupIds: ["g1"], status: "Active", avatarId: "cat" },
      { id: "s2", code: "S2", fullName: "Lucas Bennett", groupIds: ["g1"], status: "Active", avatarId: "fox" },
    ],
    grades: [
      {
        id: "grade-low",
        date: "2026-10-19",
        studentId: "s1",
        assessment: "Quiz",
        score: 5,
        maxScore: 10,
        classSessionKey: "2026-10-19|g:g1|16:00",
      },
    ],
    classLog: [
      row("r1", "2026-10-12", "s1", "P", 0),
      row("r2", "2026-10-12", "s2", "P", 200),
      row("r3", "2026-10-19", "s1", "P", 200),
      row("r4", "2026-10-19", "s2", "A", 0),
      row("r5", "2026-10-14", "s1", "P", 200),
      row("r6", "2026-10-14", "s2", "P", 200),
    ].map((item) => (item.classDate === "2026-10-14" ? { ...item, scheduleSlotId: "slot-wed" } : item)),
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

function homeProps(overrides = {}) {
  const state = homeState();
  const derived = deriveAll(state, AS_OF);
  return {
    state,
    derived,
    openPage: vi.fn(),
    clearIntent: vi.fn(),
    archiveScope: {
      count: 1,
      names: ["Old group"],
      pendingBalance: 150,
      included: false,
      onChange: vi.fn(),
      onOpen: vi.fn(),
    },
    ...overrides,
  };
}

function renderHome(overrides = {}) {
  const props = homeProps(overrides);
  render(
    <I18nProvider>
      <Home {...props} />
    </I18nProvider>,
  );
  return props;
}

function setCompact(matches) {
  window.matchMedia.mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  localStorage.setItem("hibi:language:v1", "en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 21, 12, 30));
});

afterEach(() => {
  vi.useRealTimers();
  setCompact(false);
});

describe("Home", () => {
  it("shows today's line, the next class and records it", async () => {
    const user = userEvent.setup();
    const props = renderHome();
    expect(screen.getByRole("heading", { name: "Good afternoon, Teacher!" })).toBeInTheDocument();
    expect(screen.getByText("You have 1 class today. Next is Reading, in 3 h 30 min.")).toBeInTheDocument();
    const block = screen.getByRole("button", { name: /^Reading, 4:00 – 6:00 p\.m\./ });
    expect(block).toHaveAttribute("aria-pressed", "true");
    const card = screen.getByRole("article", { name: "Reading" });
    expect(within(card).getByText("owes $200 from the class on 12 Oct.")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Record class" }));
    expect(props.openPage).toHaveBeenCalledWith("classes", { type: "open-class", sessionKey: "2026-10-21|g:g1|16:00" });
  });

  it("marks a note as seen and shows it again", async () => {
    const user = userEvent.setup();
    const setNotesDismissed = vi.fn();
    renderHome({ actions: { setNotesDismissed } });
    const card = screen.getByRole("article", { name: "Reading" });
    await user.click(within(card).getByRole("button", { name: "Mark as seen: Maya" }));
    expect(setNotesDismissed).toHaveBeenCalledWith(["owes:s1:2026-10-12"], true);
  });

  it("hides seen notes, their chips and the badge until they are shown again", async () => {
    const user = userEvent.setup();
    const setNotesDismissed = vi.fn();
    const state = homeState();
    state.settings.dismissedNotes = { "owes:s1:2026-10-12": "2026-10-20" };
    renderHome({ state, derived: deriveAll(state, AS_OF), actions: { setNotesDismissed } });
    const card = screen.getByRole("article", { name: "Reading" });
    expect(within(card).queryByText("owes $200 from the class on 12 Oct.")).not.toBeInTheDocument();
    expect(within(card).queryByText("Owes $200")).not.toBeInTheDocument();
    expect(within(card).getByText("No new notices.")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "1 seen notice · Show again" }));
    expect(setNotesDismissed).toHaveBeenCalledWith(["owes:s1:2026-10-12"], false);
  });

  it("greets at night between midnight and 5 a.m. and keeps the line readable before 8 a.m.", () => {
    vi.setSystemTime(new Date(2026, 9, 21, 0, 34));
    const { unmount } = render(
      <I18nProvider>
        <Home {...homeProps()} />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading", { name: "Good evening, Teacher!" })).toBeInTheDocument();
    unmount();
    vi.setSystemTime(new Date(2026, 9, 21, 6, 40));
    renderHome();
    expect(screen.getByRole("heading", { name: "Good morning, Teacher!" })).toBeInTheDocument();
    const line = screen.getByRole("region", { name: "Today's timeline" });
    expect(within(line).getByText("8 a.m.")).toBeInTheDocument();
    expect(within(line).getByText("4 p.m.")).toBeInTheDocument();
    const block = within(line).getByRole("button", { name: /^Reading, 4:00 – 6:00 p\.m\./ });
    expect(block.style.width).not.toBe("");
    expect(line.firstElementChild.style.minWidth).toBe("864px");
  });

  it("turns «Para atender» into actions and explores a metric in place", async () => {
    const user = userEvent.setup();
    const props = renderHome();
    const attention = screen.getByRole("heading", { name: /^To attend to · / }).closest("section");
    await user.click(within(attention).getByRole("button", { name: /got 5\.0/ }));
    const tabs = screen.getByRole("tablist", { name: "Charts" });
    expect(within(tabs).getByRole("tab", { name: /Grade/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: "Students · what needs attention first" })).toBeInTheDocument();
    await user.click(within(tabs).getByRole("tab", { name: /Collections/ }));
    await user.click(screen.getByRole("button", { name: /To collect/ }));
    expect(screen.getByText("Who owes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Month projection/ }));
    expect(screen.getByText("Accumulated collections · tap a point")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reading" }));
    await user.click(screen.getByRole("button", { name: "Close detail and return to the three charts" }));
    expect(screen.queryByRole("tablist", { name: "Charts" })).not.toBeInTheDocument();
    await user.click(within(attention).getByRole("button", { name: /still not recorded/ }));
    expect(props.openPage).toHaveBeenCalledWith("classes", expect.objectContaining({ type: "open-class" }));
  });

  it("changes the period, picks points and switches the archived scope", async () => {
    const user = userEvent.setup();
    const props = renderHome();
    expect(screen.getByRole("heading", { name: "Your week · 19 to 25 Oct" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("heading", { name: "Your month · October" })).toBeInTheDocument();
    const attendance = screen.getByRole("article", { name: /^Attendance:/ });
    await user.click(within(attendance).getByRole("button", { name: /Mon 12 Oct · Reading: 100%/ }));
    expect(within(attendance).getByText("Nobody missed. Perfect attendance!")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Include archived groups" }));
    expect(props.archiveScope.onChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("1 archived group is left out of these figures")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Balance in archived groups: $150" }));
    expect(props.archiveScope.onOpen).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Yearly" }));
    expect(screen.getByRole("heading", { name: "Your year · 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: /^Today · / })).toBeInTheDocument();
  });

  it("uses an agenda, a list and metric sheets on a phone", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const props = renderHome();
    expect(screen.getByRole("heading", { name: "Hi, Teacher" })).toBeInTheDocument();
    expect(screen.getByText("12:30 now")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View students of Reading" }));
    expect(await screen.findByRole("dialog", { name: "Reading" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: /^Attendance:/ }));
    const sheet = await screen.findByRole("dialog", { name: "Attendance" });
    expect(within(sheet).getByText("Below 80%")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Open in Tracking" }));
    expect(props.openPage).toHaveBeenCalledWith("grades", { type: "open-tracking", tab: "attendance" });
  });
});
