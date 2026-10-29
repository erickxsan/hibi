import { addDays, endOfMonth, isDateOnly } from "./dates.js";
import { isGroupArchived } from "./groupArchiving.js";
import { createStableId } from "./ids.js";
import { roundMoney, sumMoney } from "./money.js";
import { dayOfWeekForDate, generateScheduledOccurrences, resolveHourlyRate } from "./schedule.js";

/*
 * Optional monthly billing, stored only as optional fields on existing entities
 * (the cloud schema accepts a fixed set of collections, so no new collection):
 *
 *   group.billing = { mode: "perClass" | "monthly", monthlyFee, due, effectiveFrom: "YYYY-MM", creditFirstMonth,
 *                     coveredFrom?: "YYYY-MM-DD", history?: [earlier terms] }
 *   `billing` is the latest arrangement and `history` the earlier ones, oldest first, each with its own
 *   `effectiveFrom`: a term applies from its month until the next one starts, so changing the fee or the
 *   mode from a month never rewrites the months before it.
 *   `coveredFrom` (new groups whose first fee falls next month): classes from that day until
 *   `effectiveFrom` are part of the monthly arrangement, so they are not charged per class.
 *     due = { type: "dayOfMonth", day: 1–28 } | { type: "nthClass", nth: 1–4 | "last" }
 *   student.billingByGroup[groupId] = { mode: "group" | "customFee" | "perClass", fee, due, joinedOn, firstMonthAmount }
 *   `due` (same shape as the group's) moves that student's due date; absent, they follow the group's.
 *   student.monthlyPayments = [{ id, groupId, period: "YYYY-MM", amount, paidAt, partial? }]
 *   A month may have several payments (abonos). `partial` marks one that left a balance; a payment
 *   without it settled the month when it was recorded, so later fee changes do not reopen it.
 *
 * A group without `billing` (or with mode "perClass") keeps the current per-class behavior.
 * Monthly charges are derived; only the payments are stored. Each month covers from its due date
 * until the day before the next one, so a late payment never moves the student's cycle.
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

/**
 * @typedef {object} GroupBilling
 * @property {string} mode "perClass" | "monthly"; the other fields are set for monthly billing only.
 * @property {number} [monthlyFee]
 * @property {{ type: string, nth?: string | number, day?: number }} [due]
 * @property {string} [effectiveFrom]
 * @property {boolean} [creditFirstMonth]
 * @property {string} [coveredFrom]
 * @property {GroupBilling[]} [history]
 */

function normalizeTerm(value) {
  if (!value || typeof value !== "object") return null;
  if (value.mode !== "monthly") {
    if (value.mode !== "perClass") return null;
    return isPeriod(value.effectiveFrom)
      ? { mode: "perClass", effectiveFrom: value.effectiveFrom }
      : { mode: "perClass" };
  }
  const fee = toNumber(value.monthlyFee);
  return {
    mode: "monthly",
    monthlyFee: fee !== null && fee >= 0 ? roundMoney(fee) : 0,
    due: normalizeDue(value.due),
    effectiveFrom: isPeriod(value.effectiveFrom) ? value.effectiveFrom : "",
    creditFirstMonth: Boolean(value.creditFirstMonth),
    ...(isDateOnly(value.coveredFrom) ? { coveredFrom: value.coveredFrom } : {}),
  };
}

/**
 * Canonical group billing, or null when the group follows the legacy per-class rule.
 * @returns {GroupBilling | null}
 */
export function normalizeGroupBilling(value) {
  const term = normalizeTerm(value);
  if (!term) return null;
  // Earlier terms need their own start, before the latest one's; anything else cannot be placed in time.
  const history = term.effectiveFrom
    ? (Array.isArray(value.history) ? value.history : [])
        .map(normalizeTerm)
        .filter((item, index) => item && (item.effectiveFrom || index === 0) && item.effectiveFrom < term.effectiveFrom)
        .sort((a, b) => (a.effectiveFrom || "").localeCompare(b.effectiveFrom || ""))
        .filter((item, index, list) => index === 0 || item.effectiveFrom !== list[index - 1].effectiveFrom)
    : [];
  return history.length ? { ...term, history } : term;
}

