import { calculateOutstanding } from "./calculations.js";
import { setGroupArchived } from "./groupArchiving.js";
import { markLost } from "./lostPayments.js";
import { deriveMonthlyCharges, groupMoneyOnRecord, normalizeMonthlyPayments, recordStays } from "./monthlyBilling.js";
import { roundMoney, sumMoney } from "./money.js";
import { gradeGroupId } from "./semanticIdentity.js";

function studentGroupIds(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : [];
}

// Its students, without the group from `date` (a monthly group stamps the day they left).
function withoutMembers(state, groupId, date) {
  return {
    ...state,
    students: state.students.map((student) =>
      studentGroupIds(student).includes(groupId)
        ? recordStays(
            student,
            { ...student, groupIds: student.groupIds.filter((id) => id !== groupId) },
            state.groups,
            date,
            state.classLog,
          )
        : student,
    ),
  };
}

// What a group still expects to collect on `date`, with the amount of each debt: unpaid classes and
// monthly fees not given up yet.
function pendingDebts(state, groupId, date) {
  const classes = (state.classLog || [])
    .filter((row) => row.groupId === groupId)
    .map((row) => ({
      item: { studentId: row.studentId, kind: "class", classId: row.id },
      amount: calculateOutstanding(state, row, date),
    }));
  const fees = deriveMonthlyCharges(state, date)
    .filter((charge) => charge.groupId === groupId && ["pending", "overdue"].includes(charge.status))
    .map((charge) => ({
      item: { studentId: charge.studentId, kind: "monthly", groupId, period: charge.period },
      amount: charge.balance,
    }));
  return [...classes, ...fees].filter((debt) => debt.amount > 0);
}

function hasHistory(state, groupId) {
  return (
    (state.classLog || []).some((row) => row.groupId === groupId) ||
    (state.grades || []).some((grade) => gradeGroupId(grade) === groupId) ||
    groupMoneyOnRecord(state, groupId)
  );
}

/**
 * What deleting a group on `date` keeps and gives up, for the confirmation: what it collected (classes
 * and monthly fees), how many classes it recorded and what it still had to collect.
 */
export function groupDeletionPreview(state, groupId, date) {
  const rows = (state.classLog || []).filter((row) => row.groupId === groupId);
  const fees = (state.students || []).flatMap((student) =>
    normalizeMonthlyPayments(student.monthlyPayments).filter((item) => item.groupId === groupId),
  );
  return {
    collected: roundMoney(sumMoney(rows, (row) => row.amountPaid) + sumMoney(fees, (item) => item.amount)),
    classes: new Set(
      rows.filter((row) => row.classStatus === "Completed").map((row) => `${row.classDate}|${row.startTime}`),
    ).size,
    cancelled: roundMoney(
      sumMoney(pendingDebts(withoutMembers(state, groupId, date), groupId, date), (debt) => debt.amount),
    ),
  };
}

/**
 * Deletes a group for good on `date`. Its students stay, without the group, and what it still had to
 * collect is given up (lostPayments.js), so nothing of it is owed any more. A group with classes,
 * grades or money on record keeps them: it stays stored, archived and marked `deletedAt`, is never
 * listed again and its history keeps counting in the figures (see isGroupDeleted). A group with nothing
 * on record is simply removed.
 */
export function deleteGroup(state, groupId, date) {
  const group = (state.groups || []).find((item) => item.id === groupId);
  if (!group) return state;
  const left = withoutMembers(state, groupId, date);
  const debts = pendingDebts(left, groupId, date);
  // A debt given up is history too: it stays listed among the lost payments.
  if (debts.length || hasHistory(state, groupId)) {
    const givenUp = markLost(
      left,
      debts.map((debt) => debt.item),
      date,
    );
    const archived = setGroupArchived(givenUp, groupId, true, date);
    return {
      ...archived,
      groups: archived.groups.map((item) => (item.id === groupId ? { ...item, deletedAt: date } : item)),
    };
  }
  return {
    ...left,
    groups: left.groups.filter((item) => item.id !== groupId),
    // Nothing of the group is on record: its billing adjustments go with it.
    students: left.students.map((student) => {
      if (!student.billingByGroup?.[groupId]) return student;
      const { [groupId]: _removed, ...rest } = student.billingByGroup;
      const { billingByGroup: _previous, ...fields } = student;
      return Object.keys(rest).length ? { ...fields, billingByGroup: rest } : fields;
    }),
    classSchedules: (state.classSchedules || []).filter((item) => item.groupId !== groupId),
    scheduleExceptions: (state.scheduleExceptions || []).filter(
      (item) => item.groupId !== groupId && item.sourceGroupId !== groupId,
    ),
    scheduleChanges: (state.scheduleChanges || []).filter((item) => item.groupId !== groupId),
  };
}
