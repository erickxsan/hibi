import { describe, expect, it } from "vitest";
import { buildAssessmentOptions, buildAttendanceTracking, buildGradeTracking, buildPaymentTracking, trackingRange } from "./trackingModel";

const state = {
  settings: { asOfDate: "2026-07-25" },
  groups: [{ id: "g1", name: "Math" }, { id: "g2", name: "Science" }],
  students: [
    { id: "s1", fullName: "Ana", code: "S-1", status: "Active", groupIds: ["g1"] },
    { id: "s2", fullName: "Ben", code: "S-2", status: "Active", groupIds: ["g1"] },
    { id: "s3", fullName: "Cam", code: "S-3", status: "Active", groupIds: ["g2"] },
  ],
};
const range = trackingRange("2026-07-25", "month");
const grades = [
  { id: "a", date: "2026-07-20", studentId: "s1", studentName: "Ana", assessment: "Fractions", score: 9, maxScore: 10 },
  { id: "b", date: "2026-07-20", studentId: "s2", studentName: "Ben", assessment: "Fractions", score: 5, maxScore: 10 },
];
const classes = [
  { id: "c1", classDate: "2026-07-20", startTime: "10:00", groupId: "g1", studentId: "s1", studentName: "Ana", classStatus: "Completed", attendance: "P", charge: 100, recognizedPaid: 100, outstanding: 0, paymentDate: "2026-07-20" },
  { id: "c2", classDate: "2026-07-20", startTime: "10:00", groupId: "g1", studentId: "s2", studentName: "Ben", classStatus: "Completed", attendance: "A", charge: 100, recognizedPaid: 0, outstanding: 100, paymentDate: "" },
  { id: "c3", classDate: "2026-07-24", startTime: "12:00", groupId: "g2", studentId: "s3", studentName: "Cam", classStatus: "Completed", attendance: "P", charge: 200, recognizedPaid: 50, outstanding: 150, paymentDate: "2026-07-24" },
];

describe("tracking model", () => {
  it("builds a group assessment summary without inventing missing scores", () => {
    const assessment = buildAssessmentOptions(state, grades, "g1", range)[0];
    const result = buildGradeTracking(state, grades, { mode: "group", groupId: "g1", assessmentKey: assessment.key, range });
    expect(result.average).toBeCloseTo(.7);
    expect(result.best).toBe(.9);
    expect(result.worst).toBe(.5);
    expect(result.tableRows).toHaveLength(2);
  });

  it("summarizes attendance by student and week", () => {
    const result = buildAttendanceTracking(state, classes, { mode: "group", groupId: "g1", range });
    expect(result.average).toBe(.5);
    expect(result.present).toBe(1);
    expect(result.absent).toBe(1);
    expect(result.sessions).toBe(1);
    expect(result.series).toHaveLength(1);
  });

  it("keeps class payments granular and calculates collected versus pending", () => {
    const sessionKey = "2026-07-20|g:g1|10:00";
    const result = buildPaymentTracking(state, classes, { mode: "class", groupId: "g1", sessionKey, range });
    expect(result.generated).toBe(200);
    expect(result.collected).toBe(100);
    expect(result.pending).toBe(100);
    expect(result.paidStudents).toBe(1);
    expect(result.pendingStudents).toBe(1);
    expect(result.paidClasses).toBe(1);
    expect(result.unpaidClasses).toBe(1);
    expect(result.series).toEqual([{ label: "2026-07-20", value: 100 }]);
  });

  it("builds a global payment overview with cumulative collections and forecast metadata", () => {
    const result = buildPaymentTracking(state, classes, {
      mode: "overview",
      range,
      projectionTotal: 900,
    });
    expect(result.generated).toBe(400);
    expect(result.collected).toBe(150);
    expect(result.pending).toBe(250);
    expect(result.paidClasses).toBe(1);
    expect(result.unpaidClasses).toBe(2);
    expect(result.overdue).toBe(250);
    expect(result.overdueClasses).toBe(2);
    expect(result.projection).toBe(900);
    expect(result.projectionGap).toBe(750);
    expect(result.cumulativeSeries).toEqual([
      { label: "2026-07-20", value: 100 },
      { label: "2026-07-24", value: 150 },
    ]);
    expect(result.tableRows).toHaveLength(3);
  });
});
