import { describe, expect, it } from "vitest";
import { deriveMonthlyCharges, monthlyPaymentsBetween } from "./monthlyBilling.js";
import { calculateOutstanding } from "./calculations.js";
import { deleteGroup, groupDeletionPreview, isGroupDeleted } from "./groupDeletion.js";

const AS_OF = "2026-11-10";

function workspace() {
  return {
    settings: { asOfDate: AS_OF, hourlyRate: 100, defaultClassHours: 2 },
    groups: [
      {
        id: "g-month",
        name: "Prepa",
        status: "Active",
        weeklySchedule: [],
        billing: { mode: "monthly", monthlyFee: 800, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-10" },
      },
      { id: "g-class", name: "Sec", status: "Active", weeklySchedule: [], hourlyRate: 100 },
    ],
    students: [
      {
        id: "s1",
        fullName: "Luna Ortiz",
        status: "Active",
        groupIds: ["g-month", "g-class"],
        monthlyPayments: [{ id: "p1", groupId: "g-month", period: "2026-10", amount: 800, paidAt: "2026-10-05" }],
      },
    ],
    classLog: [
      {
        id: "c1",
        classDate: "2026-11-03",
        studentId: "s1",
        groupId: "g-class",
        classStatus: "Completed",
        attendance: "P",
        hours: 2,
        appliedHourlyRate: 100,
        appliedCharge: 200,
        amountPaid: 0,
      },
    ],
    grades: [],
    classSchedules: [],
    scheduleExceptions: [],
    scheduleChanges: [],
  };
}

describe("deleting a group for good", () => {
  it("keeps what it collected and gives up what it still had to collect", () => {
    const state = workspace();
    expect(groupDeletionPreview(state, "g-month", AS_OF)).toEqual({ collected: 800, classes: 0, cancelled: 800 });

    const next = deleteGroup(state, "g-month", AS_OF);
    const group = next.groups.find((item) => item.id === "g-month");
    expect(isGroupDeleted(group)).toBe(true);
    expect(group).toMatchObject({ status: "Inactive", archivedAt: AS_OF, deletedAt: AS_OF });
    expect(next.students[0].groupIds).toEqual(["g-class"]);
    // October's receipt still counts as income; November's fee is no longer owed.
    expect(monthlyPaymentsBetween(next, "2026-10-01", AS_OF).map((item) => item.amount)).toEqual([800]);
    const november = deriveMonthlyCharges(next, AS_OF).find((charge) => charge.period === "2026-11");
    expect(november?.status ?? "lost").toBe("lost");
    // Its other group is untouched.
    expect(calculateOutstanding(next, next.classLog[0], AS_OF)).toBe(200);
  });

  it("gives up the unpaid classes of a per-class group and keeps them in the history", () => {
    const next = deleteGroup(workspace(), "g-class", AS_OF);
    expect(next.classLog).toHaveLength(1);
    expect(calculateOutstanding(next, next.classLog[0], AS_OF)).toBe(0);
    expect(next.students[0].lostPayments).toEqual([{ kind: "class", classId: "c1", lostAt: AS_OF }]);
  });

  it("simply removes a group with nothing on record", () => {
    const state = { ...workspace(), classLog: [] };
    state.students = [{ ...state.students[0], monthlyPayments: undefined }];
    const next = deleteGroup(state, "g-class", AS_OF);
    expect(next.groups.map((item) => item.id)).toEqual(["g-month"]);
    expect(next.students[0].groupIds).toEqual(["g-month"]);
  });
});
