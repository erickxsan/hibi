import { describe, expect, it } from "vitest";
import { allocatePayment } from "./collectModel.js";

const fee = (period, amount) => ({ kind: "monthly", key: period, period, amount });
const lesson = (date, amount) => ({ kind: "class", key: date, date, amount });

describe("allocatePayment", () => {
  const months = ["2026-04", "2026-05", "2026-06"].map((period) => fee(period, 800));

  it("pays every checked debt when the amount is the total", () => {
    const plan = allocatePayment(months, 2400);
    expect(plan.items.map((item) => [item.debt.period, item.amount, item.full])).toEqual([
      ["2026-04", 800, true],
      ["2026-05", 800, true],
      ["2026-06", 800, true],
    ]);
    expect(plan).toMatchObject({ total: 2400, applied: 2400, unapplied: 0, partial: null, blocked: null });
  });

  it("goes oldest first and leaves the rest as an abono on the first month it cannot cover", () => {
    const plan = allocatePayment(months, 1100);
    expect(plan.items.map((item) => [item.debt.period, item.amount, item.full])).toEqual([
      ["2026-04", 800, true],
      ["2026-05", 300, false],
    ]);
    expect(plan.partial.debt.period).toBe("2026-05");
    expect(plan).toMatchObject({ applied: 1100, unapplied: 0, blocked: null });
  });

  it("keeps a small amount as an abono on the oldest month", () => {
    const plan = allocatePayment(months, 250.5);
    expect(plan.items).toEqual([{ debt: months[0], amount: 250.5, full: false }]);
  });

  it("pays a class only in full and says how much it leaves out", () => {
    const debts = [fee("2026-04", 800), lesson("2026-05-12", 300), fee("2026-05", 800)];
    const plan = allocatePayment(debts, 1000);
    expect(plan.items.map((item) => item.amount)).toEqual([800]);
    expect(plan.blocked).toBe(debts[1]);
    expect(plan).toMatchObject({ applied: 800, unapplied: 200, partial: null });
  });

  it("records nothing when the oldest debt is a class the amount does not cover", () => {
    const plan = allocatePayment([lesson("2026-05-12", 300)], 200);
    expect(plan).toMatchObject({ items: [], applied: 0, unapplied: 200 });
  });

  it("never goes over the checked total and ignores what is not a positive amount", () => {
    expect(allocatePayment(months, 9999).applied).toBe(2400);
    expect(allocatePayment(months, 9999).unapplied).toBe(0);
    expect(allocatePayment(months, -5).items).toEqual([]);
    expect(allocatePayment(months, "abc").items).toEqual([]);
    expect(allocatePayment([], 100)).toMatchObject({ total: 0, applied: 0, unapplied: 0 });
  });

  it("adds cents without floating-point drift", () => {
    const plan = allocatePayment([fee("2026-04", 0.1), fee("2026-05", 0.2)], 0.3);
    expect(plan.items.every((item) => item.full)).toBe(true);
    expect(plan.applied).toBe(0.3);
  });
});
