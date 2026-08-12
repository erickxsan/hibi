import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  CreditCard,
  DollarSign,
  Filter,
  History,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button, ConfirmDialog, Drawer, Field, Input, MultiSelect, Select, TextArea } from "../components/ui";
import { AvatarPicker, StudentAvatar } from "../components/StudentAvatar";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { getUiLocale } from "../i18n";
import { studentMatchesFilters } from "../domain/studentFilters";
import { normalizeSearchText } from "../utils/searchText";

const EMPTY = Object.freeze({
  id: "",
  code: "",
  fullName: "",
  avatarId: "cat",
  groupIds: [],
  isIndividual: false,
  customHourlyRate: null,
  studentEmail: "",
  guardianPhone: "",
  phone: "",
  guardianContact: "",
  notes: "",
  status: "Active",
});

const DETAIL_TABS = Object.freeze(["overview", "attendance", "grades", "history", "payments", "notes"]);

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(
    Number(value || 0),
  );
}

function pct(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function EnrollmentTags({ student, groupsById }) {
  const groupIds = Array.isArray(student.groupIds) ? student.groupIds : student.groupId ? [student.groupId] : [];
  return (
    <div className="enrollment-tags">
      {student.isIndividual || groupIds.length === 0 ? (
        <span className="enroll-tag individual">
          <UserRound size={13} />
          Individual
        </span>
      ) : null}
      {groupIds
        .map((id) => groupsById.get(id))
        .filter(Boolean)
        .map((group) => (
          <span className="enroll-tag" key={group.id}>
            <UsersRound size={13} />
            {group.name}
          </span>
        ))}
    </div>
  );
}

export function StudentEditor({ draft, setDraft, groups, defaultRate }) {
  const selectedGroups = draft.groupIds.map((id) => groups.find((group) => group.id === id)).filter(Boolean);
  const groupOptions = groups.map((group) => ({
    value: group.id,
    label: group.name,
    meta: group.schedule || group.subject || "No schedule",
  }));
  const inheritedRate =
    selectedGroups.length === 1 && Number.isFinite(selectedGroups[0].hourlyRate)
      ? selectedGroups[0].hourlyRate
      : defaultRate;

  return (
    <form id="student-editor" className="drawer-form" onSubmit={(event) => event.preventDefault()}>
      <div className="form-grid two-columns">
        <Field label="Student ID" required>
          <Input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option>Active</option>
            <option>Inactive</option>
          </Select>
        </Field>
      </div>
      <Field label="Full name" required>
        <Input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
      </Field>
      <AvatarPicker value={draft.avatarId} onChange={(avatarId) => setDraft({ ...draft, avatarId })} />
      <section className="compact-enrollment" aria-label="Enrollment">
        <div className="enrollment-heading">
          <div>
            <strong>Enrollment</strong>
            <span>Individual, groups, or both</span>
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={draft.isIndividual}
              onChange={(event) => setDraft({ ...draft, isIndividual: event.target.checked })}
            />
            <span aria-hidden="true" />
            <b>Individual classes</b>
          </label>
        </div>
        <MultiSelect
          ariaLabel="Assign groups"
          value={draft.groupIds}
          options={groupOptions}
          onChange={(groupIds) => setDraft((current) => ({ ...current, groupIds }))}
          placeholder="Choose groups"
          emptyMessage="No groups match"
          variant="group"
        />
      </section>
      <details className="optional-settings pricing-settings">
        <summary>
          <span>
            <DollarSign size={17} />
            <strong>Pricing</strong>
          </span>
          <small>
            {Number.isFinite(draft.customHourlyRate)
              ? `${money(draft.customHourlyRate)} / hour override`
              : selectedGroups.length > 1
                ? "Uses each group rate"
                : `${money(inheritedRate)} / hour inherited`}
          </small>
        </summary>
        <div className="optional-settings-body">
          <label className="switch-row pricing-switch">
            <input
              type="checkbox"
              checked={Number.isFinite(draft.customHourlyRate)}
              onChange={(event) =>
                setDraft({ ...draft, customHourlyRate: event.target.checked ? inheritedRate : null })
              }
            />
            <span aria-hidden="true" />
            <b>Override inherited rate</b>
          </label>
          {Number.isFinite(draft.customHourlyRate) ? (
            <Field label="Custom hourly rate">
              <Input
                type="number"
                min="0"
                step="1"
                value={draft.customHourlyRate}
                onChange={(event) => setDraft({ ...draft, customHourlyRate: Number(event.target.value) })}
              />
              <small>MXN / hour</small>
            </Field>
          ) : (
            <p>
              {selectedGroups.length > 1
                ? "This student uses the relevant group rate for each class, then the account default when a group has no rate."
                : `Inherited rate: ${money(inheritedRate)} per hour.`}
            </p>
          )}
        </div>
      </details>
      <section className="student-contact-fields" aria-labelledby="student-contact-heading">
        <div className="student-contact-heading">
          <strong id="student-contact-heading">Contact information</strong>
          <span>Email is shown first in Community.</span>
        </div>
        <Field label="Student email">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={draft.studentEmail}
            onChange={(event) => setDraft({ ...draft, studentEmail: event.target.value })}
          />
        </Field>
        <Field label="Guardian phone">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.guardianPhone}
            onChange={(event) => setDraft({ ...draft, guardianPhone: event.target.value })}
          />
        </Field>
        <Field label="Student phone">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
        </Field>
        <Field label="Parent / tutor details" hint="Name or other useful contact details">
          <TextArea
            rows="2"
            value={draft.guardianContact}
            onChange={(event) => setDraft({ ...draft, guardianContact: event.target.value })}
          />
        </Field>
      </section>
      <Field label="Notes">
        <TextArea
          rows="3"
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </Field>
    </form>
  );
}

