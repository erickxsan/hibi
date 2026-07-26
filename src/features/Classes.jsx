import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Filter,
  Hourglass,
  Minus,
  Plus,
  Save,
  Search,
  Star,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Button, Drawer, EmptyState, Field, Input, Select, StatusBadge } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { dayOfWeekForDate, resolveHourlyRate } from "../domain";
import { todayDateOnly } from "../domain/dates";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { getUiLocale } from "../i18n";
import { playHibiSound } from "../utils/hibiSounds";
import {
  buildClassWorkspaceSessions,
  classWorkspaceSessionKey,
  filterClassHistory,
  paymentRecordState,
  rosterForClassSession,
  selectPrimaryClassSession,
} from "./classesWorkspaceModel";

const DAY_OPTIONS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
];
const PAGE_SIZE = 8;

function formatDate(value, options = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(getUiLocale(), options).format(new Date(`${value}T12:00:00`));
}

function formatTime(value) {
  if (!value) return "—";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(getUiLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, hour, minute));
}

function currentTimeForDate(date) {
  if (date !== todayDateOnly()) return "23:59";
  return new Date().toLocaleTimeString("en-CA", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function statusTone(status) {
  if (status === "Registered") return "success";
  if (status === "Cancelled") return "danger";
  if (status === "Rescheduled" || status === "Pending") return "warning";
  return "info";
}

function initialScheduleDraft(asOfDate, state) {
  const firstGroup = state.groups?.[0];
  const firstStudent = state.students?.find((student) => student.status !== "Inactive");
  return {
    recurrence: "weekly",
    format: firstGroup ? "group" : "individual",
    groupId: firstGroup?.id || "",
    studentId: firstStudent?.id || "",
    startDate: asOfDate,
    startTime: "10:00",
    durationHours: state.settings?.defaultClassHours || 2,
    intervalWeeks: 1,
    daysOfWeek: [dayOfWeekForDate(asOfDate)],
  };
}

function NewClassDrawer({ open, onClose, state, asOfDate, actions }) {
  const [draft, setDraft] = useState(() => initialScheduleDraft(asOfDate, state));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setDraft(initialScheduleDraft(asOfDate, state));
  }, [asOfDate, open, state]);
  const ownerReady = draft.format === "group" ? Boolean(draft.groupId) : Boolean(draft.studentId);
  const valid = ownerReady && draft.startDate && draft.startTime && Number(draft.durationHours) > 0
    && (draft.recurrence === "once" || draft.daysOfWeek.length > 0);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const save = async () => {
    if (!valid || !actions.upsertClassSchedule) return;
    setSaving(true);
    try {
      const saved = await actions.upsertClassSchedule(draft);
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New class"
      description="Assign the class to a group or one student."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={CalendarDays} disabled={!valid || saving} onClick={save}>{saving ? "Creating…" : "Create class"}</Button></>}
    >
      <div className="classes-new-form">
        <Field label="Frequency" hint="A recurring class appears automatically on its selected days.">
          <div className="classes-choice" role="group" aria-label="Class frequency">
            <button type="button" className={draft.recurrence === "once" ? "active" : ""} aria-pressed={draft.recurrence === "once"} onClick={() => update({ recurrence: "once" })}>One-time</button>
            <button type="button" className={draft.recurrence === "weekly" ? "active" : ""} aria-pressed={draft.recurrence === "weekly"} onClick={() => update({ recurrence: "weekly" })}>Recurring</button>
          </div>
        </Field>
        <Field label="Format">
          <div className="classes-choice" role="group" aria-label="Class format">
            <button type="button" className={draft.format === "group" ? "active" : ""} aria-pressed={draft.format === "group"} onClick={() => update({ format: "group" })}>Group</button>
            <button type="button" className={draft.format === "individual" ? "active" : ""} aria-pressed={draft.format === "individual"} onClick={() => update({ format: "individual" })}>Individual</button>
          </div>
        </Field>
        {draft.format === "group" ? <Field label="Group" required><Select value={draft.groupId} onChange={(event) => update({ groupId: event.target.value })}><option value="">Choose a group</option>{state.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></Field>
          : <Field label="Student" required><Select value={draft.studentId} onChange={(event) => update({ studentId: event.target.value })}><option value="">Choose a student</option>{state.students.filter((student) => student.status !== "Inactive").map((student) => <option key={student.id} value={student.id}>{student.fullName}</option>)}</Select></Field>}
        <div className="classes-new-grid">
          <Field label="Start date" required><Input type="date" value={draft.startDate} onChange={(event) => { const startDate = event.target.value; update({ startDate, daysOfWeek: draft.recurrence === "weekly" && draft.daysOfWeek.length === 1 ? [dayOfWeekForDate(startDate)] : draft.daysOfWeek }); }} /></Field>
          <Field label="Time" required><Input type="time" value={draft.startTime} onChange={(event) => update({ startTime: event.target.value })} /></Field>
          <Field label="Duration" required><Select value={draft.durationHours} onChange={(event) => update({ durationHours: Number(event.target.value) })}>{[1, 1.5, 2, 2.5, 3].map((hours) => <option value={hours} key={hours}>{hours} h</option>)}</Select></Field>
        </div>
        {draft.recurrence === "weekly" ? <>
          <Field label="Repeat every"><Select value={draft.intervalWeeks} onChange={(event) => update({ intervalWeeks: Number(event.target.value) })}><option value="1">1 week</option><option value="2">2 weeks</option><option value="3">3 weeks</option><option value="4">4 weeks</option></Select></Field>
          <Field label="Days of the week" required>
            <div className="weekday-picker">{DAY_OPTIONS.map(([value, label]) => { const active = draft.daysOfWeek.includes(value); return <button type="button" key={value} className={active ? "active" : ""} aria-pressed={active} onClick={() => update({ daysOfWeek: active ? draft.daysOfWeek.filter((day) => day !== value) : [...draft.daysOfWeek, value].sort() })}>{label}{active ? <Check size={12} aria-hidden="true" /> : null}</button>; })}</div>
          </Field>
          <p className="classes-repeat-note"><CircleAlert size={15} aria-hidden="true" />This class will repeat on the selected days.</p>
        </> : null}
      </div>
    </Drawer>
  );
}

function AttendanceControl({ value, name, onChange }) {
  return <div className="class-attendance-control" role="group" aria-label={`Attendance for ${name}`}>
    <button type="button" className={value === "P" ? "present active" : "present"} aria-pressed={value === "P"} title="Present" onClick={() => onChange("P")}>P</button>
    <button type="button" className={value === "A" ? "absent active" : "absent"} aria-pressed={value === "A"} title="Absent" onClick={() => onChange("A")}>A</button>
  </div>;
}

function PaymentControl({ value, name, onChange }) {
  const choices = [{ value: "Paid", label: "Paid", icon: Check }, { value: "Pending", label: "Pending", icon: Minus }, { value: "Unpaid", label: "Unpaid", icon: X }];
  return <div className="class-payment-control" role="group" aria-label={`Payment for ${name}`}>{choices.map((choice) => { const Icon = choice.icon; return <button type="button" key={choice.value} className={`${choice.value.toLowerCase()} ${value === choice.value ? "active" : ""}`} aria-label={choice.label} title={choice.label} aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}><Icon size={15} aria-hidden="true" /></button>; })}</div>;
}

