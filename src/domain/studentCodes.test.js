import { describe, expect, it } from "vitest";
import { nextStudentCode, nextStudentCodes } from "./studentCodes.js";
import { validateStudent } from "./validation.js";

describe("student codes", () => {
  it("skips IDs already in use, however they were typed", () => {
    const students = [{ code: "HIBI-001" }, { code: " hibi-002 " }, { code: "CUSTOM" }, { code: "" }];
    expect(nextStudentCodes(students, 2)).toEqual(["HIBI-003", "HIBI-004"]);
    expect(nextStudentCode([])).toBe("HIBI-001");
  });

  it("never produces an ID that validation would reject as taken", () => {
    const students = [{ id: "a", code: "hibi-001", fullName: "A", status: "Active" }];
    const code = nextStudentCode(students);
    expect(validateStudent({ id: "b", code, fullName: "B", status: "Active" }, { students, groups: [] }).valid).toBe(
      true,
    );
  });
});