function StudentDetailContent({ tab, student, summary, grades, classes, onEdit }) {
  if (tab === "attendance") {
    return (
      <article className="detail-card span-two">
        <header>
          <h2>Attendance history</h2>
          <History size={18} />
        </header>
        {classes.map((row) => (
          <div className="history-line" key={row.id}>
            <span>{row.classDate}</span>
            <strong>{row.classTitle || row.groupName || "Individual class"}</strong>
            <em>{row.attendance || "—"}</em>
          </div>
        ))}
        {!classes.length ? <p>No attendance records yet.</p> : null}
      </article>
    );
  }
  if (tab === "grades") {
    return (
      <article className="detail-card span-two">
        <header>
          <h2>Grades</h2>
          <Star size={18} />
        </header>
        {grades.map((row) => (
          <div className="history-line" key={row.id}>
            <span>{row.date}</span>
            <strong>{row.assessment}</strong>
            <em>{pct(row.percentage)}</em>
          </div>
        ))}
        {!grades.length ? <p>No grades yet.</p> : null}
      </article>
    );
  }
  if (tab === "history") {
    return (
      <article className="detail-card span-two">
        <header>
          <h2>Class history</h2>
          <History size={18} />
        </header>
        {classes.map((row) => (
          <div className="history-line" key={row.id}>
            <span>{row.classDate}</span>
            <strong>{row.classTitle || row.groupName || "Individual class"}</strong>
            <em>{row.classStatus}</em>
          </div>
        ))}
        {!classes.length ? <p>No classes yet.</p> : null}
      </article>
    );
  }
  if (tab === "payments") {
    return (
      <article className="detail-card span-two">
        <header>
          <h2>Payments</h2>
          <CreditCard size={18} />
        </header>
        {classes.map((row) => (
          <div className="student-payment-line" key={row.id}>
            <span>
              {row.classDate}
              <small>{row.paymentStatus}</small>
            </span>
            <strong>{money(row.recognizedPaid)}</strong>
            <em>{money(row.outstanding)} pending</em>
          </div>
        ))}
        {!classes.length ? <p>No payment records yet.</p> : null}
      </article>
    );
  }
  if (tab === "notes") {
    return (
      <article className="detail-card span-two">
        <header>
          <h2>Notes</h2>
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        </header>
        <p>{student.notes || "No notes yet."}</p>
      </article>
    );
  }
  return (
    <>
      <article className="detail-card">
        <header>
          <h2>Attendance</h2>
          <span>This term</span>
        </header>
        <div className="large-stat">{pct(summary.attendance)}</div>
        <p>
          {summary.attendedClasses || 0} of {summary.attendanceClasses || 0} recorded classes attended
        </p>
      </article>
      <article className="detail-card">
        <header>
          <h2>Latest grades</h2>
          <Star size={18} />
        </header>
        {grades.slice(0, 3).map((row) => (
          <div className="mini-row" key={row.id}>
            <span>{row.assessment}</span>
            <strong>{pct(row.percentage)}</strong>
          </div>
        ))}
        {!grades.length ? <p>No grades yet.</p> : null}
      </article>
      <article className="detail-card span-two">
        <header>
          <h2>Class history</h2>
          <History size={18} />
        </header>
        {classes.slice(0, 4).map((row) => (
          <div className="history-line" key={row.id}>
            <span>{row.classDate}</span>
            <strong>{row.classTitle || row.groupName || "Individual class"}</strong>
            <em>{row.attendance || "—"}</em>
          </div>
        ))}
        {!classes.length ? <p>No classes yet.</p> : null}
      </article>
      <article className="detail-card">
        <header>
          <h2>Payments</h2>
          <CreditCard size={18} />
        </header>
        <div className="large-stat">{money(summary.outstanding)}</div>
        <p>Current outstanding balance</p>
      </article>
      <article className="detail-card">
        <header>
          <h2>Notes</h2>
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        </header>
        <p>{student.notes || "No notes yet."}</p>
      </article>
    </>
  );
}

