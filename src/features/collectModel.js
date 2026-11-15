import { moneyDifference, roundMoney, sumMoney } from "../domain/money.js";

/**
 * What one payment covers, given the checked debts oldest first (`{ kind, amount }`, amount being
 * what is still owed). Each debt the money reaches in full is paid; the rest of the money goes to
 * the first debt it cannot cover: a monthly fee keeps it as an abono, a class is only ever paid
 * whole, so the money stops there (`blocked`) and `unapplied` says how much is left out.
 * The amount never goes over the checked total.
 */
export function allocatePayment(debts, amount) {
  const total = sumMoney(debts, (debt) => debt.amount);
  const offered = Math.min(Math.max(roundMoney(Number(amount) || 0), 0), total);
  let left = offered;
  const items = [];
  let blocked = null;
  for (const debt of debts) {
    if (!(left > 0)) break;
    if (left >= debt.amount) {
      items.push({ debt, amount: debt.amount, full: true });
      left = moneyDifference(left, debt.amount);
      continue;
    }
    if (debt.kind === "monthly") {
      items.push({ debt, amount: left, full: false });
      left = 0;
    } else blocked = debt;
    break;
  }
  const applied = sumMoney(items, (item) => item.amount);
  return {
    items,
    total,
    applied,
    unapplied: moneyDifference(offered, applied),
    partial: items.find((item) => !item.full) || null,
    blocked,
  };
}
