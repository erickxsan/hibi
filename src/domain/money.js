/** MXN: round half up to two decimal places at the charge/payment boundary. */
export function toMinorUnits(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON * Math.max(1, Math.abs(value))) * 100);
}
export function roundMoney(value) {
  return toMinorUnits(value) / 100;
}
export function sumMoney(items, selector = (item) => item) {
  return items.reduce((total, item) => total + toMinorUnits(selector(item)), 0) / 100;
}
export function moneyDifference(charge, paid) {
  return Math.max(toMinorUnits(charge) - toMinorUnits(paid), 0) / 100;
}
