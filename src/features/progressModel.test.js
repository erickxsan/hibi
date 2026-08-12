import { describe, expect, it } from "vitest";
import {
  assessmentKey,
  attendanceRate,
  buildAssessments,
  buildClassSessions,
  classSessionKey,
  INDIVIDUAL_GROUP_ID,
} from "./progressModel";

describe("progress workspace model", () => {
  it("groups per-student class rows into one session and preserves individual classes", () => {
    const rows = [
      {
        id: "a",
        classDate: "2026-07-13",
        groupId: "group_1",
        groupName: "Secondary",
        startTime: "16:00",
        hours: 2,
        classStatus: "Completed",
      },
      {
        id: "b",
        classDate: "2026-07-13",
        groupId: "group_1",
        groupName: "Secondary",
        startTime: "16:00",
        hours: 2,
        classStatus: "Completed",
      },
      { id: "c", classDate: "2026-07-12", groupId: "", startTime: "", hours: 1, classStatus: "Completed" },
    ];
    const sessions = buildClassSessions(rows);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ groupId: "group_1", recorded: true });
    expect(sessions[1].groupId).toBe(INDIVIDUAL_GROUP_ID);
    expect(classSessionKey(rows[2])).toBe(`2026-07-12|${INDIVIDUAL_GROUP_ID}|`);
  });

  it("deduplicates assessment columns and distinguishes different maxima", () => {
    const rows = [
      { date: "2026-07-10", assessment: "Quiz 1", category: "Quiz", maximum: 20, studentId: "a" },
      { date: "2026-07-10", assessment: "Quiz 1", category: "Quiz", maximum: 20, studentId: "b" },
      { date: "2026-07-10", assessment: "Quiz 1", category: "Quiz", maximum: 10, studentId: "c" },
    ];
    expect(buildAssessments(rows)).toHaveLength(2);
    expect(assessmentKey(rows[0])).not.toBe(assessmentKey(rows[2]));
  });

  it("counts present and late as attended while excluding excused records", () => {
    expect(attendanceRate(["P", "L", "A", "E"])).toBeCloseTo(2 / 3);
    expect(attendanceRate(["E"])).toBeNull();
  });
});
