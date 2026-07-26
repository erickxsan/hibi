import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  Filter,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button, ConfirmDialog, Drawer, Field, Input, Select, TextArea } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { studentMatchesFilters } from "../domain/studentFilters";
import { formatWeeklySchedule } from "../domain";
import { getUiLocale, useI18n } from "../i18n";
import { normalizeSearchText } from "../utils/searchText";
import { EnrollmentTags, StudentEditor } from "./Students";
import { GroupEditor } from "./Groups";

const COMMUNITY_VIEWS = Object.freeze(["all", "students", "groups"]);
const EMPTY_STUDENT = Object.freeze({
  id: "",
  code: "",
  fullName: "",
  avatarId: "cat",
  groupIds: [],
  isIndividual: false,
  customHourlyRate: null,
  phone: "",
  guardianContact: "",
  notes: "",
  status: "Active",
});
const EMPTY_GROUP = Object.freeze({
  id: "",
  name: "",
  grade: "",
  subject: "",
  schedule: "",
  hourlyRate: null,
  weeklySchedule: [],
  plannedSessionsPerMonth: 8,
  assistantContact: "",
  notes: "",
});

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function pct(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function cloneStudent(student = EMPTY_STUDENT) {
  return {
    ...EMPTY_STUDENT,
    ...student,
    code: student.code ?? student.studentCode ?? "",
    phone: student.phone ?? student.studentPhone ?? "",
    notes: student.notes ?? student.importantNotes ?? "",
    groupIds: [...(student.groupIds || (student.groupId ? [student.groupId] : []))],
  };
}

function cloneGroup(group = EMPTY_GROUP) {
  return {
    ...EMPTY_GROUP,
    ...group,
    weeklySchedule: (group.weeklySchedule || []).map((slot) => ({ ...slot })),
  };
}

function initialCommunityView(explicitView) {
  if (COMMUNITY_VIEWS.includes(explicitView)) return explicitView;
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/students")) return "students";
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/groups")) return "groups";
  return "all";
}

function CommunityTabs({ value, onChange }) {
  return (
    <div className="community-tabs" role="tablist" aria-label="Community views">
      {[
        ["all", "All"],
        ["students", "Students"],
        ["groups", "Groups"],
      ].map(([id, label]) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === id}
          className={value === id ? "active" : ""}
          key={id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function StudentFilters({ state, status, setStatus, filters, setFilters }) {
  const activeCount = filters.groupIds.length + filters.enrollment.length + (status === "all" ? 0 : 1);
  return (
    <details className="student-filter-menu community-filter-menu">
      <summary aria-label="Filter students"><Filter size={15} />Filters{activeCount ? <span className="filter-count">{activeCount}</span> : null}</summary>
      <div className="student-filter-panel">
        <div className="filter-panel-heading"><strong>Filter students</strong>{activeCount ? <button type="button" onClick={() => { setStatus("all"); setFilters({ groupIds: [], groupMatch: "any", enrollment: [] }); }}>Clear all</button> : null}</div>
        <fieldset><legend>Status</legend><div className="filter-status-options" role="group" aria-label="Filter students by status">{[["all", "All statuses"], ["Active", "Active"], ["Inactive", "Inactive"]].map(([id, label]) => <button key={id} type="button" className={status === id ? "active" : ""} aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}</div></fieldset>
        <fieldset><legend>Enrollment</legend>{[["individual", "Individual only"], ["group", "Group classes"], ["both", "Individual + group"]].map(([id, label]) => <label key={id}><input type="checkbox" checked={filters.enrollment.includes(id)} onChange={() => setFilters((current) => ({ ...current, enrollment: current.enrollment.includes(id) ? current.enrollment.filter((item) => item !== id) : [...current.enrollment, id] }))} />{label}</label>)}</fieldset>
        <fieldset><legend>Groups</legend><div className="filter-group-list">{state.groups.map((group) => <label key={group.id}><input type="checkbox" checked={filters.groupIds.includes(group.id)} onChange={() => setFilters((current) => ({ ...current, groupIds: current.groupIds.includes(group.id) ? current.groupIds.filter((id) => id !== group.id) : [...current.groupIds, group.id] }))} />{group.name}</label>)}</div>{filters.groupIds.length > 1 ? <div className="filter-match"><span>Match</span><button type="button" className={filters.groupMatch === "any" ? "active" : ""} onClick={() => setFilters((current) => ({ ...current, groupMatch: "any" }))}>Any</button><button type="button" className={filters.groupMatch === "all" ? "active" : ""} onClick={() => setFilters((current) => ({ ...current, groupMatch: "all" }))}>All</button></div> : null}</fieldset>
      </div>
    </details>
  );
}

function RowMenu({ label, onEdit, onDelete, onArchive }) {
  return (
    <details className="community-row-menu">
      <summary aria-label={`More actions for ${label}`}><EllipsisVertical size={18} /></summary>
      <div>
        <button type="button" onClick={onEdit}><Pencil size={14} />Edit all details</button>
        {onArchive ? <button type="button" onClick={onArchive}>Deactivate</button> : null}
        <button type="button" className="danger" onClick={onDelete}><Trash2 size={14} />Delete</button>
      </div>
    </details>
  );
}

function StudentRows({ students, selectedId, onSelect, onEdit, onArchive, onDelete, groupsById }) {
  return (
    <div className="community-table community-student-table" role="table" aria-label="Students">
      <div className="community-table-head" role="row"><span>Student</span><span>Phone</span><span>Group(s)</span><span>Status</span><span>Actions</span></div>
      {students.map((student) => (
        <div className={selectedId === student.id ? "community-table-row selected" : "community-table-row"} role="row" key={student.id}>
          <button type="button" className="community-row-primary" onClick={() => onSelect(student.id)} aria-label={`Open ${student.fullName}`}>
            <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
            <span><strong>{student.fullName}</strong><small>{student.code}</small></span>
          </button>
          <span className="community-phone">{student.phone || "No phone"}</span>
          <EnrollmentTags student={student} groupsById={groupsById} />
          <span className={student.status === "Active" ? "record-status active" : "record-status"}>{student.status}</span>
          <span className="community-row-actions"><Button icon={Pencil} onClick={() => onEdit(student)}>Edit</Button><RowMenu label={student.fullName} onEdit={() => onEdit(student)} onArchive={student.status === "Active" ? () => onArchive(student) : null} onDelete={() => onDelete(student)} /></span>
        </div>
      ))}
    </div>
  );
}

function GroupRows({ groups, summaries, selectedId, onSelect, onEdit, onDelete }) {
  return (
    <div className="community-table community-group-table" role="table" aria-label="Groups">
      <div className="community-table-head" role="row"><span>Group</span><span>Schedule</span><span>Students</span><span>Attendance</span><span>Actions</span></div>
      {groups.map((group) => {
        const summary = summaries.find((item) => item.id === group.id) || {};
        return (
          <div className={selectedId === group.id ? "community-table-row selected" : "community-table-row"} role="row" key={group.id}>
            <button type="button" className="community-row-primary" onClick={() => onSelect(group.id)} aria-label={`Open ${group.name}`}>
              <span className="community-group-emblem"><UsersRound size={20} /></span>
              <span><strong>{group.name}</strong><small>{group.subject || group.grade || "Group"}</small></span>
            </button>
            <span className="community-phone">{formatWeeklySchedule(group.weeklySchedule) || group.schedule || "Not scheduled"}</span>
            <strong>{summary.activeStudents || 0}</strong>
            <strong>{pct(summary.attendance)}</strong>
            <span className="community-row-actions"><Button icon={Pencil} onClick={() => onEdit(group)}>Edit</Button><RowMenu label={group.name} onEdit={() => onEdit(group)} onDelete={() => onDelete(group)} /></span>
          </div>
        );
      })}
    </div>
  );
}

function ListPanel({ view, students, groups, derived, selected, onSelectStudent, onSelectGroup, onEditStudent, onEditGroup, onArchiveStudent, onDeleteStudent, onDeleteGroup, groupsById, state, status, setStatus, filters, setFilters }) {
  const showStudents = view !== "groups";
  const showGroups = view !== "students";
  return (
    <section className="community-list-panel" aria-label="Community directory">
      {showStudents ? <section className="community-list-section">
        <header className="community-panel-heading"><span className="community-heading-icon"><UserRound size={23} /></span><span><h2>Students</h2><p>Manage every student in one place.</p></span>{view === "students" ? <StudentFilters state={state} status={status} setStatus={setStatus} filters={filters} setFilters={setFilters} /> : null}</header>
        {students.length ? <StudentRows students={students} selectedId={selected.type === "student" ? selected.id : ""} onSelect={onSelectStudent} onEdit={onEditStudent} onArchive={onArchiveStudent} onDelete={onDeleteStudent} groupsById={groupsById} /> : <div className="community-empty"><UserRound size={24} /><strong>No students found</strong><span>Add a student or adjust your search and filters.</span></div>}
        <footer className="community-list-footer"><span>Showing {students.length} {students.length === 1 ? "student" : "students"}</span><div><button type="button" disabled aria-label="Previous page"><ChevronLeft size={17} /></button><b>1</b><button type="button" disabled aria-label="Next page"><ChevronRight size={17} /></button></div></footer>
      </section> : null}
      {showGroups ? <section className={showStudents ? "community-list-section community-secondary-list" : "community-list-section"}>
        <header className="community-panel-heading"><span className="community-heading-icon"><UsersRound size={23} /></span><span><h2>Groups</h2><p>Create schedules and organize students.</p></span></header>
        {groups.length ? <GroupRows groups={groups} summaries={derived.groups || []} selectedId={selected.type === "group" ? selected.id : ""} onSelect={onSelectGroup} onEdit={onEditGroup} onDelete={onDeleteGroup} /> : <div className="community-empty"><UsersRound size={24} /><strong>No groups found</strong><span>Create a group or adjust your search.</span></div>}
        <footer className="community-list-footer"><span>Showing {groups.length} {groups.length === 1 ? "group" : "groups"}</span><div><button type="button" disabled aria-label="Previous page"><ChevronLeft size={17} /></button><b>1</b><button type="button" disabled aria-label="Next page"><ChevronRight size={17} /></button></div></footer>
      </section> : null}
    </section>
  );
}

function StudentDetail({ student, draft, setDraft, groupsById, state, onEdit, onSave, onArchive, saving }) {
  const { t } = useI18n();
  const groupIds = draft?.groupIds || [];
  return (
    <section className="community-detail-panel" aria-labelledby="community-student-detail-title">
      <header className="community-detail-heading"><span className="community-heading-icon"><UserRound size={22} /></span><h2 id="community-student-detail-title">Student details</h2><ChevronDown size={19} aria-hidden="true" /></header>
      <div className="community-detail-body">
        <div className="community-profile"><button type="button" className="community-avatar-button" onClick={onEdit} aria-label="Change student avatar"><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="large" /></button><span><strong>{student.fullName}</strong><small>{student.code}</small><em className={student.status === "Active" ? "record-status active" : "record-status"}>{student.status}</em></span></div>
        <div className="community-detail-form">
          <Field label="Full name"><Input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></Field>
          <Field label="Phone"><Input type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></Field>
          <Field label="Status"><Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option>Active</option><option>Inactive</option></Select></Field>
          <Field label="Brief notes"><TextArea rows="3" maxLength="250" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /><small className="community-character-count">{draft.notes.length}/250</small></Field>
        </div>
        <section className="community-assignment"><h3>Assigned groups</h3><div>{groupIds.map((id) => groupsById.get(id)).filter(Boolean).map((group) => { const memberCount = state.students.filter((item) => (item.groupIds || []).includes(group.id)).length; return <article key={group.id}><span className="community-group-emblem"><UsersRound size={19} /></span><span><strong>{group.name}</strong><small>{t(`${memberCount} ${memberCount === 1 ? "member" : "members"}`)}</small></span></article>; })}</div>{!groupIds.length ? <p>No groups assigned. This student can still take individual classes.</p> : null}<button type="button" onClick={onEdit}><Plus size={16} />Add to a group</button></section>
      </div>
      <footer className="community-detail-footer"><Button variant="danger" className="community-danger-action" icon={Trash2} onClick={onArchive} disabled={student.status !== "Active"}>Deactivate student</Button><Button variant="primary" icon={Save} onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></footer>
    </section>
  );
}

function GroupDetail({ group, draft, setDraft, summary, members, onEdit, onManage, onSave, onDelete, saving }) {
  return (
    <section className="community-detail-panel" aria-labelledby="community-group-detail-title">
      <header className="community-detail-heading"><span className="community-heading-icon"><UsersRound size={22} /></span><h2 id="community-group-detail-title">Group details</h2><ChevronDown size={19} aria-hidden="true" /></header>
      <div className="community-detail-body">
        <div className="community-profile"><span className="community-group-emblem large"><UsersRound size={29} /></span><span><strong>{group.name}</strong><small>{formatWeeklySchedule(group.weeklySchedule) || group.schedule || "Not scheduled"}</small><em className="record-status active">{members.length} {members.length === 1 ? "student" : "students"}</em></span></div>
        <div className="community-detail-form">
          <Field label="Group name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <div className="form-grid two-columns"><Field label="Grade"><Input value={draft.grade} onChange={(event) => setDraft({ ...draft, grade: event.target.value })} /></Field><Field label="Subject"><Input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></Field></div>
          <Field label="Notes"><TextArea rows="3" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
        </div>
        <section className="community-group-metrics"><article><small>Attendance</small><strong>{pct(summary.attendance)}</strong></article><article><small>Ideal revenue</small><strong>{money(summary.idealRevenue)}</strong></article></section>
        <section className="community-assignment"><h3>Students</h3><div>{members.slice(0, 6).map((student) => <article key={student.id}><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.isIndividual ? "Individual + group" : "Group student"}</small></span></article>)}</div>{!members.length ? <p>No students assigned yet.</p> : null}<button type="button" onClick={onManage}><Plus size={16} />Manage students</button><button type="button" className="community-edit-all" onClick={onEdit}><Pencil size={15} />Edit schedule and pricing</button></section>
      </div>
      <footer className="community-detail-footer"><Button variant="danger" className="community-danger-action" icon={Trash2} onClick={onDelete}>Delete group</Button><Button variant="primary" icon={Save} onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></footer>
    </section>
  );
}

export default function Community({ state, derived, actions, intent, clearIntent, initialView, registerNavigationBlocker }) {
  const [view, setView] = useState(() => initialCommunityView(initialView));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState({ groupIds: [], groupMatch: "any", enrollment: [] });
  const [selected, setSelected] = useState({ type: "student", id: state.students[0]?.id || "" });
  const [studentDraft, setStudentDraft] = useState(null);
  const [groupDraft, setGroupDraft] = useState(null);
  const [studentEditorDraft, setStudentEditorDraft] = useState(null);
  const [groupEditorDraft, setGroupEditorDraft] = useState(null);
  const [membersGroupId, setMembersGroupId] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const studentBaseline = useRef(null);
  const groupBaseline = useRef(null);
  const studentEditorBaseline = useRef(null);
  const groupEditorBaseline = useRef(null);
  const groupsById = derived.groupsById || new Map(state.groups.map((group) => [group.id, group]));

  const studentDirty = Boolean(studentDraft) && draftChanged(studentDraft, studentBaseline.current);
  const groupDirty = Boolean(groupDraft) && draftChanged(groupDraft, groupBaseline.current);
  const studentEditorDirty = Boolean(studentEditorDraft) && draftChanged(studentEditorDraft, studentEditorBaseline.current);
  const groupEditorDirty = Boolean(groupEditorDraft) && draftChanged(groupEditorDraft, groupEditorBaseline.current);
  const dirty = studentDirty || groupDirty || studentEditorDirty || groupEditorDirty;
  useUnsavedChanges(registerNavigationBlocker, dirty, "Discard your unsaved community changes?");

  const changeView = useHistoryBackedState({
    key: "community-view",
    value: view,
    onChange: setView,
    defaultValue: initialCommunityView(initialView),
    allowedValues: COMMUNITY_VIEWS,
    canChange: () => confirmDiscard(dirty, "Discard your unsaved community changes?"),
  });

  const needle = normalizeSearchText(query);
  const visibleStudents = useMemo(() => state.students.filter((student) => {
    if (status !== "all" && student.status !== status) return false;
    if (!studentMatchesFilters(student, filters)) return false;
    const groupNames = (student.groupIds || []).map((id) => groupsById.get(id)?.name || "");
    return normalizeSearchText([student.fullName, student.code, student.phone, student.guardianContact, ...groupNames].join(" ")).includes(needle);
  }), [filters, groupsById, needle, state.students, status]);
  const visibleGroups = useMemo(() => state.groups.filter((group) => normalizeSearchText([group.name, group.subject, group.grade, group.schedule, formatWeeklySchedule(group.weeklySchedule)].join(" ")).includes(needle)), [needle, state.groups]);

  const selectedStudent = selected.type === "student" ? state.students.find((item) => item.id === selected.id) : null;
  const selectedGroup = selected.type === "group" ? state.groups.find((item) => item.id === selected.id) : null;
  const groupSummary = selectedGroup ? derived.groups.find((item) => item.id === selectedGroup.id) || {} : {};
  const groupMembers = useMemo(() => selectedGroup ? state.students.filter((student) => (student.groupIds || []).includes(selectedGroup.id)) : [], [selectedGroup, state.students]);
  const membersGroup = state.groups.find((group) => group.id === membersGroupId);

  useEffect(() => {
    if (!selectedStudent) return;
    const next = cloneStudent(selectedStudent);
    studentBaseline.current = next;
    setStudentDraft(next);
    setGroupDraft(null);
  }, [selectedStudent]);
  useEffect(() => {
    if (!selectedGroup) return;
    const next = cloneGroup(selectedGroup);
    groupBaseline.current = next;
    setGroupDraft(next);
    setStudentDraft(null);
  }, [selectedGroup]);
  useEffect(() => {
    const wantsStudents = view === "students";
    const wantsGroups = view === "groups";
    if (wantsStudents && (!selectedStudent || !visibleStudents.some((item) => item.id === selectedStudent.id))) setSelected({ type: "student", id: visibleStudents[0]?.id || "" });
    if (wantsGroups && (!selectedGroup || !visibleGroups.some((item) => item.id === selectedGroup.id))) setSelected({ type: "group", id: visibleGroups[0]?.id || "" });
    if (view === "all" && !selectedStudent && !selectedGroup) {
      if (visibleStudents[0]) setSelected({ type: "student", id: visibleStudents[0].id });
      else if (visibleGroups[0]) setSelected({ type: "group", id: visibleGroups[0].id });
    }
  }, [selectedGroup, selectedStudent, view, visibleGroups, visibleStudents]);

  const selectRecord = (type, id) => {
    if (!confirmDiscard(studentDirty || groupDirty, "Discard your unsaved community changes?")) return;
    setSelected({ type, id });
  };
  const openStudentEditor = (student = EMPTY_STUDENT) => {
    const next = cloneStudent(student);
    studentEditorBaseline.current = next;
    setStudentEditorDraft(next);
  };
  const closeStudentEditor = () => {
    if (!confirmDiscard(studentEditorDirty, "Discard your unsaved student changes?")) return false;
    studentEditorBaseline.current = null;
    setStudentEditorDraft(null);
    return true;
  };
  const openGroupEditor = (group = EMPTY_GROUP) => {
    const next = cloneGroup(group);
    groupEditorBaseline.current = next;
    setGroupEditorDraft(next);
  };
  const closeGroupEditor = () => {
    if (!confirmDiscard(groupEditorDirty, "Discard your unsaved group changes?")) return false;
    groupEditorBaseline.current = null;
    setGroupEditorDraft(null);
    return true;
  };

  useEffect(() => {
    if (intent === "students" || intent === "groups" || intent === "all") changeView(intent, { replace: true });
    if (intent === "add-student") openStudentEditor();
    if (intent === "add-group") openGroupEditor();
    if (intent) clearIntent?.();
  // Intent actions use the latest editor defaults and are consumed once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const runSave = async (task) => {
    if (saving) return false;
    setSaving(true);
    try { return await task(); } finally { setSaving(false); }
  };
  const saveStudentDetail = () => runSave(async () => {
    if (!studentDraft) return false;
    const saved = await actions.upsertStudent(studentDraft);
    if (saved) studentBaseline.current = cloneStudent(studentDraft);
    return saved;
  });
  const saveGroupDetail = () => runSave(async () => {
    if (!groupDraft) return false;
    const saved = await actions.upsertGroup(groupDraft);
    if (saved) groupBaseline.current = cloneGroup(groupDraft);
    return saved;
  });
  const saveStudentEditor = () => runSave(async () => {
    if (!studentEditorDraft) return false;
    const saved = await actions.upsertStudent(studentEditorDraft);
    if (saved) {
      const id = studentEditorDraft.id || state.students.at(-1)?.id;
      studentEditorBaseline.current = null;
      setStudentEditorDraft(null);
      if (id) setSelected({ type: "student", id });
      changeView("students", { replace: true });
    }
    return saved;
  });
  const saveGroupEditor = () => runSave(async () => {
    if (!groupEditorDraft) return false;
    const saved = await actions.upsertGroup(groupEditorDraft);
    if (saved) {
      groupEditorBaseline.current = null;
      setGroupEditorDraft(null);
      if (groupEditorDraft.id) setSelected({ type: "group", id: groupEditorDraft.id });
      changeView("groups", { replace: true });
    }
    return saved;
  });
  const toggleMember = async (student) => {
    if (!membersGroup) return;
    await actions.upsertStudent({
      ...student,
      groupIds: (student.groupIds || []).includes(membersGroup.id)
        ? student.groupIds.filter((id) => id !== membersGroup.id)
        : [...(student.groupIds || []), membersGroup.id],
    });
  };

  const confirmAction = async () => {
    const target = confirmTarget;
    if (!target) return;
    let completed = false;
    if (target.action === "archive-student") completed = await actions.archiveStudent(target.item.id);
    if (target.action === "delete-student") completed = await actions.deleteStudent(target.item.id);
    if (target.action === "delete-group") completed = await actions.deleteGroup(target.item.id);
    if (completed) {
      setConfirmTarget(null);
      if (selected.id === target.item.id) setSelected({ type: target.action === "delete-group" ? "student" : "group", id: "" });
    }
  };

  return (
    <div className="page community-page">
      <header className="community-page-heading"><div><h1>Community</h1><p>Manage students and groups in one place, quickly and simply.</p></div><div><Button variant="primary" icon={Plus} onClick={() => openStudentEditor()}>Add student</Button><Button icon={UsersRound} onClick={() => openGroupEditor()}>Create group</Button></div></header>
      <div className="community-toolbar"><label className="community-search"><Search size={19} aria-hidden="true" /><span className="sr-only">Search students or groups</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students or groups" /></label><CommunityTabs value={view} onChange={changeView} /></div>
      <div className="community-layout">
        <ListPanel view={view} students={visibleStudents} groups={visibleGroups} derived={derived} selected={selected} onSelectStudent={(id) => selectRecord("student", id)} onSelectGroup={(id) => selectRecord("group", id)} onEditStudent={openStudentEditor} onEditGroup={openGroupEditor} onArchiveStudent={(item) => setConfirmTarget({ action: "archive-student", item })} onDeleteStudent={(item) => setConfirmTarget({ action: "delete-student", item })} onDeleteGroup={(item) => setConfirmTarget({ action: "delete-group", item })} groupsById={groupsById} state={state} status={status} setStatus={setStatus} filters={filters} setFilters={setFilters} />
        {selectedStudent && studentDraft ? <StudentDetail student={selectedStudent} draft={studentDraft} setDraft={setStudentDraft} groupsById={groupsById} state={state} onEdit={() => openStudentEditor(selectedStudent)} onSave={saveStudentDetail} onArchive={() => setConfirmTarget({ action: "archive-student", item: selectedStudent })} saving={saving} /> : null}
        {selectedGroup && groupDraft ? <GroupDetail group={selectedGroup} draft={groupDraft} setDraft={setGroupDraft} summary={groupSummary} members={groupMembers} onEdit={() => openGroupEditor(selectedGroup)} onManage={() => setMembersGroupId(selectedGroup.id)} onSave={saveGroupDetail} onDelete={() => setConfirmTarget({ action: "delete-group", item: selectedGroup })} saving={saving} /> : null}
        {!selectedStudent && !selectedGroup ? <section className="community-detail-panel community-detail-empty"><span className="community-heading-icon"><UsersRound size={24} /></span><h2>Select a student or group</h2><p>Details and editing tools will appear here.</p></section> : null}
      </div>

      <Drawer open={Boolean(studentEditorDraft)} onClose={closeStudentEditor} title={studentEditorDraft?.id ? "Edit student" : "Add student"} description="Use individual classes, one or many groups, or both." footer={<><Button onClick={closeStudentEditor}>Cancel</Button><Button variant="primary" onClick={saveStudentEditor} disabled={saving}>{saving ? "Saving…" : "Save student"}</Button></>}>
        {studentEditorDraft ? <StudentEditor draft={studentEditorDraft} setDraft={setStudentEditorDraft} groups={state.groups} defaultRate={state.settings.hourlyRate} /> : null}
      </Drawer>
      <Drawer open={Boolean(groupEditorDraft)} onClose={closeGroupEditor} title={groupEditorDraft?.id ? "Edit group" : "Create group"} footer={<><Button onClick={closeGroupEditor}>Cancel</Button><Button variant="primary" onClick={saveGroupEditor} disabled={saving}>{saving ? "Saving…" : "Save group"}</Button></>}>
        {groupEditorDraft ? <GroupEditor draft={groupEditorDraft} setDraft={setGroupEditorDraft} defaultHours={state.settings.defaultClassHours} defaultRate={state.settings.hourlyRate} /> : null}
      </Drawer>
      <Drawer open={Boolean(membersGroup)} onClose={() => setMembersGroupId("")} title={membersGroup ? `Manage ${membersGroup.name}` : "Manage group"} description="Students can belong to more than one group.">
        <div className="member-picker">{state.students.map((student) => <label key={student.id}><input type="checkbox" checked={(student.groupIds || []).includes(membersGroup?.id)} onChange={() => toggleMember(student)} /><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.isIndividual ? "Also takes individual classes" : "Group enrollment"}</small></span></label>)}</div>
      </Drawer>
      <ConfirmDialog open={Boolean(confirmTarget)} title={confirmTarget?.action === "archive-student" ? `Deactivate ${confirmTarget.item.fullName}?` : `Delete ${confirmTarget?.item?.fullName || confirmTarget?.item?.name}?`} description={confirmTarget?.action === "archive-student" ? "The student becomes inactive while grades, attendance, and payment history stay available." : confirmTarget?.action === "delete-student" ? "Students with grades or class history cannot be deleted; deactivate them instead." : "Groups with assigned students cannot be deleted. Existing class history remains protected."} confirmLabel={confirmTarget?.action === "archive-student" ? "Deactivate student" : confirmTarget?.action === "delete-group" ? "Delete group" : "Delete student"} tone={confirmTarget?.action === "archive-student" ? "primary" : "danger"} onClose={() => setConfirmTarget(null)} onConfirm={confirmAction} />
    </div>
  );
}
