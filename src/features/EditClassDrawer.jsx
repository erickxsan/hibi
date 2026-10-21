import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import {
  Button,
  DatePicker,
  Drawer,
  DurationStepper,
  Field,
  GroupSelect,
  SearchInput,
  Segmented,
  StudentSelect,
  TimePicker,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { confirmDiscard, draftChanged } from "../hooks/useUnsavedChanges";
import { normalizeSearchText } from "../utils/searchText";
import { formatShortDate, formatTime } from "../utils/displayFormat";
import { groupMark, studentGroupIdsOf } from "./groupLabels";

function initialEditDraft(session) {
  return {
    classDate: session?.classDate || "",
    startTime: session?.startTime || "",
    minutes: Math.round(Number(session?.durationHours || 2) * 60),
    format: session?.format === "individual" ? "individual" : "group",
    groupId: session?.groupId || "",
    studentId: session?.studentId || "",
    participantMode: session?.participantMode === "custom" ? "custom" : "default",
    participantIds: [...(session?.participantIds || [])],
  };
}

export function EditClassDrawer({ open, session, state, actions, asOfDate, futureSupported, onClose }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(() => initialEditDraft(session));
  const [scope, setScope] = useState("occurrence");
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const baselineRef = useRef(null);

  useEffect(() => {
    if (!open || !session) return;
    const next = initialEditDraft(session);
    setDraft(next);
    setScope("occurrence");
    setParticipantsOpen(false);
    setSearch("");
    baselineRef.current = { draft: next, scope: "occurrence" };
  }, [open, session]);

  const activeStudents = useMemo(
    () =>
      (state.students || [])
        .filter((student) => student.status !== "Inactive")
        .sort((left, right) => String(left.fullName).localeCompare(String(right.fullName))),
    [state.students],
  );
  const groups = (state.groups || []).filter((group) => group.status !== "Inactive");
  const defaultParticipantIds = useMemo(() => {
    if (draft.format === "individual") return draft.studentId ? [draft.studentId] : [];
    return activeStudents
      .filter((student) => studentGroupIdsOf(student).includes(draft.groupId))
      .map((student) => student.id);
  }, [activeStudents, draft.format, draft.groupId, draft.studentId]);
  const participantIds = draft.participantMode === "custom" ? draft.participantIds : defaultParticipantIds;
  const visibleStudents = activeStudents.filter(
    (student) => !search || normalizeSearchText(student.fullName).includes(normalizeSearchText(search)),
  );
  const dirty = Boolean(baselineRef.current) && draftChanged({ draft, scope }, baselineRef.current);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const requestClose = () => {
    if (dirty && !confirmDiscard(true, "Discard the class schedule changes?")) return false;
    onClose();
    return true;
  };
  const payload = () => ({ ...draft, durationHours: draft.minutes / 60 });
  const save = async () => {
    if (!session || !actions.editScheduledClass) return;
    setSaving(true);
    try {
      if (await actions.editScheduledClass({ session, draft: payload(), scope, asOfDate })) onClose();
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!session || !actions.removeScheduledClass) return;
    const future = scope === "future" && futureSupported;
    if (
      !globalThis.confirm?.(
        t(
          future
            ? "Remove this class and every future class in the series? Past classes and saved records will not change."
            : "Remove only this class? Past classes and saved records will not change.",
        ),
      )
    )
      return;
    setSaving(true);
    try {
      if (await actions.removeScheduledClass({ session, scope, asOfDate })) onClose();
    } finally {
      setSaving(false);
    }
  };
  const toggleParticipant = (studentId) => {
    const selected = new Set(participantIds);
    if (selected.has(studentId)) selected.delete(studentId);
    else selected.add(studentId);
    update({ participantMode: "custom", participantIds: [...selected] });
  };
  const minimumDate = scope === "future" ? session?.occurrenceDate || session?.classDate : asOfDate;

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={t("Edit class")}
      description={
        session
          ? `${session.title} · ${formatShortDate(session.classDate, locale)} · ${formatTime(session.startTime, locale)}`
          : undefined
      }
      size="wide"
      footer={
        <>
          <Button variant="ghost" className="footer-spacer" icon={Trash2} onClick={remove} disabled={saving}>
            {t("Delete class")}
          </Button>
          <Button onClick={requestClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !draft.classDate || !draft.startTime}>
            {saving ? t("Saving…") : t("Save changes")}
          </Button>
        </>
      }
    >
      {session ? (
        <div className="class-form">
          <Field label={t("Apply changes to")}>
            <Segmented
              tone="soft"
              label={t("Apply changes to")}
              value={scope}
              onChange={setScope}
              items={[
                { value: "occurrence", label: "Only this class" },
                { value: "future", label: "This and future classes", disabled: !futureSupported },
              ]}
            />
          </Field>
          <p className="edit-scope-note">
            {t(
              scope === "future"
                ? "Past classes and saved records will remain unchanged."
                : "The other classes in this series will keep their information.",
            )}
          </p>
          <div className="form-grid cols-3">
            <Field label={t("Date")} required>
              <DatePicker
                today={asOfDate}
                min={minimumDate}
                value={draft.classDate}
                onChange={(event) => update({ classDate: event.target.value })}
              />
            </Field>
            <Field label={t("Time")} required>
              <TimePicker
                minMinutes={0}
                maxMinutes={1440}
                durationMinutes={draft.minutes}
                value={draft.startTime}
                onChange={(event) => update({ startTime: event.target.value })}
              />
            </Field>
            <Field label={t("Duration")} required>
              <DurationStepper
                label={t("Duration")}
                minutes={draft.minutes}
                onChange={(minutes) => update({ minutes })}
              />
            </Field>
          </div>
          <Field label={t("Format")}>
            <Segmented
              tone="soft"
              label={t("Class format")}
              value={draft.format}
              onChange={(format) =>
                update(
                  format === "group"
                    ? {
                        format,
                        groupId: draft.groupId || groups[0]?.id || "",
                        studentId: "",
                        participantMode: "default",
                        participantIds: [],
                      }
                    : {
                        format,
                        studentId: draft.studentId || activeStudents[0]?.id || "",
                        groupId: "",
                        participantMode: "default",
                        participantIds: [],
                      },
                )
              }
              items={[
                { value: "group", label: "Group" },
                { value: "individual", label: "Individual" },
              ]}
            />
          </Field>
          {draft.format === "group" ? (
            <Field label={t("Group")} required>
              <GroupSelect
                value={draft.groupId}
                placeholder="Choose a group"
                onChange={(event) =>
                  update({ groupId: event.target.value, participantMode: "default", participantIds: [] })
                }
                groups={groups.map((group) => ({ id: group.id, name: group.name, mark: groupMark(group.name) }))}
              />
            </Field>
          ) : (
            <Field label={t("Student")} required>
              <StudentSelect
                value={draft.studentId}
                placeholder="Choose a student"
                searchable
                onChange={(event) => update({ studentId: event.target.value })}
                students={activeStudents}
              />
            </Field>
          )}
          {draft.format === "group" ? (
            <div className="participants-box">
              <div className="block-head">
                <span>
                  <strong>{t("Participants")}</strong>{" "}
                  <span className="muted">
                    {t(participantIds.length === 1 ? "{count} student" : "{count} students", {
                      count: participantIds.length,
                    })}
                    {draft.participantMode === "custom" ? ` · ${t("custom list")}` : ""}
                  </span>
                </span>
                <button type="button" className="link-button" onClick={() => setParticipantsOpen((value) => !value)}>
                  {t(participantsOpen ? "Hide" : "Manage")}
                </button>
              </div>
              {participantsOpen ? (
                <>
                  <SearchInput
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("Search students")}
                  />
                  {visibleStudents.map((student) => (
                    <label key={student.id}>
                      <input
                        type="checkbox"
                        checked={participantIds.includes(student.id)}
                        onChange={() => toggleParticipant(student.id)}
                      />
                      <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative />
                      <span>
                        {student.fullName}
                        <small>
                          {t(studentGroupIdsOf(student).includes(draft.groupId) ? "Group member" : "Not in this group")}
                        </small>
                      </span>
                    </label>
                  ))}
                  {draft.participantMode === "custom" ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => update({ participantMode: "default", participantIds: [] })}
                    >
                      {t("Use the group roster")}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
