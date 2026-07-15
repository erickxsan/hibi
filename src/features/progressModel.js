export const INDIVIDUAL_GROUP_ID = "__individual__";

export function classSessionKey(row = {}) {
  return [row.classDate || "", row.groupId || INDIVIDUAL_GROUP_ID, row.startTime || ""].join("|");
}

export function buildClassSessions(classRows = [], upcomingRows = []) {
  const sessions = new Map();
  for (const row of classRows) {
    if (!row?.classDate) continue;
    const key = classSessionKey(row);
    const current = sessions.get(key);
    sessions.set(key, {
      key,
      classDate: row.classDate,
      groupId: row.groupId || INDIVIDUAL_GROUP_ID,
      groupName: row.groupName || "",
      startTime: row.startTime || "",
      durationHours: row.hours ?? current?.durationHours ?? null,
      classTitle: row.classTitle || current?.classTitle || "",
      status: row.classStatus || current?.status || "Completed",
      recorded: true,
    });
  }
  for (const row of upcomingRows) {
    if (!row?.classDate) continue;
    const key = classSessionKey(row);
    if (sessions.has(key)) continue;
    sessions.set(key, {
      key,
      classDate: row.classDate,
      groupId: row.groupId || INDIVIDUAL_GROUP_ID,
      groupName: row.groupName || "",
      startTime: row.startTime || "",
      durationHours: row.durationHours ?? null,
      classTitle: row.classTitle || "",
      status: row.status || "Scheduled",
      recorded: Boolean(row.recorded),
      scheduleSlotId: row.scheduleSlotId || "",
      occurrenceDate: row.occurrenceDate || row.classDate,
    });
  }
  return [...sessions.values()].sort((left, right) => (
    right.classDate.localeCompare(left.classDate)
      || right.startTime.localeCompare(left.startTime)
      || left.groupName.localeCompare(right.groupName)
  ));
}

export function assessmentKey(row = {}) {
  return [row.date || "", row.assessment || "", row.maximum ?? row.maxScore ?? "", row.category || ""].join("|");
}

export function buildAssessments(gradeRows = []) {
  const assessments = new Map();
  for (const row of gradeRows) {
    if (!row?.date || !row?.assessment) continue;
    const key = assessmentKey(row);
    if (!assessments.has(key)) {
      assessments.set(key, {
        key,
        date: row.date,
        assessment: row.assessment,
        category: row.category || "Other",
        maximum: row.maximum ?? row.maxScore ?? null,
      });
    }
  }
  return [...assessments.values()].sort((left, right) => (
    right.date.localeCompare(left.date) || left.assessment.localeCompare(right.assessment)
  ));
}

export function attendanceRate(codes = []) {
  const recorded = codes.filter((code) => ["P", "L", "A"].includes(code));
  if (!recorded.length) return null;
  return recorded.filter((code) => code === "P" || code === "L").length / recorded.length;
}

export function monthKey(date = "") {
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : "";
}
