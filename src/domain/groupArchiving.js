import { todayDateOnly } from "./dates.js";
import { gradeGroupId } from "./semanticIdentity.js";

export function isGroupArchived(group) {
  return group?.status === "Inactive";
}

export function setGroupArchived(state, groupId, archived, date = todayDateOnly()) {
  return {
    ...state,
    groups: state.groups.map((group) =>
      group.id !== groupId || isGroupArchived(group) === archived
        ? group
        : {
            ...group,
            status: archived ? "Inactive" : "Active",
            archivedAt: archived ? date : group.archivedAt || "",
            scheduleResumeDate: archived ? group.scheduleResumeDate || "" : date,
          },
    ),
  };
}

// Report scope is a derived view. Saved records and original memberships stay intact.
export function statisticsStateForGroups(state, includeArchivedGroups = false) {
  if (includeArchivedGroups) return state;
  const archivedIds = new Set((state.groups || []).filter(isGroupArchived).map((group) => group.id));
  if (!archivedIds.size) return state;
  const groups = state.groups.filter((group) => !archivedIds.has(group.id));
  const classLog = (state.classLog || []).filter((row) => !archivedIds.has(row.groupId));
  const grades = (state.grades || []).filter((row) => !archivedIds.has(gradeGroupId(row)));
  const studentsWithRecords = new Set([...classLog, ...grades].map((row) => row.studentId));
  const students = (state.students || [])
    .filter((student) => {
      const ids = student.groupIds || (student.groupId ? [student.groupId] : []);
      return (
        !ids.length ||
        student.isIndividual ||
        ids.some((id) => !archivedIds.has(id)) ||
        studentsWithRecords.has(student.id)
      );
    })
    .map((student) => ({
      ...student,
      groupIds: (student.groupIds || (student.groupId ? [student.groupId] : [])).filter((id) => !archivedIds.has(id)),
      groupId: archivedIds.has(student.groupId) ? "" : student.groupId,
    }));
  const inScope = (item) => !archivedIds.has(item.groupId) && !archivedIds.has(item.sourceGroupId);
  return {
    ...state,
    groups,
    students,
    grades,
    classLog,
    classLogs: classLog,
    classSchedules: (state.classSchedules || []).filter(inScope),
    scheduleExceptions: (state.scheduleExceptions || []).filter(inScope),
    scheduleChanges: (state.scheduleChanges || []).filter(inScope),
  };
}