function ClassFacts({ session, rosterCount }) {
  const facts = [
    [CalendarDays, "Date", formatDate(session.classDate)],
    [Clock3, "Time", formatTime(session.startTime)],
    [Hourglass, "Duration", `${session.durationHours || 0} h`],
    [UsersRound, "Students", rosterCount],
    [session.format === "group" ? UsersRound : UserRound, "Type", session.format === "group" ? "Group" : "Individual"],
  ];
  return <div className="class-session-facts">{facts.map(([Icon, label, value]) => <div key={label}><Icon size={19} aria-hidden="true" /><span><small>{label}</small><strong>{value}</strong></span></div>)}</div>;
}

function ClassSummary({ entries, roster, maximum }) {
  const values = roster.map((student) => entries[student.id] || {});
  const present = values.filter((entry) => entry.attendance !== "A").length;
  const absent = values.filter((entry) => entry.attendance === "A").length;
  const paid = values.filter((entry) => entry.paymentState === "Paid").length;
  const pending = values.filter((entry) => entry.paymentState === "Pending").length;
  const unpaid = values.filter((entry) => entry.paymentState === "Unpaid").length;
  const scores = values.map((entry) => Number(entry.score)).filter((score, index) => values[index].score !== "" && Number.isFinite(score));
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  return <aside className="class-live-summary" aria-label="Class summary">
    <div className="class-live-summary-title"><div><h2>Class summary</h2><p>Review before saving</p></div><BookOpenCheck size={34} aria-hidden="true" /></div>
    <dl>
      <div className="green"><dt><UsersRound size={17} />Present</dt><dd>{present}</dd></div>
      <div className="red"><dt><UserRound size={17} />Absent</dt><dd>{absent}</dd></div>
      <div className="orange"><dt><CircleDollarSign size={17} />Payments pending</dt><dd>{pending}</dd></div>
      <div className="blue"><dt><CircleDollarSign size={17} />Payments recorded</dt><dd>{paid}</dd></div>
      {unpaid ? <div className="red"><dt><CircleAlert size={17} />Unpaid</dt><dd>{unpaid}</dd></div> : null}
    </dl>
    <div className="class-average"><Star size={21} aria-hidden="true" /><span><small>Average grade</small><strong>{average == null ? "—" : average.toFixed(1)} <em>/ {maximum || 20}</em></strong><b>{scores.length ? `Based on ${scores.length} grades` : "No grades recorded"}</b></span></div>
  </aside>;
}

