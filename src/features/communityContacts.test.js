import { describe, expect, it } from "vitest";
import {
  CONTACT_VIEWS,
  contactForStudent,
  extractLegacyGuardianPhone,
  groupContactRows,
  groupMemberContact,
  uniqueAvailableContacts,
} from "./communityContacts";

describe("community contact directory", () => {
  it("keeps student email as the primary explicit contact view", () => {
    const student = { studentEmail: "student@example.com", guardianPhone: "272 100 2000", phone: "272 300 4000" };
    expect(contactForStudent(student, CONTACT_VIEWS.STUDENT_EMAIL)).toEqual({
      value: "student@example.com",
      inferred: false,
    });
    // In a group, the tutor's phone comes first, then the student's, then the email.
    expect(groupMemberContact(student)).toEqual({ value: "272 100 2000", view: CONTACT_VIEWS.GUARDIAN_PHONE });
    expect(groupMemberContact({ studentEmail: "student@example.com" })).toEqual({
      value: "student@example.com",
      view: CONTACT_VIEWS.STUDENT_EMAIL,
    });
    expect(groupMemberContact({})).toBeNull();
  });

  it("uses a legacy guardian contact as a non-destructive phone fallback", () => {
    expect(extractLegacyGuardianPhone("María López | 272 123 4567 | maria@example.com")).toBe("272 123 4567");
    expect(contactForStudent({ guardianContact: "María López | 272 123 4567" }, CONTACT_VIEWS.GUARDIAN_PHONE)).toEqual({
      value: "272 123 4567",
      inferred: true,
    });
  });

  it("filters missing contacts and deduplicates bulk actions without changing records", () => {
    const students = [
      { id: "a", studentEmail: "shared@example.com" },
      { id: "b", studentEmail: "" },
      { id: "c", studentEmail: "shared@example.com" },
    ];
    const allRows = groupContactRows(students, CONTACT_VIEWS.STUDENT_EMAIL);
    expect(
      groupContactRows(students, CONTACT_VIEWS.STUDENT_EMAIL, { missingOnly: true }).map((row) => row.student.id),
    ).toEqual(["b"]);
    expect(uniqueAvailableContacts(allRows)).toEqual(["shared@example.com"]);
    expect(students[1].studentEmail).toBe("");
  });
});
