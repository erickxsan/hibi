import { useMemo, useState } from "react";
import { Archive, ArrowLeft, Check, CreditCard, History, Pencil, Plus, Search, Star, Trash2, UserRound, UsersRound } from "lucide-react";
import { Button, Drawer, Field, Input, Select, TextArea } from "../components/ui";

const EMPTY = { id: "", studentCode: "", fullName: "", groupIds: [], isIndividual: false, studentPhone: "", guardianContact: "", importantNotes: "", status: "Active" };
const initials = (name) => String(name || "?").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
const pct = (value) => value == null ? "—" : `${Math.round(value * 100)}%`;

function EnrollmentTags({ student, groupsById }) {
  return <div className="enrollment-tags">{student.isIndividual ? <span className="enroll-tag individual"><UserRound size={13}/>Individual</span> : null}{(student.groupIds || []).map((id) => groupsById.get(id)).filter(Boolean).map((group) => <span className="enroll-tag" key={group.id}><UsersRound size={13}/>{group.name}</span>)}{!student.isIndividual && !(student.groupIds || []).length ? <span className="enroll-tag muted">Unassigned</span> : null}</div>;
}

function StudentEditor({ draft, setDraft, groups }) {
  const [groupSearch, setGroupSearch] = useState("");
  const filtered = groups.filter((group) => group.name.toLowerCase().includes(groupSearch.toLowerCase()));
  const toggleGroup = (id) => setDraft({ ...draft, groupIds: draft.groupIds.includes(id) ? draft.groupIds.filter((value) => value !== id) : [...draft.groupIds, id] });
  return <form id="student-editor" className="drawer-form" onSubmit={(event) => event.preventDefault()}>
    <div className="form-grid two-columns"><Field label="Student ID" required><Input value={draft.studentCode} onChange={(e) => setDraft({ ...draft, studentCode: e.target.value })}/></Field><Field label="Status"><Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option>Active</option><option>Inactive</option></Select></Field></div>
    <Field label="Full name" required><Input value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}/></Field>
    <section className="compact-enrollment" aria-label="Enrollment"><div className="enrollment-heading"><div><strong>Enrollment</strong><span>Individual, groups, or both</span></div><label className="switch-row"><input type="checkbox" checked={draft.isIndividual} onChange={(e) => setDraft({ ...draft, isIndividual: e.target.checked })}/><span/><b>Individual classes</b></label></div>
      <label className="mini-search"><Search size={15}/><input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="Search groups"/></label>
      <div className="group-picker">{filtered.length ? filtered.map((group) => <button key={group.id} type="button" className={draft.groupIds.includes(group.id) ? "group-option selected" : "group-option"} onClick={() => toggleGroup(group.id)}><span>{group.name}<small>{group.scheduleRoom || group.subject || "No schedule"}</small></span>{draft.groupIds.includes(group.id) ? <Check size={16}/> : null}</button>) : <p>No groups match.</p>}</div>
      <div className="selected-groups">{draft.groupIds.map((id) => groups.find((group) => group.id === id)).filter(Boolean).map((group) => <button type="button" key={group.id} onClick={() => toggleGroup(group.id)}>{group.name} ×</button>)}</div>
    </section>
    <Field label="Student phone"><Input type="tel" value={draft.studentPhone} onChange={(e) => setDraft({ ...draft, studentPhone: e.target.value })}/></Field>
    <Field label="Parent / tutor"><TextArea rows="2" value={draft.guardianContact} onChange={(e) => setDraft({ ...draft, guardianContact: e.target.value })}/></Field>
    <Field label="Notes"><TextArea rows="3" value={draft.importantNotes} onChange={(e) => setDraft({ ...draft, importantNotes: e.target.value })}/></Field>
  </form>;
}

