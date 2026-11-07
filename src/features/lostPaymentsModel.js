import { deriveMonthlyCharges, periodOf } from "../domain/monthlyBilling";
import { isOverdueClassDebt, matchesGroup } from "./homeDashboardModel";
import { trackingDerived } from "./trackingModel";

/** The student and debt a lost mark points at, ready for the manager's actions. */
export function debtItem(studentId, debt) {
  const lostAt = debt.lostAt ? { lostAt: debt.lostAt } : {};
  return debt.kind === "class"
    ? { studentId, kind: "class", classId: debt.classId, ...lostAt }
    : { studentId, kind: "monthly", groupId: debt.groupId, period: debt.period, ...lostAt };
}

/** A monthly charge as the same kind of debt. */
export function chargeDebt(charge) {
  return {
    kind: "monthly",
    groupId: charge.groupId,
    period: charge.period,
    date: charge.dueDate,
    amount: charge.balance,
    ...(charge.lostAt ? { lostAt: charge.lostAt } : {}),
  };
}

/**
 * Everything one student owes or was given up, oldest first: monthly fees already due and classes
 * with a balance. `canLose` holds only for what is overdue, the only debts that can be given up.
 */
export function studentDebtRows(state, derived, { studentId, asOf, scope = "all" }) {
  const groupNames = new Map((state.groups || []).map((group) => [group.id, group.name]));
  const fees = deriveMonthlyCharges(state, asOf)
    .filter(
      (charge) =>
        charge.studentId === studentId &&
        matchesGroup(scope, charge.groupId) &&
        (charge.status === "lost" || (["pending", "overdue"].includes(charge.status) && charge.dueDate <= asOf)),
    )
    .map((charge) => ({
      ...chargeDebt(charge),
      key: charge.id,
      charge,
      groupName: groupNames.get(charge.groupId) || "",
      lost: charge.status === "lost",
      canLose: charge.status === "overdue",
      abono: charge.paid,
    }));
  const classes = (trackingDerived(state, derived, asOf)?.classLog || [])
    .filter(
      (row) =>
        row.studentId === studentId &&
        row.classDate <= asOf &&
        (row.lostAmount > 0 || Number(row.outstanding) > 0) &&
        matchesGroup(scope, row.groupId || ""),
    )
    .map((row) => ({
      kind: "class",
      key: row.id,
      classId: row.id,
      groupId: row.groupId || "",
      groupName: row.groupName || "",
      date: row.classDate,
      amount: row.lostAmount > 0 ? row.lostAmount : Number(row.outstanding),
      lost: row.lostAmount > 0,
      ...(row.lostAmount > 0 ? { lostAt: row.lostAt } : {}),
      canLose: !(row.lostAmount > 0) && isOverdueClassDebt(row.classDate, asOf),
      overdue: isOverdueClassDebt(row.classDate, asOf),
      abono: 0,
      period: periodOf(row.classDate),
    }));
  return [...fees, ...classes].sort((left, right) => left.date.localeCompare(right.date));
}