/** The billing terms of a group, oldest first: its history and then the latest one. */
export function billingTerms(group) {
  const billing = normalizeGroupBilling(group?.billing);
  if (!billing) return [];
  const { history = [], ...latest } = billing;
  return [...history, latest];
}

/**
 * The term in force in a month (YYYY-MM), or null before the first one starts (legacy per class).
 * Without a period, the latest term.
 * @returns {GroupBilling | null}
 */
export function groupBillingFor(group, period = "") {
  const terms = billingTerms(group);
  if (!period) return terms.at(-1) || null;
  return terms.findLast((term) => !term.effectiveFrom || term.effectiveFrom <= period) || null;
}

/**
 * The group's billing after a change that applies from `from` (YYYY-MM): the terms before that month
 * stay as they were and the ones starting on or after it are replaced by `next`.
 */
export function changeGroupBilling(billing, next, from) {
  const before = normalizeGroupBilling(billing);
  const term = normalizeTerm(next) || { mode: "perClass" };
  // A start-less per-class term says nothing a group without billing does not.
  const kept = billingTerms({ billing })
    .filter((item) => (item.effectiveFrom || "") < from)
    .filter((item, index) => index > 0 || item.mode === "monthly" || item.effectiveFrom);
  const last = kept.at(-1);
  const sameTerms = (a, b) =>
    a.mode === b.mode &&
    (a.mode !== "monthly" || (a.monthlyFee === b.monthlyFee && JSON.stringify(a.due) === JSON.stringify(b.due)));
  // Nothing before `from` and per class from then on: the group simply bills per class.
  if (!kept.length && term.mode === "perClass") return { mode: "perClass" };
  if (last && sameTerms(last, term)) return kept.length > 1 ? { ...last, history: kept.slice(0, -1) } : last;
  const replaced = before?.mode === "monthly" && before.coveredFrom && from <= before.effectiveFrom;
  const { creditFirstMonth: _credit, ...clean } = term;
  const result = {
    ...clean,
    ...(term.mode === "monthly" ? { creditFirstMonth: false } : {}),
    effectiveFrom: from,
    ...(term.mode === "monthly" && replaced ? { coveredFrom: before.coveredFrom } : {}),
  };
  return kept.length ? { ...result, history: kept } : result;
}

/** The same latest arrangement, starting in another month (earlier or later). */
export function moveBillingStart(billing, from) {
  const terms = billingTerms({ billing });
  if (!terms.length) return billing;
  const earlier = terms.slice(0, -1);
  const { coveredFrom: _covered, ...latest } = terms.at(-1);
  const base = earlier.length ? { ...earlier.at(-1), history: earlier.slice(0, -1) } : null;
  return changeGroupBilling(base, latest, from);
}