export default function Students({ state, derived, actions }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(null);
  const groupsById = derived.groupsById || new Map();
  const list = useMemo(() => state.students.filter((student) => [student.fullName, student.studentCode, student.guardianContact, ...(student.groupIds || []).map((id) => groupsById.get(id)?.name || "")].join(" ").toLowerCase().includes(query.toLowerCase())), [groupsById, query, state.students]);
  const student = state.students.find((item) => item.id === selectedId);
  const summary = derived.students.find((item) => item.id === selectedId) || {};
  const studentGrades = derived.grades.filter((row) => row.studentId === selectedId).slice().sort((a,b) => b.date.localeCompare(a.date));
  const studentClasses = derived.classLog.filter((row) => row.studentId === selectedId).slice().sort((a,b) => b.classDate.localeCompare(a.classDate));
  const open = (item = EMPTY) => setDraft({ ...EMPTY, ...item, groupIds: [...(item.groupIds || [])] });
  const save = async () => { if (await actions.upsertStudent(draft)) { setSelectedId(draft.id || ""); setDraft(null); } };

  if (student) return <div className="page detail-page"><button className="back-link" type="button" onClick={() => setSelectedId("")}><ArrowLeft size={17}/>Students</button><section className="detail-hero"><div className="profile-avatar">{initials(student.fullName)}</div><div className="detail-identity"><h1>{student.fullName}</h1><p>{student.studentCode} · {student.guardianContact || "No parent/tutor registered"}</p><EnrollmentTags student={student} groupsById={groupsById}/></div><div className="hero-actions"><Button icon={Pencil} onClick={() => open(student)}>Edit enrollment</Button>{student.status === "Active" ? <button className="hero-icon" type="button" title="Archive student" aria-label="Archive student" onClick={() => { if (confirm(`Archive ${student.fullName}?`)) actions.archiveStudent(student.id); }}><Archive size={18}/></button> : null}<button className="hero-icon danger" type="button" title="Delete student" aria-label="Delete student" onClick={async () => { if (confirm(`Delete ${student.fullName}?`)) { const removed = await actions.deleteStudent(student.id); if (removed) setSelectedId(""); } }}><Trash2 size={18}/></button></div></section>
    <div className="detail-tabs"><button className="active">Overview</button><button>Attendance</button><button>Grades</button><button>History</button><button>Payments</button><button>Notes</button></div>
    <section className="detail-grid"><article className="detail-card"><header><h2>Attendance</h2><span>This term</span></header><div className="large-stat">{pct(summary.attendance)}</div><p>{summary.attendedClasses || 0} of {summary.attendanceClasses || 0} recorded classes attended</p></article><article className="detail-card"><header><h2>Latest grades</h2><Star size={18}/></header>{studentGrades.slice(0,3).map((row) => <div className="mini-row" key={row.id}><span>{row.assessment}</span><strong>{pct(row.percentage)}</strong></div>)}{!studentGrades.length ? <p>No grades yet.</p> : null}</article><article className="detail-card span-two"><header><h2>Class history</h2><History size={18}/></header>{studentClasses.slice(0,4).map((row) => <div className="history-line" key={row.id}><span>{row.classDate}</span><strong>{row.classTitle || row.groupName || "Individual class"}</strong><em>{row.attendance || "—"}</em></div>)}{!studentClasses.length ? <p>No classes yet.</p> : null}</article><article className="detail-card"><header><h2>Payments</h2><CreditCard size={18}/></header><div className="large-stat">{money(summary.outstanding)}</div><p>Current outstanding balance</p></article><article className="detail-card"><header><h2>Notes</h2><button type="button" onClick={() => open(student)}>Edit</button></header><p>{student.importantNotes || "No notes yet."}</p></article></section>
    <Drawer open={Boolean(draft)} onClose={() => setDraft(null)} title="Edit student" description="Individual and group enrollment can be combined." footer={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save student</Button></>}>{draft ? <StudentEditor draft={draft} setDraft={setDraft} groups={state.groups}/> : null}</Drawer></div>;

  return <div className="page"><div className="page-heading"><div><h1>Students</h1><p>Keep profiles, enrollment, progress, and balances together.</p></div><Button variant="primary" icon={Plus} onClick={() => open()}>Add student</Button></div><label className="page-search"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search students, parents, or groups"/></label>
    <section className="people-list">{list.map((item) => { const itemSummary = derived.students.find((row) => row.id === item.id) || {}; return <button className="person-row" key={item.id} type="button" onClick={() => setSelectedId(item.id)}><span className="profile-avatar small">{initials(item.fullName)}</span><span className="person-main"><strong>{item.fullName}</strong><small>{item.guardianContact || item.studentPhone || item.studentCode}</small><EnrollmentTags student={item} groupsById={groupsById}/></span><span className="person-metric"><small>Attendance</small><strong>{pct(itemSummary.attendance)}</strong></span><span className="person-metric"><small>Balance</small><strong>{money(itemSummary.outstanding)}</strong></span><span className={item.status === "Active" ? "record-status active" : "record-status"}>{item.status}</span></button>; })}{!list.length ? <div className="empty-box"><UsersRound size={28}/><h2>No students found</h2><p>Add a student or adjust your search.</p></div> : null}</section>
    <Drawer open={Boolean(draft)} onClose={() => setDraft(null)} title={draft?.id ? "Edit student" : "Add student"} description="Use individual classes, one or many groups, or both." footer={<><Button onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save student</Button></>}>{draft ? <StudentEditor draft={draft} setDraft={setDraft} groups={state.groups}/> : null}</Drawer>
  </div>;
}
