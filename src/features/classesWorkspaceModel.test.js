import { describe, expect, it } from "vitest";
import { buildClassWorkspaceSessions, buildClassWorkspaceSessionsForRange, filterClassHistory, paymentRecordState, rosterForClassSession, selectPrimaryClassSession } from "./classesWorkspaceModel";

const state = {
  settings: { defaultClassHours: 2 },
  groups: [{ id: "g1", name: "Math", weeklySchedule: [] }],
  students: [
    { id: "s1", fullName: "Ana", groupIds: ["g1"], status: "Active" },
    { id: "s2", fullName: "Ben", groupIds: ["g1"], status: "Inactive" },
  ],
  classSchedules: [{ id: "cs1", recurrence: "weekly", format: "group", groupId: "g1", studentId: "", startDate: "2026-07-01", startTime: "10:00", durationHours: 2, intervalWeeks: 1, daysOfWeek: [3] }],
  classLog: [],
  scheduleExceptions: [],
  scheduleChanges: [],
};

describe("classes workspace model", () => {
  it("creates pending and future sessions and picks the current due class", () => {
    const sessions = buildClassWorkspaceSessions(state, "2026-07-15");
    expect(sessions.find((item) => item.classDate === "2026-07-08")?.statusLabel).toBe("Pending");
    expect(selectPrimaryClassSession(sessions, "2026-07-15", "11:00")?.classDate).toBe("2026-07-15");
  });

  it("loads only active group students", () => {
    const session = buildClassWorkspaceSessions(state, "2026-07-15").find((item) => item.classDate === "2026-07-15");
    expect(rosterForClassSession(state, session).map((item) => item.id)).toEqual(["s1"]);
  });

  it("preserves explicit payment states and filters history", () => {
    expect(paymentRecordState({ paymentState: "Unpaid", amountPaid: 0 }, 100)).toBe("Unpaid");
    const rows = [{ title: "Math", statusLabel: "Registered", classDate: "2026-07-10", startTime: "10:00", groupId: "g1" }];
    expect(filterClassHistory(rows, { search: "math", status: "Registered" })).toHaveLength(1);
  });

  it("builds an exact calendar range without dropping scheduled classes", () => {
    const sessions = buildClassWorkspaceSessionsForRange(state, "2026-07-01", "2026-07-31", "2026-07-15");
    expect(sessions.map((session) => session.classDate)).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
  });
});
