import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock3,
  DollarSign,
  Pencil,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { Button, ConfirmDialog, Drawer, Field, IconButton, Input, Select, TextArea } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { getUiLocale } from "../i18n";
import { normalizeSearchText } from "../utils/searchText";
import { createStableId, DAY_OPTIONS, formatWeeklySchedule } from "../domain";

const EMPTY = Object.freeze({ id: "", name: "", grade: "", subject: "", schedule: "", hourlyRate: null, weeklySchedule: [], plannedSessionsPerMonth: 8, assistantContact: "", notes: "" });
const GROUP_TABS = Object.freeze(["overview", "students", "attendance", "grades", "payments"]);

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function pct(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function GroupEditor({ draft, setDraft, defaultHours, defaultRate }) {
  const addSchedule = () => setDraft((current) => ({ ...current, weeklySchedule: [...current.weeklySchedule, { id: createStableId("slot"), dayOfWeek: 1, startTime: "16:00", durationHours: defaultHours }] }));
  const updateSchedule = (id, patch) => setDraft((current) => ({ ...current, weeklySchedule: current.weeklySchedule.map((slot) => slot.id === id ? { ...slot, ...patch } : slot) }));
  const removeSchedule = (id) => setDraft((current) => ({ ...current, weeklySchedule: current.weeklySchedule.filter((slot) => slot.id !== id) }));
  return (
    <form className="drawer-form" onSubmit={(event) => event.preventDefault()}>
      <Field label="Group name" required><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <div className="form-grid two-columns">
        <Field label="Grade"><Input value={draft.grade} onChange={(event) => setDraft({ ...draft, grade: event.target.value })} /></Field>
        <Field label="Subject"><Input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></Field>
      </div>
      <section className="recurring-schedule-editor" aria-labelledby="weekly-schedule-heading">
        <div className="editor-section-heading"><div><strong id="weekly-schedule-heading">Weekly schedule</strong><small>Add every regular meeting time for this group.</small></div><Button icon={Plus} onClick={addSchedule}>Add time</Button></div>
        <div className="schedule-slot-list">{draft.weeklySchedule.map((slot) => <div className="schedule-slot-row" key={slot.id}><Field label="Day"><Select value={slot.dayOfWeek} onChange={(event) => updateSchedule(slot.id, { dayOfWeek: Number(event.target.value) })}>{DAY_OPTIONS.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</Select></Field><Field label="Time"><Input type="time" value={slot.startTime} onChange={(event) => updateSchedule(slot.id, { startTime: event.target.value })} /></Field><Field label="Hours"><Input type="number" min="0" step="0.25" value={slot.durationHours} onChange={(event) => updateSchedule(slot.id, { durationHours: Number(event.target.value) })} /></Field><IconButton label="Remove meeting time" icon={Trash2} onClick={() => removeSchedule(slot.id)} /></div>)}{!draft.weeklySchedule.length ? <p className="compact-empty">No recurring times yet. Existing manual classes remain unchanged.</p> : null}</div>
      </section>
      <details className="optional-settings"><summary><span><DollarSign size={17} /><strong>Pricing & fallback details</strong></span><small>{Number.isFinite(draft.hourlyRate) ? `${money(draft.hourlyRate)} / hour` : `${money(defaultRate)} / hour inherited`}</small></summary><div className="optional-settings-body"><label className="switch-row pricing-switch"><input type="checkbox" checked={Number.isFinite(draft.hourlyRate)} onChange={(event) => setDraft({ ...draft, hourlyRate: event.target.checked ? defaultRate : null })} /><span aria-hidden="true" /><b>Set a group rate</b></label>{Number.isFinite(draft.hourlyRate) ? <Field label="Group hourly rate"><Input type="number" min="0" step="1" value={draft.hourlyRate} onChange={(event) => setDraft({ ...draft, hourlyRate: Number(event.target.value) })} /><small>MXN / hour</small></Field> : <p>Uses the account default of {money(defaultRate)} per hour.</p>}<Field label="Schedule note / room"><Input value={draft.schedule} onChange={(event) => setDraft({ ...draft, schedule: event.target.value })} placeholder="Optional room or legacy schedule note" /></Field>{!draft.weeklySchedule.length ? <Field label="Planned sessions / month"><Input type="number" min="0" value={draft.plannedSessionsPerMonth} onChange={(event) => setDraft({ ...draft, plannedSessionsPerMonth: Number(event.target.value) })} /></Field> : null}</div></details>
      <Field label="Assistant / contact"><TextArea rows="2" value={draft.assistantContact} onChange={(event) => setDraft({ ...draft, assistantContact: event.target.value })} /></Field>
      <Field label="Notes"><TextArea rows="3" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
    </form>
  );
}

function GroupDetailContent({ tab, group, summary, members, classRows, gradeRows, onManage, navigate }) {
  if (tab === "students") {
    return <article className="detail-card member-card span-two"><header><h2>Members ({members.length})</h2><button type="button" onClick={onManage}>Manage</button></header>{members.map((student) => <div className="member-row" key={student.id}><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.isIndividual ? "Individual + group" : "Group student"}</small></span>{student.isIndividual ? <em>Individual</em> : null}</div>)}{!members.length ? <p>No students assigned yet.</p> : null}</article>;
  }
  if (tab === "attendance") {
    return <article className="detail-card span-two"><header><h2>Attendance history</h2><CalendarDays size={18} /></header>{classRows.map((row) => <div className="history-line" key={row.id}><span>{row.classDate}</span><strong>{row.studentName}</strong><em>{row.attendance || "—"}</em></div>)}{!classRows.length ? <p>No attendance records yet.</p> : null}</article>;
  }
  if (tab === "grades") {
    return <article className="detail-card span-two"><header><h2>Group grades</h2><TrendingUp size={18} /></header>{gradeRows.map((row) => <div className="history-line" key={row.id}><span>{row.date}</span><strong>{row.studentName} · {row.assessment}</strong><em>{pct(row.percentage)}</em></div>)}{!gradeRows.length ? <p>No grades yet.</p> : null}</article>;
  }
  if (tab === "payments") {
    return <article className="detail-card span-two"><header><h2>Payments</h2><button type="button" onClick={() => navigate("payments")}>Open payments</button></header>{classRows.map((row) => <div className="student-payment-line" key={row.id}><span>{row.studentName}<small>{row.classDate} · {row.paymentStatus}</small></span><strong>{money(row.recognizedPaid)}</strong><em>{money(row.outstanding)} pending</em></div>)}{!classRows.length ? <p>No payment records yet.</p> : null}</article>;
  }
  return (
    <>
      <article className="detail-card member-card"><header><h2>Members ({members.length})</h2><button type="button" onClick={onManage}>Manage</button></header>{members.slice(0, 6).map((student) => <div className="member-row" key={student.id}><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.isIndividual ? "Individual + group" : "Group student"}</small></span>{student.isIndividual ? <em>Individual</em> : null}</div>)}{!members.length ? <p>No students assigned yet.</p> : null}</article>
      <article className="detail-card next-class"><header><h2>Group schedule</h2><Clock3 size={18} /></header><strong>{formatWeeklySchedule(group.weeklySchedule) || group.schedule || "Not scheduled"}</strong><p>{Number.isFinite(group.hourlyRate) ? `${money(group.hourlyRate)} per hour · group rate` : `${money(summary.effectiveHourlyRate)} per hour · inherited`}</p><Button variant="primary" onClick={() => navigate("classes")}>Open upcoming classes</Button></article>
      <article className="detail-card"><header><h2>Attendance</h2><CalendarDays size={18} /></header><div className="large-stat">{pct(summary.attendance)}</div><p>Average attendance</p></article>
      <article className="detail-card"><header><h2>Performance</h2><TrendingUp size={18} /></header><div className="large-stat">{pct(summary.averageGrade)}</div><p>Latest group average</p></article>
      <article className="detail-card"><header><h2>Outstanding balances</h2></header><div className="large-stat">{money(summary.outstanding)}</div><p>Across current members</p></article>
      <article className="detail-card quick-list"><header><h2>Quick actions</h2></header><button type="button" onClick={() => navigate("classes")}>Record group class <ChevronRight size={16} /></button><button type="button" onClick={() => navigate("grades")}>Add group grades <ChevronRight size={16} /></button><button type="button" onClick={() => navigate("payments")}>View payments <ChevronRight size={16} /></button></article>
    </>
  );
}