function SessionEditor({ session, state, entries, setEntry, roster, assessmentOn, setAssessmentOn, assessment, setAssessment, maximum, setMaximum, saving, dirty, onSave, onDiscard, onCancel, variant = "upcoming" }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!session) return <EmptyState icon={CalendarDays} title="No class selected" description="Choose a class from History or create a new class." />;
  const heading = variant === "history" ? "Edit class record" : session.statusLabel === "Pending" ? "Class pending registration" : "Next class";
  return <>
    <section className={`class-session-card class-session-${variant}`}>
      <header className="class-session-header">
        <div className="class-session-title-row"><h2>{heading}</h2><StatusBadge tone={statusTone(session.statusLabel)}>{session.statusLabel === "Pending" ? "Pending registration" : session.statusLabel}</StatusBadge></div>
        <div className="class-session-overview">
          <div className="class-session-identity"><span><UsersRound size={24} aria-hidden="true" /></span><div><small>{session.format === "group" ? "Group" : "Student"}</small><strong>{session.title}</strong></div></div>
          <button className="class-overview-toggle" type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Hide details" : "View details"}</button>
          <div className={detailsOpen ? "class-overview-details is-open" : "class-overview-details"}><ClassFacts session={session} rosterCount={roster.length} /></div>
        </div>
        {variant === "history" ? <ClassSummary entries={entries} roster={roster} maximum={maximum} /> : null}
      </header>
      <div className="class-session-body">
        <div className="class-task-toggle"><strong>Record assignment?</strong><div role="group" aria-label="Record assignment"><button type="button" className={assessmentOn ? "active" : ""} aria-pressed={assessmentOn} onClick={() => setAssessmentOn(true)}>Yes</button><button type="button" className={!assessmentOn ? "active" : ""} aria-pressed={!assessmentOn} onClick={() => setAssessmentOn(false)}>No</button></div></div>
        {assessmentOn ? <div className="class-assessment"><span><BookOpenCheck size={20} aria-hidden="true" /><strong>Graded activity</strong></span><Field label="Assignment name"><Input value={assessment} onChange={(event) => setAssessment(event.target.value)} placeholder="e.g. Equivalent fractions" /></Field><Field label="Maximum score"><Input type="number" min="0.01" step="0.01" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></Field></div> : null}
        {!roster.length ? <EmptyState icon={UsersRound} title="No active students" description="Add active students to this group in Community before registering the class." /> : <div className="class-roster" role="table" aria-label="Class student roster">
          <div className="class-roster-head" role="row"><span role="columnheader">Student</span><span role="columnheader">Attendance</span><span role="columnheader">Payment</span>{assessmentOn ? <span role="columnheader">Grade</span> : null}</div>
          {roster.map((student) => { const entry = entries[student.id] || { attendance: "P", paymentState: "Pending", score: "" }; return <div className="class-roster-row" role="row" key={student.id}>
            <div className="class-roster-student" role="rowheader"><StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative /><span><strong>{student.fullName}</strong><small>{student.code || "Student"}</small></span></div>
            <AttendanceControl value={entry.attendance} name={student.fullName} onChange={(attendance) => setEntry(student.id, { attendance })} />
            <PaymentControl value={entry.paymentState} name={student.fullName} onChange={(paymentState) => { setEntry(student.id, { paymentState, paymentTouched: true }); playHibiSound("payment"); }} />
            {assessmentOn ? <label className="class-grade-input"><span className="sr-only">Grade for {student.fullName}</span><Input type="number" min="0" max={maximum || undefined} step="0.01" value={entry.score} onChange={(event) => setEntry(student.id, { score: event.target.value })} /><small>/{maximum || "—"}</small></label> : null}
          </div>; })}
        </div>}
      </div>
    </section>
    <footer className={`class-session-actions ${variant}`}>
      {variant === "history" ? <Button onClick={onDiscard} disabled={!dirty || saving}>Discard changes</Button> : <Button onClick={onCancel} disabled={saving || session.statusLabel === "Cancelled"}>Mark cancelled</Button>}
      <Button variant="primary" icon={Save} onClick={onSave} disabled={!roster.length || saving}>{saving ? "Saving…" : variant === "history" ? "Save changes" : "Save class"}</Button>
    </footer>
  </>;
}

