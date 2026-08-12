import { describe, expect, it } from "vitest";
import {
  classRecordIdentity,
  classSessionIdentity,
  gradeIdentity,
  normalizeClassSessionIdentity,
  workspaceEntityIdentity,
} from "./semanticIdentity.js";

describe("semantic entity identity", () => {
  it("creates one canonical session key for group and individual classes", () => {
    expect(classSessionIdentity({ classDate: "2026-08-12", groupId: "g1", startTime: "10:00" })).toBe(
      "2026-08-12|g:g1|10:00",
    );
    expect(classSessionIdentity({ classDate: "2026-08-12", studentId: "s1", startTime: "10:00" })).toBe(
      "2026-08-12|s:s1|10:00",
    );
  });

  it("normalizes legacy group and individual session keys", () => {
    expect(normalizeClassSessionIdentity("2026-08-12|g1|10:00", "s1")).toBe("2026-08-12|g:g1|10:00");
    expect(normalizeClassSessionIdentity("2026-08-12|__individual__|10:00", "s1")).toBe("2026-08-12|s:s1|10:00");
  });

  it("identifies class rows by student, date, and typed time", () => {
    const left = { id: "class-a", studentId: "s1", classDate: "2026-08-12", startTime: "10:00" };
    const right = { ...left, id: "class-b", groupId: "g1" };

    expect(classRecordIdentity(left)).toBe(classRecordIdentity(right));
    expect(classRecordIdentity({ ...left, startTime: "" })).toBeNull();
  });

  it("identifies one grade per student and normalized class session", () => {
    const canonical = { studentId: "s1", classSessionKey: "2026-08-12|g:g1|10:00" };
    const legacy = { studentId: "s1", classSessionKey: "2026-08-12|g1|10:00" };

    expect(gradeIdentity(canonical)).toBe(gradeIdentity(legacy));
    expect(workspaceEntityIdentity("grades", canonical)).toBe(`grades:${gradeIdentity(canonical)}`);
  });
});
