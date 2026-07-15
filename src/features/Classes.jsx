import { useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus } from "lucide-react";
import { Button, Drawer, EmptyState, Field, IconButton, Input, Select, StatusBadge } from "../components/ui";
import { addDays, todayDateOnly } from "../domain/dates";
import { dayOfWeekForDate, generateScheduledOccurrences } from "../domain/schedule";
import { getUiLocale } from "../i18n";
import ClassLog from "./ClassLog";

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(getUiLocale(), { weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function newExtraDraft(asOfDate, groupId = "") {
  return {
    mode: "added",
    groupId,
    occurrenceDate: asOfDate,
    classDate: asOfDate,
    startTime: "",
    durationHours: 2,
    status: "Scheduled",
    scope: "one",
  };
}

function occurrenceDraft(occurrence) {
  return {
    mode: occurrence.kind === "added" ? "added" : "recurring",
    id: occurrence.exceptionId || "",
    groupId: occurrence.groupId,
    scheduleSlotId: occurrence.scheduleSlotId,
    occurrenceDate: occurrence.occurrenceDate,
    classDate: occurrence.classDate,
    startTime: occurrence.startTime,
    durationHours: occurrence.durationHours,
    status: occurrence.status,
    scope: "one",
  };
}

function scheduleTone(item) {
  if (item.recorded) return "success";
  if (item.status === "Cancelled") return "neutral";
  if (item.kind === "override" || item.kind === "added") return "warning";
  return "info";
}

function ScheduleEditor({ draft, setDraft, groups, onClose, onSave, saving }) {
  if (!draft) return null;
  const isAdded = draft.mode === "added";
  const canSave = Boolean(
    draft.groupId
    && draft.classDate
    && draft.startTime
    && Number(draft.durationHours) > 0
    && (draft.scope !== "future" || (draft.scheduleSlotId && draft.status !== "Cancelled"))
    && (draft.scope !== "future" || draft.classDate >= draft.occurrenceDate),
  );
  return (
    <Drawer
      open
      onClose={onClose}
      title={isAdded ? "Add an extra class" : "Adjust scheduled class"}
      description={isAdded
        ? "Add a one-time class without changing the group’s weekly schedule."
        : "Change only this class, or update this meeting time from this date forward."}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!canSave || saving}>{saving ? "Saving…" : "Save schedule"}</Button>
        </>
      )}
    >
      <div className="drawer-form schedule-drawer-form">
        {isAdded ? (
          <Field label="Group" required>
            <Select value={draft.groupId} onChange={(event) => setDraft((current) => ({ ...current, groupId: event.target.value }))}>
              <option value="">Choose a group</option>
              {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
            </Select>
          </Field>
        ) : null}
        {!isAdded ? (
          <Field label="Apply change to" required>
            <Select value={draft.scope} onChange={(event) => setDraft((current) => ({ ...current, scope: event.target.value }))}>
              <option value="one">Only this class</option>
              {draft.status !== "Cancelled" ? <option value="future">This and future classes</option> : null}
            </Select>
          </Field>
        ) : null}
        <div className="form-grid form-grid-2 two-columns">
          <Field label="Date" required>
            <Input type="date" min={draft.scope === "future" ? draft.occurrenceDate : undefined} value={draft.classDate} onChange={(event) => setDraft((current) => ({ ...current, classDate: event.target.value }))} />
          </Field>
          <Field label="Start time" required>
            <Input type="time" value={draft.startTime} onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))} />
          </Field>
          <Field label="Duration (hours)" required>
            <Input type="number" min="0.25" step="0.25" value={draft.durationHours} onChange={(event) => setDraft((current) => ({ ...current, durationHours: event.target.value }))} />
          </Field>
          {!isAdded ? (
            <Field label="Status" required>
              <Select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value, scope: event.target.value === "Cancelled" ? "one" : current.scope }))}>
                <option value="Scheduled">Scheduled</option>
                <option value="Cancelled">Cancelled</option>
              </Select>
            </Field>
          ) : null}
        </div>
        {draft.scope === "future" ? <p className="form-note">Completed class history stays unchanged. The new day, time, and duration apply from the original occurrence date forward.</p> : null}
      </div>
    </Drawer>
  );
}

