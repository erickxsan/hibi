export function studentMatchesFilters(student, filters = {}) {
  const studentGroupIds = Array.isArray(student?.groupIds)
    ? student.groupIds
    : student?.groupId ? [student.groupId] : [];
  const selectedGroups = Array.isArray(filters.groupIds) ? filters.groupIds : [];
  if (selectedGroups.length) {
    const matches = filters.groupMatch === "all"
      ? selectedGroups.every((id) => studentGroupIds.includes(id))
      : selectedGroups.some((id) => studentGroupIds.includes(id));
    if (!matches) return false;
  }

  const enrollment = Array.isArray(filters.enrollment) ? filters.enrollment : [];
  if (enrollment.length) {
    const hasGroups = studentGroupIds.length > 0;
    const hasIndividual = Boolean(student?.isIndividual) || !hasGroups;
    const mode = hasGroups && hasIndividual ? "both" : hasGroups ? "group" : "individual";
    if (!enrollment.includes(mode)) return false;
  }
  return true;
}
