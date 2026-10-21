import { addDays, endOfMonth, isDateOnly } from "./dates.js";
import { isGroupArchived } from "./groupArchiving.js";
import { createStableId } from "./ids.js";
import { roundMoney, sumMoney } from "./money.js";
import { generateScheduledOccurrences, resolveHourlyRate } from "./schedule.js";

/*
 * Optional monthly billing, stored only as optional fields on existing entities
 * (the cloud schema accepts a fixed set of collections, so no new collection):
 *
 *   group.billing = { mode: "perClass" | "monthly", monthlyFee, due, effectiveFrom: "YYYY-MM", creditFirstMonth }
 *     due = { type: "dayOfMonth", day: 1–28 } | { type: "nthClass", nth: 1–4 | "last" }
 *   student.billingByGroup[groupId] = { mode: "group" | "customFee" | "perClass", fee, joinedOn, firstMonthAmount }
 *   student.monthlyPayments = [{ id, groupId, period: "YYYY-MM", amount, paidAt }]
 *
 * A group without `billing` (or with mode "perClass") keeps the current per-class behavior.
 * Monthly charges are derived; only the paid ones are stored.
 */
export const DUE_NTH_OPTIONS = Object.freeze([1, 2, 3, 4, "last"]);

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value) {
  if (finite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function periodOf(date) {
  return isDateOnly(date) ? date.slice(0, 7) : "";
}

export function isPeriod(value) {
  return typeof value === "string" && PERIOD_RE.test(value);
}

export function periodStart(period) {
  return `${period}-01`;
}

export function nextPeriod(period) {
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function normalizeDue(value) {
  if (value?.type === "nthClass") {
    const nth = value.nth === "last" ? "last" : Math.min(4, Math.max(1, Math.trunc(Number(value.nth)) || 1));
    return { type: "nthClass", nth };
  }
  return { type: "dayOfMonth", day: Math.min(28, Math.max(1, Math.trunc(Number(value?.day)) || 5)) };
}

/** Canonical group billing, or null when the group follows the legacy per-class rule. */
export function normalizeGroupBilling(value) {
  if (!value || typeof value !== "object") return null;
  if (value.mode !== "monthly") return value.mode === "perClass" ? { mode: "perClass" } : null;
  const fee = toNumber(value.monthlyFee);
  return {
    mode: "monthly",
    monthlyFee: fee !== null && fee >= 0 ? roundMoney(fee) : 0,
    due: normalizeDue(value.due),
    effectiveFrom: isPeriod(value.effectiveFrom) ? value.effectiveFrom : "",
    creditFirstMonth: Boolean(value.creditFirstMonth),
  };
}

function normalizeOverride(value) {
  if (!value || typeof value !== "object") return null;
  const mode = ["customFee", "perClass"].includes(value.mode) ? value.mode : "group";
  const fee = toNumber(value.fee);
  const firstMonthAmount = toNumber(value.firstMonthAmount);
  const override = { mode };
  if (mode === "customFee") override.fee = fee !== null && fee >= 0 ? roundMoney(fee) : 0;
  if (isDateOnly(value.joinedOn)) override.joinedOn = value.joinedOn;
  if (override.joinedOn && firstMonthAmount !== null && firstMonthAmount >= 0)
    override.firstMonthAmount = roundMoney(firstMonthAmount);
  return mode === "group" && !override.joinedOn ? null : override;
}

/** Canonical per-group overrides for one student, or null when there are none. */
export function normalizeBillingByGroup(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value)
    .filter(([groupId]) => typeof groupId === "string" && groupId.trim())
    .map(([groupId, override]) => [groupId.trim(), normalizeOverride(override)])
    .filter(([, override]) => override);
  return entries.length ? Object.fromEntries(entries.sort(([a], [b]) => String(a).localeCompare(String(b)))) : null;
}

export function normalizeMonthlyPayments(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => ({
      id: String(item?.id || "").trim(),
      groupId: String(item?.groupId || "").trim(),
      period: String(item?.period || "").trim(),
      amount: roundMoney(toNumber(item?.amount) ?? 0),
      paidAt: isDateOnly(item?.paidAt) ? item.paidAt : "",
    }))
    .filter((item) => {
      const key = `${item.groupId}|${item.period}`;
      if (!item.id || !item.groupId || !isPeriod(item.period) || !item.paidAt || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.groupId.localeCompare(b.groupId));
}

/** Structural problems for the import validator. Empty when the optional fields are absent or valid. */
export function billingIssues(entity, kind) {
  const issues = [];
  if (kind === "group" && entity.billing !== undefined && entity.billing !== null) {
    const billing = entity.billing;
    if (typeof billing !== "object" || !["perClass", "monthly"].includes(billing.mode))
      issues.push(["billing", "Billing must be per class or monthly."]);
    else if (billing.mode === "monthly") {
      if (!finite(billing.monthlyFee) || billing.monthlyFee < 0)
        issues.push(["billing.monthlyFee", "Monthly fee must be zero or more."]);
      if (billing.effectiveFrom && !isPeriod(billing.effectiveFrom))
        issues.push(["billing.effectiveFrom", "Billing start must use YYYY-MM."]);
    }
  }
  if (kind === "student") {
    if (entity.monthlyPayments !== undefined && !Array.isArray(entity.monthlyPayments))
      issues.push(["monthlyPayments", "Monthly payments must be an array."]);
    (Array.isArray(entity.monthlyPayments) ? entity.monthlyPayments : []).forEach((item, index) => {
      if (!isPeriod(item?.period) || !isDateOnly(item?.paidAt) || !finite(item?.amount) || item.amount < 0)
        issues.push([`monthlyPayments[${index}]`, "Monthly payment needs a period, a paid date and an amount."]);
    });
    if (
      entity.billingByGroup !== undefined &&
      (typeof entity.billingByGroup !== "object" || Array.isArray(entity.billingByGroup))
    )
      issues.push(["billingByGroup", "Student billing adjustments must be an object."]);
  }
  return issues;
}

function studentGroupIds(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}

export function isMonthlyGroup(group, period = "") {
  const billing = normalizeGroupBilling(group?.billing);
  return Boolean(billing?.mode === "monthly" && (!period || !billing.effectiveFrom || period >= billing.effectiveFrom));
}

/** Per-class charge used for suggestions: the group's rate × the usual class length. */
export function perClassCharge(state, group, studentId = "") {
  const slots = group?.weeklySchedule || [];
  const hours = slots.length
    ? slots.reduce((sum, slot) => sum + (Number(slot.durationHours) || 0), 0) / slots.length
    : Number(state?.settings?.defaultClassHours) || 0;
  const rate = studentId ? resolveHourlyRate(state, studentId, group?.id) : (group?.hourlyRate ?? state?.settings?.hourlyRate);
  return roundMoney(hours * (Number(rate) || 0));
}

/** Non-cancelled class dates of a group inside a month (YYYY-MM), from its real schedule. */
export function groupClassDates(state, group, period) {
  if (!group || !isPeriod(period)) return [];
  const start = periodStart(period);
  const end = endOfMonth(start);
  const visibleState = isGroupArchived(group)
    ? { ...state, groups: state.groups.map((item) => (item.id === group.id ? { ...item, status: "Active" } : item)) }
    : state;
  const cancelled = new Set(
    (state.classLog || [])
      .filter((row) => row.groupId === group.id && row.classStatus === "Cancelled")
      .map((row) => row.classDate),
  );
  return [
    ...new Set(
      generateScheduledOccurrences(visibleState, start, end)
        .filter((item) => item.groupId === group.id && item.status !== "Cancelled" && !cancelled.has(item.classDate))
        .map((item) => item.classDate),
    ),
  ].sort();
}

/** Due date of a group's monthly fee in a period. */
export function monthlyDueDate(state, group, period) {
  const billing = normalizeGroupBilling(group?.billing);
  const start = periodStart(period);
  if (!billing || billing.mode !== "monthly") return endOfMonth(start);
  if (billing.due.type === "dayOfMonth") return addDays(start, billing.due.day - 1);
  const dates = groupClassDates(state, group, period);
  if (!dates.length) return endOfMonth(start);
  const nth = billing.due.nth;
  return nth === "last" ? dates.at(-1) : dates[Math.min(Number(nth), dates.length) - 1];
}

/** How a student pays inside a group in a given month. */
export function studentMonthlyPlan(state, student, group, period) {
  const billing = normalizeGroupBilling(group?.billing);
  if (!student || !billing || billing.mode !== "monthly") return null;
  if (billing.effectiveFrom && period < billing.effectiveFrom) return null;
  const override = normalizeBillingByGroup(student.billingByGroup)?.[group.id];
  if (override?.mode === "perClass") return null;
  const joinedPeriod = periodOf(override?.joinedOn);
  if (joinedPeriod && period < joinedPeriod) return null;
  const fee = override?.mode === "customFee" ? override.fee : billing.monthlyFee;
  let amount = fee;
  let prorated = false;
  if (joinedPeriod && period === joinedPeriod && finite(override.firstMonthAmount)) {
    amount = override.firstMonthAmount;
    prorated = amount !== fee;
  } else if (billing.creditFirstMonth && period === billing.effectiveFrom) {
    const paidPerClass = sumMoney(
      (state.classLog || []).filter(
        (row) => row.studentId === student.id && row.groupId === group.id && periodOf(row.classDate) === period,
      ),
      (row) => row.amountPaid || 0,
    );
    amount = Math.max(0, roundMoney(fee - paidPerClass));
    prorated = amount !== fee;
  }
  return { fee, amount, adjusted: Boolean(override && override.mode !== "group"), prorated };
}

/** True when a class row for this student and group is covered by a monthly fee (its own charge is $0). */
export function coveredByMonthlyFee(state, studentId, groupId, date) {
  const group = (state.groups || []).find((item) => item.id === groupId);
  const student = (state.students || []).find((item) => item.id === studentId);
  return Boolean(group && student && studentMonthlyPlan(state, student, group, periodOf(date)));
}

/** First month amount for a student joining mid-month: full, proportional to remaining classes, or nothing. */
export function joiningAmounts(state, group, fee, joinedOn) {
  const dates = groupClassDates(state, group, periodOf(joinedOn));
  const remaining = dates.filter((date) => date >= joinedOn).length;
  return {
    total: dates.length,
    remaining,
    full: roundMoney(fee),
    prorated: dates.length ? roundMoney((fee * remaining) / dates.length) : roundMoney(fee),
    next: 0,
  };
}

function firstPeriodFor(state, group, students) {
  const billing = normalizeGroupBilling(group.billing);
  if (billing.effectiveFrom) return billing.effectiveFrom;
  const joined = students
    .map((student) => periodOf(normalizeBillingByGroup(student.billingByGroup)?.[group.id]?.joinedOn))
    .filter(Boolean)
    .sort();
  return joined[0] || periodOf(state.settings?.asOfDate);
}

/**
 * Monthly charges from each group's start through `through` (YYYY-MM), for active members.
 * Status: "paid" with a payment record; otherwise "pending" until the due date and "overdue" after it.
 */
export function deriveMonthlyCharges(state, asOfDate, { through = periodOf(asOfDate), includeArchived = true } = {}) {
  const charges = [];
  const students = (state.students || []).filter((student) => student.status !== "Inactive");
  for (const group of state.groups || []) {
    if (!isMonthlyGroup(group) || (!includeArchived && isGroupArchived(group))) continue;
    const members = students.filter((student) => studentGroupIds(student).includes(group.id));
    const lastPeriod =
      isGroupArchived(group) && isDateOnly(group.archivedAt) && periodOf(group.archivedAt) < through
        ? periodOf(group.archivedAt)
        : through;
    let period = firstPeriodFor(state, group, members);
    for (let guard = 0; period && period <= lastPeriod && guard < 240; guard += 1, period = nextPeriod(period)) {
      const dueDate = monthlyDueDate(state, group, period);
      for (const student of members) {
        const plan = studentMonthlyPlan(state, student, group, period);
        if (!plan) continue;
        const payment = normalizeMonthlyPayments(student.monthlyPayments).find(
          (item) => item.groupId === group.id && item.period === period,
        );
        charges.push({
          id: `${student.id}|${group.id}|${period}`,
          studentId: student.id,
          groupId: group.id,
          period,
          fee: plan.fee,
          amount: payment ? payment.amount : plan.amount,
          dueDate,
          status: payment ? "paid" : plan.amount <= 0 ? "waived" : asOfDate > dueDate ? "overdue" : "pending",
          paidAt: payment?.paidAt || "",
          paymentId: payment?.id || "",
          adjusted: plan.adjusted,
          prorated: plan.prorated,
          archived: isGroupArchived(group),
        });
      }
    }
  }
  return charges.sort(
    (a, b) => a.period.localeCompare(b.period) || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id),
  );
}

/** Monthly fees paid between two dates (inclusive), for revenue figures. */
export function monthlyPaymentsBetween(state, startDate, endDate, { groupIds = null } = {}) {
  return (state.students || []).flatMap((student) =>
    normalizeMonthlyPayments(student.monthlyPayments)
      .filter(
        (item) =>
          item.paidAt >= startDate &&
          item.paidAt <= endDate &&
          (!groupIds || groupIds.has(item.groupId)) &&
          (state.groups || []).some((group) => group.id === item.groupId),
      )
      .map((item) => ({ ...item, studentId: student.id })),
  );
}

/** Suggested fee: classes the group really has this month × the per-class charge. */
export function suggestedMonthlyFee(state, group, period) {
  const classes = groupClassDates(state, group, period).length;
  const perClass = perClassCharge(state, group);
  return { classes, perClass, fee: roundMoney(classes * perClass) };
}

/** Marks or unmarks one month as paid. Returns the next workspace state. */
export function setMonthlyPayment(state, { studentId, groupId, period, amount, paid = true, paidAt }) {
  return {
    ...state,
    students: state.students.map((student) => {
      if (student.id !== studentId) return student;
      const payments = normalizeMonthlyPayments(student.monthlyPayments).filter(
        (item) => !(item.groupId === groupId && item.period === period),
      );
      const next = paid
        ? [
            ...payments,
            { id: createStableId("monthly"), groupId, period, amount: roundMoney(Number(amount) || 0), paidAt },
          ]
        : payments;
      const { monthlyPayments: _previous, ...rest } = student;
      return next.length ? { ...rest, monthlyPayments: normalizeMonthlyPayments(next) } : rest;
    }),
  };
}