export default function Classes({ state = {}, derived = {}, actions = {}, asOfDate, navigate, ...classLogProps }) {
  const groups = Array.isArray(state.groups) ? state.groups : [];
  const currentDate = asOfDate || state.settings?.asOfDate || todayDateOnly();
  const upcoming = useMemo(() => {
    const source = Array.isArray(derived.upcomingClasses)
      ? derived.upcomingClasses
      : generateScheduledOccurrences(state, currentDate, addDays(currentDate, 42));
    return source.filter((item) => !item.recorded).slice(0, 10);
  }, [currentDate, derived.upcomingClasses, state]);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const saveSchedule = async () => {
    if (!scheduleDraft) return;
    setSavingSchedule(true);
    try {
      const saved = scheduleDraft.scope === "future"
        ? await Promise.resolve(actions.upsertScheduleChange?.({
          groupId: scheduleDraft.groupId,
          scheduleSlotId: scheduleDraft.scheduleSlotId,
          effectiveFrom: scheduleDraft.occurrenceDate,
          dayOfWeek: dayOfWeekForDate(scheduleDraft.classDate),
          startTime: scheduleDraft.startTime,
          durationHours: Number(scheduleDraft.durationHours),
        }))
        : await Promise.resolve(actions.upsertScheduleException?.({
          id: scheduleDraft.id || undefined,
          groupId: scheduleDraft.groupId,
          scheduleSlotId: scheduleDraft.mode === "added" ? "" : scheduleDraft.scheduleSlotId,
          occurrenceDate: scheduleDraft.occurrenceDate,
          classDate: scheduleDraft.classDate,
          startTime: scheduleDraft.startTime,
          durationHours: Number(scheduleDraft.durationHours),
          status: scheduleDraft.status,
          kind: scheduleDraft.mode === "added" ? "added" : "override",
        }));
      if (saved) setScheduleDraft(null);
    } finally {
      setSavingSchedule(false);
    }
  };

  const recordOccurrence = (item) => {
    setPrefill({
      groupId: item.groupId,
      classDate: item.classDate,
      startTime: item.startTime,
      durationHours: item.durationHours,
      classStatus: "Completed",
      scheduleSlotId: item.scheduleSlotId,
      occurrenceDate: item.occurrenceDate,
    });
    window.requestAnimationFrame(() => document.querySelector(".class-log-page")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="page redesigned-classes-page">
      <div className="page-heading classes-heading">
        <div>
          <h1>Classes</h1>
          <p>See what’s next, record attendance and payments, or adjust a single class.</p>
        </div>
        <Button icon={Plus} onClick={() => setScheduleDraft(newExtraDraft(currentDate, groups[0]?.id || ""))} disabled={!groups.length}>Extra class</Button>
      </div>

      <section className="panel upcoming-classes-panel" aria-labelledby="upcoming-classes-title">
        <div className="panel-header">
          <div><h2 id="upcoming-classes-title">Upcoming classes</h2><p>The next six weeks from weekly group schedules.</p></div>
          <CalendarClock aria-hidden="true" />
        </div>
        {upcoming.length ? (
          <div className="upcoming-class-list">
            {upcoming.map((item) => (
              <article className="upcoming-class-card" key={item.id}>
                <div className="upcoming-class-date"><strong>{formatDate(item.classDate)}</strong><span>{item.startTime || "Time not set"}</span></div>
                <div className="upcoming-class-details"><strong>{item.groupName}</strong><span>{item.durationHours} h</span></div>
                <StatusBadge tone={scheduleTone(item)}>{item.status === "Cancelled" ? "Cancelled" : item.kind === "recurring" ? "Weekly" : "Adjusted"}</StatusBadge>
                <div className="upcoming-class-actions">
                  {item.status !== "Cancelled" ? <Button variant="primary" onClick={() => recordOccurrence(item)}>Record</Button> : null}
                  <IconButton label={`Edit ${item.groupName} class`} icon={Pencil} onClick={() => setScheduleDraft(occurrenceDraft(item))} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="No upcoming classes yet"
            description="Add one or more weekly meeting times to a group, or create an extra class."
            action={navigate ? <Button onClick={() => navigate("groups")}>Set group schedules</Button> : null}
          />
        )}
      </section>

      <ClassLog
        {...classLogProps}
        state={state}
        derived={derived}
        actions={actions}
        asOfDate={asOfDate}
        navigate={navigate}
        prefill={prefill}
        onPrefillConsumed={() => setPrefill(null)}
      />
      <ScheduleEditor draft={scheduleDraft} setDraft={setScheduleDraft} groups={groups} onClose={() => setScheduleDraft(null)} onSave={saveSchedule} saving={savingSchedule} />
    </div>
  );
}
