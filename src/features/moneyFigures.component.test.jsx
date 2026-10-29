// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAll } from "../domain";
import { I18nProvider } from "../i18n";
import { LANGUAGE_STORAGE_KEY } from "../i18n/translations";
import Home from "./Home";
import Tracking from "./Tracking";

const AS_OF = "2026-10-21";

function row(id, classDate, studentId, amountPaid, charge = 200) {
  return {
    id,
    classDate,
    studentId,
    groupId: "g1",
    startTime: "16:00",
    scheduleSlotId: "slot-mon",
    scheduleOccurrenceDate: classDate,
    classStatus: "Completed",
    attendance: "P",
    hours: 2,
    appliedHourlyRate: 100,
    appliedCharge: charge,
    amountPaid,
    paymentState: amountPaid ? "Paid" : "Pending",
    paymentDate: amountPaid ? classDate : null,
    paymentMethod: amountPaid ? "Cash" : "",
  };
}

/**
 * Maya owes three classes: 14 Sep (overdue, earlier month), 12 Oct (overdue, this month) and 19 Oct (not
 * due yet). Old Student left the school with a September class unpaid. Lucas paid on 7 Sep (inside
 * «1–21 sep»), on 28 Sep (outside it) and on 12 Oct.
 */
function moneyState() {
  return {
    version: 1,
    settings: { asOfDate: AS_OF, hourlyRate: 100, defaultClassHours: 2 },
    groups: [
      {
        id: "g1",
        name: "Reading",
        hourlyRate: 100,
        weeklySchedule: [{ id: "slot-mon", dayOfWeek: 1, startTime: "16:00", durationHours: 2 }],
      },
    ],
    students: [
      { id: "s1", code: "S1", fullName: "Maya Torres", groupIds: ["g1"], status: "Active" },
      { id: "s2", code: "S2", fullName: "Lucas Bennett", groupIds: ["g1"], status: "Active" },
      { id: "s9", code: "S9", fullName: "Old Student", groupIds: ["g1"], status: "Inactive" },
    ],
    grades: [],
    classLog: [
      row("m-sep", "2026-09-14", "s1", 0),
      row("m-oct12", "2026-10-12", "s1", 0),
      row("m-oct19", "2026-10-19", "s1", 0),
      row("o-sep", "2026-09-14", "s9", 0),
      row("l-sep7", "2026-09-07", "s2", 100, 100),
      row("l-sep14", "2026-09-14", "s2", 0, 0),
      row("l-sep28", "2026-09-28", "s2", 500, 500),
      row("l-oct12", "2026-10-12", "s2", 200),
      row("l-oct19", "2026-10-19", "s2", 0, 0),
    ],
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

function renderHome() {
  const state = moneyState();
  const props = { state, derived: deriveAll(state, AS_OF), openPage: vi.fn(), clearIntent: vi.fn() };
  render(
    <I18nProvider>
      <Home {...props} />
    </I18nProvider>,
  );
  return props;
}

function renderTracking() {
  const state = moneyState();
  render(
    <I18nProvider>
      <Tracking state={state} derived={deriveAll(state, AS_OF)} />
    </I18nProvider>,
  );
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
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 21, 12, 30));
});

afterEach(() => {
  vi.useRealTimers();
  setCompact(false);
});

