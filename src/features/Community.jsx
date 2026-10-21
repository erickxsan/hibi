import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronRight, Plus, Search, UsersRound } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import {
  AttendanceRing,
  BottomSheet,
  Button,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  Input,
  ListRow,
  SectionHeading,
  Segmented,
  Tabs,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { useCompactViewport } from "../components/OverlayContext";
import { confirmDiscard, draftChanged, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { isGroupArchived } from "../domain/groupArchiving";
import { gradeGroupId } from "../domain/semanticIdentity";
import { normalizeGroupBilling } from "../domain/monthlyBilling";
import { todayDateOnly } from "../domain/dates";
import { formatPercent, formatShortDate } from "../utils/displayFormat";
import { normalizeSearchText } from "../utils/searchText";
import { buildClassWorkspaceSessionsForRange } from "./classesWorkspaceModel";
import { addDays } from "../domain/dates";
import { groupScheduleShort, studentGroupIdsOf } from "./groupLabels";
import {
  archivedGroupHistory,
  billingChanges,
  billingDraftFor,
  groupAttendanceGrid,
  groupMonth,
  joinGroup,
  sortStudentsByAttention,
  studentMonths,
  studentRecentClasses,
} from "./communityModel";
import { BillingFields, GroupEditor, StudentEditor } from "./CommunityEditors";
import { groupNamesOf, StudentDetail, StudentSheet, studentContext } from "./CommunityStudent";
import {
  ArchiveGroupDialog,
  ArchivedGroupView,
  GroupDetail,
  GroupSheet,
  groupPaymentLine,
  JoinGroupSheet,
} from "./CommunityGroup";
import "./community.css";

const COMMUNITY_VIEWS = Object.freeze(["all", "students", "groups"]);
const VIEW_TABS = [
  { value: "all", label: "All" },
  { value: "students", label: "Students" },
  { value: "groups", label: "Groups" },
];
const EMPTY_STUDENT = Object.freeze({
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
const NEW_GROUP_BILLING = Object.freeze({
  mode: "perClass",
  monthlyFee: null,
  due: { type: "dayOfMonth", day: 5 },
  effectiveFrom: "",
  creditFirstMonth: false,
  hourlyRate: null,
  adjustments: {},
});

/** @param {any} [student] */
function cloneStudent(student = EMPTY_STUDENT) {
  return {
    ...EMPTY_STUDENT,
    ...student,
    code: student.code ?? "",
    studentEmail: student.studentEmail ?? student.email ?? "",
    guardianPhone: student.guardianPhone ?? student.parentPhone ?? "",
    phone: student.phone ?? "",
    notes: student.notes ?? "",
    groupIds: [...studentGroupIdsOf(student)],
  };
}

function cloneGroup(group = EMPTY_GROUP) {
  return { ...EMPTY_GROUP, ...group, weeklySchedule: (group.weeklySchedule || []).map((slot) => ({ ...slot })) };
}

function initialCommunityView(explicitView) {
  if (COMMUNITY_VIEWS.includes(explicitView)) return explicitView;
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/students")) return "students";
  if (typeof window !== "undefined" && window.location.pathname.startsWith("/groups")) return "groups";
  return "all";
}

const DISCARD = "Discard your unsaved community changes?";

/** A student in the desktop lists: avatar, name, context and a status dot. */
function StudentRow({ student, context, selected, onSelect, extra = null, dot = "" }) {
  const { t } = useI18n();
  return (
    <div className={`sr ${selected ? "sel" : ""}`}>
      <button
        type="button"
        className="sr-main"
        aria-current={selected ? "true" : undefined}
        aria-label={t("Open {name}", { name: student.fullName })}
        onClick={() => onSelect(student.id)}
      >
        <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
        <span className="sr-text">
          <strong>{student.fullName}</strong>
          <small className={context.tone ? `text-${context.tone}` : undefined}>{context.text}</small>
        </span>
        {dot ? <span className={`sr-dot dot-${dot}`} aria-hidden="true" /> : null}
        {context.value ? <b className="sr-value text-bad">{context.value}</b> : null}
      </button>
      {extra}
    </div>
  );
}

export default function Community({
  state,
  derived,
  actions,
  intent,
  clearIntent,
  initialView,
  registerNavigationBlocker,
  archiveScope,
  openPage = undefined,
}) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const asOf = state.settings?.asOfDate || todayDateOnly();
  const [view, setView] = useState(() => initialCommunityView(initialView));
  const [query, setQuery] = useState("");
  const [studentArchivesOpen, setStudentArchivesOpen] = useState(false);
  const [groupArchivesOpen, setGroupArchivesOpen] = useState(false);
  const [selected, setSelected] = useState(() => ({ type: "", id: "" }));
  const [sheet, setSheet] = useState(null);
  const [billingSheet, setBillingSheet] = useState(false);
  const [studentDraft, setStudentDraft] = useState(null);
  const [groupDraft, setGroupDraft] = useState(null);
  const [billingDraft, setBillingDraft] = useState(null);
  const [applyFrom, setApplyFrom] = useState("next");
  const [studentEditor, setStudentEditor] = useState(null);
  const [groupEditor, setGroupEditor] = useState(null);
  const [newGroupBilling, setNewGroupBilling] = useState(NEW_GROUP_BILLING);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [joinTarget, setJoinTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingCode, setPendingCode] = useState("");
  const baselines = useRef({ student: null, group: null, billing: null, studentEditor: null, groupEditor: null });

  const groupsById = useMemo(() => new Map(state.groups.map((group) => [group.id, group])), [state.groups]);
  const activeStudents = useMemo(
    () => state.students.filter((student) => student.status !== "Inactive"),
    [state.students],
  );
  const months = useMemo(
    () => studentMonths(state, derived, asOf, activeStudents),
    [activeStudents, asOf, derived, state],
  );
  const activeGroups = useMemo(() => state.groups.filter((group) => !isGroupArchived(group)), [state.groups]);
  const archivedGroups = useMemo(() => state.groups.filter(isGroupArchived), [state.groups]);
  const membersOf = useCallback(
    (group) =>
      isGroupArchived(group)
        ? state.students.filter(
            (student) =>
              studentGroupIdsOf(student).includes(group.id) ||
              state.classLog.some((row) => row.groupId === group.id && row.studentId === student.id) ||
              state.grades.some((row) => gradeGroupId(row) === group.id && row.studentId === student.id),
          )
        : activeStudents.filter((student) => studentGroupIdsOf(student).includes(group.id)),
    [activeStudents, state.classLog, state.grades, state.students],
  );
  const groupSummaries = useMemo(
    () => new Map(activeGroups.map((group) => [group.id, groupMonth(state, derived, group, asOf, membersOf(group))])),
    [activeGroups, asOf, derived, membersOf, state],
  );
  const upcoming = useMemo(
    () =>
      buildClassWorkspaceSessionsForRange(state, asOf, addDays(asOf, 30), asOf).filter((session) =>
        ["Scheduled", "Rescheduled"].includes(session.statusLabel),
      ),
    [asOf, state],
  );

  const needle = normalizeSearchText(query);
  const studentMatches = useCallback(
    (student) =>
      !needle ||
      normalizeSearchText(
        [
          student.fullName,
          student.code,
          student.studentEmail,
          student.guardianPhone,
          student.phone,
          ...studentGroupIdsOf(student).map((id) => groupsById.get(id)?.name || ""),
        ].join(" "),
      ).includes(needle),
    [groupsById, needle],
  );
  const groupMatches = useCallback(
    (group) =>
      !needle ||
      normalizeSearchText([group.name, group.subject, group.grade, group.schedule].join(" ")).includes(needle),
    [needle],
  );
  const visibleActive = activeStudents.filter(studentMatches);
  const visibleInactive = state.students.filter((student) => student.status === "Inactive" && studentMatches(student));
  const visibleGroups = activeGroups.filter(groupMatches);
  const visibleArchivedGroups = archivedGroups.filter(groupMatches);
  const sortedStudents = sortStudentsByAttention(visibleActive.map((student) => months.get(student.id)));
  const pending = sortedStudents.filter((month) => month.flag.kind !== "ok");
  const upToDate = sortedStudents.filter((month) => month.flag.kind === "ok");

  const selectedStudent =
    selected.type === "student" ? state.students.find((item) => item.id === selected.id) || null : null;
  const selectedGroup = selected.type === "group" ? state.groups.find((item) => item.id === selected.id) || null : null;
  const selectedMembers = useMemo(() => (selectedGroup ? membersOf(selectedGroup) : []), [membersOf, selectedGroup]);
  const sheetStudent = sheet?.type === "student" ? state.students.find((item) => item.id === sheet.id) || null : null;
  const sheetGroup = sheet?.type === "group" ? state.groups.find((item) => item.id === sheet.id) || null : null;
  const focusGroup = compact ? sheetGroup : selectedGroup;
  const focusMembers = useMemo(() => (focusGroup ? membersOf(focusGroup) : []), [focusGroup, membersOf]);

  // Pick something to show first on desktop.
  useEffect(() => {
    if (compact) return;
    const stillVisible =
      (selectedStudent &&
        (selectedStudent.status === "Inactive" ? visibleInactive : visibleActive).some(
          (item) => item.id === selectedStudent.id,
        )) ||
      (selectedGroup && [...visibleGroups, ...visibleArchivedGroups].some((item) => item.id === selectedGroup.id));
    if (stillVisible) {
      if (view === "groups" && selectedStudent && visibleGroups[0])
        setSelected({ type: "group", id: visibleGroups[0].id });
      return;
    }
    if (view === "groups") setSelected({ type: visibleGroups[0] ? "group" : "", id: visibleGroups[0]?.id || "" });
    else if (sortedStudents[0]) setSelected({ type: "student", id: sortedStudents[0].student.id });
    else if (visibleGroups[0]) setSelected({ type: "group", id: visibleGroups[0].id });
    else setSelected({ type: "", id: "" });
  }, [
    compact,
    selectedGroup,
    selectedStudent,
    sortedStudents,
    view,
    visibleActive,
    visibleArchivedGroups,
    visibleGroups,
    visibleInactive,
  ]);

  // A new student is selected once the saved record arrives.
  useEffect(() => {
    if (!pendingCode) return;
    const created = state.students.find((student) => student.code === pendingCode);
    if (!created) return;
    setPendingCode("");
    setSelected({ type: "student", id: created.id });
    if (created.status === "Inactive") setStudentArchivesOpen(true);
  }, [pendingCode, state.students]);

  // Drafts follow the selected record.
  useEffect(() => {
    if (!selectedStudent) {
      setStudentDraft(null);
      return;
    }
    const next = cloneStudent(selectedStudent);
    baselines.current.student = next;
    setStudentDraft(next);
  }, [selectedStudent]);
  useEffect(() => {
    if (!focusGroup || isGroupArchived(focusGroup)) {
      setGroupDraft(null);
      setBillingDraft(null);
      return;
    }
    const nextGroup = cloneGroup(focusGroup);
    const nextBilling = billingDraftFor(focusGroup, focusMembers);
    baselines.current.group = nextGroup;
    baselines.current.billing = nextBilling;
    setGroupDraft(nextGroup);
    setBillingDraft(nextBilling);
    setApplyFrom("next");
  }, [focusGroup, focusMembers]);

  const studentDirty = Boolean(studentDraft) && draftChanged(studentDraft, baselines.current.student);
  const groupDirty =
    (Boolean(groupDraft) && draftChanged(groupDraft, baselines.current.group)) ||
    (Boolean(billingDraft) && draftChanged(billingDraft, baselines.current.billing));
  const editorDirty =
    (Boolean(studentEditor) && draftChanged(studentEditor, baselines.current.studentEditor)) ||
    (Boolean(groupEditor) && draftChanged(groupEditor, baselines.current.groupEditor));
  const dirty = studentDirty || groupDirty || editorDirty;
  useUnsavedChanges(registerNavigationBlocker, dirty, DISCARD);

  const changeView = useHistoryBackedState({
    key: "community-view",
    value: view,
    onChange: setView,
    defaultValue: initialCommunityView(initialView),
    allowedValues: COMMUNITY_VIEWS,
    canChange: () => confirmDiscard(studentDirty || groupDirty, DISCARD),
  });

  const select = (type, id) => {
    if (compact) {
      setSheet({ type, id });
      return;
    }
    if (selected.type === type && selected.id === id) return;
    if (!confirmDiscard(studentDirty || groupDirty, DISCARD)) return;
    setSelected({ type, id });
  };

  const openStudentEditor = (student = EMPTY_STUDENT) => {
    const next = cloneStudent(student);
    baselines.current.studentEditor = next;
    setStudentEditor(next);
  };
  const closeStudentEditor = () => {
    if (
      !confirmDiscard(
        Boolean(studentEditor) && draftChanged(studentEditor, baselines.current.studentEditor),
        "Discard your unsaved student changes?",
      )
    )
      return false;
    setStudentEditor(null);
    return true;
  };
  const openGroupEditor = (group = EMPTY_GROUP) => {
    const next = cloneGroup(group);
    baselines.current.groupEditor = next;
    setNewGroupBilling(NEW_GROUP_BILLING);
    setGroupEditor(next);
  };
  const closeGroupEditor = () => {
    if (
      !confirmDiscard(
        Boolean(groupEditor) && draftChanged(groupEditor, baselines.current.groupEditor),
        "Discard your unsaved group changes?",
      )
    )
      return false;
    setGroupEditor(null);
    return true;
  };

  useEffect(() => {
    if (intent?.type === "open-group-archives") {
      changeView("groups", { replace: true });
      setGroupArchivesOpen(true);
      const first = state.groups.find(isGroupArchived);
      if (first) select("group", first.id);
    }
    if (intent === "students" || intent === "groups" || intent === "all") changeView(intent, { replace: true });
    if (intent === "add-student") openStudentEditor();
    if (intent === "add-group") openGroupEditor();
    if (intent) clearIntent?.();
    // Intents are consumed once with the latest editor defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const runSave = async (task) => {
    if (saving) return false;
    setSaving(true);
    try {
      return await task();
    } finally {
      setSaving(false);
    }
  };
  const saveStudentDetail = () =>
    runSave(async () => {
      if (!studentDraft) return false;
      const saved = await actions.upsertStudent(studentDraft);
      if (saved) baselines.current.student = cloneStudent(studentDraft);
      return saved;
    });
  const saveStudentEditor = () =>
    runSave(async () => {
      if (!studentEditor) return false;
      const saved = await actions.upsertStudent(studentEditor);
      if (saved) {
        setStudentEditor(null);
        if (!compact && studentEditor.id) setSelected({ type: "student", id: studentEditor.id });
        else if (!compact) setPendingCode(studentEditor.code);
      }
      return saved;
    });
  const saveGroupEditor = () =>
    runSave(async () => {
      if (!groupEditor) return false;
      let saved;
      if (groupEditor.id) saved = await actions.upsertGroup(groupEditor);
      else {
        const { billing } = billingChanges(groupEditor, [], newGroupBilling, asOf);
        const draft = { ...groupEditor, hourlyRate: newGroupBilling.hourlyRate ?? groupEditor.hourlyRate, billing };
        saved = actions.saveGroupBilling ? await actions.saveGroupBilling(draft, {}) : await actions.upsertGroup(draft);
      }
      if (saved) {
        setGroupEditor(null);
        if (groupEditor.id && !compact) setSelected({ type: "group", id: groupEditor.id });
        changeView("groups", { replace: true });
      }
      return saved;
    });
  const saveGroupDetail = (group) =>
    runSave(async () => {
      if (!groupDraft || !billingDraft) return false;
      const members = membersOf(group);
      const { billing, overrides } = billingChanges(group, members, billingDraft, asOf, applyFrom);
      const draft = { ...group, name: groupDraft.name, hourlyRate: billingDraft.hourlyRate, billing };
      const saved = actions.saveGroupBilling
        ? await actions.saveGroupBilling(draft, overrides)
        : await actions.upsertGroup(draft);
      if (saved) {
        baselines.current.group = { ...groupDraft };
        baselines.current.billing = { ...billingDraft };
        setBillingSheet(false);
      }
      return saved;
    });
  const confirmAction = async () => {
    const target = confirmTarget;
    if (!target) return;
    let completed = false;
    if (target.action === "archive-student") completed = await actions.archiveStudent(target.item.id);
    if (target.action === "delete-student") completed = await actions.deleteStudent(target.item.id);
    if (target.action === "delete-group") completed = await actions.deleteGroup(target.item.id);
    if (completed) {
      setConfirmTarget(null);
      setStudentEditor(null);
      setGroupEditor(null);
      setSheet(null);
      if (selected.id === target.item.id) setSelected({ type: "", id: "" });
    }
  };
  const archiveGroup = () =>
    runSave(async () => {
      if (!archiveTarget) return false;
      const done = await actions.archiveGroup(archiveTarget.id);
      if (done) {
        setArchiveTarget(null);
        setSheet(null);
        setGroupArchivesOpen(true);
      }
      return done;
    });
  const reactivateGroup = (group) => runSave(() => actions.reactivateGroup(group.id));
  const reactivateStudent = (student) => runSave(() => actions.upsertStudent({ ...student, status: "Active" }));
  const join = (student, choice) =>
    runSave(async () => {
      if (!joinTarget || !student) return false;
      const saved = await actions.upsertStudent(joinGroup(student, joinTarget, asOf, choice));
      if (saved) setJoinTarget(null);
      return saved;
    });

  const nextFor = (group) => upcoming.find((session) => session.groupId === group.id) || null;
  const openTracking = () => openPage?.("grades", { type: "open-tracking", tab: "attendance" });
  const openNextClass = (group) => {
    const next = nextFor(group);
    if (next) openPage?.("classes", { type: "open-class", sessionKey: next.key });
  };
  const contextFor = (student) =>
    student.status === "Inactive"
      ? { text: `${student.code} · ${t("Inactive")}`, tone: "" }
      : studentContext(months.get(student.id), groupNamesOf(student, groupsById, t), t, locale);

  const groupCount = activeGroups.length;
  const individualCount = activeStudents.filter((student) => student.isIndividual).length;
  const description =
    view === "groups"
      ? t(
          individualCount === 1
            ? "{groups} groups and {count} individual class. Choose a group to see how it is going and whom to contact."
            : "{groups} groups and {count} individual classes. Choose a group to see how it is going and whom to contact.",
          { groups: groupCount, count: individualCount },
        )
      : t("{students} active students in {groups} groups. Choose someone to see their progress and details.", {
          students: activeStudents.length,
          groups: groupCount,
        });

  const archivedStudentsToggle = visibleInactive.length ? (
    <>
      <button
        type="button"
        className={`arch-toggle ${studentArchivesOpen ? "open" : ""}`}
        aria-expanded={studentArchivesOpen}
        aria-controls="community-archived-students"
        onClick={() => setStudentArchivesOpen(!studentArchivesOpen)}
      >
        <Archive aria-hidden="true" />
        {t("Inactive students · {count}", { count: visibleInactive.length })}
        <ChevronRight className="chev" aria-hidden="true" />
      </button>
      {studentArchivesOpen ? (
        <div id="community-archived-students" className="arch-list">
          {visibleInactive.map((student) => (
            <StudentRow
              key={student.id}
              student={student}
              context={contextFor(student)}
              selected={!compact && selected.id === student.id}
              onSelect={(id) => select("student", id)}
              extra={
                <button
                  type="button"
                  className="link-button"
                  onClick={() => reactivateStudent(student)}
                  disabled={saving}
                >
                  {t("Reactivate")}
                </button>
              }
            />
          ))}
        </div>
      ) : null}
    </>
  ) : null;

  const archivedGroupsToggle = visibleArchivedGroups.length ? (
    <>
      <button
        type="button"
        className={`arch-toggle ${groupArchivesOpen ? "open" : ""}`}
        aria-expanded={groupArchivesOpen}
        aria-controls="community-archived-groups"
        onClick={() => setGroupArchivesOpen(!groupArchivesOpen)}
      >
        <Archive aria-hidden="true" />
        {t("Archived groups · {count}", { count: visibleArchivedGroups.length })}
        <ChevronRight className="chev" aria-hidden="true" />
      </button>
      {groupArchivesOpen ? (
        <div id="community-archived-groups" className="arch-list">
          <p className="arch-help">{t("They do not count in Home or Tracking. Their history is kept.")}</p>
          {visibleArchivedGroups.map((group) => (
            <button
              type="button"
              key={group.id}
              className={`gi ar ${!compact && selected.id === group.id ? "on" : ""}`}
              aria-label={`${group.name} ${t("Archived on {date}", { date: formatShortDate(group.archivedAt, locale, { weekday: false }) })}`}
              onClick={() => select("group", group.id)}
            >
              <span className="gi-top">
                <strong>{group.name}</strong>
                <span className="tag">{t("Archived group")}</span>
              </span>
              <small>
                {t("Archived on {date}", { date: formatShortDate(group.archivedAt, locale, { weekday: false }) })} ·{" "}
                {t("{count} students", { count: membersOf(group).length })}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </>
  ) : null;

  const groupCards = (
    <>
      {visibleGroups.map((group) => {
        const summary = groupSummaries.get(group.id);
        const members = membersOf(group);
        const line = groupPaymentLine(summary, group, t, locale);
        return (
          <button
            type="button"
            key={group.id}
            className={`gi ${selected.type === "group" && selected.id === group.id ? "on" : ""}`}
            aria-current={selected.id === group.id ? "true" : undefined}
            aria-label={t("Open {name}", { name: group.name })}
            onClick={() => select("group", group.id)}
          >
            <span className="gi-top">
              <strong>{group.name}</strong>
              <span className="gi-pct">{formatPercent(summary.attendance, locale)}</span>
            </span>
            <small>
              {[
                t(members.length === 1 ? "{count} student" : "{count} students", { count: members.length }),
                groupScheduleShort(group, locale),
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <span className="bar" aria-hidden="true">
              <i style={{ width: `${Math.round((summary.attendance ?? 0) * 100)}%` }} />
            </span>
            <span className={`st ${line.tone}`}>{line.text}</span>
          </button>
        );
      })}
      {activeStudents
        .filter((student) => student.isIndividual && studentMatches(student))
        .map((student) => (
          <button
            type="button"
            key={student.id}
            className="link-button gi-individual"
            onClick={() => select("student", student.id)}
          >
            {student.fullName} · {t("individual")} →
          </button>
        ))}
    </>
  );

  const allList = (
    <>
      {visibleGroups.map((group) => {
        const members = membersOf(group).filter(studentMatches);
        const summary = groupSummaries.get(group.id);
        return (
          <div className="list-group" key={group.id}>
            <div className="gh">
              <span>
                <strong>{group.name}</strong>
                <span className="muted">
                  {" "}
                  · {members.length} · {formatPercent(summary.attendance, locale)}
                </span>
              </span>
              <button type="button" className="link-button" onClick={() => select("group", group.id)}>
                {t("View group")}
              </button>
            </div>
            {members.map((student) => {
              const month = months.get(student.id);
              const others = studentGroupIdsOf(student)
                .filter((id) => id !== group.id)
                .map((id) => groupsById.get(id)?.name)
                .filter(Boolean);
              const extra = others.length
                ? t("also in {groups}", { groups: others.join(", ") })
                : student.isIndividual
                  ? t("also individual")
                  : "";
              return (
                <StudentRow
                  key={`${group.id}-${student.id}`}
                  student={student}
                  context={{ text: [student.code, extra].filter(Boolean).join(" · "), tone: "" }}
                  dot={month.flag.tone}
                  selected={selected.type === "student" && selected.id === student.id}
                  onSelect={(id) => select("student", id)}
                />
              );
            })}
          </div>
        );
      })}
      {visibleActive.some(
        (student) =>
          !studentGroupIdsOf(student).some((id) => groupsById.get(id) && !isGroupArchived(groupsById.get(id))),
      ) ? (
        <div className="list-group">
          <div className="gh">
            <strong>{t("Individual and without a group")}</strong>
          </div>
          {visibleActive
            .filter(
              (student) =>
                !studentGroupIdsOf(student).some((id) => groupsById.get(id) && !isGroupArchived(groupsById.get(id))),
            )
            .map((student) => (
              <StudentRow
                key={student.id}
                student={student}
                context={{ text: student.code, tone: "" }}
                dot={months.get(student.id).flag.tone}
                selected={selected.type === "student" && selected.id === student.id}
                onSelect={(id) => select("student", id)}
              />
            ))}
        </div>
      ) : null}
    </>
  );

  const studentsList = (
    <>
      {pending.length ? (
        <div className="list-group">
          <div className="gh">
            <strong>{t("With something pending")}</strong>
            <span className="muted">{pending.length}</span>
          </div>
          {pending.map((month) => (
            <StudentRow
              key={month.student.id}
              student={month.student}
              context={contextFor(month.student)}
              selected={selected.type === "student" && selected.id === month.student.id}
              onSelect={(id) => select("student", id)}
            />
          ))}
        </div>
      ) : null}
      {upToDate.length ? (
        <div className="list-group">
          <div className="gh">
            <strong>{t("Up to date")}</strong>
            <span className="muted">{upToDate.length}</span>
          </div>
          {upToDate.map((month) => (
            <StudentRow
              key={month.student.id}
              student={month.student}
              context={contextFor(month.student)}
              selected={selected.type === "student" && selected.id === month.student.id}
              onSelect={(id) => select("student", id)}
            />
          ))}
        </div>
      ) : null}
    </>
  );

  const noResults =
    (view === "groups"
      ? !visibleGroups.length && !visibleArchivedGroups.length
      : !visibleActive.length && !visibleInactive.length) && !(view === "all" && visibleGroups.length);

  const detail =
    selectedStudent && studentDraft ? (
      <StudentDetail
        student={selectedStudent}
        draft={studentDraft}
        setDraft={setStudentDraft}
        month={
          months.get(selectedStudent.id) ||
          studentMonths(state, derived, asOf, [selectedStudent]).get(selectedStudent.id)
        }
        recent={studentRecentClasses(state, derived, selectedStudent.id)}
        groupsById={groupsById}
        onSave={saveStudentDetail}
        onArchive={() => setConfirmTarget({ action: "archive-student", item: selectedStudent })}
        onReactivate={() => reactivateStudent(selectedStudent)}
        onEdit={() => openStudentEditor(selectedStudent)}
        onOpenTracking={openTracking}
        saving={saving}
        dirty={studentDirty}
      />
    ) : selectedGroup && isGroupArchived(selectedGroup) ? (
      <ArchivedGroupView
        key={selectedGroup.id}
        group={selectedGroup}
        members={selectedMembers}
        history={archivedGroupHistory(state, derived, selectedGroup, selectedMembers)}
        includedInStatistics={archiveScope?.included}
        onReactivate={() => reactivateGroup(selectedGroup)}
        saving={saving}
      />
    ) : selectedGroup && groupDraft && billingDraft ? (
      <GroupDetail
        key={selectedGroup.id}
        group={selectedGroup}
        members={selectedMembers}
        summary={groupSummaries.get(selectedGroup.id)}
        grid={groupAttendanceGrid(state, selectedGroup, selectedMembers, asOf)}
        monthsById={months}
        next={nextFor(selectedGroup)}
        asOf={asOf}
        state={state}
        draft={groupDraft}
        setDraft={setGroupDraft}
        billingDraft={billingDraft}
        setBillingDraft={setBillingDraft}
        applyFrom={applyFrom}
        setApplyFrom={setApplyFrom}
        switching={normalizeGroupBilling(selectedGroup.billing)?.mode !== "monthly" && billingDraft.mode === "monthly"}
        onSave={() => saveGroupDetail(selectedGroup)}
        onArchive={() => setArchiveTarget(selectedGroup)}
        onEditSchedule={() => openGroupEditor(selectedGroup)}
        onAddStudent={() => setJoinTarget(selectedGroup)}
        onOpenStudent={(student) => select("student", student.id)}
        onOpenNext={() => openNextClass(selectedGroup)}
        saving={saving}
        dirty={groupDirty}
      />
    ) : (
      <section className="detail">
        <EmptyState
          icon={UsersRound}
          title={t("Select a student or group")}
          description={t("Details and editing tools will appear here.")}
        />
      </section>
    );

  const archiveSummary = archiveTarget
    ? {
        ...groupSummaries.get(archiveTarget.id),
        recordedClasses: new Set(
          state.classLog
            .filter((row) => row.groupId === archiveTarget.id && row.classStatus === "Completed")
            .map((row) => `${row.classDate}|${row.startTime}`),
        ).size,
      }
    : null;

  const overlays = (
    <>
      <Drawer
        open={Boolean(studentEditor)}
        onClose={closeStudentEditor}
        title={studentEditor?.id ? t("Edit student") : t("Add student")}
        description={t("Use individual classes, one or many groups, or both.")}
        footer={
          <>
            {studentEditor?.id ? (
              <Button
                variant="ghost"
                className="is-danger-text footer-start"
                onClick={() => setConfirmTarget({ action: "delete-student", item: studentEditor })}
              >
                {t("Delete student")}
              </Button>
            ) : null}
            <Button onClick={closeStudentEditor}>{t("Cancel")}</Button>
            <Button variant="primary" onClick={saveStudentEditor} disabled={saving}>
              {saving ? t("Saving…") : t("Save student")}
            </Button>
          </>
        }
      >
        {studentEditor ? (
          <StudentEditor
            draft={studentEditor}
            setDraft={setStudentEditor}
            groups={state.groups}
            defaultRate={state.settings.hourlyRate}
          />
        ) : null}
      </Drawer>
      <Drawer
        open={Boolean(groupEditor)}
        onClose={closeGroupEditor}
        title={groupEditor?.id ? t("Edit group") : t("Create group")}
        kicker={groupEditor?.id ? t("Schedule and details") : t("New group")}
        footer={
          <>
            {groupEditor?.id ? (
              <Button
                variant="ghost"
                className="is-danger-text footer-start"
                onClick={() => setConfirmTarget({ action: "delete-group", item: groupEditor })}
              >
                {t("Delete group")}
              </Button>
            ) : null}
            <Button onClick={closeGroupEditor}>{t("Cancel")}</Button>
            <Button variant="primary" onClick={saveGroupEditor} disabled={saving}>
              {saving ? t("Saving…") : groupEditor?.id ? t("Save group") : t("Create group")}
            </Button>
          </>
        }
      >
        {groupEditor ? (
          <GroupEditor
            draft={groupEditor}
            setDraft={setGroupEditor}
            defaultHours={state.settings.defaultClassHours}
            defaultRate={state.settings.hourlyRate}
          >
            {groupEditor.id ? null : (
              <BillingFields
                draft={newGroupBilling}
                setDraft={setNewGroupBilling}
                group={groupEditor}
                state={state}
                asOf={asOf}
                defaultRate={state.settings.hourlyRate}
              />
            )}
          </GroupEditor>
        ) : null}
      </Drawer>
      <ArchiveGroupDialog
        open={Boolean(archiveTarget)}
        group={archiveTarget}
        members={archiveTarget ? membersOf(archiveTarget) : []}
        summary={archiveSummary}
        onClose={() => setArchiveTarget(null)}
        onConfirm={archiveGroup}
        saving={saving}
      />
      <JoinGroupSheet
        key={joinTarget?.id || "join"}
        open={Boolean(joinTarget)}
        group={joinTarget}
        candidates={
          joinTarget ? activeStudents.filter((student) => !studentGroupIdsOf(student).includes(joinTarget.id)) : []
        }
        state={state}
        asOf={asOf}
        onClose={() => setJoinTarget(null)}
        onJoin={join}
        saving={saving}
      />
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.action === "archive-student"
            ? t("Deactivate {p0}?", { p0: confirmTarget.item.fullName })
            : t("Delete {p0}?", { p0: confirmTarget?.item?.fullName || confirmTarget?.item?.name })
        }
        description={
          confirmTarget?.action === "archive-student"
            ? t("The student becomes inactive while grades, attendance, and payment history stay available.")
            : confirmTarget?.action === "delete-student"
              ? t("Students with grades or class history cannot be deleted; deactivate them instead.")
              : t("Groups with assigned students cannot be deleted. Existing class history remains protected.")
        }
        confirmLabel={
          confirmTarget?.action === "archive-student"
            ? t("Deactivate student")
            : confirmTarget?.action === "delete-group"
              ? t("Delete group")
              : t("Delete student")
        }
        tone={confirmTarget?.action === "archive-student" ? "primary" : "danger"}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => runSave(confirmAction)}
        busy={saving}
      />
    </>
  );

  if (compact) {
    const sheetMonth = sheetStudent
      ? months.get(sheetStudent.id) || studentMonths(state, derived, asOf, [sheetStudent]).get(sheetStudent.id)
      : null;
    const showStudents = view !== "groups";
    return (
      <div className="page community-page is-compact">
        <div className="community-head">
          <div>
            <span className="overline">
              {t("{students} students · {groups} groups", { students: activeStudents.length, groups: groupCount })}
            </span>
            <h1>{t("Community")}</h1>
          </div>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => (showStudents ? openStudentEditor() : openGroupEditor())}
          >
            {t(showStudents ? "Add" : "Create group")}
          </Button>
        </div>
        <label className="search-control">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search student or group")}
            aria-label={t("Search student or group")}
          />
        </label>
        <Segmented
          className="community-switch"
          tone="soft"
          value={showStudents ? "students" : "groups"}
          label={t("Community views")}
          onChange={(value) => changeView(value)}
          items={[
            { value: "students", label: "Students" },
            { value: "groups", label: "Groups" },
          ]}
        />
        {showStudents ? (
          <>
            {pending.length ? (
              <section>
                <div className="sh">
                  <h2>{t("With something pending")}</h2>
                  <span>{pending.length}</span>
                </div>
                <div className="list-rows">
                  {pending.map((month) => {
                    const context = contextFor(month.student);
                    return (
                      <ListRow
                        key={month.student.id}
                        avatar={
                          <StudentAvatar avatarId={month.student.avatarId} name={month.student.fullName} decorative />
                        }
                        name={month.student.fullName}
                        context={context.text}
                        contextTone={context.tone}
                        value={context.value || null}
                        valueTone="bad"
                        label={t("Open {name}", { name: month.student.fullName })}
                        onClick={() => select("student", month.student.id)}
                      />
                    );
                  })}
                </div>
              </section>
            ) : null}
            {upToDate.length ? (
              <section>
                <div className="sh">
                  <h2>{t("Up to date")}</h2>
                  <span>{upToDate.length}</span>
                </div>
                <div className="list-rows">
                  {upToDate.map((month) => (
                    <ListRow
                      key={month.student.id}
                      avatar={
                        <StudentAvatar avatarId={month.student.avatarId} name={month.student.fullName} decorative />
                      }
                      name={month.student.fullName}
                      context={contextFor(month.student).text}
                      label={t("Open {name}", { name: month.student.fullName })}
                      onClick={() => select("student", month.student.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            {archivedStudentsToggle}
          </>
        ) : (
          <>
            <div className="list-rows">
              {visibleGroups.map((group) => {
                const summary = groupSummaries.get(group.id);
                const line = groupPaymentLine(summary, group, t, locale);
                return (
                  <ListRow
                    key={group.id}
                    avatar={<AttendanceRing value={summary.attendance === null ? NaN : summary.attendance * 100} />}
                    name={group.name}
                    context={[groupScheduleShort(group, locale), line.text].filter(Boolean).join(" · ")}
                    contextTone={line.tone === "st-venc" ? "bad" : line.tone === "st-pend" ? "pend" : ""}
                    label={t("Open {name}", { name: group.name })}
                    onClick={() => select("group", group.id)}
                  />
                );
              })}
            </div>
            {archivedGroupsToggle}
          </>
        )}
        {noResults ? <p className="muted">{t("No matches.")}</p> : null}

        <BottomSheet open={Boolean(sheetStudent)} onClose={() => setSheet(null)} title={sheetStudent?.fullName || ""}>
          {sheetStudent && sheetMonth ? (
            <StudentSheet
              student={sheetStudent}
              month={sheetMonth}
              recent={studentRecentClasses(state, derived, sheetStudent.id, 4)}
              groupsById={groupsById}
              asOf={asOf}
              onEdit={() => openStudentEditor(sheetStudent)}
            />
          ) : null}
        </BottomSheet>
        <BottomSheet
          open={Boolean(sheetGroup)}
          onClose={() => setSheet(null)}
          title={sheetGroup?.name || ""}
          kicker={
            sheetGroup
              ? isGroupArchived(sheetGroup)
                ? t("Archived · {date}", { date: formatShortDate(sheetGroup.archivedAt, locale, { weekday: false }) })
                : groupScheduleShort(sheetGroup, locale)
              : ""
          }
          description={
            sheetGroup && isGroupArchived(sheetGroup)
              ? t("{count} students · their history is kept in full", { count: focusMembers.length })
              : undefined
          }
        >
          {sheetGroup && isGroupArchived(sheetGroup) ? (
            <ArchivedGroupView
              group={sheetGroup}
              members={focusMembers}
              history={archivedGroupHistory(state, derived, sheetGroup, focusMembers)}
              includedInStatistics={archiveScope?.included}
              compact
              onReactivate={async () => {
                if (await reactivateGroup(sheetGroup)) setSheet(null);
              }}
              saving={saving}
            />
          ) : sheetGroup ? (
            <GroupSheet
              group={sheetGroup}
              members={focusMembers}
              summary={groupSummaries.get(sheetGroup.id)}
              grid={groupAttendanceGrid(state, sheetGroup, focusMembers, asOf, 3)}
              monthsById={months}
              next={nextFor(sheetGroup)}
              asOf={asOf}
              state={state}
              onEditBilling={() => setBillingSheet(true)}
              onOpenStudent={(student) => setSheet({ type: "student", id: student.id })}
              onAddStudent={() => setJoinTarget(sheetGroup)}
              onArchive={() => setArchiveTarget(sheetGroup)}
            />
          ) : null}
        </BottomSheet>
        <BottomSheet
          open={Boolean(billingSheet && sheetGroup && groupDraft && billingDraft)}
          onClose={() => setBillingSheet(false)}
          title={sheetGroup?.name || ""}
          kicker={t("Edit group")}
          backLabel={t("Back")}
          footer={
            <Button variant="primary" onClick={() => saveGroupDetail(sheetGroup)} disabled={saving || !groupDirty}>
              {saving ? t("Saving…") : t("Save changes")}
            </Button>
          }
        >
          {sheetGroup && groupDraft && billingDraft ? (
            <div className="billing-sheet">
              <Field label={t("Group name")}>
                <Input
                  value={groupDraft.name}
                  onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })}
                />
              </Field>
              <BillingFields
                draft={billingDraft}
                setDraft={setBillingDraft}
                group={sheetGroup}
                members={focusMembers}
                state={state}
                asOf={asOf}
                defaultRate={state.settings?.hourlyRate}
                applyFrom={applyFrom}
                setApplyFrom={setApplyFrom}
                switching={
                  normalizeGroupBilling(sheetGroup.billing)?.mode !== "monthly" && billingDraft.mode === "monthly"
                }
              />
              <button type="button" className="link-button" onClick={() => openGroupEditor(sheetGroup)}>
                {t("Edit schedule and details")}
              </button>
            </div>
          ) : null}
        </BottomSheet>
        {overlays}
      </div>
    );
  }

  return (
    <div className="page community-page">
      <SectionHeading
        title={t("Community")}
        description={description}
        actions={
          view === "groups" ? (
            <>
              <Button icon={Plus} onClick={() => openStudentEditor()}>
                {t("Add student")}
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => openGroupEditor()}>
                {t("Create group")}
              </Button>
            </>
          ) : (
            <>
              <Button icon={Plus} onClick={() => openGroupEditor()}>
                {t("Create group")}
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => openStudentEditor()}>
                {t("Add student")}
              </Button>
            </>
          )
        }
      />
      <div className="community-bar">
        <Tabs value={view} onChange={(value) => changeView(value)} items={VIEW_TABS} ariaLabel={t("Community views")} />
        <label className="search-control">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search student or group")}
            aria-label={t("Search student or group")}
          />
        </label>
      </div>
      <div className="cols" role="tabpanel">
        <nav
          className={`list ${view === "groups" ? "is-groups" : ""}`}
          aria-label={t(view === "groups" ? "Groups" : "Students")}
        >
          {view === "groups" ? groupCards : view === "students" ? studentsList : allList}
          {noResults ? <p className="muted">{t("No matches.")}</p> : null}
          {view === "groups" ? archivedGroupsToggle : archivedStudentsToggle}
          {view === "all" ? archivedGroupsToggle : null}
        </nav>
        {detail}
      </div>
      {overlays}
    </div>
  );
}
