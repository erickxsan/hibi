/**
 * Whether a class record is charged, from its attendance. Only a student who came (present or late)
 * pays for a completed class: an absence costs nothing, and an unmarked student owes nothing until
 * attendance is taken. Scheduled classes keep their price, so a payment in advance still matches it;
 * cancelled classes are free by their status.
 *
 * @returns {"billable" | "absent" | "unmarked"}
 */
export function attendanceBilling(row) {
  if (row?.classStatus !== "Completed") return "billable";
  if (row.attendance === "P" || row.attendance === "L") return "billable";
  if (row.attendance === "A" || row.attendance === "E") return "absent";
  return "unmarked";
}

export function isBillableAttendance(row) {
  return attendanceBilling(row) === "billable";
}