function normalizeOverride(value) {
  if (!value || typeof value !== "object") return null;
  const mode = ["customFee", "perClass"].includes(value.mode) ? value.mode : "group";
  const fee = toNumber(value.fee);
  const firstMonthAmount = toNumber(value.firstMonthAmount);
  const override = { mode };
  if (mode === "customFee") override.fee = fee !== null && fee >= 0 ? roundMoney(fee) : 0;
  if (mode !== "perClass" && value.due && typeof value.due === "object") override.due = normalizeDue(value.due);
  if (isDateOnly(value.joinedOn)) override.joinedOn = value.joinedOn;
  if (override.joinedOn && firstMonthAmount !== null && firstMonthAmount >= 0)
    override.firstMonthAmount = roundMoney(firstMonthAmount);
  return mode === "group" && !override.joinedOn && !override.due ? null : override;
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
      ...(item?.partial === true ? { partial: true } : {}),
    }))
    .filter((item) => {
      if (!item.id || !item.groupId || !isPeriod(item.period) || !item.paidAt || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(
      (a, b) =>
        a.period.localeCompare(b.period) ||
        a.groupId.localeCompare(b.groupId) ||
        a.paidAt.localeCompare(b.paidAt) ||
        a.id.localeCompare(b.id),
    );
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
      if (billing.coveredFrom && !isDateOnly(billing.coveredFrom))
        issues.push(["billing.coveredFrom", "Covered start must use YYYY-MM-DD."]);
    }
    if (billing && typeof billing === "object" && billing.history !== undefined) {
      if (!Array.isArray(billing.history)) issues.push(["billing.history", "Billing history must be an array."]);
      else if (
        billing.history.some(
          (term, index) =>
            !["perClass", "monthly"].includes(term?.mode) ||
            (!isPeriod(term?.effectiveFrom) && (index > 0 || term?.effectiveFrom)),
        )
      )
        issues.push(["billing.history", "Each earlier billing term needs a mode and a start month (YYYY-MM)."]);
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

/** True when the group bills monthly in `period`; without one, when any of its terms is monthly. */
export function isMonthlyGroup(group, period = "") {
  if (!period) return billingTerms(group).some((term) => term.mode === "monthly");
  return groupBillingFor(group, period)?.mode === "monthly";
}

/** Per-class charge used for suggestions: the group's rate × the usual class length. */
export function perClassCharge(state, group, studentId = "") {
  const slots = group?.weeklySchedule || [];
  const hours = slots.length
    ? slots.reduce((sum, slot) => sum + (Number(slot.durationHours) || 0), 0) / slots.length
    : Number(state?.settings?.defaultClassHours) || 0;
  const rate = studentId
    ? resolveHourlyRate(state, studentId, group?.id)
    : (group?.hourlyRate ?? state?.settings?.hourlyRate);
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

// The date a `due` rule lands on in a period of a group's calendar.
function dueDateIn(state, group, period, due) {
  const start = periodStart(period);
  if (due.type === "dayOfMonth") return addDays(start, due.day - 1);
  const dates = groupClassDates(state, group, period);
  if (!dates.length) return endOfMonth(start);
  return due.nth === "last" ? dates.at(-1) : dates[Math.min(Number(due.nth), dates.length) - 1];
}

/** Due date of a group's monthly fee in a period. */
export function monthlyDueDate(state, group, period) {
  const billing = groupBillingFor(group, period);
  if (!billing || billing.mode !== "monthly") return endOfMonth(periodStart(period));
  return dueDateIn(state, group, period, billing.due);
}

/**
 * A student's due date in a period: their own `due` when they have one, otherwise the group's, but
 * never before the day the student joined, so someone who joins after the due day is not overdue on arrival.
 */
export function studentMonthlyDueDate(state, student, group, period, groupDueDate = undefined) {
  const override = normalizeBillingByGroup(student?.billingByGroup)?.[group?.id];
  const dueDate =
    override?.due && isMonthlyGroup(group, period)
      ? dueDateIn(state, group, period, override.due)
      : (groupDueDate ?? monthlyDueDate(state, group, period));
  const joinedOn = override?.joinedOn || "";
  return joinedOn > dueDate ? joinedOn : dueDate;
}

// True when the weekly schedule still has a class from `asOf` to the end of its month.
function classLeftThisMonth(weeklySchedule, asOf) {
  const days = new Set((Array.isArray(weeklySchedule) ? weeklySchedule : []).map((slot) => Number(slot?.dayOfWeek)));
  for (let date = asOf; date <= endOfMonth(asOf); date = addDays(date, 1))
    if (days.has(dayOfWeekForDate(date))) return true;
  return false;
}

/**
 * First month a new monthly group bills, so a fee is never born overdue: this month while its due
 * day is today or still ahead, otherwise next month. A group due at its nth class bills this month
 * only while its schedule (`weeklySchedule`, when given) still has a class left in it.
 */
export function firstBillingPeriod(billing, asOf, weeklySchedule = undefined) {
  const period = periodOf(asOf);
  const normalized = normalizeGroupBilling(billing);
  if (!period || normalized?.mode !== "monthly") return period;
  if (normalized.due.type !== "dayOfMonth")
    return weeklySchedule && !classLeftThisMonth(weeklySchedule, asOf) ? nextPeriod(period) : period;
  return addDays(periodStart(period), normalized.due.day - 1) < asOf ? nextPeriod(period) : period;
}

/**
 * A group being created on `asOf` bills from its first billable month at the earliest. When that is
 * next month, the classes left this month are part of the monthly arrangement (`coveredFrom`): they
 * are not charged per class at the general rate the teacher never chose for this group.
 */
export function startGroupBilling(group, asOf) {
  const billing = normalizeGroupBilling(group?.billing);
  if (billing?.mode !== "monthly") return group;
  const first = firstBillingPeriod(billing, asOf, group.weeklySchedule);
  if (!first) return group;
  const effectiveFrom = billing.effectiveFrom && billing.effectiveFrom >= first ? billing.effectiveFrom : first;
  const next = { ...billing, effectiveFrom };
  if (effectiveFrom > periodOf(asOf) && !billing.coveredFrom) next.coveredFrom = asOf;
  return { ...group, billing: next };
}

// The student's own adjustment in a group, and whether they pay that group monthly in `period`.
function overrideOf(student, group) {
  return normalizeBillingByGroup(student?.billingByGroup)?.[group?.id] || null;
}

function paysMonthly(student, group, period) {
  if (!student || groupBillingFor(group, period)?.mode !== "monthly") return false;
  const override = overrideOf(student, group);
  if (override?.mode === "perClass") return false;
  const joinedPeriod = periodOf(override?.joinedOn);
  return !(joinedPeriod && period < joinedPeriod);
}

// Per-class money already paid in a month for classes a monthly fee now covers: it counts toward the fee.
function paidPerClassIn(state, student, group, period) {
  return sumMoney(
    (state.classLog || []).filter(
      (row) => row.studentId === student.id && row.groupId === group.id && periodOf(row.classDate) === period,
    ),
    (row) => row.amountPaid || 0,
  );
}

/**
 * How a student pays inside a group in a given month, under the term in force that month.
 * Money already paid per class for that month's classes is discounted from the fee.
 */
export function studentMonthlyPlan(state, student, group, period, paidPerClass = undefined) {
  if (!paysMonthly(student, group, period)) return null;
  const billing = groupBillingFor(group, period);
  const override = overrideOf(student, group);
  const joinedPeriod = periodOf(override?.joinedOn);
  const fee = override?.mode === "customFee" ? override.fee : billing.monthlyFee;
  const base =
    joinedPeriod && period === joinedPeriod && finite(override.firstMonthAmount) ? override.firstMonthAmount : fee;
  const credit = paidPerClass ?? paidPerClassIn(state, student, group, period);
  const amount = Math.max(0, roundMoney(base - credit));
  return { fee, amount, adjusted: Boolean(override && override.mode !== "group"), prorated: amount !== fee };
}

// A class of a new monthly group between its creation and its first fee (see `coveredFrom`).
function coveredBeforeFirstFee(student, group, date) {
  const period = periodOf(date);
  const term = billingTerms(group).find(
    (item) =>
      item.mode === "monthly" &&
      item.coveredFrom &&
      item.effectiveFrom &&
      date >= item.coveredFrom &&
      period < item.effectiveFrom,
  );
  return Boolean(term) && overrideOf(student, group)?.mode !== "perClass";
}

/**
 * True when a monthly fee covers this student's class in this group on `date`, so the class itself
 * costs nothing more. Works on the records, for callers that already hold them. `startedOnly` leaves
 * out arrangements saved without a start month, which cannot say which recorded classes they cover.
 */
export function monthlyFeeCovers(student, group, date, { startedOnly = false } = {}) {
  if (!student || !group || !isDateOnly(date)) return false;
  if (startedOnly && !groupBillingFor(group, periodOf(date))?.effectiveFrom)
    return coveredBeforeFirstFee(student, group, date);
  return paysMonthly(student, group, periodOf(date)) || coveredBeforeFirstFee(student, group, date);
}

/** True when a class row for this student and group is covered by a monthly fee (its own charge is $0). */
export function coveredByMonthlyFee(state, studentId, groupId, date) {
  const group = (state.groups || []).find((item) => item.id === groupId);
  const student = (state.students || []).find((item) => item.id === studentId);
  return monthlyFeeCovers(student, group, date);
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
  const first = billingTerms(group).find((term) => term.mode === "monthly");
  if (first?.effectiveFrom) return first.effectiveFrom;
  const joined = students
    .map((student) => periodOf(overrideOf(student, group)?.joinedOn))
    .filter(Boolean)
    .sort();
  return joined[0] || periodOf(state.settings?.asOfDate);
}

/**
 * Where a month's payments leave it: settled once a payment covered the balance when it was made
 * (or the payments add up to the total), otherwise the balance still owed.
 */
function settlement(total, payments) {
  const paid = sumMoney(payments, (item) => item.amount);
  const settled = payments.length > 0 && (payments.some((item) => !item.partial) || paid >= total);
  return { paid, settled, balance: settled ? 0 : Math.max(0, roundMoney(total - paid)) };
}

/**
 * The days a month's fee covers for a student: from its due date until the day before the next one.
 * The first month starts when the arrangement (or the student) does and the last one ends with its
 * month, the same days in which classes are not charged on their own.
 */
function coverage(state, student, group, period, dueDate) {
  const override = overrideOf(student, group);
  const term = groupBillingFor(group, period);
  const previous = periodOf(addDays(periodStart(period), -1));
  const from = paysMonthly(student, group, previous)
    ? dueDate
    : periodOf(override?.joinedOn) === period
      ? override.joinedOn
      : term?.coveredFrom && term.effectiveFrom === period
        ? term.coveredFrom
        : periodStart(period);
  const next = nextPeriod(period);
  const to = paysMonthly(student, group, next)
    ? addDays(studentMonthlyDueDate(state, student, group, next), -1)
    : endOfMonth(periodStart(period));
  return { coversFrom: from, coversTo: to < from ? from : to };
}

/**
 * Monthly charges from each group's start through `through` (YYYY-MM), for active members.
 * `dueDate` is the student's own (never before they joined); `groupDueDate` is the group's.
 * `total` is what the month costs, `paid` the payments so far and `balance` what is still owed;
 * `amount` is the money the charge stands for now: what was paid once settled, otherwise the balance.
 * Status: "paid" once settled; otherwise "pending" until the due date and "overdue" after it
 * (`partial` when part of it is paid). `coversFrom`–`coversTo` are the days the month pays for.
 */
export function deriveMonthlyCharges(state, asOfDate, { through = periodOf(asOfDate), includeArchived = true } = {}) {
  const charges = [];
  const students = (state.students || []).filter((student) => student.status !== "Inactive");
  const perClassPaid = new Map();
  for (const row of state.classLog || []) {
    if (!(row?.amountPaid > 0)) continue;
    const key = `${row.studentId}|${row.groupId}|${periodOf(row.classDate)}`;
    perClassPaid.set(key, roundMoney((perClassPaid.get(key) || 0) + row.amountPaid));
  }
  for (const group of state.groups || []) {
    if (!isMonthlyGroup(group) || (!includeArchived && isGroupArchived(group))) continue;
    const members = students.filter((student) => studentGroupIds(student).includes(group.id));
    const lastPeriod =
      isGroupArchived(group) && isDateOnly(group.archivedAt) && periodOf(group.archivedAt) < through
        ? periodOf(group.archivedAt)
        : through;
    let period = firstPeriodFor(state, group, members);
    for (let guard = 0; period && period <= lastPeriod && guard < 240; guard += 1, period = nextPeriod(period)) {
      if (!isMonthlyGroup(group, period)) continue;
      const groupDueDate = monthlyDueDate(state, group, period);
      for (const student of members) {
        const paidPerClass = perClassPaid.get(`${student.id}|${group.id}|${period}`) || 0;
        const plan = studentMonthlyPlan(state, student, group, period, paidPerClass);
        if (!plan) continue;
        const payments = normalizeMonthlyPayments(student.monthlyPayments).filter(
          (item) => item.groupId === group.id && item.period === period,
        );
        const { paid, settled, balance } = settlement(plan.amount, payments);
        const dueDate = studentMonthlyDueDate(state, student, group, period, groupDueDate);
        const last = payments.at(-1);
        charges.push({
          id: `${student.id}|${group.id}|${period}`,
          studentId: student.id,
          groupId: group.id,
          period,
          fee: plan.fee,
          total: plan.amount,
          paid,
          balance,
          amount: settled ? paid : balance,
          dueDate,
          groupDueDate,
          status: settled ? "paid" : plan.amount <= 0 ? "waived" : asOfDate > dueDate ? "overdue" : "pending",
          partial: !settled && paid > 0,
          payments,
          paidAt: settled ? last.paidAt : "",
          paymentId: last?.id || "",
          lastPaidAt: last?.paidAt || "",
          adjusted: plan.adjusted,
          prorated: plan.prorated,
          archived: isGroupArchived(group),
          ...coverage(state, student, group, period, dueDate),
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

// The classes a group's schedule gives in a whole month, even when the group started (or was
// reactivated) partway through it or is not saved yet: a monthly fee is priced on a full month.
function fullMonthClassDates(state, group, period) {
  const preview = { ...group, status: "Active", scheduleResumeDate: "" };
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const previewState = {
    ...state,
    groups: groups.some((item) => item.id === group.id)
      ? groups.map((item) => (item.id === group.id ? preview : item))
      : [...groups, preview],
  };
  return groupClassDates(previewState, preview, period);
}

/**
 * Suggested fee: the classes of a full month of the group's schedule × the per-class charge.
 * Uses `period`, or the next month when this one has no classes.
 */
export function suggestedMonthlyFee(state, group, period) {
  if (!group?.id || !isPeriod(period)) return { classes: 0, perClass: perClassCharge(state, group), fee: 0 };
  const classes =
    fullMonthClassDates(state, group, period).length || fullMonthClassDates(state, group, nextPeriod(period)).length;
  const perClass = perClassCharge(state, group);
  return { classes, perClass, fee: roundMoney(classes * perClass) };
}

/** What one month of a group costs a student, what was paid and what is still owed (null when not monthly). */
export function monthlyBalance(state, { studentId, groupId, period }) {
  const student = (state.students || []).find((item) => item.id === studentId);
  const group = (state.groups || []).find((item) => item.id === groupId);
  const plan = student && group ? studentMonthlyPlan(state, student, group, period) : null;
  if (!plan) return null;
  const payments = normalizeMonthlyPayments(student.monthlyPayments).filter(
    (item) => item.groupId === groupId && item.period === period,
  );
  return { total: plan.amount, ...settlement(plan.amount, payments) };
}

function withPayments(state, studentId, change) {
  return {
    ...state,
    students: state.students.map((student) => {
      if (student.id !== studentId) return student;
      const next = change(normalizeMonthlyPayments(student.monthlyPayments));
      const { monthlyPayments: _previous, ...rest } = student;
      return next.length ? { ...rest, monthlyPayments: normalizeMonthlyPayments(next) } : rest;
    }),
  };
}

/**
 * Records a payment for one month: the whole balance by default, or part of it (an abono). It never
 * goes over what is still owed, and one that leaves a balance is stored as partial.
 */
export function recordMonthlyPayment(state, { studentId, groupId, period, amount = undefined, paidAt }) {
  const balance = monthlyBalance(state, { studentId, groupId, period });
  if (!balance || balance.settled || !isDateOnly(paidAt)) return state;
  const wanted =
    amount === undefined || amount === null || amount === "" ? balance.balance : roundMoney(Number(amount));
  const value = Math.min(balance.balance, Number.isFinite(wanted) ? wanted : 0);
  if (!(value > 0)) return state;
  const payment = { id: createStableId("monthly"), groupId, period, amount: value, paidAt };
  return withPayments(state, studentId, (payments) => [
    ...payments,
    value < balance.balance ? { ...payment, partial: true } : payment,
  ]);
}

/** Removes one recorded payment. */
export function removeMonthlyPayment(state, { studentId, paymentId }) {
  return withPayments(state, studentId, (payments) => payments.filter((item) => item.id !== paymentId));
}

/**
 * Marks one month as paid (its balance, or `amount` as an abono) or takes back a payment: the one
 * given by `paymentId`, otherwise all of that month's. Returns the next workspace state.
 */
export function setMonthlyPayment(state, { studentId, groupId, period, amount, paid = true, paidAt, paymentId = "" }) {
  if (paid) return recordMonthlyPayment(state, { studentId, groupId, period, amount, paidAt });
  if (paymentId) return removeMonthlyPayment(state, { studentId, paymentId });
  return withPayments(state, studentId, (payments) =>
    payments.filter((item) => !(item.groupId === groupId && item.period === period)),
  );
}
