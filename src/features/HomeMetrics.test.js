import { describe, expect, it } from "vitest";
import { metricSummary } from "./HomeMetrics";

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
const context = {
  t,
  locale: "en-MX",
  period: "weekly",
  asOf: "2026-10-21",
  names: (list) => list.join(", "),
  nameOf: () => "",
  threshold: { attendance: 0.8, grade: 7 },
  rows: [],
};

const emptyGrades = { metric: "grade", period: "weekly", value: null, delta: null, points: [], graded: 0, ungraded: 0 };

describe("metricSummary when the current period has nothing to measure", () => {
  it("says there are no grades this week and still shows last week's value", () => {
    const summary = metricSummary({ ...emptyGrades, previous: 8.5 }, context);
    expect(summary.delta).toBe("No grades this week · Last week was 8.5 /10");
    expect(summary.delta).not.toMatch(/No previous period/);
  });

  it("does the same for attendance with an explicit current period", () => {
    const summary = metricSummary(
      { metric: "attendance", period: "monthly", value: null, previous: 0.9, delta: null, points: [], registered: 0 },
      { ...context, period: "monthly" },
    );
    expect(summary.delta).toMatch(/^No classes recorded this month · September was 90%$/);
  });

  it("falls back to «No data» when neither period has a value", () => {
    expect(metricSummary({ ...emptyGrades, previous: null }, context).delta).toBe("No data");
  });

  it("keeps «No previous period» when only the previous period is empty", () => {
    const summary = metricSummary({ ...emptyGrades, value: 8, previous: null, assignments: [] }, context);
    expect(summary.delta).toBe("No previous period");
  });
});

describe("metricSummary comparisons", () => {
  it("names the same stretch of the previous month, not the whole month", () => {
    const summary = metricSummary(
      {
        metric: "attendance",
        period: "monthly",
        value: 0.9,
        previous: 0.85,
        previousStart: "2026-09-01",
        previousEnd: "2026-09-21",
        delta: 0.05,
        points: [],
        registered: 4,
      },
      { ...context, period: "monthly" },
    );
    expect(summary.delta).toBe("↑ 5 pp vs. 1–21 Sep");
  });
});

describe("metricSummary empty sentence", () => {
  it("gives an empty card one sentence, with last period's value when there is one", () => {
    expect(metricSummary({ ...emptyGrades, previous: null }, context).empty).toBe("No grades this week");
    expect(metricSummary({ ...emptyGrades, previous: 8.5 }, context).empty).toBe(
      "No grades this week · Last week was 8.5 /10",
    );
  });

  it("says a week without payments once and leaves cards with data alone", () => {
    const collections = { metric: "collections", value: 0, previous: 0, delta: null, points: [], payments: [] };
    expect(metricSummary(collections, context).empty).toBe("No payments this week");
    expect(metricSummary({ ...emptyGrades, value: 8, previous: null, assignments: [] }, context).empty).toBe("");
  });
});