function UpcomingClasses({ sessions, onSelect }) {
  if (!sessions.length) return null;
  return <section className="classes-next-list" aria-labelledby="classes-next-title"><h2 id="classes-next-title">Upcoming classes</h2><div>{sessions.slice(0, 3).map((session) => <button type="button" key={session.key} onClick={() => onSelect(session)}><span><CalendarDays size={20} aria-hidden="true" /></span><span><small>{session.classDate === todayDateOnly() ? `Today, ${formatTime(session.startTime)}` : `${formatDate(session.classDate, { weekday: "short", month: "short", day: "numeric" })}, ${formatTime(session.startTime)}`}</small><strong>{session.title}</strong><em>{session.durationHours} h · {session.format === "group" ? "Group" : "Individual"} · {session.format === "group" ? `${session.studentCount || 0} students` : "1 student"}</em></span></button>)}</div></section>;
}

function HistoryList({ sessions, selectedKey, onSelect, filters, setFilters }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters]);
  const pages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const visible = sessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <div className="classes-history-master">
    <div className="classes-history-filters">
      <label className="classes-history-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Search by group or student</span><input value={filters.search} placeholder="Search by group or student" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
      <label><CalendarDays size={18} aria-hidden="true" /><span className="sr-only">From date</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /><span>—</span><span className="sr-only">To date</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
      <label><UsersRound size={18} aria-hidden="true" /><Select aria-label="Filter by group or student" value={filters.ownerId} onChange={(event) => setFilters((current) => ({ ...current, ownerId: event.target.value }))}><option value="">Group or student</option>{[...new Map(sessions.map((session) => [session.groupId || session.studentId, session.title])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></label>
      <label><Filter size={18} aria-hidden="true" /><Select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Status</option>{["Pending", "Registered", "Cancelled", "Rescheduled"].map((status) => <option key={status}>{status}</option>)}</Select></label>
    </div>
    <section className="classes-history-list" aria-label="Class history">
      <div className="classes-history-head"><span>Date</span><span>Group / Student</span><span>Type</span><span>Status</span><span>Summary</span></div>
      {visible.map((session) => <button type="button" className={selectedKey === session.key ? "selected" : ""} key={session.key} onClick={() => onSelect(session)}><span><CalendarDays size={17} aria-hidden="true" /><b>{formatDate(session.classDate)}</b><small>{formatTime(session.startTime)}</small></span><span><strong>{session.title}</strong><small>{session.format === "group" ? "Group" : session.studentName || "Individual"}</small></span><span>{session.format === "group" ? <UsersRound size={18} /> : <UserRound size={18} />}</span><StatusBadge tone={statusTone(session.statusLabel)}>{session.statusLabel}</StatusBadge><span><b>{session.studentCount || 1} {session.studentCount === 1 ? "student" : "students"}</b><small>{session.durationHours} h</small></span><ChevronRight size={17} aria-hidden="true" /></button>)}
      {!visible.length ? <EmptyState icon={CalendarDays} title="No matching classes" description="Try changing one or more filters." /> : null}
      <footer><span>Showing {sessions.length ? (page - 1) * PAGE_SIZE + 1 : 0} to {Math.min(page * PAGE_SIZE, sessions.length)} of {sessions.length} classes</span><nav aria-label="History pages"><button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button>{Array.from({ length: pages }, (_, index) => index + 1).slice(0, 4).map((value) => <button type="button" key={value} className={page === value ? "active" : ""} onClick={() => setPage(value)}>{value}</button>)}<button type="button" aria-label="Next page" disabled={page === pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></nav></footer>
    </section>
  </div>;
}

export default function Classes({ state = {}, derived = {}, actions = {}, asOfDate, intent, clearIntent, registerNavigationBlocker }) {
  const currentDate = asOfDate || state.settings?.asOfDate || todayDateOnly();
  const sessions = useMemo(() => buildClassWorkspaceSessions(state, currentDate), [currentDate, state]);
  const primary = useMemo(() => selectPrimaryClassSession(sessions, currentDate, currentTimeForDate(currentDate)), [currentDate, sessions]);
  const [tab, setTab] = useState("next");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedUpcomingKey, setSelectedUpcomingKey] = useState("");
  const [newClassOpen, setNewClassOpen] = useState(false);
  const [filters, setFilters] = useState({ search: "", dateFrom: "", dateTo: "", ownerId: "", status: "" });
  const [entries, setEntries] = useState({});
  const [assessmentOn, setAssessmentOn] = useState(false);
  const [assessment, setAssessment] = useState("");
  const [maximum, setMaximum] = useState(20);
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef(null);

  const history = useMemo(() => filterClassHistory(sessions, filters).map((session) => ({ ...session, studentCount: rosterForClassSession(state, session).length })), [filters, sessions, state]);
  useEffect(() => {
    if (!selectedKey && history[0]) setSelectedKey(history[0].key);
    else if (selectedKey && !history.some((session) => session.key === selectedKey)) setSelectedKey(history[0]?.key || "");
  }, [history, selectedKey]);
  const selectedHistory = history.find((session) => session.key === selectedKey) || history[0] || null;
  const selectedUpcoming = sessions.find((session) => session.key === selectedUpcomingKey) || null;
  const activeSession = tab === "history" ? selectedHistory : selectedUpcoming || primary;
  const roster = useMemo(() => rosterForClassSession(state, activeSession), [activeSession, state]);
  const snapshot = useMemo(() => ({ entries, assessmentOn, assessment, maximum }), [assessment, assessmentOn, entries, maximum]);
  const dirty = Boolean(baselineRef.current) && draftChanged(snapshot, baselineRef.current);

  useUnsavedChanges(registerNavigationBlocker, dirty, "Discard your unsaved class changes?");
  const changeTab = useHistoryBackedState({
    key: "classes-workspace-tab",
    value: tab,
    onChange: setTab,
    defaultValue: "next",
    allowedValues: ["next", "history"],
    canChange: () => !dirty || confirmDiscard(true, "Discard your unsaved class changes?"),
  });

  useEffect(() => {
    if (intent === "class-history" || intent === "add-grades") changeTab("history", { replace: true });
    if (intent?.type === "open-history-class" && typeof intent.sessionKey === "string") {
      if (changeTab("history", { replace: true })) setSelectedKey(intent.sessionKey);
    }
    if (intent?.type === "open-class" && typeof intent.sessionKey === "string") {
      if (changeTab("next", { replace: true })) setSelectedUpcomingKey(intent.sessionKey);
    }
    if (intent === "new-class") setNewClassOpen(true);
    if (intent) clearIntent?.();
  }, [changeTab, clearIntent, intent]);

  const hydrate = useCallback((session) => {
    if (!session) {
      setEntries({}); setAssessmentOn(false); setAssessment(""); setMaximum(20); baselineRef.current = { entries: {}, assessmentOn: false, assessment: "", maximum: 20 };
      return;
    }
    const sessionRoster = rosterForClassSession(state, session);
    const rosterIds = new Set(sessionRoster.map((student) => student.id));
    const exactGrades = (state.grades || []).filter((grade) => grade.classSessionKey === session.key);
    const legacyGrades = exactGrades.length ? [] : (state.grades || []).filter((grade) => !grade.classSessionKey && grade.date === session.classDate && rosterIds.has(grade.studentId));
    const candidateGrades = exactGrades.length ? exactGrades : legacyGrades;
    const selectedAssessment = candidateGrades[0]?.assessment || "";
    const sessionGrades = selectedAssessment ? candidateGrades.filter((grade) => grade.assessment === selectedAssessment) : [];
    const nextEntries = Object.fromEntries(sessionRoster.map((student) => {
      const row = (session.rows || []).find((item) => item.studentId === student.id);
      const grade = sessionGrades.find((item) => item.studentId === student.id);
      const hours = row?.hours ?? session.durationHours ?? state.settings?.defaultClassHours ?? 2;
      const charge = hours * (resolveHourlyRate(state, student, session.groupId) || 0);
      return [student.id, {
        attendance: row?.attendance === "A" || row?.attendance === "E" ? "A" : "P",
        paymentState: paymentRecordState(row, charge),
        paymentTouched: false,
        score: grade?.score == null ? "" : String(grade.score),
        classId: row?.id || "",
        gradeId: grade?.id || "",
      }];
    }));
    const next = { entries: nextEntries, assessmentOn: Boolean(selectedAssessment), assessment: selectedAssessment, maximum: sessionGrades[0]?.maxScore ?? 20 };
    setEntries(next.entries); setAssessmentOn(next.assessmentOn); setAssessment(next.assessment); setMaximum(next.maximum); baselineRef.current = next;
  }, [state]);

  useEffect(() => { hydrate(activeSession); }, [activeSession?.key, hydrate]);

  const setEntry = (studentId, patch) => setEntries((current) => ({ ...current, [studentId]: { ...current[studentId], ...patch } }));
  const saveSession = async (classStatus = "Completed") => {
    if (!activeSession || !roster.length || !actions.saveProgress) return;
    const trimmedAssessment = assessment.trim();
    const max = Number(maximum);
    if (assessmentOn && !trimmedAssessment) return actions.notify?.("Name the assignment before saving grades.", "error");
    if (assessmentOn && (!Number.isFinite(max) || max <= 0)) return actions.notify?.("Enter a valid maximum score.", "error");
    const invalid = roster.find((student) => entries[student.id]?.score !== "" && (Number(entries[student.id]?.score) < 0 || Number(entries[student.id]?.score) > max));
    if (invalid) return actions.notify?.(`Check the grade for ${invalid.fullName}.`, "error");
    const classRecords = roster.map((student) => {
      const entry = entries[student.id] || {};
      const existing = (activeSession.rows || []).find((row) => row.id === entry.classId) || (activeSession.rows || []).find((row) => row.studentId === student.id);
      const hours = existing?.hours ?? activeSession.durationHours ?? state.settings?.defaultClassHours ?? 2;
      const charge = hours * (resolveHourlyRate(state, student, activeSession.groupId) || 0);
      const payment = entry.paymentTouched ? entry.paymentState : null;
      return {
        ...existing,
        id: existing?.id,
        classDate: activeSession.classDate,
        studentId: student.id,
        groupId: activeSession.groupId || "",
        startTime: activeSession.startTime || "",
        classTitle: activeSession.title,
        scheduleSlotId: activeSession.scheduleSlotId || "",
        scheduleOccurrenceDate: activeSession.occurrenceDate || activeSession.classDate,
        classStatus,
        attendance: classStatus === "Completed" ? entry.attendance || "P" : "",
        hours,
        amountPaid: payment === "Paid" ? charge : payment ? 0 : existing?.amountPaid ?? 0,
        paymentDate: payment === "Paid" ? (existing?.paymentDate || currentDate) : payment ? null : existing?.paymentDate || null,
        paymentMethod: payment === "Paid" ? (existing?.paymentMethod || "Cash") : payment ? "" : existing?.paymentMethod || "",
        paymentState: payment || existing?.paymentState || entry.paymentState || "Pending",
      };
    });
    const gradeRecords = assessmentOn ? roster.flatMap((student) => {
      const entry = entries[student.id] || {};
      if (entry.score === "" && !entry.gradeId) return [];
      const existing = (state.grades || []).find((grade) => grade.id === entry.gradeId);
      return [{ ...existing, id: existing?.id, date: activeSession.classDate, studentId: student.id, assessment: trimmedAssessment, category: existing?.category || "Homework", score: entry.score === "" ? null : Number(entry.score), maxScore: max, workStatus: existing?.workStatus || "On time", feedback: existing?.feedback || "", classSessionKey: activeSession.key }];
    }) : [];
    setSaving(true);
    try {
      if (await actions.saveProgress({ classRecords, gradeRecords })) {
        const next = { entries, assessmentOn, assessment, maximum };
        baselineRef.current = next;
        playHibiSound(classStatus === "Completed" ? "success" : "selection");
      }
    } finally { setSaving(false); }
  };
  const cancelSession = () => {
    if (!globalThis.confirm?.("Mark this class as cancelled? Existing payments will be preserved.")) return;
    saveSession("Cancelled");
  };
  const selectUpcomingSession = useCallback((session) => {
    if (!session || session.key === activeSession?.key) return;
    if (dirty && !confirmDiscard(true, "Discard your unsaved class changes?")) return;
    setSelectedUpcomingKey(session.key);
  }, [activeSession?.key, dirty]);

  const upcomingAfter = useMemo(() => {
    const reference = tab === "next" ? activeSession : primary;
    if (!reference) return sessions.filter((session) => session.statusLabel === "Scheduled").slice(0, 3);
    return sessions.filter((session) => session.statusLabel === "Scheduled" && session.key !== reference.key && (session.classDate > reference.classDate || (session.classDate === reference.classDate && session.startTime > reference.startTime))).map((session) => ({ ...session, studentCount: rosterForClassSession(state, session).length })).slice(0, 3);
  }, [activeSession, primary, sessions, state, tab]);

  return <div className="page classes-workspace-page">
    <header className="classes-workspace-heading"><div><h1>Classes</h1><p>Record the current class quickly and simply.</p></div><Button icon={Plus} onClick={() => setNewClassOpen(true)}>New class</Button></header>
    <div className="classes-workspace-tabs" role="tablist" aria-label="Class views"><button type="button" role="tab" aria-selected={tab === "next"} className={tab === "next" ? "active" : ""} onClick={() => changeTab("next")}>Next class</button><button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}>History</button></div>
    {tab === "next" ? <div className="classes-upcoming-view" role="tabpanel">
      {activeSession ? <><div className="classes-upcoming-layout"><main><SessionEditor session={activeSession} state={state} entries={entries} setEntry={setEntry} roster={roster} assessmentOn={assessmentOn} setAssessmentOn={setAssessmentOn} assessment={assessment} setAssessment={setAssessment} maximum={maximum} setMaximum={setMaximum} saving={saving} dirty={dirty} onSave={() => saveSession("Completed")} onDiscard={() => hydrate(activeSession)} onCancel={cancelSession} /></main><ClassSummary entries={entries} roster={roster} maximum={maximum} /></div><UpcomingClasses sessions={upcomingAfter} onSelect={selectUpcomingSession} /></> : <EmptyState icon={CalendarDays} title="No upcoming classes" description="Create a one-time or recurring class to start the daily workflow." action={<Button icon={Plus} variant="primary" onClick={() => setNewClassOpen(true)}>New class</Button>} />}
    </div> : <div className="classes-history-view" role="tabpanel"><HistoryList sessions={history} selectedKey={selectedKey} onSelect={(session) => setSelectedKey(session.key)} filters={filters} setFilters={setFilters} /><div className="classes-history-detail"><SessionEditor variant="history" session={selectedHistory} state={state} entries={entries} setEntry={setEntry} roster={roster} assessmentOn={assessmentOn} setAssessmentOn={setAssessmentOn} assessment={assessment} setAssessment={setAssessment} maximum={maximum} setMaximum={setMaximum} saving={saving} dirty={dirty} onSave={() => saveSession("Completed")} onDiscard={() => hydrate(activeSession)} onCancel={cancelSession} /></div></div>}
    <NewClassDrawer open={newClassOpen} onClose={() => setNewClassOpen(false)} state={state} asOfDate={currentDate} actions={actions} />
  </div>;
}