describe("Home money", () => {
  it("states the scope of the overdue alert and opens the chart on that same figure", async () => {
    const user = userEvent.setup();
    renderHome();
    const attention = screen.getByRole("heading", { name: /^To attend to · / }).closest("section");
    const alert = within(attention).getByRole("button", { name: /overdue/ });
    // Overdue (all months) and the total with what is not due yet; the inactive student stays apart.
    expect(alert).toHaveTextContent(
      "$400 overdue · $600 in total from Maya. Overdue: $200 from October · $200 from earlier months. Aside, $200 owed by inactive students.",
    );
    expect(alert).not.toHaveTextContent(/Old/);
    await user.click(alert);
    const aside = document.querySelector("aside.det");
    expect(within(aside).getByText("To collect")).toBeInTheDocument();
    expect(aside.querySelector(".big")).toHaveTextContent("$600");
    expect(within(aside).getByText("$400 overdue")).toBeInTheDocument();
    const values = [...aside.querySelectorAll(".kv")].map((item) => item.textContent);
    expect(values).toEqual(["Overdue from October$200", "Overdue from earlier months$200", "Not due yet$200"]);
    const who = [...aside.querySelectorAll(".who")].map((item) => item.textContent);
    expect(who[0]).toMatch(/^Maya Torres\$400 overdue · class on .*\$600$/);
    expect(within(aside).getByText("Owed by inactive students · $200")).toBeInTheDocument();
    expect(who[1]).toMatch(/^Old Student.*\$200$/);
  });

  it("compares collections with the same days of the previous period", async () => {
    const user = userEvent.setup();
    renderHome();
    const card = () => screen.getByRole("article", { name: /^Collections:/ });
    // Week of 19 Oct (Mon–Wed so far) against Mon 12 – Wed 14 Oct.
    expect(within(card()).getByText("↓ 100% vs. 12–14 Oct")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    // 1–21 Oct ($200) against 1–21 Sep ($100); the $500 paid on 28 Sep is not part of the comparison.
    expect(within(card()).getByText("↑ 100% vs. 1–21 Sep")).toBeInTheDocument();
  });

  it("names the month of the overdue money on a phone and lists inactive students apart", async () => {
    setCompact(true);
    const user = userEvent.setup();
    const props = renderHome();
    const attention = screen.getByRole("heading", { name: "To attend to" }).closest("section");
    expect(within(attention).getByRole("button", { name: /overdue/ })).toHaveTextContent(
      "$400 overdue · $600 in total from Maya · $200 owed by inactive students",
    );
    const row = screen.getByRole("button", { name: /^Collections:/ });
    expect(row).toHaveTextContent("$200 overdue from October");
    await user.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Collections" });
    expect(within(sheet).getByText("To collect $600")).toBeInTheDocument();
    expect(within(sheet).getByText("$400 overdue ($200 from October · $200 from earlier months)")).toBeInTheDocument();
    const maya = within(sheet).getByText("Maya Torres").closest(".lr");
    expect(maya).toHaveTextContent("$400 overdue");
    expect(maya).toHaveTextContent("$600");
    expect(within(sheet).getByText("Owed by inactive students · $200")).toBeInTheDocument();
    expect(within(sheet).getByText("Old Student").closest(".lr")).toHaveTextContent("Inactive student");
    await user.click(within(sheet).getByRole("button", { name: "Open in Tracking" }));
    expect(props.openPage).toHaveBeenCalledWith("grades", { type: "open-tracking", tab: "payments" });
  });
});

describe("Tracking money", () => {
  it("keeps the money in the list, without a row of figures over the chart", async () => {
    const user = userEvent.setup();
    renderTracking();
    await user.click(screen.getByRole("tab", { name: "Payments" }));
    expect(document.querySelector(".tkpi")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Chart view" })).toHaveTextContent("Pace");
    const list = screen.getByRole("complementary", { name: "Students · what is owed first" });
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent("$600");
  });

  it("says it in Spanish on a phone", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "es");
    setCompact(true);
    const user = userEvent.setup();
    renderTracking();
    await user.click(screen.getByRole("button", { name: "Pagos" }));
    const hero = document.querySelector(".tracking-hero");
    expect(hero).toHaveTextContent("↑ 100% vs. 1–21 sep");
    expect(hero).toHaveTextContent(
      "Por cobrar $600 · $400 vencidos ($200 de octubre · $200 de meses anteriores) · Aparte, $200 que deben alumnos inactivos.",
    );
  });
});
