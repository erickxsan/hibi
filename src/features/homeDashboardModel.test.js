import { describe, expect, it } from "vitest";
import { buildHomeDashboard } from "./homeDashboardModel";

const state = {
  settings: { asOfDate: "2026-07-16" },
  groups: [{ id: "g1", name: "Reading" }],
  students: [{ id: "s1", fullName: "Maya", status: "Active", groupIds: ["g1"] }],
  grades: [
    { id: "grade-current", date: "2026-07-14", studentId: "s1", score: 9, maxScore: 10 },
    { id: "grade-previous", date: "2026-07-07", studentId: "s1", score: 8, maxScore: 10 },
  ],
  classLog: [
    { id: "current", classDate: "2026-07-14", paymentDate: "2026-07-14", amountPaid: 100 },
    { id: "previous", classDate: "2026-07-07", paymentDate: "2026-07-07", amountPaid: 80 },
  ],
};

const derived = {
  dashboard: { recentProjection: 500, outstandingThroughToday: 20 },
  groups: [{ id: "g1", name: "Reading", activeStudents: 1, attendance: 1 }],
  students: [{ id: "s1", fullName: "Maya", status: "Active", attendance: 1, gradeAverage: 0.9, alerts: [] }],
  classLog: [
    {
      id: "current",
      classDate: "2026-07-14",
      paymentDate: "2026-07-14",
      amountPaid: 100,
      classStatus: "Completed",
      attendance: "P",
      charge: 100,
      outstanding: 0,
      groupId: "g1",
      groupName: "Reading",
      startTime: "10:30",
    },
    {
      id: "previous",
      classDate: "2026-07-07",
      paymentDate: "2026-07-07",
      amountPaid: 80,
      classStatus: "Completed",
      attendance: "P",
      charge: 80,
      outstanding: 20,
      groupId: "g1",
      groupName: "Reading",
      startTime: "10:30",
    },
  ],
  upcomingClasses: [],
};

describe("buildHomeDashboard", () => {
  it("builds the selected period from real class, grade, payment, student, and group records", () => {
    const dashboard = buildHomeDashboard(state, derived, "weekly");
    expect(dashboard.generated).toBe(100);
    expect(dashboard.generatedDelta).toBe(0.25);
    expect(dashboard.completedClassCount).toBe(1);
    expect(dashboard.revenueSeries.find((item) => item.label === "2026-07-14").generated).toBe(100);
    expect(dashboard.revenueGroups).toEqual([
      expect.objectContaining({ id: "group:g1", name: "Reading", value: 100, classCount: 1 }),
    ]);
    expect(dashboard.grade).toBe(0.9);
    expect(dashboard.gradeDelta).toBeCloseTo(0.1);
    expect(dashboard.attendance).toBe(1);
    expect(dashboard.attendanceSessions).toEqual([
      expect.objectContaining({
        key: "2026-07-14|g:g1|10:30",
        scopeId: "group:g1",
        title: "Reading",
        attended: 1,
        expected: 1,
        attendance: 1,
      }),
    ]);
    expect(dashboard.previousAttendanceSessions).toHaveLength(1);
    expect(dashboard.sessions).toHaveLength(0);
    expect(dashboard.topStudents[0].fullName).toBe("Maya");
    expect(dashboard.topGroups[0].name).toBe("Reading");
    expect(dashboard.outstandingRecords).toBe(1);
  });

  it("falls back to weekly for an unknown period", () => {
    expect(buildHomeDashboard(state, derived, "unknown").period).toBe("weekly");
  });

  it("projects remaining scheduled classes from their real roster, duration, and rate", () => {
    const dashboard = buildHomeDashboard(
      {
        ...state,
        settings: { ...state.settings, hourlyRate: 50, defaultClassHours: 1 },
        groups: [
          {
            ...state.groups[0],
            hourlyRate: 200,
            weeklySchedule: [{ id: "friday", dayOfWeek: 5, startTime: "10:30", durationHours: 1 }],
          },
        ],
      },
      derived,
      "weekly",
    );

    expect(dashboard.revenueProjection).toBe(300);
    expect(dashboard.projectedClassCount).toBe(1);
  });

  it("gives each class card the stable key used by the class editor", () => {
    const dashboard = buildHomeDashboard(
      state,
      {
        ...derived,
        upcomingClasses: [
          {
            id: "schedule-one:2026-07-16",
            classDate: "2026-07-16",
            startTime: "10:00",
            groupId: "",
            studentId: "s1",
            studentName: "Maya",
            format: "individual",
          },
        ],
      },
      "today",
    );

    expect(dashboard.sessions[0]).toMatchObject({
      workspaceKey: "2026-07-16|s:s1|10:00",
      title: "Maya",
      expected: 1,
    });
  });

  it("groups student attendance rows into class sessions for the interactive attendance panel", () => {
    const dashboard = buildHomeDashboard(
      {
        ...state,
        students: [...state.students, { id: "s2", fullName: "Leo", status: "Active", groupIds: ["g1"] }],
      },
      {
        ...derived,
        classLog: [
          { ...derived.classLog[0], id: "maya", studentId: "s1", attendance: "P" },
          { ...derived.classLog[0], id: "leo", studentId: "s2", attendance: "A" },
          {
            ...derived.classLog[0],
            id: "individual",
            studentId: "s2",
            groupId: "",
            groupName: "",
            classDate: "2026-07-15",
            startTime: "12:00",
            attendance: "L",
          },
        ],
      },
      "weekly",
    );

    expect(dashboard.attendanceSessions).toHaveLength(2);
    expect(dashboard.attendanceSessions[0]).toMatchObject({
      scopeId: "group:g1",
      attended: 1,
      expected: 2,
      attendance: 0.5,
    });
    expect(dashboard.attendanceSessions[1]).toMatchObject({
      scopeId: "individual",
      title: "Leo",
      attended: 1,
      expected: 1,
      attendance: 1,
    });
  });
});
