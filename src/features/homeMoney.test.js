import { describe, expect, it } from "vitest";
import { translateMessage } from "../i18n/index.jsx";
import "../i18n/screenTranslations.js";
import { comparisonSpan, metricSummary, moneyDeltaText, overdueLine, overdueSplit } from "./HomeMetrics";

const en = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
const es = (key, values = {}) => translateMessage(key, values, "es");

const context = {
  t: en,
  locale: "en-MX",
  period: "monthly",
  asOf: "2026-10-22",
  names: (list) => list.join(", "),
  nameOf: () => "",
  threshold: { attendance: 0.8, grade: 7 },
  rows: [],
};

function collections(overrides = {}) {
  return {
    metric: "collections",
    period: "monthly",
    value: 5525,
    previous: 10834,
    previousStart: "2026-09-01",
    previousEnd: "2026-09-22",
    delta: -0.49,
    points: [],
    payments: [],
    paymentDays: 0,
    ...overrides,
  };
}

describe("money comparisons name the stretch they compare with", () => {
  it("formats the compared dates", () => {
    expect(comparisonSpan("2026-09-01", "2026-09-22", "2026-10-22", "es-MX")).toBe("1–22 sep");
    expect(comparisonSpan("2026-10-12", "2026-10-14", "2026-10-21", "es-MX")).toBe("12–14 oct");
    expect(comparisonSpan("2026-08-24", "2026-09-22", "2026-09-22", "es-MX")).toBe("24 ago–22 sep");
    expect(comparisonSpan("2026-09-01", "2026-09-30", "2026-10-31", "es-MX")).toBe("septiembre");
    expect(comparisonSpan("2025-01-01", "2025-10-22", "2026-10-22", "es-MX")).toBe("1 ene–22 oct 2025");
    expect(comparisonSpan("2025-01-01", "2025-12-31", "2026-12-31", "es-MX")).toBe("2025");
    expect(comparisonSpan("", "", "2026-10-22", "es-MX")).toBe("");
  });

  it("says «vs. 1–22 sep» on 22 Oct instead of «vs. septiembre»", () => {
    expect(moneyDeltaText(-0.49, "2026-09-01", "2026-09-22", "2026-10-22", es, "es-MX")).toBe("↓ 49% vs. 1–22 sep");
    expect(moneyDeltaText(null, "2026-09-01", "2026-09-22", "2026-10-22", es, "es-MX")).toBe("");
    const summary = metricSummary(collections(), context);
    expect(summary.delta).toBe("↓ 49% vs. 1–22 Sep");
    expect(summary.delta).not.toMatch(/September/);
    expect(summary.deltaTone).toBe("text-bad");
  });

  it("keeps «last Wednesday» for a single day", () => {
    const summary = metricSummary(
      collections({ period: "today", previousStart: "2026-10-15", previousEnd: "2026-10-15", delta: 0.1 }),
      { ...context, period: "today" },
    );
    expect(summary.delta).toBe("↑ 10% vs. last Thursday");
  });
});

describe("overdue money states its scope", () => {
  const debts = { period: "2026-10", overdue: 12900, overdueThisMonth: 3200, overdueEarlier: 9700 };

  it("splits the overdue figure by month in Spanish", () => {
    expect(overdueSplit(debts, es, "es-MX")).toBe("$3,200 de octubre · $9,700 de meses anteriores");
    expect(overdueLine(debts, es, "es-MX")).toBe("$12,900 vencidos ($3,200 de octubre · $9,700 de meses anteriores)");
    expect(overdueLine({ ...debts, overdueThisMonth: 0, overdue: 9700 }, es, "es-MX")).toBe(
      "$9,700 vencidos ($9,700 de meses anteriores)",
    );
    expect(overdueLine({ period: "2026-10", overdue: 0 }, es, "es-MX")).toBe("Nada vencido");
  });

  it("has Spanish copy for every new money label", () => {
    expect(es("{amount} in total", { amount: "$1,125" })).toBe("$1,125 en total");
    expect(es("{amount} overdue from {month}", { amount: "$900", month: "octubre" })).toBe("$900 vencidos de octubre");
    expect(es("{amount} overdue from earlier months", { amount: "$900" })).toBe("$900 vencidos de meses anteriores");
    expect(es("Aside, {amount} owed by inactive students.", { amount: "$11,700" })).toBe(
      "Aparte, $11,700 que deben alumnos inactivos.",
    );
    expect(es("{amount} owed by inactive students", { amount: "$11,700" })).toBe("$11,700 que deben alumnos inactivos");
    expect(es("Inactive students owe {amount}", { amount: "$200" })).toBe("Alumnos inactivos deben $200");
    expect(es("Overdue: {split}.", { split: "$900 de octubre" })).toBe("Vencido: $900 de octubre.");
    expect(es("Overdue from {month}", { month: "octubre" })).toBe("Vencido de octubre");
    expect(es("Overdue from earlier months")).toBe("Vencido de meses anteriores");
    expect(es("Not due yet")).toBe("Aún no vence");
    expect(es("Owed by inactive students")).toBe("Lo que deben alumnos inactivos");
    expect(es("Inactive student")).toBe("Alumno inactivo");
    expect(es("No active student owes.")).toBe("Ningún alumno activo debe.");
  });
});
