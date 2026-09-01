// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { AttendancePanel, RevenuePanel } from "./Home";

const sessions = [
  {
    key: "one",
    scopeId: "group:a",
    groupId: "a",
    title: "Group A",
    attended: 9,
    expected: 10,
    attendance: 0.9,
  },
  {
    key: "two",
    scopeId: "group:b",
    groupId: "b",
    title: "Group B",
    attended: 8,
    expected: 10,
    attendance: 0.8,
  },
  {
    key: "three",
    scopeId: "group:a",
    groupId: "a",
    title: "Group A",
    attended: 10,
    expected: 10,
    attendance: 1,
  },
];

describe("AttendancePanel", () => {
  it("filters real sessions by group, selects session details, and opens attendance tracking", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <I18nProvider>
        <AttendancePanel
          title="Average attendance this week"
          sessions={sessions}
          previousSessions={[{ ...sessions[0], key: "previous", attendance: 0.8, attended: 8 }]}
          onOpen={onOpen}
        />
      </I18nProvider>,
    );

    expect(document.querySelector(".home-metric-value")).toHaveTextContent("90%");
    expect(screen.getByRole("status")).toHaveTextContent("Group A · 10 students");

    await user.selectOptions(screen.getByLabelText("Attendance group"), "group:b");
    expect(document.querySelector(".home-metric-value")).toHaveTextContent("80%");
    expect(screen.getByText("Attendance in 1 class")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Group B · 8 students");

    await user.click(screen.getByRole("button", { name: "View sessions" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("RevenuePanel", () => {
  it("switches between rhythm, projection, and group views without changing the selected period", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const dashboard = {
      collected: 400,
      collectedDelta: 0.25,
      collectionRecordCount: 2,
      completedClassCount: 2,
      projectedClassCount: 1,
      collectionProjection: 600,
      collectionSeries: [
        { label: "2026-07-13", collected: 150, value: 150 },
        { label: "2026-07-14", collected: 250, value: 400 },
      ],
      collectionGroups: [{ id: "group:g1", name: "Reading", value: 400, paymentCount: 2 }],
    };

    render(
      <I18nProvider>
        <RevenuePanel dashboard={dashboard} period="weekly" locale="en-MX" noun="this week" onOpen={onOpen} />
      </I18nProvider>,
    );

    expect(screen.getByText("Amount collected this week")).toBeInTheDocument();
    expect(screen.getByText("2 payments recorded")).toBeInTheDocument();
    const rhythmTrigger = screen.getByRole("button", { name: /View: Rhythm/i });
    await user.click(rhythmTrigger);
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Weekly rhythm" })).toHaveFocus());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("Period projection")).toBeInTheDocument();
    expect(screen.getByText("1 class to teach")).toBeInTheDocument();

    const projectionTrigger = screen.getByRole("button", { name: /View: Projection/i });
    await user.click(projectionTrigger);
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Projection" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(projectionTrigger).toHaveFocus();
    await user.click(projectionTrigger);
    await user.click(screen.getByRole("menuitemradio", { name: "By groups" }));
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("2 payments")).toBeInTheDocument();
    expect(screen.getByLabelText("Collection period: Weekly")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View breakdown" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