export default function Students({ state, derived, actions, intent, clearIntent, registerNavigationBlocker }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [filters, setFilters] = useState({ groupIds: [], groupMatch: "any", enrollment: [] });
  const [selectedId, setSelectedId] = useState("");
  const [detailTab, setDetailTab] = useState("overview");
  const [draft, setDraft] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef(null);
  const dirty = Boolean(draft) && draftChanged(draft, baselineRef.current);
  const groupsById = derived.groupsById || new Map();
  const activeFilterCount = filters.groupIds.length + filters.enrollment.length + (status === "all" ? 0 : 1);

  useUnsavedChanges(registerNavigationBlocker, dirty, "Discard your unsaved student changes?");
  const changeSelected = useHistoryBackedState({
    key: "student-detail",
    value: selectedId,
    onChange: (value) => {
      setSelectedId(value);
      setDetailTab("overview");
    },
    defaultValue: "",
    allowedValues: ["", ...state.students.map((student) => student.id)],
    canChange: () => confirmDiscard(dirty, "Discard your unsaved student changes?"),
  });

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [selectedId]);

  const list = useMemo(() => {
    const needle = normalizeSearchText(query);
    return state.students.filter((student) => {
      if (status !== "all" && student.status !== status) return false;
      if (!studentMatchesFilters(student, filters)) return false;
      const groupNames = (student.groupIds || []).map((id) => groupsById.get(id)?.name || "");
      return normalizeSearchText(
        [student.fullName, student.code, student.phone, student.guardianContact, ...groupNames].join(" "),
      ).includes(needle);
    });
  }, [filters, groupsById, query, state.students, status]);

  const student = state.students.find((item) => item.id === selectedId);
  const summary = derived.students.find((item) => item.id === selectedId) || {};
  const studentGrades = derived.grades
    .filter((row) => row.studentId === selectedId)
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date));
  const studentClasses = derived.classLog
    .filter((row) => row.studentId === selectedId)
    .slice()
    .sort((left, right) => right.classDate.localeCompare(left.classDate));

  const open = (item = EMPTY) => {
    const next = {
      ...EMPTY,
      ...item,
      code: item.code ?? item.studentCode ?? "",
      phone: item.phone ?? item.studentPhone ?? "",
      notes: item.notes ?? item.importantNotes ?? "",
      groupIds: [...(item.groupIds || (item.groupId ? [item.groupId] : []))],
    };
    baselineRef.current = next;
    setDraft(next);
  };
  const closeDraft = () => {
    if (!confirmDiscard(dirty, "Discard your unsaved student changes?")) return false;
    baselineRef.current = null;
    setDraft(null);
    return true;
  };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      if (await actions.upsertStudent(draft)) {
        baselineRef.current = null;
        setDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (intent !== "add-student") return;
    open();
    clearIntent?.();
    // `open` intentionally snapshots the latest empty model when the intent arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearIntent, intent]);

  if (student) {
    return (
      <div className="page detail-page">
        <button className="back-link" type="button" onClick={() => changeSelected("")}>
          <ArrowLeft size={17} />
          Students
        </button>
        <section className="detail-hero">
          <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="large" />
          <div className="detail-identity">
            <h1>{student.fullName}</h1>
            <p>
              {student.code} · {student.guardianContact || "No parent/tutor registered"}
            </p>
            <EnrollmentTags student={student} groupsById={groupsById} />
          </div>
          <div className="hero-actions">
            <Button icon={Pencil} onClick={() => open(student)}>
              Edit student
            </Button>
            {student.status === "Active" ? (
              <button
                className="hero-icon"
                type="button"
                title="Archive student"
                aria-label="Archive student"
                onClick={() => setDeleteTarget({ type: "archive", student })}
              >
                <Archive size={18} />
              </button>
            ) : null}
            <button
              className="hero-icon danger"
              type="button"
              title="Delete student"
              aria-label="Delete student"
              onClick={() => setDeleteTarget({ type: "delete", student })}
            >
              <Trash2 size={18} />
            </button>
          </div>
        </section>
        <div className="detail-tabs" role="tablist" aria-label="Student details">
          {DETAIL_TABS.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={detailTab === tab}
              className={detailTab === tab ? "active" : ""}
              key={tab}
              onClick={() => setDetailTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <section className="detail-grid">
          <StudentDetailContent
            tab={detailTab}
            student={student}
            summary={summary}
            grades={studentGrades}
            classes={studentClasses}
            onEdit={() => open(student)}
          />
        </section>
        <Drawer
          open={Boolean(draft)}
          onClose={closeDraft}
          title="Edit student"
          description="Individual and group enrollment can be combined."
          footer={
            <>
              <Button onClick={closeDraft}>Cancel</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save student"}
              </Button>
            </>
          }
        >
          {draft ? (
            <StudentEditor
              draft={draft}
              setDraft={setDraft}
              groups={state.groups}
              defaultRate={state.settings.hourlyRate}
            />
          ) : null}
        </Drawer>
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title={deleteTarget?.type === "archive" ? `Archive ${student.fullName}?` : `Delete ${student.fullName}?`}
          description={
            deleteTarget?.type === "archive"
              ? "The student becomes inactive while grades, attendance, and payment history stay available."
              : "Students with grades or class history cannot be deleted; archive them instead."
          }
          confirmLabel={deleteTarget?.type === "archive" ? "Archive student" : "Delete student"}
          tone={deleteTarget?.type === "archive" ? "primary" : "danger"}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const removed =
              deleteTarget?.type === "archive"
                ? await actions.archiveStudent(student.id)
                : await actions.deleteStudent(student.id);
            if (removed) {
              setDeleteTarget(null);
              if (deleteTarget?.type === "delete") changeSelected("");
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Students</h1>
          <p>Keep profiles, enrollment, progress, and balances together.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => open()}>
          Add student
        </Button>
      </div>
      <div className="page-list-tools">
        <label className="page-search">
          <Search size={17} />
          <span className="sr-only">Search students</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search students, parents, or groups"
          />
        </label>
        <details className="student-filter-menu">
          <summary>
            <Filter size={16} />
            Filters{activeFilterCount ? <span>{activeFilterCount}</span> : null}
          </summary>
          <div className="student-filter-panel">
            <div className="filter-panel-heading">
              <strong>Filter students</strong>
              <div className="filter-panel-actions">
                {activeFilterCount ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStatus("all");
                      setFilters({ groupIds: [], groupMatch: "any", enrollment: [] });
                    }}
                  >
                    Clear all
                  </button>
                ) : null}
                <button
                  type="button"
                  className="filter-panel-done"
                  onClick={(event) => {
                    const menu = event.currentTarget.closest("details");
                    if (menu) menu.open = false;
                  }}
                >
                  Done
                </button>
              </div>
            </div>
            <fieldset>
              <legend>Status</legend>
              <div className="filter-status-options" role="group" aria-label="Filter students by status">
                {[
                  ["all", "All statuses"],
                  ["Active", "Active"],
                  ["Inactive", "Inactive"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={status === value ? "active" : ""}
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Enrollment</legend>
              {[
                ["individual", "Individual only"],
                ["group", "Group classes"],
                ["both", "Individual + group"],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={filters.enrollment.includes(value)}
                    onChange={() =>
                      setFilters((current) => ({
                        ...current,
                        enrollment: current.enrollment.includes(value)
                          ? current.enrollment.filter((item) => item !== value)
                          : [...current.enrollment, value],
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Groups</legend>
              <div className="filter-group-list">
                {state.groups.map((group) => (
                  <label key={group.id}>
                    <input
                      type="checkbox"
                      checked={filters.groupIds.includes(group.id)}
                      onChange={() =>
                        setFilters((current) => ({
                          ...current,
                          groupIds: current.groupIds.includes(group.id)
                            ? current.groupIds.filter((id) => id !== group.id)
                            : [...current.groupIds, group.id],
                        }))
                      }
                    />
                    {group.name}
                  </label>
                ))}
              </div>
              {filters.groupIds.length > 1 ? (
                <div className="filter-match">
                  <span>Match</span>
                  <button
                    type="button"
                    className={filters.groupMatch === "any" ? "active" : ""}
                    onClick={() => setFilters((current) => ({ ...current, groupMatch: "any" }))}
                  >
                    Any
                  </button>
                  <button
                    type="button"
                    className={filters.groupMatch === "all" ? "active" : ""}
                    onClick={() => setFilters((current) => ({ ...current, groupMatch: "all" }))}
                  >
                    All
                  </button>
                </div>
              ) : null}
            </fieldset>
          </div>
        </details>
      </div>
      <section className="people-list">
        {list.map((item) => {
          const itemSummary = derived.students.find((row) => row.id === item.id) || {};
          return (
            <button className="person-row" key={item.id} type="button" onClick={() => changeSelected(item.id)}>
              <StudentAvatar avatarId={item.avatarId} name={item.fullName} size="small" decorative />
              <span className="person-main">
                <strong>{item.fullName}</strong>
                <small>{item.guardianContact || item.phone || item.code}</small>
                <EnrollmentTags student={item} groupsById={groupsById} />
              </span>
              <span className="person-metric">
                <small>Attendance</small>
                <strong>{pct(itemSummary.attendance)}</strong>
              </span>
              <span className="person-metric">
                <small>Balance</small>
                <strong>{money(itemSummary.outstanding)}</strong>
              </span>
              <span className={item.status === "Active" ? "record-status active" : "record-status"}>{item.status}</span>
            </button>
          );
        })}
        {!list.length ? (
          <div className="empty-box">
            <UsersRound size={28} />
            <h2>No students found</h2>
            <p>Add a student or adjust your filters.</p>
          </div>
        ) : null}
      </section>
      <Drawer
        open={Boolean(draft)}
        onClose={closeDraft}
        title={draft?.id ? "Edit student" : "Add student"}
        description="Use individual classes, one or many groups, or both."
        footer={
          <>
            <Button onClick={closeDraft}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save student"}
            </Button>
          </>
        }
      >
        {draft ? (
          <StudentEditor
            draft={draft}
            setDraft={setDraft}
            groups={state.groups}
            defaultRate={state.settings.hourlyRate}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
