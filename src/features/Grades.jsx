import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  SearchInput,
  SectionHeading,
  Select,
  StatusBadge,
  TableShell,
  TextArea,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { todayDateOnly } from "../domain/dates";
import { normalizeSearchText } from "../utils/searchText";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { getUiLocale, useI18n } from "../i18n";

const CATEGORIES = ["Quiz", "Exam", "Project", "Homework", "Participation", "Other"];
const WORK_STATUSES = ["On time", "Late", "Missing", "Excused"];
const UNASSIGNED_GROUP = "__unassigned__";
const today = () => todayDateOnly();
const percentageFor = (score, maximum) => score == null || maximum == null || maximum <= 0 ? null : score / maximum;
const formatPercent = (value) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const formatDate = (value) => value ? new Intl.DateTimeFormat(getUiLocale(), { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`)) : "—";

function toneForWorkStatus(status) {
  if (status === "Missing") return "danger";
  if (status === "Late") return "warning";
  if (status === "Excused") return "info";
  return "success";
}

export default function Grades({ state, derived, actions, intent, clearIntent, registerNavigationBlocker }) {
  const { language } = useI18n();
  const [filters, setFilters] = useState({ groupId: "all", studentId: "all", category: "all", workStatus: "all", search: "" });
  const [batchDraft, setBatchDraft] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const batchBaselineRef = useRef(null);
  const editBaselineRef = useRef(null);

  const groupsById = derived.groupsById || new Map((state.groups || []).map((group) => [group.id, group]));
  const studentsById = derived.studentsById || new Map((state.students || []).map((student) => [student.id, student]));
  const gradeRows = derived.gradeRows || (state.grades || []).map((grade) => {
    const student = studentsById.get(grade.studentId);
    const groupId = student?.groupIds?.[0] || "";
    return { ...grade, studentName: student?.fullName, groupId, groupName: groupsById.get(groupId)?.name, percentage: percentageFor(grade.score, grade.maximum) };
  });
  const batchDirty = Boolean(batchDraft) && draftChanged(batchDraft, batchBaselineRef.current);
  const editDirty = Boolean(editDraft) && draftChanged(editDraft, editBaselineRef.current);

  useUnsavedChanges(registerNavigationBlocker, batchDirty || editDirty, "Discard your unsaved grade changes?");

  const openBatch = useCallback((groupId = "") => {
    const next = createBatchDraft(groupId);
    batchBaselineRef.current = next;
    setBatchDraft(next);
  }, []);

  const openEdit = useCallback((grade) => {
    const next = { ...grade, score: grade.score ?? "" };
    editBaselineRef.current = next;
    setEditDraft(next);
  }, []);

  const closeBatch = () => {
    if (!confirmDiscard(batchDirty, "Discard the grades you entered?")) return false;
    batchBaselineRef.current = null;
    setBatchDraft(null);
    return true;
  };

  const closeEdit = () => {
    if (!confirmDiscard(editDirty, "Discard your unsaved grade changes?")) return false;
    editBaselineRef.current = null;
    setEditDraft(null);
    return true;
  };

  useEffect(() => {
    if (intent !== "add-grades") return;
    openBatch(state.groups?.[0]?.id);
    clearIntent?.();
  }, [clearIntent, intent, openBatch, state.groups]);

  const visibleRows = useMemo(() => {
    const needle = normalizeSearchText(filters.search);
    return [...gradeRows]
      .filter((row) => filters.groupId === "all"
        || (filters.groupId === UNASSIGNED_GROUP ? !row.groupId : row.groupId === filters.groupId))
      .filter((row) => filters.studentId === "all" || row.studentId === filters.studentId)
      .filter((row) => filters.category === "all" || row.category === filters.category)
      .filter((row) => filters.workStatus === "all" || row.workStatus === filters.workStatus)
      .filter((row) => !needle || [row.studentName, row.groupName, row.assessment, row.feedback].some((value) => normalizeSearchText(value).includes(needle)))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [filters, gradeRows]);

  const roster = useMemo(() => {
    if (!batchDraft?.groupId) return [];
    return (state.students || []).filter((student) => student.groupIds?.includes(batchDraft.groupId) && student.status === "Active");
  }, [batchDraft?.groupId, state.students]);

  function createBatchDraft(groupId = "") {
    return { date: today(), groupId: groupId || "", assessment: "", category: "Quiz", maximum: 20, entries: {} };
  }

  const updateEntry = (studentId, patch) => {
    setBatchDraft((current) => ({ ...current, entries: { ...current.entries, [studentId]: { workStatus: "On time", score: "", feedback: "", ...current.entries[studentId], ...patch } } }));
  };

  const saveBatch = async (event) => {
    event.preventDefault();
    const records = roster.flatMap((student) => {
      const entry = batchDraft.entries[student.id] || { score: "", workStatus: "On time", feedback: "" };
      const shouldSave = entry.score !== "" || entry.workStatus !== "On time" || entry.feedback.trim();
      if (!shouldSave) return [];
      return [{
        date: batchDraft.date,
        studentId: student.id,
        assessment: batchDraft.assessment,
        category: batchDraft.category,
        score: entry.score === "" ? null : Number(entry.score),
        maximum: Number(batchDraft.maximum),
        workStatus: entry.workStatus,
        feedback: entry.feedback,
      }];
    });
    setSaving(true);
    try {
      if (await actions.addGrades(records)) {
        batchBaselineRef.current = null;
        setBatchDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (await actions.upsertGrade({ ...editDraft, score: editDraft.score === "" ? null : Number(editDraft.score), maximum: Number(editDraft.maximum) })) {
        editBaselineRef.current = null;
        setEditDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (await actions.deleteGrade(deleteTarget.id)) setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page page-grades">
      <SectionHeading title="Grades" description="Record scores and feedback without retyping student details." actions={<Button variant="primary" icon={Plus} onClick={() => openBatch(state.groups?.[0]?.id)}>Add grades</Button>} />

      <div className="filter-bar grade-filters">
        <Field label="Group"><Select value={filters.groupId} onChange={(event) => setFilters({ ...filters, groupId: event.target.value })}><option value="all">All groups</option><option value={UNASSIGNED_GROUP}>Unassigned</option>{(state.groups || []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></Field>
        <Field label="Student"><Select value={filters.studentId} onChange={(event) => setFilters({ ...filters, studentId: event.target.value })}><option value="all">All students</option>{(state.students || []).map((student) => <option key={student.id} value={student.id}>{student.fullName}</option>)}</Select></Field>
        <Field label="Category"><Select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="all">All categories</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field>
        <Field label="Work status"><Select value={filters.workStatus} onChange={(event) => setFilters({ ...filters, workStatus: event.target.value })}><option value="all">All statuses</option>{WORK_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select></Field>
        <Field label="Search"><SearchInput value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Assessment or feedback" /></Field>
      </div>

      {visibleRows.length ? (
        <TableShell label="Grade records">
          <table className="data-table grades-table">
            <thead><tr><th scope="col">Date</th><th scope="col" className="sticky-cell">Student</th><th scope="col">Group</th><th scope="col">Assessment</th><th scope="col">Category</th><th scope="col" className="numeric">Score</th><th scope="col" className="numeric">Maximum</th><th scope="col" className="numeric">Percentage</th><th scope="col">Work status</th><th scope="col">Feedback / next step</th><th scope="col" aria-label="Actions" /></tr></thead>
            <tbody>{visibleRows.map((row) => {
              const low = row.percentage != null && row.percentage < state.settings.lowGradeThreshold;
              const high = row.percentage != null && row.percentage >= 0.9;
              return (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <th scope="row" className="sticky-cell"><div className="person-cell"><StudentAvatar avatarId={studentsById.get(row.studentId)?.avatarId} name={row.studentName} size="tiny" decorative /><strong>{row.studentName || "Unknown student"}</strong></div></th>
                  <td>{row.groupName || "Unassigned"}</td><td><strong>{row.assessment}</strong></td><td><StatusBadge tone="lilac">{row.category}</StatusBadge></td><td className="numeric">{row.score ?? "—"}</td><td className="numeric">{row.maximum}</td><td className={`numeric score-value ${low ? "is-low" : high ? "is-high" : ""}`}>{formatPercent(row.percentage)}</td><td><StatusBadge tone={toneForWorkStatus(row.workStatus)} icon={row.workStatus === "Missing" ? AlertTriangle : undefined}>{row.workStatus}</StatusBadge></td><td className="wrap-cell">{row.feedback || "—"}</td>
                  <td><div className="row-actions"><IconButton label={`Edit ${row.assessment} for ${row.studentName}`} icon={Pencil} onClick={() => openEdit(row)} /><IconButton label={`Delete ${row.assessment} for ${row.studentName}`} icon={Trash2} onClick={() => setDeleteTarget(row)} /></div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </TableShell>
      ) : <EmptyState icon={CalendarDays} title="No grades match" description="Adjust your filters or add grade records." action={<Button icon={Plus} onClick={() => openBatch(state.groups?.[0]?.id)}>Add grades</Button>} />}

      <div className="table-footer"><span>Showing {visibleRows.length} of {gradeRows.length} grades</span><span>Blank scores are excluded; an entered zero counts.</span></div>

      <Drawer
        open={Boolean(batchDraft)}
        onClose={closeBatch}
        title="Add grades"
        description="Enter one assessment for a whole roster. Blank untouched rows are skipped."
        size="wide"
        footer={<><Button onClick={closeBatch} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="batch-grade-form" disabled={saving}>{saving ? "Saving…" : "Save grades"}</Button></>}
      >
        {batchDraft ? <form id="batch-grade-form" className="drawer-form" onSubmit={saveBatch}>
          <div className="form-grid two-columns"><Field label="Date" required><Input type="date" value={batchDraft.date} onChange={(event) => setBatchDraft({ ...batchDraft, date: event.target.value })} /></Field><Field label="Group" required><Select value={batchDraft.groupId} onChange={(event) => {
            if (Object.keys(batchDraft.entries).length && !confirmDiscard(true, "Changing groups clears the scores you entered. Continue?")) return;
            setBatchDraft({ ...batchDraft, groupId: event.target.value, entries: {} });
          }}><option value="">Choose group</option>{(state.groups || []).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></Field></div>
          <Field label="Assessment" required><Input value={batchDraft.assessment} onChange={(event) => setBatchDraft({ ...batchDraft, assessment: event.target.value })} placeholder="e.g. Linear equations quiz" /></Field>
          <div className="form-grid two-columns"><Field label="Category"><Select value={batchDraft.category} onChange={(event) => setBatchDraft({ ...batchDraft, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field><Field label="Maximum" required><Input type="number" inputMode="decimal" min="0.01" step="0.01" value={batchDraft.maximum} onChange={(event) => setBatchDraft({ ...batchDraft, maximum: event.target.value })} /></Field></div>
          <div className="drawer-section-heading"><div><h3>Enter scores</h3><p>{roster.length} {language === "es"
            ? (roster.length === 1 ? "alumno activo en este grupo" : "alumnos activos en este grupo")
            : (roster.length === 1 ? "active student in this group" : "active students in this group")}</p></div></div>
          <div className="roster-list">
            {roster.map((student) => {
              const entry = batchDraft.entries[student.id] || { score: "", workStatus: "On time", feedback: "" };
              return <div className="grade-roster-row" key={student.id}><div className="person-cell"><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><strong>{student.fullName}</strong></div><Field label="Score"><Input aria-label={`Score for ${student.fullName}`} type="number" inputMode="decimal" min="0" step="0.01" value={entry.score} onChange={(event) => updateEntry(student.id, { score: event.target.value })} /></Field><Field label="Work status"><Select aria-label={`Work status for ${student.fullName}`} value={entry.workStatus} onChange={(event) => updateEntry(student.id, { workStatus: event.target.value })}>{WORK_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select></Field><Field label="Feedback"><Input aria-label={`Feedback for ${student.fullName}`} value={entry.feedback} onChange={(event) => updateEntry(student.id, { feedback: event.target.value })} /></Field></div>;
            })}
          </div>
        </form> : null}
      </Drawer>

      <Drawer open={Boolean(editDraft)} onClose={closeEdit} title="Edit grade" footer={<><Button onClick={closeEdit} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="edit-grade-form" disabled={saving}>{saving ? "Saving…" : "Save grade"}</Button></>}>
        {editDraft ? <form id="edit-grade-form" className="drawer-form" onSubmit={saveEdit}>
          <Field label="Student"><Input value={editDraft.studentName || studentsById.get(editDraft.studentId)?.fullName || ""} disabled /></Field>
          <div className="form-grid two-columns"><Field label="Date" required><Input type="date" value={editDraft.date} onChange={(event) => setEditDraft({ ...editDraft, date: event.target.value })} /></Field><Field label="Category"><Select value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value })}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Select></Field></div>
          <Field label="Assessment" required><Input value={editDraft.assessment} onChange={(event) => setEditDraft({ ...editDraft, assessment: event.target.value })} /></Field>
          <div className="form-grid two-columns"><Field label="Score"><Input type="number" inputMode="decimal" min="0" step="0.01" value={editDraft.score} onChange={(event) => setEditDraft({ ...editDraft, score: event.target.value })} /></Field><Field label="Maximum" required><Input type="number" inputMode="decimal" min="0.01" step="0.01" value={editDraft.maximum} onChange={(event) => setEditDraft({ ...editDraft, maximum: event.target.value })} /></Field></div>
          <Field label="Work status"><Select value={editDraft.workStatus} onChange={(event) => setEditDraft({ ...editDraft, workStatus: event.target.value })}>{WORK_STATUSES.map((status) => <option key={status}>{status}</option>)}</Select></Field>
          <Field label="Feedback / next step"><TextArea rows="5" value={editDraft.feedback || ""} onChange={(event) => setEditDraft({ ...editDraft, feedback: event.target.value })} /></Field>
        </form> : null}
      </Drawer>

      <ConfirmDialog open={Boolean(deleteTarget)} title="Delete grade record?" description={`${deleteTarget?.assessment || "This grade"} will be permanently removed.`} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} busy={saving} />
    </div>
  );
}
