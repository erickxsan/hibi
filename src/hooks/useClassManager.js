import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClassLogRow,
  createExportFilename,
  createGrade,
  createGroup,
  createScheduleChange,
  createScheduleException,
  createStarterState,
  createStudent,
  deriveAll,
  exportState,
  importState,
  resolveHourlyRate,
  REAL_ROSTER_BACKUP_KEY,
  REAL_ROSTER_MIGRATION_KEY,
  safeLoadStateWithMigrations,
  saveState,
  serializeState,
  STORAGE_KEY,
  validateClassLogRow,
  validateGrade,
  validateGroup,
  validateStudent,
} from "../domain";

const UI_STORAGE_KEY = "minimal-class-manager:ui:v1";

function loadUiPreferences(storageKey = UI_STORAGE_KEY) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    return {};
  }
}

function downloadText(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function messageForError(error) {
  const detail = error?.validation?.errors?.[0]?.message;
  return detail || error?.message || "That change could not be saved.";
}

function canonicalGroup(draft) {
  return {
    id: draft.id,
    name: draft.name,
    grade: draft.grade,
    subject: draft.subject,
    schedule: draft.scheduleRoom ?? draft.schedule ?? "",
    hourlyRate: draft.hourlyRate === "" || draft.hourlyRate == null ? null : Number(draft.hourlyRate),
    weeklySchedule: Array.isArray(draft.weeklySchedule) ? draft.weeklySchedule.map((slot) => ({
      id: slot.id,
      dayOfWeek: Number(slot.dayOfWeek),
      startTime: slot.startTime,
      durationHours: Number(slot.durationHours),
    })) : [],
    plannedSessionsPerMonth: Number(draft.plannedSessionsPerMonth ?? 0),
    assistantContact: draft.assistantContact ?? "",
    notes: draft.notes ?? "",
  };
}

function canonicalStudent(draft) {
  return {
    id: draft.id,
    code: draft.studentCode ?? draft.code ?? "",
    fullName: draft.fullName ?? "",
    avatarId: draft.avatarId ?? "",
    groupIds: Array.isArray(draft.groupIds) ? [...new Set(draft.groupIds.filter(Boolean))] : draft.groupId ? [draft.groupId] : [],
    isIndividual: Boolean(draft.isIndividual),
    customHourlyRate: draft.customHourlyRate === "" || draft.customHourlyRate == null ? null : Number(draft.customHourlyRate),
    phone: draft.studentPhone ?? draft.phone ?? "",
    guardianContact: draft.guardianContact ?? "",
    notes: draft.importantNotes ?? draft.notes ?? "",
    status: draft.status ?? "Active",
  };
}

function canonicalGrade(draft) {
  return {
    id: draft.id,
    date: draft.date,
    studentId: draft.studentId,
    assessment: draft.assessment,
    category: draft.category ?? "Quiz",
    score: draft.score === "" || draft.score == null ? null : Number(draft.score),
    maxScore: Number(draft.maximum ?? draft.maxScore),
    workStatus: draft.workStatus ?? "On time",
    feedback: draft.feedback ?? "",
  };
}

function canonicalClassLog(draft, state) {
  const hours = draft.hours === "" || draft.hours == null ? null : Number(draft.hours);
  const appliedHourlyRate = Number.isFinite(draft.appliedHourlyRate)
    ? draft.appliedHourlyRate
    : resolveHourlyRate(state, draft.studentId, draft.groupId);
  const effectiveHours = hours === null ? state.settings.defaultClassHours : hours;
  const appliedCharge = Number.isFinite(draft.appliedCharge)
    ? draft.appliedCharge
    : draft.classStatus === "Cancelled" ? 0 : effectiveHours * appliedHourlyRate;
  return {
    id: draft.id,
    classDate: draft.classDate,
    studentId: draft.studentId,
    groupId: draft.groupId ?? "",
    startTime: draft.startTime ?? "",
    classTitle: draft.classTitle ?? "",
    scheduleSlotId: draft.scheduleSlotId ?? "",
    scheduleOccurrenceDate: draft.scheduleOccurrenceDate ?? "",
    classStatus: draft.classStatus ?? "Completed",
    attendance: draft.attendance || null,
    hours,
    appliedHourlyRate,
    appliedCharge,
    amountPaid: draft.amountPaid === "" || draft.amountPaid == null ? 0 : Number(draft.amountPaid),
    paymentDate: draft.paymentDate || null,
    paymentMethod: draft.paymentMethod ?? draft.method ?? "",
    paymentReference: draft.paymentReference ?? draft.reference ?? "",
    notes: draft.notes ?? "",
  };
}

function canonicalScheduleException(draft) {
  return {
    id: draft.id,
    groupId: draft.groupId ?? "",
    scheduleSlotId: draft.scheduleSlotId ?? "",
    occurrenceDate: draft.occurrenceDate ?? draft.classDate ?? "",
    classDate: draft.classDate ?? "",
    startTime: draft.startTime ?? "",
    durationHours: Number(draft.durationHours),
    status: draft.status ?? "Scheduled",
    kind: draft.kind === "added" ? "added" : "override",
  };
}

function canonicalScheduleChange(draft) {
  return {
    id: draft.id,
    groupId: draft.groupId ?? "",
    scheduleSlotId: draft.scheduleSlotId ?? "",
    effectiveFrom: draft.effectiveFrom ?? "",
    dayOfWeek: Number(draft.dayOfWeek),
    startTime: draft.startTime ?? "",
    durationHours: Number(draft.durationHours),
  };
}

function applyGeneratedId(factory, canonicalDraft) {
  if (canonicalDraft.id) return canonicalDraft;
  const { id: _unused, ...fields } = canonicalDraft;
  return factory(fields);
}

export function useClassManager({ persistence } = {}) {
  const uiStorageKey = persistence?.uiStorageKey || UI_STORAGE_KEY;
  const initial = useMemo(() => {
    if (!persistence?.initialState) return safeLoadStateWithMigrations();
    try {
      return { state: importState(serializeState(persistence.initialState)), source: persistence.mode || "cloud", error: null };
    } catch (error) {
      return { state: createStarterState(), source: "starter", error };
    }
  }, []);
  const [canonicalState, setCanonicalState] = useState(initial.state);
  const [uiPreferences, setUiPreferences] = useState(() => loadUiPreferences(uiStorageKey));
  const [toasts, setToasts] = useState(() => initial.error ? [{ id: "storage-warning", tone: "error", message: "A browser-storage issue was detected. Your saved bytes were not overwritten automatically." }] : []);
  const timers = useRef(new Map());
  const stateRef = useRef(initial.state);
  const mountedRef = useRef(true);
  const persistenceRef = useRef(persistence);
  const persistedSnapshot = useRef(serializeState(initial.state));
  const operationQueue = useRef(Promise.resolve());
  const pendingWrites = useRef(0);
  const [syncStatus, setSyncStatus] = useState(persistence?.mode === "cloud" ? "saved" : "local");
  persistenceRef.current = persistence;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const notify = useCallback((message, tone = "success") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
    const timer = setTimeout(() => dismissToast(id), 3600);
    timers.current.set(id, timer);
  }, [dismissToast]);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(uiStorageKey, JSON.stringify(uiPreferences));
    } catch {
      // The core state still works when UI-only preferences cannot persist.
    }
  }, [uiPreferences, uiStorageKey]);

  const commit = useCallback((recipe, successMessage) => {
    pendingWrites.current += 1;
    if (persistenceRef.current?.mode === "cloud") setSyncStatus("saving");

    const operation = async () => {
      let synchronized = false;
      try {
        if (!mountedRef.current) return false;
        const next = importState(serializeState(recipe(stateRef.current)));
        const adapter = persistenceRef.current;
        const result = adapter?.save ? await adapter.save(next) : saveState(next);
        if (!mountedRef.current) return false;
        const saved = importState(serializeState(result?.state ?? result ?? next));
        stateRef.current = saved;
        persistedSnapshot.current = serializeState(saved);
        setCanonicalState(saved);
        if (successMessage) notify(successMessage);
        synchronized = true;
        return true;
      } catch (error) {
        if (!mountedRef.current) return false;
        if (error?.latestState) {
          try {
            const latest = importState(serializeState(error.latestState));
            stateRef.current = latest;
            persistedSnapshot.current = serializeState(latest);
            setCanonicalState(latest);
            notify("A newer change from another device was loaded. Please retry your edit.", "error");
            synchronized = true;
            return false;
          } catch {
            // Fall through to the original persistence error.
          }
        }
        notify(messageForError(error), "error");
        return false;
      } finally {
        pendingWrites.current = Math.max(0, pendingWrites.current - 1);
        if (mountedRef.current && persistenceRef.current?.mode === "cloud" && pendingWrites.current === 0) {
          setSyncStatus(synchronized ? "saved" : "error");
        }
      }
    };

    const queued = operationQueue.current.then(operation, operation);
    operationQueue.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [notify]);

  useEffect(() => {
    if (persistenceRef.current?.mode === "cloud") return undefined;
    const handleStorage = (event) => {
      if (event.key !== STORAGE_KEY) return;
      try {
        const next = event.newValue === null ? createStarterState() : importState(event.newValue);
        const snapshot = serializeState(next);
        if (snapshot === persistedSnapshot.current) return;
        stateRef.current = next;
        persistedSnapshot.current = snapshot;
        setCanonicalState(next);
        notify("Records updated from another tab");
      } catch (error) {
        notify(`Another tab saved invalid data: ${messageForError(error)}`, "error");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [notify]);

  useEffect(() => {
    const subscribe = persistenceRef.current?.subscribe;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((incoming) => {
      if (!mountedRef.current) return;
      try {
        const next = importState(serializeState(incoming?.state ?? incoming));
        const snapshot = serializeState(next);
        if (snapshot === persistedSnapshot.current) return;
        stateRef.current = next;
        persistedSnapshot.current = snapshot;
        setCanonicalState(next);
        notify("Records updated from another device");
      } catch (error) {
        notify(`Cloud synchronization returned invalid data: ${messageForError(error)}`, "error");
      }
    });
  }, [notify]);

  const rawDerived = useMemo(
    () => deriveAll(canonicalState, canonicalState.settings.asOfDate),
    [canonicalState],
  );

  const groups = useMemo(() => canonicalState.groups.map((group) => ({ ...group, scheduleRoom: group.schedule })), [canonicalState.groups]);
  const students = useMemo(() => canonicalState.students.map((student) => ({ ...student, studentCode: student.code, studentPhone: student.phone, importantNotes: student.notes })), [canonicalState.students]);
  const gradeRows = useMemo(() => rawDerived.grades.map((row) => ({ ...row, maximum: row.maxScore })), [rawDerived.grades]);
  const classLogRows = rawDerived.classLog;
  const studentSummaries = useMemo(() => rawDerived.students.map((student) => ({
    ...student,
    code: student.code,
    studentCode: student.code,
    studentPhone: student.phone,
    importantNotes: student.notes,
    attendanceRate: student.attendance,
    missingCount: student.missingAssignments,
  })), [rawDerived.students]);
  const groupSummaries = useMemo(() => rawDerived.groups.map((group) => ({ ...group, activeStudentCount: group.activeStudents, scheduleRoom: group.schedule })), [rawDerived.groups]);
  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  const selectedStudentId = uiPreferences.selectedStudentId
    && studentSummaries.some((student) => student.id === uiPreferences.selectedStudentId)
    ? uiPreferences.selectedStudentId
    : studentSummaries.find((student) => student.status === "Active")?.id || "";

  const viewState = useMemo(() => ({
    ...canonicalState,
    settings: { ...canonicalState.settings, hourlyRateMxn: canonicalState.settings.hourlyRate },
    preferences: {
      selectedMonth: canonicalState.settings.selectedMonth,
      asOfDate: canonicalState.settings.asOfDate,
      selectedStudentId,
    },
    groups,
    students,
    grades: gradeRows,
    classLog: canonicalState.classLog,
    classLogs: canonicalState.classLog,
  }), [canonicalState, gradeRows, groups, selectedStudentId, students]);

  const derived = useMemo(() => ({
    ...rawDerived,
    dashboard: {
      ...rawDerived.dashboard,
      studentSummaries,
      studentSnapshots: studentSummaries,
      groupSummaries,
    },
    students: studentSummaries,
    studentSummaries,
    groups: groupSummaries,
    groupSummaries,
    grades: gradeRows,
    gradeRows,
    classLog: classLogRows,
    classLogRows,
    studentsById,
    groupsById,
  }), [classLogRows, gradeRows, groupSummaries, groupsById, rawDerived, studentSummaries, studentsById]);

  const updatePreferences = useCallback((patch) => {
    const statePatch = {};
    if (patch.selectedMonth) statePatch.selectedMonth = `${patch.selectedMonth.slice(0, 7)}-01`;
    if (patch.asOfDate) statePatch.asOfDate = patch.asOfDate;
    const saved = Object.keys(statePatch).length
      ? commit((current) => ({ ...current, settings: { ...current.settings, ...statePatch } }))
      : Promise.resolve(true);
    if (Object.hasOwn(patch, "selectedStudentId")) setUiPreferences((current) => ({ ...current, selectedStudentId: patch.selectedStudentId }));
    return saved;
  }, [commit]);

  const updateSettings = useCallback((draft) => {
    const next = {
      ...stateRef.current.settings,
      hourlyRate: Number(draft.hourlyRateMxn ?? draft.hourlyRate),
      defaultClassHours: Number(draft.defaultClassHours),
      recentProjectionWeeks: Number(draft.recentProjectionWeeks),
      lowGradeThreshold: Number(draft.lowGradeThreshold),
      lowAttendanceThreshold: Number(draft.lowAttendanceThreshold),
    };
    return commit((current) => ({ ...current, settings: { ...current.settings, ...next } }), "Preferences saved");
  }, [commit]);

  const upsertGroup = useCallback((draft) => {
    const item = applyGeneratedId(createGroup, canonicalGroup(draft));
    const validation = validateGroup(item, stateRef.current);
    if (!validation.valid) {
      notify(validation.errors[0].message, "error");
      return false;
    }
    return commit((current) => ({ ...current, groups: current.groups.some((group) => group.id === item.id) ? current.groups.map((group) => group.id === item.id ? item : group) : [...current.groups, item] }), draft.id ? "Group updated" : "Group added");
  }, [commit, notify]);

  const deleteGroup = useCallback((id) => {
    if (stateRef.current.students.some((student) => student.groupIds?.includes(id))) {
      notify("Unassign or move every student before deleting this group.", "error");
      return Promise.resolve(false);
    }
    return commit((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== id),
      scheduleExceptions: current.scheduleExceptions.filter((item) => item.groupId !== id),
      scheduleChanges: current.scheduleChanges.filter((item) => item.groupId !== id),
    }), "Group deleted");
  }, [commit, notify]);

  const upsertStudent = useCallback((draft) => {
    const item = applyGeneratedId(createStudent, canonicalStudent(draft));
    const validation = validateStudent(item, stateRef.current);
    if (!validation.valid) {
      notify(validation.errors[0].message, "error");
      return false;
    }
    return commit((current) => ({ ...current, students: current.students.some((student) => student.id === item.id) ? current.students.map((student) => student.id === item.id ? item : student) : [...current.students, item] }), draft.id ? "Student updated" : "Student added");
  }, [commit, notify]);

  const archiveStudent = useCallback((id) => commit((current) => ({ ...current, students: current.students.map((student) => student.id === id ? { ...student, status: "Inactive" } : student) }), "Student archived"), [commit]);

  const deleteStudent = useCallback((id) => {
    if (stateRef.current.grades.some((grade) => grade.studentId === id) || stateRef.current.classLog.some((row) => row.studentId === id)) return notify("Archive this student to preserve grade and payment history.", "error");
    return commit((current) => ({ ...current, students: current.students.filter((student) => student.id !== id) }), "Student deleted");
  }, [commit, notify]);

  const upsertGrade = useCallback((draft) => {
    const item = applyGeneratedId(createGrade, canonicalGrade(draft));
    const validation = validateGrade(item, stateRef.current);
    if (!validation.valid) {
      notify(validation.errors[0].message, "error");
      return false;
    }
    return commit((current) => ({ ...current, grades: current.grades.some((grade) => grade.id === item.id) ? current.grades.map((grade) => grade.id === item.id ? item : grade) : [...current.grades, item] }), draft.id ? "Grade updated" : "Grade added");
  }, [commit, notify]);

  const addGrades = useCallback((drafts) => {
    const items = drafts.map((draft) => applyGeneratedId(createGrade, canonicalGrade(draft)));
    const current = stateRef.current;
    const error = items.map((item) => validateGrade(item, { ...current, grades: [...current.grades, ...items] })).find((validation) => !validation.valid);
    if (error) {
      notify(error.errors[0].message, "error");
      return false;
    }
    if (!items.length) {
      notify("Enter at least one score, status, or feedback note.", "error");
      return false;
    }
    return commit((current) => ({ ...current, grades: [...current.grades, ...items] }), `${items.length} grade${items.length === 1 ? "" : "s"} saved`);
  }, [commit, notify]);

  const deleteGrade = useCallback((id) => commit((current) => ({ ...current, grades: current.grades.filter((grade) => grade.id !== id) }), "Grade deleted"), [commit]);

  const upsertClassLog = useCallback((draft) => {
    const item = applyGeneratedId(createClassLogRow, canonicalClassLog(draft, stateRef.current));
    const validation = validateClassLogRow(item, stateRef.current);
    if (!validation.valid) {
      notify(validation.errors[0].message, "error");
      return false;
    }
    return commit((current) => ({ ...current, classLog: current.classLog.some((row) => row.id === item.id) ? current.classLog.map((row) => row.id === item.id ? item : row) : [...current.classLog, item] }), draft.id ? "Class record updated" : "Class record added");
  }, [commit, notify]);

  const addClassLogs = useCallback((drafts) => {
    const items = drafts.map((draft) => applyGeneratedId(createClassLogRow, canonicalClassLog(draft, stateRef.current)));
    if (!items.length) {
      notify("Choose a group with active students first.", "error");
      return false;
    }
    const current = stateRef.current;
    const invalid = items.map((item) => validateClassLogRow(item, current)).find((validation) => !validation.valid);
    if (invalid) {
      notify(invalid.errors[0].message, "error");
      return false;
    }
    const duplicate = items.find((item) => current.classLog.some((row) => row.studentId === item.studentId && row.classDate === item.classDate && (row.startTime || "") === (item.startTime || "")));
    if (duplicate) {
      notify("A student already has a class record at this date and time. Review History before saving.", "error");
      return false;
    }
    return commit((current) => ({ ...current, classLog: [...current.classLog, ...items] }), `Class saved for ${items.length} student${items.length === 1 ? "" : "s"}`);
  }, [commit, notify]);

  const deleteClassLog = useCallback((id) => commit((current) => ({ ...current, classLog: current.classLog.filter((row) => row.id !== id) }), "Class record deleted"), [commit]);

  const upsertScheduleException = useCallback((draft) => {
    const item = applyGeneratedId(createScheduleException, canonicalScheduleException(draft));
    return commit((current) => ({
      ...current,
      scheduleExceptions: current.scheduleExceptions.some((entry) => entry.id === item.id)
        ? current.scheduleExceptions.map((entry) => entry.id === item.id ? item : entry)
        : [...current.scheduleExceptions, item],
    }), draft.id ? "Class exception updated" : "Class exception added");
  }, [commit]);

  const upsertScheduleChange = useCallback((draft) => {
    const item = applyGeneratedId(createScheduleChange, canonicalScheduleChange(draft));
    return commit((current) => ({ ...current, scheduleChanges: [...current.scheduleChanges, item] }), "Future schedule updated");
  }, [commit]);

  const exportJson = useCallback(() => {
    const current = stateRef.current;
    downloadText(createExportFilename(current.settings.asOfDate), exportState(current));
    notify("Backup downloaded");
  }, [notify]);

  const importJson = useCallback((text) => {
    try {
      const imported = importState(text);
      return commit(() => imported, "Backup restored");
    } catch (error) {
      notify(messageForError(error), "error");
      return Promise.resolve(false);
    }
  }, [commit, notify]);

  const clearAll = useCallback(() => commit((current) => ({ ...current, groups: [], students: [], grades: [], classLog: [], scheduleExceptions: [], scheduleChanges: [] }), "All records cleared"), [commit]);
  const clearLegacyLocalData = useCallback(() => {
    if (persistenceRef.current?.mode !== "cloud") return false;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(REAL_ROSTER_BACKUP_KEY);
      localStorage.removeItem(REAL_ROSTER_MIGRATION_KEY);
      notify("Old local browser copy removed");
      return true;
    } catch (error) {
      notify(messageForError(error), "error");
      return false;
    }
  }, [notify]);

  const actions = useMemo(() => ({
    updatePreferences,
    updateSettings,
    upsertGroup,
    deleteGroup,
    upsertStudent,
    archiveStudent,
    deleteStudent,
    upsertGrade,
    addGrades,
    deleteGrade,
    upsertClassLog,
    addClassLogs,
    addClassLog: upsertClassLog,
    deleteClassLog,
    upsertScheduleException,
    upsertScheduleChange,
    exportJson,
    importJson,
    clearAll,
    clearLegacyLocalData,
    notify,
  }), [addClassLogs, addGrades, archiveStudent, clearAll, clearLegacyLocalData, deleteClassLog, deleteGrade, deleteGroup, deleteStudent, exportJson, importJson, notify, updatePreferences, updateSettings, upsertClassLog, upsertGrade, upsertGroup, upsertScheduleChange, upsertScheduleException, upsertStudent]);

  return useMemo(() => ({
    state: viewState,
    derived,
    asOfDate: canonicalState.settings.asOfDate,
    syncStatus,
    persistenceMode: persistence?.mode || "local",
    actions,
    toasts,
    dismissToast,
  }), [actions, canonicalState.settings.asOfDate, derived, dismissToast, persistence?.mode, syncStatus, toasts, viewState]);
}
