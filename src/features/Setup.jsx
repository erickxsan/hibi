import { uiText } from "../i18n/index.jsx";
const EMPTY_ROWS = Object.freeze([]);
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Download, Pencil, Plus, Trash2, Upload, UsersRound } from "lucide-react";
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
  Tabs,
  TextArea,
} from "../components/ui";
import { normalizeSearchText } from "../utils/searchText";
import { MAX_BACKUP_BYTES } from "../domain";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { getUiLocale, useI18n } from "../i18n";

const EMPTY_STUDENT = {
  studentCode: "",
  fullName: "",
  groupId: "",
  studentPhone: "",
  guardianContact: "",
  importantNotes: "",
  status: "Active",
};

const EMPTY_GROUP = {
  name: "",
  grade: "",
  subject: "Mathematics",
  scheduleRoom: "",
  plannedSessionsPerMonth: 8,
  assistantContact: "",
  notes: "",
};

const formatPercent = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
const formatMxn = (value) =>
  new Intl.NumberFormat(getUiLocale(), { style: "currency", currency: "MXN" }).format(value || 0);

export default function Setup({
  state,
  derived,
  actions,
  persistenceMode,
  intent,
  clearIntent,
  registerNavigationBlocker,
}) {
  const { t: uiT } = useI18n();
  const { language } = useI18n();
  const [tab, setTab] = useState("students");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [studentDraft, setStudentDraft] = useState(null);
  const [groupDraft, setGroupDraft] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(state.settings);
  const importRef = useRef(null);
  const studentBaselineRef = useRef(null);
  const groupBaselineRef = useRef(null);

  const groups = state.groups || EMPTY_ROWS;
  const students = state.students || EMPTY_ROWS;
  const studentSummaries = derived.studentSummaries || derived.dashboard?.studentSummaries || EMPTY_ROWS;
  const summaryById = useMemo(
    () => new Map(studentSummaries.map((student) => [student.id || student.studentId, student])),
    [studentSummaries],
  );
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const studentDirty = Boolean(studentDraft) && draftChanged(studentDraft, studentBaselineRef.current);
  const groupDirty = Boolean(groupDraft) && draftChanged(groupDraft, groupBaselineRef.current);
  const settingsDirty = draftChanged(settingsDraft, state.settings);
  const hasUnsavedChanges = studentDirty || groupDirty || settingsDirty;

  useUnsavedChanges(registerNavigationBlocker, hasUnsavedChanges, "Discard your unsaved Setup changes?");

  const changeTab = useHistoryBackedState({
    key: "setup-tab",
    value: tab,
    onChange: (nextTab) => {
      setTab(nextTab);
      setSearch("");
    },
    defaultValue: "students",
    allowedValues: ["students", "groups", "preferences"],
    canChange: ({ from, to }) =>
      from !== "preferences" ||
      from === to ||
      confirmDiscard(settingsDirty, "Discard your unsaved preference changes?"),
  });

  const openStudent = useCallback((student) => {
    const next = { ...student };
    studentBaselineRef.current = next;
    setStudentDraft(next);
  }, []);

  const openGroup = useCallback((group) => {
    const next = { ...group };
    groupBaselineRef.current = next;
    setGroupDraft(next);
  }, []);

  const closeStudent = () => {
    if (!confirmDiscard(studentDirty, "Discard your unsaved student changes?")) return false;
    studentBaselineRef.current = null;
    setStudentDraft(null);
    return true;
  };

  const closeGroup = () => {
    if (!confirmDiscard(groupDirty, "Discard your unsaved group changes?")) return false;
    groupBaselineRef.current = null;
    setGroupDraft(null);
    return true;
  };

  useEffect(() => setSettingsDraft(state.settings), [state.settings]);
  useEffect(() => {
    if (intent !== "add-student") return;
    setTab("students");
    openStudent(EMPTY_STUDENT);
    clearIntent?.();
  }, [clearIntent, intent, openStudent]);

  const visibleStudents = useMemo(() => {
    const needle = normalizeSearchText(search);
    return students.filter((student) => {
      if (statusFilter !== "all" && student.status !== statusFilter) return false;
      const groupName = groupById.get(student.groupId)?.name || "Unassigned";
      return (
        !needle ||
        [student.studentCode, student.fullName, groupName, student.guardianContact].some((value) =>
          normalizeSearchText(value).includes(needle),
        )
      );
    });
  }, [groupById, search, statusFilter, students]);

  const visibleGroups = useMemo(() => {
    const needle = normalizeSearchText(search);
    return groups.filter(
      (group) =>
        !needle ||
        [group.name, group.grade, group.subject, group.scheduleRoom].some((value) =>
          normalizeSearchText(value).includes(needle),
        ),
    );
  }, [groups, search]);

  const saveStudent = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (await actions.upsertStudent(studentDraft)) {
        studentBaselineRef.current = null;
        setStudentDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveGroup = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (await actions.upsertGroup(groupDraft)) {
        groupBaselineRef.current = null;
        setGroupDraft(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await actions.updateSettings(settingsDraft);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      let saved = false;
      if (deleteTarget.type === "archive-student") saved = await actions.archiveStudent(deleteTarget.item.id);
      if (deleteTarget.type === "student") saved = await actions.deleteStudent(deleteTarget.item.id);
      if (deleteTarget.type === "group") saved = await actions.deleteGroup(deleteTarget.item.id);
      if (deleteTarget.type === "clear-local") saved = actions.clearLegacyLocalData();
      if (saved) setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setSaving(true);
    try {
      if (await actions.importJson(pendingImport.text)) setPendingImport(null);
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      actions.notify("That backup is larger than the 5 MB safety limit.", "error");
      event.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const counts = {
        students: Array.isArray(parsed?.students) ? parsed.students.length : 0,
        groups: Array.isArray(parsed?.groups) ? parsed.groups.length : 0,
        grades: Array.isArray(parsed?.grades) ? parsed.grades.length : 0,
        classes: Array.isArray(parsed?.classLog) ? parsed.classLog.length : 0,
      };
      setPendingImport({ text, name: file.name, counts });
    } catch {
      actions.notify("The selected file is not valid JSON.", "error");
    }
    event.target.value = "";
  };

  return (
    <div className="page page-setup">
      <SectionHeading
        title={uiT("Setup")}
        description={uiT("Keep groups, students, and pricing in one dependable place.")}
        actions={
          tab === "students" ? (
            <Button variant="primary" icon={Plus} onClick={() => openStudent(EMPTY_STUDENT)}>
              {uiT("Add student")}
            </Button>
          ) : tab === "groups" ? (
            <Button variant="primary" icon={Plus} onClick={() => openGroup(EMPTY_GROUP)}>
              {uiT("Add group")}
            </Button>
          ) : null
        }
      />

      <Tabs
        value={tab}
        onChange={changeTab}
        ariaLabel={uiT("Setup sections")}
        items={[
          { value: "students", label: "Students" },
          { value: "groups", label: "Groups" },
          { value: "preferences", label: "Preferences" },
        ]}
      />

      {tab !== "preferences" ? (
        <div className="toolbar-row">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={uiT("Search {p0}", { p0: tab })}
          />
          {tab === "students" ? (
            <Select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label={uiT("Filter students by status")}
            >
              <option value="all">{uiT("All statuses")}</option>
              <option value="Active">{uiT("Active")}</option>
              <option value="Inactive">{uiT("Inactive")}</option>
            </Select>
          ) : null}
          <span className="toolbar-count">
            {(() => {
              const count = tab === "students" ? visibleStudents.length : visibleGroups.length;
              if (language !== "es") return `${count} ${tab}`;
              const noun = tab === "students" ? (count === 1 ? "alumno" : "alumnos") : count === 1 ? "grupo" : "grupos";
              return `${count} ${noun}`;
            })()}
          </span>
        </div>
      ) : null}

      {tab === "students" ? (
        visibleStudents.length ? (
          <TableShell label={uiT("Students")}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="sticky-cell">
                    {uiT("Student")}
                  </th>
                  <th scope="col">{uiT("Group")}</th>
                  <th scope="col">{uiT("Guardian / contact")}</th>
                  <th scope="col">{uiT("Status")}</th>
                  <th scope="col" className="numeric">
                    {uiT("Grade")}
                  </th>
                  <th scope="col" className="numeric">
                    {uiT("Attendance")}
                  </th>
                  <th scope="col" className="numeric">
                    {uiT("Missing")}
                  </th>
                  <th scope="col" className="numeric">
                    {uiT("Outstanding")}
                  </th>
                  <th scope="col" aria-label={uiT("Actions")} />
                </tr>
              </thead>
              <tbody>
                {visibleStudents.map((student) => {
                  const summary = summaryById.get(student.id) || {};
                  return (
                    <tr key={student.id}>
                      <th scope="row" className="sticky-cell">
                        <div className="person-cell">
                          <span className="avatar avatar-lilac">
                            {student.fullName
                              ?.split(/\s+/)
                              .map((part) => part[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <div>
                            <strong>{student.fullName}</strong>
                            <span>{student.studentCode}</span>
                          </div>
                        </div>
                      </th>
                      <td>{groupById.get(student.groupId)?.name || uiT("Unassigned")}</td>
                      <td className="wrap-cell">{student.guardianContact || "—"}</td>
                      <td>
                        <StatusBadge tone={student.status === "Active" ? "success" : "neutral"}>
                          {uiT(student.status)}
                        </StatusBadge>
                      </td>
                      <td className="numeric">{formatPercent(summary.gradeAverage)}</td>
                      <td className="numeric">{formatPercent(summary.attendanceRate)}</td>
                      <td className="numeric">{summary.missingCount ?? 0}</td>
                      <td className="numeric">{formatMxn(summary.outstanding)}</td>
                      <td>
                        <div className="row-actions">
                          <IconButton
                            label={uiT("Edit {p0}", { p0: student.fullName })}
                            icon={Pencil}
                            onClick={() => openStudent(student)}
                          />
                          <IconButton
                            label={uiT("Archive {p0}", { p0: student.fullName })}
                            icon={Archive}
                            onClick={() => setDeleteTarget({ type: "archive-student", item: student })}
                          />
                          <IconButton
                            label={uiT("Delete {p0}", { p0: student.fullName })}
                            icon={Trash2}
                            onClick={() => setDeleteTarget({ type: "student", item: student })}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState
            icon={UsersRound}
            title={uiT("No students found")}
            description={uiT("Try another filter or add your first student.")}
            action={
              <Button icon={Plus} onClick={() => openStudent(EMPTY_STUDENT)}>
                {uiT("Add student")}
              </Button>
            }
          />
        )
      ) : null}

      {tab === "groups" ? (
        visibleGroups.length ? (
          <TableShell label={uiT("Groups")}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="sticky-cell">
                    {uiT("Group")}
                  </th>
                  <th scope="col">{uiT("Grade")}</th>
                  <th scope="col">{uiT("Subject")}</th>
                  <th scope="col">{uiT("Schedule / room")}</th>
                  <th scope="col" className="numeric">
                    {uiT("Sessions / month")}
                  </th>
                  <th scope="col">{uiT("Assistant / contact")}</th>
                  <th scope="col" className="numeric">
                    {uiT("Active students")}
                  </th>
                  <th scope="col" className="numeric">
                    {uiT("Ideal revenue")}
                  </th>
                  <th scope="col" aria-label={uiT("Actions")} />
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((group) => {
                  const summary = derived.groupSummaries?.find((item) => (item.id || item.groupId) === group.id) || {};
                  return (
                    <tr key={group.id}>
                      <th scope="row" className="sticky-cell">
                        <strong>{group.name}</strong>
                      </th>
                      <td>{group.grade || "—"}</td>
                      <td>{group.subject || "—"}</td>
                      <td>{group.scheduleRoom || "—"}</td>
                      <td className="numeric">{group.plannedSessionsPerMonth ?? 0}</td>
                      <td>{group.assistantContact || "—"}</td>
                      <td className="numeric">{summary.activeStudentCount ?? 0}</td>
                      <td className="numeric">{formatMxn(summary.idealRevenue)}</td>
                      <td>
                        <div className="row-actions">
                          <IconButton
                            label={uiT("Edit {p0}", { p0: group.name })}
                            icon={Pencil}
                            onClick={() => openGroup(group)}
                          />
                          <IconButton
                            label={uiT("Delete {p0}", { p0: group.name })}
                            icon={Trash2}
                            onClick={() => setDeleteTarget({ type: "group", item: group })}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        ) : (
          <EmptyState
            title={uiT("No groups found")}
            description={uiT("Try another search or add a group.")}
            action={
              <Button icon={Plus} onClick={() => openGroup(EMPTY_GROUP)}>
                {uiT("Add group")}
              </Button>
            }
          />
        )
      ) : null}

      {tab === "preferences" ? (
        <div className="preferences-layout">
          <form className="preferences-form" onSubmit={saveSettings}>
            <div className="panel-heading">
              <h2>{uiT("Class and alert defaults")}</h2>
              <p>{uiT("Changes recalculate charges, balances, and projections immediately.")}</p>
            </div>
            <div className="form-grid two-columns">
              <Field label={uiT("Hourly rate (MXN)")} required>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={settingsDraft.hourlyRateMxn}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, hourlyRateMxn: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label={uiT("Default class hours")} required>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.25"
                  value={settingsDraft.defaultClassHours}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, defaultClassHours: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label={uiT("Recent projection window")} hint={uiT("Number of recent weeks")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={settingsDraft.recentProjectionWeeks}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, recentProjectionWeeks: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label={uiT("Low grade threshold")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(settingsDraft.lowGradeThreshold * 100)}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, lowGradeThreshold: Number(event.target.value) / 100 })
                  }
                />
              </Field>
              <Field label={uiT("Low attendance threshold")}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(settingsDraft.lowAttendanceThreshold * 100)}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, lowAttendanceThreshold: Number(event.target.value) / 100 })
                  }
                />
              </Field>
            </div>
            <div className="form-actions">
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? uiT("Saving…") : uiT("Save preferences")}
              </Button>
            </div>
          </form>

          <section className="data-tools" aria-labelledby="data-tools-title">
            <div className="panel-heading">
              <h2 id="data-tools-title">{uiT("Backup and restore")}</h2>
              <p>
                {persistenceMode === "cloud"
                  ? uiT(
                      "Your records sync to your private cloud workspace. Export a backup whenever you want an offline copy.",
                    )
                  : uiT("Your records stay in this browser unless you export a backup.")}
              </p>
            </div>
            <p className="privacy-note">
              {uiT(
                "JSON backups contain personal, grade, attendance, and payment information in readable text. Keep them in a private, protected location.",
              )}
            </p>
            <div className="stacked-actions">
              <Button icon={Download} onClick={actions.exportJson}>
                {uiT("Download JSON backup")}
              </Button>
              <Button icon={Upload} onClick={() => importRef.current?.click()}>
                {uiT("Restore JSON backup")}
              </Button>
              <input ref={importRef} type="file" accept="application/json,.json" onChange={handleImport} hidden />
              {persistenceMode === "cloud" ? (
                <Button icon={Trash2} onClick={() => setDeleteTarget({ type: "clear-local" })}>
                  {uiT("Remove old local browser copy")}
                </Button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <Drawer
        open={Boolean(studentDraft)}
        onClose={closeStudent}
        title={studentDraft?.id ? uiT("Edit student") : uiT("Add student")}
        description={uiT("Student indicators are calculated automatically.")}
        footer={
          <>
            <Button onClick={closeStudent} disabled={saving}>
              {uiT("Cancel")}
            </Button>
            <Button variant="primary" type="submit" form="student-form" disabled={saving}>
              {saving ? uiT("Saving…") : uiT("Save student")}
            </Button>
          </>
        }
      >
        {studentDraft ? (
          <form id="student-form" className="drawer-form" onSubmit={saveStudent}>
            <div className="form-grid two-columns">
              <Field label={uiT("Student ID")} required>
                <Input
                  value={studentDraft.studentCode}
                  onChange={(event) => setStudentDraft({ ...studentDraft, studentCode: event.target.value })}
                />
              </Field>
              <Field label={uiT("Status")}>
                <Select
                  value={studentDraft.status}
                  onChange={(event) => setStudentDraft({ ...studentDraft, status: event.target.value })}
                >
                  <option value="Active">{uiT("Active")}</option>
                  <option value="Inactive">{uiT("Inactive")}</option>
                </Select>
              </Field>
            </div>
            <Field label={uiT("Full name")} required>
              <Input
                value={studentDraft.fullName}
                onChange={(event) => setStudentDraft({ ...studentDraft, fullName: event.target.value })}
              />
            </Field>
            <Field label={uiT("Group")} hint={uiT("Optional — you can assign this later")}>
              <Select
                value={studentDraft.groupId}
                onChange={(event) => setStudentDraft({ ...studentDraft, groupId: event.target.value })}
              >
                <option value="">{uiT("Unassigned / no group")}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={uiT("Student phone")}>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={studentDraft.studentPhone}
                onChange={(event) => setStudentDraft({ ...studentDraft, studentPhone: event.target.value })}
              />
            </Field>
            <Field label={uiT("Guardian / contact")}>
              <TextArea
                rows="3"
                value={studentDraft.guardianContact}
                onChange={(event) => setStudentDraft({ ...studentDraft, guardianContact: event.target.value })}
              />
            </Field>
            <Field label={uiT("Important notes")}>
              <TextArea
                rows="4"
                value={studentDraft.importantNotes}
                onChange={(event) => setStudentDraft({ ...studentDraft, importantNotes: event.target.value })}
              />
            </Field>
          </form>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(groupDraft)}
        onClose={closeGroup}
        title={groupDraft?.id ? uiT("Edit group") : uiT("Add group")}
        description={uiT("Planned monthly sessions drive the ideal revenue projection.")}
        footer={
          <>
            <Button onClick={closeGroup} disabled={saving}>
              {uiT("Cancel")}
            </Button>
            <Button variant="primary" type="submit" form="group-form" disabled={saving}>
              {saving ? uiT("Saving…") : uiT("Save group")}
            </Button>
          </>
        }
      >
        {groupDraft ? (
          <form id="group-form" className="drawer-form" onSubmit={saveGroup}>
            <Field label={uiT("Group name")} required>
              <Input
                value={groupDraft.name}
                onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })}
              />
            </Field>
            <div className="form-grid two-columns">
              <Field label={uiT("Grade")}>
                <Input
                  value={groupDraft.grade}
                  onChange={(event) => setGroupDraft({ ...groupDraft, grade: event.target.value })}
                />
              </Field>
              <Field label={uiT("Subject")}>
                <Input
                  value={groupDraft.subject}
                  onChange={(event) => setGroupDraft({ ...groupDraft, subject: event.target.value })}
                />
              </Field>
            </div>
            <Field label={uiT("Schedule / room")}>
              <Input
                value={groupDraft.scheduleRoom}
                onChange={(event) => setGroupDraft({ ...groupDraft, scheduleRoom: event.target.value })}
              />
            </Field>
            <Field label={uiT("Planned sessions / month")}>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={groupDraft.plannedSessionsPerMonth}
                onChange={(event) =>
                  setGroupDraft({ ...groupDraft, plannedSessionsPerMonth: Number(event.target.value) })
                }
              />
            </Field>
            <Field label={uiT("Assistant / contact")}>
              <TextArea
                rows="3"
                value={groupDraft.assistantContact}
                onChange={(event) => setGroupDraft({ ...groupDraft, assistantContact: event.target.value })}
              />
            </Field>
            <Field label={uiT("Notes")}>
              <TextArea
                rows="4"
                value={groupDraft.notes}
                onChange={(event) => setGroupDraft({ ...groupDraft, notes: event.target.value })}
              />
            </Field>
          </form>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.type === "clear-local"
            ? uiT("Remove the old local copy?")
            : deleteTarget?.type === "archive-student"
              ? uiT("Archive {p0}?", { p0: deleteTarget?.item?.fullName || "student" })
              : uiT("Delete {p0}?", { p0: deleteTarget?.item?.fullName || deleteTarget?.item?.name || "record" })
        }
        description={
          deleteTarget?.type === "archive-student"
            ? uiT("The student becomes inactive while grade, attendance, and payment history stays available.")
            : deleteTarget?.type === "group"
              ? uiT("Groups with assigned students cannot be deleted.")
              : deleteTarget?.type === "clear-local"
                ? uiT(
                    "This removes only the legacy browser copy on this device. Your signed-in cloud workspace remains available.",
                  )
                : uiT("This cannot be undone without a JSON backup.")
        }
        confirmLabel={
          deleteTarget?.type === "archive-student"
            ? uiT("Archive student")
            : deleteTarget?.type === "clear-local"
              ? uiT("Remove local copy")
              : uiT("Delete")
        }
        tone={deleteTarget?.type === "archive-student" ? "primary" : "danger"}
        busy={saving}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title={uiT("Restore this backup?")}
        description={
          pendingImport
            ? uiT(
                "{p0} contains {p1} students, {p2} groups, {p3} grades, and {p4} class records. Restoring replaces the data currently saved in {p5}.",
                {
                  p0: pendingImport.name,
                  p1: pendingImport.counts.students,
                  p2: pendingImport.counts.groups,
                  p3: pendingImport.counts.grades,
                  p4: pendingImport.counts.classes,
                  p5: uiText(persistenceMode === "cloud" ? "your cloud workspace" : "this browser"),
                },
              )
            : ""
        }
        confirmLabel={uiT("Restore backup")}
        tone="primary"
        busy={saving}
        onClose={() => setPendingImport(null)}
        onConfirm={confirmImport}
      />
    </div>
  );
}
