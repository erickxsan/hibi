import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  GroupSelect,
  IconButton,
  Input,
  Select,
  StatusBadge,
  TextArea,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { getUiLocale, useI18n } from "../i18n";
import { playHibiSound } from "../utils/hibiSounds";
import { normalizeSearchText } from "../utils/searchText";
import {
  assessmentKey,
  attendanceRate,
  buildAssessments,
  buildClassSessions,
  classSessionKey,
  INDIVIDUAL_GROUP_ID,
  monthKey,
} from "./progressModel";

const TABS = [
  { value: "record", label: "Record" },
  { value: "gradebook", label: "Gradebook" },
  { value: "attendance", label: "Attendance" },
];
const CATEGORIES = ["Quiz", "Exam", "Project", "Homework", "Participation", "Other"];
const WORK_STATUSES = ["On time", "Late", "Missing", "Excused"];
const ATTENDANCE_CODES = ["P", "L", "E", "A"];

function formatDate(value, options = { month: "short", day: "numeric" }) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(getUiLocale(), options).format(new Date(`${value}T12:00:00`));
}

function formatMonth(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(getUiLocale(), { month: "long", year: "numeric" }).format(new Date(`${value}-01T12:00:00`));
}

function formatPercent(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function groupIdsFor(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}

function studentBelongsTo(student, groupId) {
  if (groupId === "all") return true;
  if (groupId === INDIVIDUAL_GROUP_ID) return Boolean(student?.isIndividual || !groupIdsFor(student).length);
  return groupIdsFor(student).includes(groupId);
}

function attendanceMeta(code, language) {
  const labels = {
    P: language === "es" ? ["P", "Presente"] : ["P", "Present"],
    L: language === "es" ? ["T", "Tarde"] : ["L", "Late"],
    E: language === "es" ? ["J", "Justificado"] : ["E", "Excused"],
    A: language === "es" ? ["A", "Ausente"] : ["A", "Absent"],
  };
  return labels[code] || ["—", "Not recorded"];
}

function attendanceTone(code) {
  return code === "P" ? "present" : code === "L" ? "late" : code === "E" ? "excused" : code === "A" ? "absent" : "empty";
}

function recordIdentity(context) {
  return `${context.classDate}|${context.groupId}|${context.startTime || ""}`;
}

function sessionLabel(session, groupsById) {
  const groupName = session.groupId === INDIVIDUAL_GROUP_ID
    ? "Individual students"
    : session.groupName || groupsById.get(session.groupId)?.name || "Group";
  return `${formatDate(session.classDate, { weekday: "short", month: "short", day: "numeric" })} · ${groupName}${session.startTime ? ` · ${session.startTime}` : ""}`;
}

function defaultRecordContext(state, sessions) {
  const asOfDate = state.settings?.asOfDate || new Date().toISOString().slice(0, 10);
  const session = sessions.find((item) => item.classDate === asOfDate && item.recorded)
    || sessions.find((item) => item.classDate <= asOfDate)
    || sessions.slice().reverse()[0];
  const groupId = session?.groupId || state.groups?.[0]?.id || INDIVIDUAL_GROUP_ID;
  return {
    classDate: session?.classDate || asOfDate,
    groupId,
    startTime: session?.startTime || "",
    hours: session?.durationHours ?? state.settings?.defaultClassHours ?? 2,
    classTitle: session?.classTitle || "",
    scheduleSlotId: session?.scheduleSlotId || "",
    occurrenceDate: session?.occurrenceDate || session?.classDate || asOfDate,
    assessment: "",
    category: "Quiz",
    maximum: 20,
  };
}

function compactGradeValue(value) {
  return value === "" || value == null ? "" : String(value);
}

function comparableRecordSnapshot(context, entries) {
  return {
    context,
    entries: Object.fromEntries(Object.entries(entries).map(([studentId, entry]) => [studentId, {
      attendance: entry.attendance || "",
      score: compactGradeValue(entry.score),
      feedback: entry.feedback || "",
    }])),
  };
}

function ProgressTabs({ value, onChange }) {
  return (
    <div className="progress-tabs" role="tablist" aria-label="Progress views">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={value === tab.value ? "active" : ""}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function Progress({ state, derived, actions, intent, clearIntent, registerNavigationBlocker }) {
  const { language } = useI18n();
  const groups = state.groups || [];
  const students = state.students || [];
  const gradeRows = derived.gradeRows || state.grades || [];
  const classRows = derived.classLogRows || state.classLog || [];
  const groupsById = derived.groupsById || new Map(groups.map((group) => [group.id, group]));
  const studentsById = derived.studentsById || new Map(students.map((student) => [student.id, student]));
  const sessions = useMemo(() => buildClassSessions(classRows, derived.upcomingClasses || []), [classRows, derived.upcomingClasses]);
  const [tab, setTab] = useState("record");
  const [recordContext, setRecordContext] = useState(() => defaultRecordContext(state, sessions));
  const [recordEntries, setRecordEntries] = useState({});
  const [detailsOpen, setDetailsOpen] = useState(!sessions.length);
  const [saving, setSaving] = useState(false);
  const recordBaselineRef = useRef(null);

  const activeStudents = useMemo(() => students.filter((student) => student.status === "Active"), [students]);
  const hasIndividualStudents = activeStudents.some((student) => studentBelongsTo(student, INDIVIDUAL_GROUP_ID));
  const recordRoster = useMemo(
    () => activeStudents.filter((student) => studentBelongsTo(student, recordContext.groupId)),
    [activeStudents, recordContext.groupId],
  );
  const recordSnapshot = useMemo(() => comparableRecordSnapshot(recordContext, recordEntries), [recordContext, recordEntries]);
  const recordDirty = Boolean(recordBaselineRef.current) && draftChanged(recordSnapshot, recordBaselineRef.current);

  const changeTab = useHistoryBackedState({
    key: "progress-tab",
    value: tab,
    onChange: setTab,
    defaultValue: "record",
    allowedValues: TABS.map((item) => item.value),
    canChange: () => !recordDirty || confirmDiscard(true, "Discard your unsaved progress changes?"),
  });
  useUnsavedChanges(registerNavigationBlocker, recordDirty, "Discard your unsaved progress changes?");

  const rawClassRows = state.classLog || [];
  const hydrateRecord = useCallback((nextContext) => {
    const roster = activeStudents.filter((student) => studentBelongsTo(student, nextContext.groupId));
    const sessionGrades = gradeRows.filter((grade) => grade.date === nextContext.classDate && roster.some((student) => student.id === grade.studentId));
    const preferredAssessment = nextContext.assessment || buildAssessments(sessionGrades)[0]?.assessment || "";
    const assessmentRows = preferredAssessment
      ? sessionGrades.filter((grade) => grade.assessment === preferredAssessment)
      : [];
    const firstGrade = assessmentRows[0];
    const hydratedContext = {
      ...nextContext,
      assessment: preferredAssessment,
      category: firstGrade?.category || nextContext.category || "Quiz",
      maximum: firstGrade?.maximum ?? firstGrade?.maxScore ?? nextContext.maximum ?? 20,
    };
    const entries = Object.fromEntries(roster.map((student) => {
      const classRow = rawClassRows.find((row) => row.studentId === student.id
        && row.classDate === hydratedContext.classDate
        && (row.groupId || INDIVIDUAL_GROUP_ID) === hydratedContext.groupId
        && (row.startTime || "") === (hydratedContext.startTime || ""));
      const grade = assessmentRows.find((row) => row.studentId === student.id);
      return [student.id, {
        attendance: classRow?.attendance || "P",
        score: compactGradeValue(grade?.score),
        feedback: grade?.feedback || "",
        classId: classRow?.id || "",
        gradeId: grade?.id || "",
      }];
    }));
    setRecordContext(hydratedContext);
    setRecordEntries(entries);
    recordBaselineRef.current = comparableRecordSnapshot(hydratedContext, entries);
  }, [activeStudents, gradeRows, rawClassRows]);

  useEffect(() => {
    hydrateRecord(recordContext);
  // Rehydrate only when the selected class identity or saved collection sizes change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordIdentity(recordContext), rawClassRows.length, gradeRows.length]);

  useEffect(() => {
    if (intent !== "add-grades") return;
    changeTab("record", { replace: true });
    setDetailsOpen(true);
    clearIntent?.();
  }, [changeTab, clearIntent, intent]);

  const chooseSession = (key) => {
    if (recordDirty && !confirmDiscard(true, "Changing classes clears your unsaved progress. Continue?")) return;
    if (key === "custom") {
      setDetailsOpen(true);
      return;
    }
    const session = sessions.find((item) => item.key === key);
    if (!session) return;
    setDetailsOpen(false);
    hydrateRecord({
      ...recordContext,
      classDate: session.classDate,
      groupId: session.groupId,
      startTime: session.startTime || "",
      hours: session.durationHours ?? state.settings.defaultClassHours,
      classTitle: session.classTitle || "",
      scheduleSlotId: session.scheduleSlotId || "",
      occurrenceDate: session.occurrenceDate || session.classDate,
      assessment: "",
    });
  };

  const updateRecordContext = (patch) => {
    if (recordDirty && !confirmDiscard(true, "Changing the class clears your unsaved progress. Continue?")) return;
    hydrateRecord({ ...recordContext, ...patch, assessment: patch.assessment ?? "" });
  };

  const updateRecordEntry = (studentId, patch) => {
    setRecordEntries((current) => ({
      ...current,
      [studentId]: { attendance: "P", score: "", feedback: "", ...current[studentId], ...patch },
    }));
  };

  const markAllPresent = () => {
    setRecordEntries((current) => Object.fromEntries(recordRoster.map((student) => [student.id, {
      score: "",
      feedback: "",
      ...current[student.id],
      attendance: "P",
    }])));
    playHibiSound("attendance");
  };

  const clearScores = () => {
    setRecordEntries((current) => Object.fromEntries(Object.entries(current).map(([studentId, entry]) => [studentId, { ...entry, score: "", feedback: "" }])));
  };

  const recordSummary = useMemo(() => {
    const attendance = Object.fromEntries(ATTENDANCE_CODES.map((code) => [code, 0]));
    const scores = [];
    recordRoster.forEach((student) => {
      const entry = recordEntries[student.id] || {};
      if (attendance[entry.attendance] != null) attendance[entry.attendance] += 1;
      if (entry.score !== "" && Number.isFinite(Number(entry.score))) scores.push(Number(entry.score));
    });
    return {
      attendance,
      average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
      missingScores: recordRoster.length - scores.length,
    };
  }, [recordEntries, recordRoster]);

  const saveRecord = async () => {
    if (!recordRoster.length || !actions.saveProgress) return;
    const assessment = recordContext.assessment.trim();
    const hasGradeContent = recordRoster.some((student) => {
      const entry = recordEntries[student.id] || {};
      return entry.score !== "" || entry.feedback?.trim();
    });
    if (hasGradeContent && !assessment) {
      actions.notify("Name the assessment before saving scores or feedback.", "error");
      return;
    }
    const maximum = Number(recordContext.maximum);
    if (hasGradeContent && (!Number.isFinite(maximum) || maximum <= 0)) {
      actions.notify("Enter a valid maximum score.", "error");
      return;
    }
    const invalidScore = recordRoster.find((student) => {
      const value = recordEntries[student.id]?.score;
      return value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > maximum);
    });
    if (invalidScore) {
      actions.notify(`Check the score for ${invalidScore.fullName}.`, "error");
      return;
    }
    const classRecords = recordRoster.map((student) => {
      const entry = recordEntries[student.id] || {};
      const existing = rawClassRows.find((row) => row.id === entry.classId)
        || rawClassRows.find((row) => row.studentId === student.id
          && row.classDate === recordContext.classDate
          && (row.groupId || INDIVIDUAL_GROUP_ID) === recordContext.groupId
          && (row.startTime || "") === (recordContext.startTime || ""));
      return {
        ...existing,
        id: existing?.id,
        classDate: recordContext.classDate,
        studentId: student.id,
        groupId: recordContext.groupId === INDIVIDUAL_GROUP_ID ? "" : recordContext.groupId,
        startTime: recordContext.startTime,
        classTitle: recordContext.classTitle,
        scheduleSlotId: recordContext.scheduleSlotId,
        scheduleOccurrenceDate: recordContext.occurrenceDate,
        classStatus: "Completed",
        attendance: entry.attendance || "P",
        hours: Number(recordContext.hours),
      };
    });
    const gradeRecords = assessment ? recordRoster.flatMap((student) => {
      const entry = recordEntries[student.id] || {};
      if (entry.score === "" && !entry.feedback?.trim() && !entry.gradeId) return [];
      const existing = gradeRows.find((row) => row.id === entry.gradeId)
        || gradeRows.find((row) => row.studentId === student.id
          && row.date === recordContext.classDate
          && row.assessment.toLocaleLowerCase() === assessment.toLocaleLowerCase());
      return [{
        ...existing,
        id: existing?.id,
        date: recordContext.classDate,
        studentId: student.id,
        assessment,
        category: recordContext.category,
        score: entry.score === "" ? null : Number(entry.score),
        maximum,
        workStatus: existing?.workStatus || "On time",
        feedback: entry.feedback || "",
      }];
    }) : [];
    setSaving(true);
    try {
      if (await actions.saveProgress({ classRecords, gradeRecords })) {
        recordBaselineRef.current = recordSnapshot;
      }
    } finally {
      setSaving(false);
    }
  };

  const openAttendanceSession = (session) => {
    changeTab("record");
    hydrateRecord({
      ...recordContext,
      classDate: session.classDate,
      groupId: session.groupId,
      startTime: session.startTime || "",
      hours: session.durationHours ?? state.settings.defaultClassHours,
      classTitle: session.classTitle || "",
      assessment: "",
    });
  };

  return (
    <div className="page progress-page">
      <div className="progress-heading">
        <div><h1>Progress</h1><p>Attendance and grades, together after every class.</p></div>
      </div>
      <ProgressTabs value={tab} onChange={changeTab} />
      {tab === "record" ? (
        <RecordView
          state={state}
          groups={groups}
          groupsById={groupsById}
          hasIndividualStudents={hasIndividualStudents}
          sessions={sessions}
          context={recordContext}
          detailsOpen={detailsOpen}
          setDetailsOpen={setDetailsOpen}
          entries={recordEntries}
          roster={recordRoster}
          summary={recordSummary}
          language={language}
          saving={saving}
          dirty={recordDirty}
          onChooseSession={chooseSession}
          onContextChange={updateRecordContext}
          onAssessmentChange={(patch) => setRecordContext((current) => ({ ...current, ...patch }))}
          onEntryChange={updateRecordEntry}
          onMarkAllPresent={markAllPresent}
          onClearScores={clearScores}
          onSave={saveRecord}
        />
      ) : null}
      {tab === "gradebook" ? <GradebookView state={state} groups={groups} students={students} studentsById={studentsById} gradeRows={gradeRows} actions={actions} /> : null}
      {tab === "attendance" ? <AttendanceView state={state} groups={groups} students={students} classRows={classRows} sessions={sessions} language={language} onOpenSession={openAttendanceSession} /> : null}
    </div>
  );
}

function RecordView({ state, groups, groupsById, hasIndividualStudents, sessions, context, detailsOpen, setDetailsOpen, entries, roster, summary, language, saving, dirty, onChooseSession, onContextChange, onAssessmentChange, onEntryChange, onMarkAllPresent, onClearScores, onSave }) {
  const currentKey = classSessionKey(context);
  const selectedGroupName = context.groupId === INDIVIDUAL_GROUP_ID ? "Individual students" : groupsById.get(context.groupId)?.name || "Choose group";
  return (
    <section className="progress-view" role="tabpanel">
      <div className="record-class-picker">
        <div className="record-class-icon"><CalendarDays aria-hidden="true" size={20} /></div>
        <label>
          <span>Class</span>
          <Select aria-label="Class to record" value={sessions.some((session) => session.key === currentKey) ? currentKey : "custom"} onChange={(event) => onChooseSession(event.target.value)}>
            {!sessions.some((session) => session.key === currentKey) ? <option value="custom">{formatDate(context.classDate)} · {selectedGroupName}</option> : null}
            {sessions.slice(0, 36).map((session) => <option key={session.key} value={session.key}>{sessionLabel(session, groupsById)}</option>)}
            <option value="custom">Custom class…</option>
          </Select>
        </label>
        <Button onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? "Hide details" : "Change class"}</Button>
      </div>

      {detailsOpen ? (
        <div className="record-details" aria-label="Class details">
          <Field label="Date" required><Input type="date" value={context.classDate} onChange={(event) => onContextChange({ classDate: event.target.value })} /></Field>
          <Field label="Group" required><GroupSelect groups={groups} include={hasIndividualStudents ? [{ id: INDIVIDUAL_GROUP_ID, name: "Individual students" }] : []} value={context.groupId} onChange={(event) => onContextChange({ groupId: event.target.value })} /></Field>
          <Field label="Start time"><Input type="time" value={context.startTime} onChange={(event) => onContextChange({ startTime: event.target.value })} /></Field>
          <Field label="Hours" required><Input type="number" min="0" step="0.25" value={context.hours} onChange={(event) => onAssessmentChange({ hours: event.target.value })} /></Field>
        </div>
      ) : null}

      <div className="record-grade-settings">
        <Field label="Assessment (optional)"><Input value={context.assessment} onChange={(event) => onAssessmentChange({ assessment: event.target.value })} placeholder="e.g. Quiz 1" /></Field>
        <Field label="Category"><Select value={context.category} onChange={(event) => onAssessmentChange({ category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field>
        <Field label="Maximum"><Input type="number" min="0.01" step="0.01" value={context.maximum} onChange={(event) => onAssessmentChange({ maximum: event.target.value })} /></Field>
      </div>

      <div className="progress-actions-row">
        <div><Button variant="primary" icon={Check} onClick={onMarkAllPresent} disabled={!roster.length}>Mark all present</Button><Button icon={RotateCcw} onClick={onClearScores} disabled={!roster.length}>Clear scores</Button></div>
        <span><Users aria-hidden="true" size={16} />{roster.length} {roster.length === 1 ? "student" : "students"}</span>
      </div>

      {!roster.length ? <EmptyState icon={Users} title="No active students here" description="Assign active students to this group, then return to record progress." /> : (
        <div className="record-layout">
          <div className="progress-roster" role="table" aria-label="Class progress roster">
            <div className="progress-roster-head" role="row"><span role="columnheader">Student</span><span role="columnheader">Attendance</span><span role="columnheader">Score</span><span role="columnheader">Feedback</span></div>
            {roster.map((student) => {
              const entry = entries[student.id] || { attendance: "P", score: "", feedback: "" };
              return (
                <div className="progress-student-row" role="row" key={student.id}>
                  <div className="progress-student" role="rowheader"><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative /><span><strong>{student.fullName}</strong><small>{student.code || "Student"}</small></span></div>
                  <div className="attendance-segments" role="group" aria-label={`Attendance for ${student.fullName}`}>
                    {ATTENDANCE_CODES.map((code) => { const [short, label] = attendanceMeta(code, language); return <button key={code} type="button" title={label} aria-label={label} aria-pressed={entry.attendance === code} className={`${attendanceTone(code)} ${entry.attendance === code ? "active" : ""}`} onClick={() => onEntryChange(student.id, { attendance: code })}>{short}</button>; })}
                  </div>
                  <label className="score-input"><span className="sr-only">Score for {student.fullName}</span><Input type="number" min="0" max={context.maximum} step="0.01" inputMode="decimal" value={entry.score} onChange={(event) => onEntryChange(student.id, { score: event.target.value })} /><small>/{context.maximum || "—"}</small></label>
                  <Input aria-label={`Feedback for ${student.fullName}`} value={entry.feedback} onChange={(event) => onEntryChange(student.id, { feedback: event.target.value })} placeholder="Optional note" />
                </div>
              );
            })}
          </div>
          <aside className="progress-summary">
            <div className="progress-summary-head"><div><h2>Class summary</h2><p>{formatDate(context.classDate, { weekday: "long", month: "long", day: "numeric" })}</p></div><span className="summary-cat" aria-hidden="true">♡</span></div>
            <dl className="summary-counts"><div><dt>Students</dt><dd>{roster.length}</dd></div>{ATTENDANCE_CODES.map((code) => { const [, label] = attendanceMeta(code, language); return <div key={code}><dt><i className={attendanceTone(code)} />{label}</dt><dd>{summary.attendance[code]}</dd></div>; })}</dl>
            <div className="summary-score"><span><small>Average score</small><strong>{summary.average == null ? "—" : `${summary.average.toFixed(1)} / ${context.maximum}`}</strong></span><span><small>Score missing</small><strong>{summary.missingScores}</strong></span></div>
            <div className="summary-note"><Sparkles aria-hidden="true" size={18} /><span><strong>{summary.attendance.P === roster.length ? "Everyone is here!" : "Almost ready to save"}</strong><small>Review the roster, then save once.</small></span></div>
          </aside>
        </div>
      )}
      {roster.length ? <div className="progress-save-bar"><span>{dirty ? "Unsaved changes" : "Everything is up to date"}</span><Button variant="primary" icon={ClipboardCheck} onClick={onSave} disabled={saving || !dirty}>{saving ? "Saving…" : "Save class progress"}</Button></div> : null}
    </section>
  );
}

function GradebookView({ state, groups, students, studentsById, gradeRows, actions }) {
  const defaultGroup = groups[0]?.id || "all";
  const defaultMonth = monthKey(state.settings?.selectedMonth || state.settings?.asOfDate) || new Date().toISOString().slice(0, 7);
  const [filters, setFilters] = useState({ groupId: defaultGroup, month: defaultMonth, search: "" });
  const [cellDrafts, setCellDrafts] = useState({});
  const [batchDraft, setBatchDraft] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const batchBaselineRef = useRef(null);
  const editBaselineRef = useRef(null);
  const batchDirty = Boolean(batchDraft) && draftChanged(batchDraft, batchBaselineRef.current);
  const editDirty = Boolean(editDraft) && draftChanged(editDraft, editBaselineRef.current);

  const months = useMemo(() => [...new Set([defaultMonth, ...gradeRows.map((row) => monthKey(row.date)).filter(Boolean)])].sort().reverse(), [defaultMonth, gradeRows]);
  const groupStudents = useMemo(() => students.filter((student) => student.status === "Active" && studentBelongsTo(student, filters.groupId)), [filters.groupId, students]);
  const needle = normalizeSearchText(filters.search);
  const visibleStudents = useMemo(() => groupStudents.filter((student) => !needle || normalizeSearchText(student.fullName).includes(needle)), [groupStudents, needle]);
  const visibleGrades = useMemo(() => gradeRows.filter((row) => monthKey(row.date) === filters.month && groupStudents.some((student) => student.id === row.studentId)), [filters.month, gradeRows, groupStudents]);
  const assessments = useMemo(() => buildAssessments(visibleGrades).slice(0, 8), [visibleGrades]);
  const gradeMap = useMemo(() => new Map(visibleGrades.map((row) => [`${assessmentKey(row)}|${row.studentId}`, row])), [visibleGrades]);

  const createBatch = () => {
    const next = { date: state.settings?.asOfDate || new Date().toISOString().slice(0, 10), groupId: filters.groupId === "all" ? defaultGroup : filters.groupId, assessment: "", category: "Quiz", maximum: 20, entries: {} };
    batchBaselineRef.current = next;
    setBatchDraft(next);
  };
  const closeBatch = () => {
    if (!confirmDiscard(batchDirty, "Discard the grades you entered?")) return false;
    setBatchDraft(null);
    batchBaselineRef.current = null;
    return true;
  };
  const batchRoster = batchDraft ? students.filter((student) => student.status === "Active" && studentBelongsTo(student, batchDraft.groupId)) : [];
  const updateBatchEntry = (studentId, value) => setBatchDraft((current) => ({ ...current, entries: { ...current.entries, [studentId]: value } }));
  const saveBatch = async (event) => {
    event.preventDefault();
    const records = batchRoster.flatMap((student) => {
      const score = batchDraft.entries[student.id] ?? "";
      if (score === "") return [];
      return [{ date: batchDraft.date, studentId: student.id, assessment: batchDraft.assessment, category: batchDraft.category, score: Number(score), maximum: Number(batchDraft.maximum), workStatus: "On time", feedback: "" }];
    });
    setSaving(true);
    try {
      if (await actions.addGrades(records)) {
        setFilters((current) => ({ ...current, groupId: batchDraft.groupId, month: monthKey(batchDraft.date) }));
        setBatchDraft(null);
        batchBaselineRef.current = null;
      }
    } finally { setSaving(false); }
  };

  const saveCell = async (student, assessment, value) => {
    const key = `${assessment.key}|${student.id}`;
    const existing = gradeMap.get(key);
    if (value === "" && !existing) return;
    const score = value === "" ? null : Number(value);
    if (value !== "" && (!Number.isFinite(score) || score < 0 || score > Number(assessment.maximum))) {
      actions.notify(`Enter a score from 0 to ${assessment.maximum}.`, "error");
      setCellDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
      return;
    }
    await actions.upsertGrade({ ...existing, id: existing?.id, date: assessment.date, studentId: student.id, assessment: assessment.assessment, category: assessment.category, maximum: assessment.maximum, score, workStatus: existing?.workStatus || "On time", feedback: existing?.feedback || "" });
    setCellDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
  };

  const openEdit = (grade) => {
    const next = { ...grade, score: compactGradeValue(grade.score) };
    editBaselineRef.current = next;
    setEditDraft(next);
  };
  const closeEdit = () => {
    if (!confirmDiscard(editDirty, "Discard your unsaved grade changes?")) return false;
    setEditDraft(null);
    editBaselineRef.current = null;
    return true;
  };
  const saveEdit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (await actions.upsertGrade({ ...editDraft, score: editDraft.score === "" ? null : Number(editDraft.score), maximum: Number(editDraft.maximum) })) {
        setEditDraft(null);
        editBaselineRef.current = null;
      }
    } finally { setSaving(false); }
  };
  const confirmDelete = async () => {
    setSaving(true);
    try { if (await actions.deleteGrade(deleteTarget.id)) setDeleteTarget(null); } finally { setSaving(false); }
  };

  return (
    <section className="progress-view" role="tabpanel">
      <div className="gradebook-toolbar">
        <Field label="Group"><GroupSelect groups={groups} include={[{ id: "all", name: "All students" }]} value={filters.groupId} onChange={(event) => setFilters({ ...filters, groupId: event.target.value })} /></Field>
        <Field label="Period"><Select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}>{months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</Select></Field>
        <Field label="Search"><label className="progress-search"><Search aria-hidden="true" size={17} /><input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search students" /></label></Field>
        <Button variant="primary" icon={Plus} onClick={createBatch}>Add assessment</Button>
      </div>
      {assessments.length && visibleStudents.length ? (
        <div className="gradebook-shell" role="region" aria-label="Gradebook" tabIndex="0">
          <table className="gradebook-table">
            <thead><tr><th className="gradebook-student-column" scope="col">Student</th>{assessments.map((assessment) => <th key={assessment.key} scope="col"><span>{assessment.assessment}</span><small>{formatDate(assessment.date)} · /{assessment.maximum}</small></th>)}<th scope="col">Average</th></tr></thead>
            <tbody>{visibleStudents.map((student) => {
              const studentGrades = assessments.map((assessment) => gradeMap.get(`${assessment.key}|${student.id}`));
              const percentages = studentGrades.filter((grade) => grade?.percentage != null).map((grade) => grade.percentage);
              const average = percentages.length ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length : null;
              return <tr key={student.id}><th className="gradebook-student-column" scope="row"><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.code || "Student"}</small></span></th>{assessments.map((assessment) => {
                const cellKey = `${assessment.key}|${student.id}`;
                const grade = gradeMap.get(cellKey);
                const value = Object.hasOwn(cellDrafts, cellKey) ? cellDrafts[cellKey] : compactGradeValue(grade?.score);
                const tone = grade?.percentage == null ? "" : grade.percentage < state.settings.lowGradeThreshold ? "low" : grade.percentage >= .9 ? "high" : "mid";
                return <td key={assessment.key} className={tone}><div className="grade-cell"><input aria-label={`${assessment.assessment} score for ${student.fullName}`} type="number" min="0" max={assessment.maximum} step="0.01" inputMode="decimal" value={value} onChange={(event) => setCellDrafts((current) => ({ ...current, [cellKey]: event.target.value }))} onBlur={(event) => saveCell(student, assessment, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><small>/{assessment.maximum}</small>{grade ? <IconButton label={`Edit ${assessment.assessment} for ${student.fullName}`} icon={Pencil} onClick={() => openEdit(grade)} /> : null}</div></td>;
              })}<td className="grade-average"><strong>{formatPercent(average)}</strong></td></tr>;
            })}</tbody>
          </table>
        </div>
      ) : <EmptyState icon={Sparkles} title="No grades for this period" description="Add an assessment once, then enter scores directly in the gradebook." action={<Button icon={Plus} onClick={createBatch}>Add assessment</Button>} />}
      <div className="gradebook-footer"><span><i className="high" />90–100%</span><span><i className="mid" />On track</span><span><i className="low" />Needs support</span><p>Click a score to edit it. Changes save when you leave the cell.</p></div>

      <Drawer open={Boolean(batchDraft)} onClose={closeBatch} title="Add assessment" description="Set it up once, then enter the whole roster." size="wide" footer={<><Button onClick={closeBatch} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="progress-batch-form" disabled={saving}>{saving ? "Saving…" : "Save assessment"}</Button></>}>
        {batchDraft ? <form id="progress-batch-form" className="drawer-form" onSubmit={saveBatch}><div className="form-grid two-columns"><Field label="Date" required><Input type="date" value={batchDraft.date} onChange={(event) => setBatchDraft({ ...batchDraft, date: event.target.value })} /></Field><Field label="Group" required><Select value={batchDraft.groupId} onChange={(event) => setBatchDraft({ ...batchDraft, groupId: event.target.value, entries: {} })}>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></Field></div><Field label="Assessment" required><Input value={batchDraft.assessment} onChange={(event) => setBatchDraft({ ...batchDraft, assessment: event.target.value })} placeholder="e.g. Quiz 1" /></Field><div className="form-grid two-columns"><Field label="Category"><Select value={batchDraft.category} onChange={(event) => setBatchDraft({ ...batchDraft, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field><Field label="Maximum" required><Input type="number" min="0.01" step="0.01" value={batchDraft.maximum} onChange={(event) => setBatchDraft({ ...batchDraft, maximum: event.target.value })} /></Field></div><div className="drawer-section-heading"><div><h3>Enter scores</h3><p>{batchRoster.length} active {batchRoster.length === 1 ? "student" : "students"}</p></div></div><div className="compact-score-list">{batchRoster.map((student) => <label key={student.id}><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span>{student.fullName}</span><Input aria-label={`Score for ${student.fullName}`} type="number" min="0" max={batchDraft.maximum} step="0.01" value={batchDraft.entries[student.id] ?? ""} onChange={(event) => updateBatchEntry(student.id, event.target.value)} /><small>/{batchDraft.maximum}</small></label>)}</div></form> : null}
      </Drawer>

      <Drawer open={Boolean(editDraft)} onClose={closeEdit} title="Edit grade" footer={<><Button onClick={closeEdit} disabled={saving}>Cancel</Button><Button variant="danger" icon={Trash2} onClick={() => { setDeleteTarget(editDraft); setEditDraft(null); }}>Delete</Button><Button variant="primary" type="submit" form="progress-edit-grade" disabled={saving}>{saving ? "Saving…" : "Save grade"}</Button></>}>
        {editDraft ? <form id="progress-edit-grade" className="drawer-form" onSubmit={saveEdit}><Field label="Student"><Input value={studentsById.get(editDraft.studentId)?.fullName || editDraft.studentName || ""} disabled /></Field><div className="form-grid two-columns"><Field label="Date" required><Input type="date" value={editDraft.date} onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })} /></Field><Field label="Category"><Select value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field></div><Field label="Assessment" required><Input value={editDraft.assessment} onChange={(event) => setEditDraft({ ...editDraft, assessment: event.target.value })} /></Field><div className="form-grid two-columns"><Field label="Score"><Input type="number" min="0" step="0.01" value={editDraft.score} onChange={(event) => setEditDraft({ ...editDraft, score: event.target.value })} /></Field><Field label="Maximum" required><Input type="number" min="0.01" step="0.01" value={editDraft.maximum} onChange={(event) => setEditDraft({ ...editDraft, maximum: event.target.value })} /></Field></div><Field label="Work status"><Select value={editDraft.workStatus} onChange={(event) => setEditDraft({ ...editDraft, workStatus: event.target.value })}>{WORK_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select></Field><Field label="Feedback"><TextArea rows="4" value={editDraft.feedback || ""} onChange={(event) => setEditDraft({ ...editDraft, feedback: event.target.value })} /></Field></form> : null}
      </Drawer>
      <ConfirmDialog open={Boolean(deleteTarget)} title="Delete grade record?" description={`${deleteTarget?.assessment || "This grade"} will be permanently removed.`} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} busy={saving} />
    </section>
  );
}

function AttendanceView({ state, groups, students, classRows, sessions, language, onOpenSession }) {
  const defaultGroup = groups[0]?.id || "all";
  const defaultMonth = monthKey(state.settings?.selectedMonth || state.settings?.asOfDate) || new Date().toISOString().slice(0, 7);
  const [filters, setFilters] = useState({ groupId: defaultGroup, month: defaultMonth, status: "all" });
  const months = useMemo(() => [...new Set([defaultMonth, ...classRows.map((row) => monthKey(row.classDate)).filter(Boolean)])].sort().reverse(), [classRows, defaultMonth]);
  const visibleSessions = useMemo(() => sessions.filter((session) => monthKey(session.classDate) === filters.month
    && (filters.groupId === "all" || session.groupId === filters.groupId)
    && classRows.some((row) => classSessionKey(row) === session.key && row.classStatus === "Completed" && row.attendance))
    .slice().sort((left, right) => left.classDate.localeCompare(right.classDate) || left.startTime.localeCompare(right.startTime)), [classRows, filters, sessions]);
  const sessionKeys = useMemo(() => new Set(visibleSessions.map((session) => session.key)), [visibleSessions]);
  const visibleClassRows = useMemo(() => classRows.filter((row) => sessionKeys.has(classSessionKey(row))), [classRows, sessionKeys]);
  const attendanceMap = useMemo(() => new Map(visibleClassRows.map((row) => [`${classSessionKey(row)}|${row.studentId}`, row.attendance])), [visibleClassRows]);
  const roster = useMemo(() => students.filter((student) => student.status === "Active" && studentBelongsTo(student, filters.groupId)).filter((student) => {
    if (filters.status === "all") return true;
    return visibleSessions.some((session) => attendanceMap.get(`${session.key}|${student.id}`) === filters.status);
  }), [attendanceMap, filters.groupId, filters.status, students, visibleSessions]);
  const counts = useMemo(() => Object.fromEntries(ATTENDANCE_CODES.map((code) => [code, visibleClassRows.filter((row) => row.attendance === code).length])), [visibleClassRows]);
  const studentStats = useMemo(() => roster.map((student) => ({ student, rate: attendanceRate(visibleSessions.map((session) => attendanceMap.get(`${session.key}|${student.id}`)).filter(Boolean)) })), [attendanceMap, roster, visibleSessions]);
  const insight = studentStats.filter((item) => item.rate != null).sort((left, right) => left.rate - right.rate)[0];

  return (
    <section className="progress-view" role="tabpanel">
      <div className="attendance-toolbar"><Field label="Group"><GroupSelect groups={groups} include={[{ id: "all", name: "All students" }]} value={filters.groupId} onChange={(event) => setFilters({ ...filters, groupId: event.target.value })} /></Field><Field label="Month"><Select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })}>{months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</Select></Field><Field label="Filter"><Select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">All attendance</option>{ATTENDANCE_CODES.map((code) => { const [, label] = attendanceMeta(code, language); return <option key={code} value={code}>{label}</option>; })}</Select></Field></div>
      <div className="attendance-overview">{ATTENDANCE_CODES.map((code) => { const [short, label] = attendanceMeta(code, language); return <div key={code} className={attendanceTone(code)}><span>{short}</span><small>{label}</small><strong>{counts[code]}</strong></div>; })}</div>
      {visibleSessions.length && roster.length ? <div className="attendance-shell" role="region" aria-label="Monthly attendance" tabIndex="0"><table className="attendance-table"><thead><tr><th className="attendance-student-column" scope="col">Student</th>{visibleSessions.map((session) => <th key={session.key} scope="col"><button type="button" onClick={() => onOpenSession(session)}><span>{formatDate(session.classDate, { month: "short", day: "numeric" })}</span><small>{session.startTime || "Class"}</small></button></th>)}<th scope="col">Attendance</th></tr></thead><tbody>{studentStats.map(({ student, rate }) => <tr key={student.id}><th className="attendance-student-column" scope="row"><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.code || "Student"}</small></span></th>{visibleSessions.map((session) => { const code = attendanceMap.get(`${session.key}|${student.id}`); const [short, label] = attendanceMeta(code, language); return <td key={session.key}><span className={`attendance-dot ${attendanceTone(code)}`} title={label}>{short}</span></td>; })}<td><strong>{formatPercent(rate)}</strong></td></tr>)}</tbody></table></div> : <EmptyState icon={CalendarDays} title="No attendance for this month" description="Record a completed class to build the monthly overview." />}
      <div className="attendance-footer"><div>{ATTENDANCE_CODES.map((code) => { const [, label] = attendanceMeta(code, language); return <span key={code}><i className={attendanceTone(code)} />{label}</span>; })}</div><p>Click any date to open that class roster and edit attendance.</p></div>
      {insight ? <button className="attendance-insight" type="button" onClick={() => { const session = [...visibleSessions].reverse().find((item) => attendanceMap.get(`${item.key}|${insight.student.id}`)); if (session) onOpenSession(session); }}><Sparkles aria-hidden="true" size={19} /><span><strong>{insight.student.fullName} may need a quick check-in</strong><small>{formatPercent(insight.rate)} attendance in {formatMonth(filters.month)}</small></span><ChevronRight aria-hidden="true" size={19} /></button> : null}
    </section>
  );
}