export default function Groups({ state, derived, actions, navigate, registerNavigationBlocker }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detailTab, setDetailTab] = useState("overview");
  const [draft, setDraft] = useState(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef(null);
  const dirty = Boolean(draft) && draftChanged(draft, baselineRef.current);

  useUnsavedChanges(registerNavigationBlocker, dirty, "Discard your unsaved group changes?");
  const changeSelected = useHistoryBackedState({
    key: "group-detail",
    value: selectedId,
    onChange: (value) => { setSelectedId(value); setDetailTab("overview"); },
    defaultValue: "",
    allowedValues: ["", ...state.groups.map((group) => group.id)],
    canChange: () => confirmDiscard(dirty, "Discard your unsaved group changes?"),
  });

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [selectedId]);

  const group = state.groups.find((item) => item.id === selectedId);
  const summary = derived.groups.find((item) => item.id === selectedId) || {};
  const members = useMemo(() => state.students.filter((student) => (student.groupIds || []).includes(selectedId)), [selectedId, state.students]);
  const memberIds = useMemo(() => new Set(members.map((student) => student.id)), [members]);
  const classRows = derived.classLog.filter((row) => row.groupId === selectedId || (!row.groupId && memberIds.has(row.studentId))).slice().sort((left, right) => right.classDate.localeCompare(left.classDate));
  const gradeRows = derived.grades.filter((row) => memberIds.has(row.studentId)).slice().sort((left, right) => right.date.localeCompare(left.date));
  const needle = normalizeSearchText(query);
  const filtered = state.groups.filter((item) => normalizeSearchText([item.name, item.subject, item.grade, item.schedule, formatWeeklySchedule(item.weeklySchedule)].join(" ")).includes(needle));

  const openEditor = (item = EMPTY) => {
    const next = { ...EMPTY, ...item };
    baselineRef.current = next;
    setDraft(next);
  };
  const closeEditor = () => {
    if (!confirmDiscard(dirty, "Discard your unsaved group changes?")) return false;
    baselineRef.current = null;
    setDraft(null);
    return true;
  };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      if (await actions.upsertGroup(draft)) {
        baselineRef.current = null;
        setDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };
  const toggleMember = async (student) => actions.upsertStudent({
    ...student,
    groupIds: (student.groupIds || []).includes(selectedId)
      ? student.groupIds.filter((id) => id !== selectedId)
      : [...(student.groupIds || []), selectedId],
  });

  if (group) {
    return (
      <div className="page detail-page">
        <button className="back-link" type="button" onClick={() => changeSelected("")}><ArrowLeft size={17} />Groups</button>
        <section className="detail-hero"><div className="group-emblem">{group.name.slice(0, 1).toUpperCase()}</div><div className="detail-identity"><h1>{group.name}</h1><p>{formatWeeklySchedule(group.weeklySchedule) || group.schedule || "Schedule not set"} · {members.length} students {group.grade ? `· ${group.grade}` : ""}</p></div><div className="hero-actions"><Button icon={Plus} onClick={() => setMembersOpen(true)}>Add students</Button><Button icon={Pencil} onClick={() => openEditor(group)}>Edit</Button><button className="hero-icon danger" type="button" title="Delete group" aria-label="Delete group" onClick={() => setDeleteOpen(true)}><Trash2 size={18} /></button></div></section>
        <div className="detail-tabs" role="tablist" aria-label="Group details">{GROUP_TABS.map((tab) => <button type="button" role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? "active" : ""} key={tab} onClick={() => setDetailTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
        <section className="group-detail-grid"><GroupDetailContent tab={detailTab} group={group} summary={summary} members={members} classRows={classRows} gradeRows={gradeRows} onManage={() => setMembersOpen(true)} navigate={navigate} /></section>
        <Drawer open={membersOpen} onClose={() => setMembersOpen(false)} title={`Manage ${group.name}`} description="Students can belong to more than one group."><div className="member-picker">{state.students.map((student) => <label key={student.id}><input type="checkbox" checked={(student.groupIds || []).includes(group.id)} onChange={() => toggleMember(student)} /><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.isIndividual ? "Also takes individual classes" : "Group enrollment"}</small></span></label>)}</div></Drawer>
        <Drawer open={Boolean(draft)} onClose={closeEditor} title="Edit group" footer={<><Button onClick={closeEditor}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save group"}</Button></>}>{draft ? <GroupEditor draft={draft} setDraft={setDraft} defaultHours={state.settings.defaultClassHours} defaultRate={state.settings.hourlyRate} /> : null}</Drawer>
        <ConfirmDialog open={deleteOpen} title={`Delete ${group.name}?`} description="Groups with assigned students cannot be deleted. Existing class history remains protected." confirmLabel="Delete group" onClose={() => setDeleteOpen(false)} onConfirm={async () => { if (await actions.deleteGroup(group.id)) { setDeleteOpen(false); changeSelected(""); } }} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-heading"><div><h1>Groups</h1><p>Open any group to see its members, schedule, progress, and balances.</p></div><Button variant="primary" icon={Plus} onClick={() => openEditor()}>Add group</Button></div>
      <label className="page-search"><Search size={17} /><span className="sr-only">Search groups</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search groups" /></label>
      <section className="group-list">{filtered.map((item) => { const itemSummary = derived.groups.find((row) => row.id === item.id) || {}; return <button className="group-row" key={item.id} type="button" onClick={() => changeSelected(item.id)}><span className="group-emblem small">{item.name.slice(0, 1).toUpperCase()}</span><span className="group-main"><strong>{item.name}</strong><small>{formatWeeklySchedule(item.weeklySchedule) || item.schedule || item.subject || "Schedule not set"}</small></span><span><small>Students</small><strong>{itemSummary.activeStudents || 0}</strong></span><span><small>Attendance</small><strong>{pct(itemSummary.attendance)}</strong></span><span><small>Ideal revenue</small><strong>{money(itemSummary.idealRevenue)}</strong></span><ChevronRight size={18} /></button>; })}{!filtered.length ? <div className="empty-box"><UsersRound size={28} /><h2>No groups yet</h2><p>Create your first class group.</p></div> : null}</section>
      <Drawer open={Boolean(draft)} onClose={closeEditor} title={draft?.id ? "Edit group" : "Add group"} footer={<><Button onClick={closeEditor}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save group"}</Button></>}>{draft ? <GroupEditor draft={draft} setDraft={setDraft} defaultHours={state.settings.defaultClassHours} defaultRate={state.settings.hourlyRate} /> : null}</Drawer>
    </div>
  );
}
