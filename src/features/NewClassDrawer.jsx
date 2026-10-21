import { useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import {
  Button,
  DatePicker,
  Drawer,
  DurationStepper,
  Field,
  GroupSelect,
  MoneyInput,
  RepeatPicker,
  Segmented,
  StudentSelect,
  TimePicker,
} from "../components/ui";
import { addDays, addMonths, startOfMonth, startOfWeek } from "../domain/dates";
import { dayOfWeekForDate, resolveHourlyRate } from "../domain/schedule";
import { scheduleFieldsForRule } from "../domain/classRecurrence";
import { nextRecurrenceDates, normalizeRecurrence, timeToMinutes, minutesToTime } from "../domain/pickerModels";
import { roundMoney } from "../domain/money";
import { formatMoney, formatTime, weekdayLong, weekdayShort, dayNumber } from "../utils/displayFormat";
import { buildClassWorkspaceSessionsForRange } from "./classesWorkspaceModel";
import { activeGroupMembers, groupMark, groupScheduleShort } from "./groupLabels";

const VIEW_START = 8 * 60;
const VIEW_END = 21 * 60;

function initialDraft(asOfDate, state) {
  const group = (state.groups || []).find((item) => item.status !== "Inactive");
  const student = (state.students || []).find((item) => item.status !== "Inactive");
  const weekday = new Date(`${asOfDate}T00:00:00Z`).getUTCDay();
  return {
    frequency: "recurring",
    format: group ? "group" : "individual",
    groupId: group?.id || "",
    studentId: student?.id || "",
    startDate: asOfDate,
    startTime: "10:00",
    minutes: Math.round((Number(state.settings?.defaultClassHours) || 2) * 60),
    rule: { kind: "weekly", interval: 1, days: [weekday], dailyMode: "all", monthlyMode: "dayOfMonth" },
    rate: "",
  };
}

/** Days of the preview week where the draft class happens (weekly rules show their weekday pattern). */
function activeDatesInWeek(draft, rule, weekStart) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  if (draft.frequency === "once") return days.filter((date) => date === draft.startDate);
  const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
  if (rule.kind === "weekly") return days.filter((date) => rule.days.includes(weekday(date)));
  if (rule.kind === "daily" && rule.interval === 1)
    return days.filter((date) => rule.dailyMode === "all" || (weekday(date) > 0 && weekday(date) < 6));
  const upcoming = new Set(nextRecurrenceDates({ ...rule, startDate: draft.startDate }, 40));
  return days.filter((date) => upcoming.has(date));
}

function overlaps(block, start, end) {
  return start < block.end && end > block.start;
}

export function NewClassDrawer({ open, onClose, state, asOfDate, actions }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(() => initialDraft(asOfDate, state));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setDraft(initialDraft(asOfDate, state));
    // Only reset when the drawer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const groups = (state.groups || []).filter((group) => group.status !== "Inactive");
  const students = (state.students || []).filter((student) => student.status !== "Inactive");
  const group = groups.find((item) => item.id === draft.groupId) || null;
  const student = students.find((item) => item.id === draft.studentId) || null;
  const isGroup = draft.format === "group";
  const members = group ? activeGroupMembers(state, group.id) : [];
  const recurring = draft.frequency === "recurring";
  const rule = normalizeRecurrence({ ...draft.rule, startDate: draft.startDate });
  const start = timeToMinutes(draft.startTime) ?? 600;
  const end = start + draft.minutes;
  const weekStart = startOfWeek(draft.startDate || asOfDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const sessionsAround = useMemo(() => {
    if (!open || !draft.startDate) return [];
    const until = [addDays(weekStart, 6), addMonths(draft.startDate, 2)].sort().at(-1);
    return buildClassWorkspaceSessionsForRange(state, startOfMonth(weekStart), until, asOfDate).filter(
      (session) => session.statusLabel !== "Cancelled" && timeToMinutes(session.startTime) !== null,
    );
  }, [asOfDate, draft.startDate, open, state, weekStart]);
  const blockFor = (session) => ({
    start: timeToMinutes(session.startTime),
    end: timeToMinutes(session.startTime) + Math.round(Number(session.durationHours || 1) * 60),
    label: session.title,
    date: session.classDate,
  });
  const weekBlocks = sessionsAround.filter((session) => weekDays.includes(session.classDate)).map(blockFor);
  const activeDates = activeDatesInWeek(draft, rule, weekStart);
  const occurrenceDates = recurring ? nextRecurrenceDates({ ...rule, startDate: draft.startDate }, 12) : [draft.startDate];
  const busyForClock = sessionsAround
    .filter((session) => occurrenceDates.includes(session.classDate))
    .map((session) => ({
      ...blockFor(session),
      label: `${session.title} (${weekdayShort(session.classDate, locale)})`,
    }));
  const clashes = activeDates.flatMap((date) =>
    weekBlocks.filter((block) => block.date === date && overlaps(block, start, end)).map((block) => ({ ...block, date })),
  );
  const conflictDays = [...new Set(clashes.map((block) => new Date(`${block.date}T00:00:00Z`).getUTCDay()))];
  const suggestions = useMemo(() => {
    if (!clashes.length) return [];
    const options = [];
    const times = [start, 600, 960, 1020, 780, 540, 1080];
    for (const date of weekDays) {
      for (const minute of times) {
        if (options.length >= 2) break;
        const blocked = weekBlocks.some((block) => block.date === date && overlaps(block, minute, minute + draft.minutes));
        if (!blocked && !(date === draft.startDate && minute === start)) options.push({ date, minute });
      }
    }
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clashes.length, draft.minutes, draft.startDate, start, weekStart]);

  const baseRate = isGroup
    ? resolveHourlyRate(state, "", group) ?? 0
    : student
      ? resolveHourlyRate(state, student, "") ?? 0
      : 0;
  const rateText = draft.rate === "" ? String(baseRate) : draft.rate;
  const rate = Number(rateText) || 0;
  const rateChanged = draft.rate !== "" && rate !== baseRate;
  const perStudent = roundMoney((rate * draft.minutes) / 60);
  const ownerReady = isGroup ? Boolean(group) : Boolean(student);
  const valid =
    ownerReady &&
    draft.startDate &&
    draft.startTime &&
    draft.minutes > 0 &&
    rate >= 0 &&
    (!recurring || rule.kind !== "weekly" || rule.days.length > 0);

  const moveTo = (date, minute) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (recurring && rule.kind === "weekly")
      update({
        startTime: minutesToTime(minute),
        rule: { ...draft.rule, days: rule.days.includes(weekday) ? rule.days : [...rule.days, weekday] },
      });
    else update({ startDate: date, startTime: minutesToTime(minute), rule: { ...draft.rule, days: [weekday] } });
  };

  const viewStart = Math.min(VIEW_START, Math.floor(start / 60) * 60);
  const viewEnd = Math.max(VIEW_END, Math.ceil(end / 60) * 60);
  const span = viewEnd - viewStart;
  const pct = (minute) => ((minute - viewStart) / span) * 100;
  const drag = (event, kind) => {
    event.preventDefault();
    event.stopPropagation();
    const column = event.currentTarget.closest(".week-preview-col");
    if (!column) return;
    const perMinute = column.getBoundingClientRect().height / span;
    const y0 = event.clientY;
    const t0 = start;
    const d0 = draft.minutes;
    const onMove = (moveEvent) => {
      const delta = Math.round((moveEvent.clientY - y0) / perMinute / 15) * 15;
      if (kind === "move") update({ startTime: minutesToTime(Math.max(0, Math.min(1440 - d0, t0 + delta))) });
      else update({ minutes: Math.max(15, Math.min(600, Math.min(1440 - t0, d0 + delta))) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (rateChanged) {
        const saved = isGroup
          ? await actions.upsertGroup?.({ ...group, hourlyRate: rate })
          : await actions.upsertStudent?.({ ...student, customHourlyRate: rate });
        if (!saved) return;
      }
      const fields = recurring
        ? scheduleFieldsForRule(rule, draft.startDate)
        : { recurrence: "once", intervalWeeks: 1, daysOfWeek: [dayOfWeekForDate(draft.startDate)], repeatRule: null };
      const saved = await actions.upsertClassSchedule?.({
        format: draft.format,
        groupId: isGroup ? draft.groupId : "",
        studentId: isGroup ? "" : draft.studentId,
        startDate: draft.startDate,
        startTime: draft.startTime,
        durationHours: draft.minutes / 60,
        ...fields,
      });
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };

  const clashBlock = clashes[0];
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("New class")}
      size="wide"
      className="drawer-display"
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" icon={CalendarDays} disabled={!valid || saving} onClick={save}>
            {saving ? t("Creating…") : t("Create class")}
          </Button>
        </>
      }
    >
      <div className="class-form">
        <div className="form-grid cols-2">
          <Field label={t("Frequency")}>
            <Segmented
              tone="soft"
              label={t("Class frequency")}
              value={draft.frequency}
              onChange={(frequency) => update({ frequency })}
              items={[
                { value: "once", label: "One-time" },
                { value: "recurring", label: "Recurring" },
              ]}
            />
          </Field>
          <Field label={t("Format")}>
            <Segmented
              tone="soft"
              label={t("Class format")}
              value={draft.format}
              onChange={(format) => update({ format, rate: "" })}
              items={[
                { value: "group", label: "Group", disabled: !groups.length },
                { value: "individual", label: "Individual", disabled: !students.length },
              ]}
            />
          </Field>
        </div>
        {isGroup ? (
          <Field label={t("Group")} required>
            <GroupSelect
              value={draft.groupId}
              onChange={(event) => update({ groupId: event.target.value, rate: "" })}
              placeholder="Choose a group"
              groups={groups.map((item) => {
                const count = activeGroupMembers(state, item.id).length;
                const schedule = groupScheduleShort(item, locale);
                const itemRate = resolveHourlyRate(state, "", item) ?? 0;
                return {
                  id: item.id,
                  name: item.name,
                  mark: groupMark(item.name),
                  meta: [t(count === 1 ? "{count} student" : "{count} students", { count }), schedule, `${formatMoney(itemRate, locale)}/h`]
                    .filter(Boolean)
                    .join(" · "),
                  detail: `${formatMoney(itemRate, locale)}/h`,
                };
              })}
            />
          </Field>
        ) : (
          <Field label={t("Student")} required>
            <StudentSelect
              value={draft.studentId}
              onChange={(event) => update({ studentId: event.target.value, rate: "" })}
              placeholder="Choose a student"
              searchable
              students={students.map((item) => {
                const own = Number.isFinite(item.customHourlyRate);
                const names = (state.groups || [])
                  .filter((groupItem) => (item.groupIds || []).includes(groupItem.id))
                  .map((groupItem) => groupItem.name);
                return {
                  ...item,
                  meta: own
                    ? t("Own rate {amount}/h", { amount: formatMoney(item.customHourlyRate, locale) })
                    : [...names, item.isIndividual ? t("individual") : ""].filter(Boolean).join(" · ") ||
                      t("General rate {amount}/h", { amount: formatMoney(state.settings?.hourlyRate || 0, locale) }),
                  detail: own ? `${formatMoney(item.customHourlyRate, locale)}/h` : "",
                };
              })}
            />
          </Field>
        )}
        <div className="form-grid cols-2">
          <Field label={t(recurring ? "Starts" : "Date")} required>
            <DatePicker
              today={asOfDate}
              classDates={[...new Set(sessionsAround.map((session) => session.classDate))]}
              repeatDates={recurring ? nextRecurrenceDates({ ...rule, startDate: draft.startDate }, 8).filter((date) => date !== draft.startDate) : []}
              value={draft.startDate}
              onChange={(event) => {
                const startDate = event.target.value;
                if (!startDate) return;
                const weekday = new Date(`${startDate}T00:00:00Z`).getUTCDay();
                update({
                  startDate,
                  rule: { ...draft.rule, days: draft.rule.days.length <= 1 ? [weekday] : draft.rule.days },
                });
              }}
            />
          </Field>
          <Field label={t("Time")} required>
            <TimePicker
              minMinutes={0}
              maxMinutes={1440}
              durationMinutes={draft.minutes}
              busy={busyForClock}
              value={draft.startTime}
              onChange={(event) => update({ startTime: event.target.value })}
            />
          </Field>
          <Field label={t("Duration")} required>
            <DurationStepper label={t("Duration")} minutes={draft.minutes} onChange={(minutes) => update({ minutes })} />
          </Field>
          {recurring ? (
            <Field label={t("Repeat")} required>
              <RepeatPicker
                startDate={draft.startDate}
                value={{ ...draft.rule, startDate: draft.startDate }}
                conflictingDays={conflictDays}
                onChange={(next) => update({ rule: { ...next } })}
              />
            </Field>
          ) : null}
        </div>
        {recurring && rule.kind === "weekly" ? (
          <Field label={t("Days")}>
            <div className="weekday-buttons" role="group" aria-label={t("Days of the week")}>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const on = rule.days.includes(day);
                const date = addDays("2024-01-01", (day + 6) % 7);
                return (
                  <button
                    type="button"
                    key={day}
                    className={on ? (conflictDays.includes(day) ? "is-bad" : "is-on") : ""}
                    aria-pressed={on}
                    aria-label={weekdayLong(date, locale)}
                    onClick={() =>
                      update({
                        rule: { ...draft.rule, days: on ? rule.days.filter((item) => item !== day) : [...rule.days, day] },
                      })
                    }
                  >
                    {weekdayShort(date, locale).replace(/^./, (c) => c.toUpperCase())}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}
        <div className="week-preview" aria-label={t("Week preview")} role="group">
          <span />
          {weekDays.map((date) => (
            <span key={date} className={`week-preview-day ${activeDates.includes(date) ? "is-on" : ""}`}>
              {weekdayShort(date, locale).replace(/^./, (c) => c.toUpperCase())} <b>{dayNumber(date)}</b>
            </span>
          ))}
          <div className="week-preview-hours" aria-hidden="true">
            {Array.from({ length: Math.floor(span / 120) + 1 }, (_, index) => viewStart + index * 120).map((minute) => (
              <span key={minute} style={{ top: `${pct(minute)}%` }}>
                {Math.floor(minute / 60) % 12 || 12}
              </span>
            ))}
          </div>
          {weekDays.map((date) => {
            const on = activeDates.includes(date);
            return (
              <div
                key={date}
                className={`week-preview-col ${on ? "is-on" : ""}`}
                aria-label={weekdayLong(date, locale)}
                onPointerDown={(event) => {
                  if (event.target.closest(".week-preview-new")) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const minute = Math.round((viewStart + ((event.clientY - rect.top) / rect.height) * span - 15) / 15) * 15;
                  moveTo(date, Math.max(0, Math.min(1440 - draft.minutes, minute)));
                }}
              >
                {weekBlocks
                  .filter((block) => block.date === date)
                  .map((block, index) => (
                    <span
                      key={index}
                      className={`week-preview-busy ${on && overlaps(block, start, end) ? "is-hit" : ""}`}
                      style={{ top: `${pct(block.start)}%`, height: `${((block.end - block.start) / span) * 100}%` }}
                    >
                      {block.label}
                    </span>
                  ))}
                {on ? (
                  <span
                    className={`week-preview-new ${clashes.some((block) => block.date === date) ? "is-bad" : ""}`}
                    style={{ top: `${pct(start)}%`, height: `${(draft.minutes / span) * 100}%` }}
                    role="img"
                    aria-label={t("New class from {start} to {end}", { start: formatTime(start, locale), end: formatTime(end, locale) })}
                    onPointerDown={(event) => drag(event, "move")}
                  >
                    {formatTime(start, locale).replace(/ .*/, "")}–{formatTime(end, locale).replace(/ .*/, "")}
                    <span className="resize-handle" onPointerDown={(event) => drag(event, "size")} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="conflict-line" aria-live="polite">
          {clashBlock ? (
            <span className="st st-venc">
              {t("Conflicts with {name} on {day}", { name: clashBlock.label, day: weekdayLong(clashBlock.date, locale) })}
            </span>
          ) : (
            <span className="st st-ok">{t("Free time")}</span>
          )}
          {suggestions.length ? (
            <span className="suggestions">
              {suggestions.map((option) => (
                <button
                  type="button"
                  key={`${option.date}-${option.minute}`}
                  className="suggestion-button"
                  onClick={() => moveTo(option.date, option.minute)}
                >
                  {weekdayShort(option.date, locale).replace(/^./, (c) => c.toUpperCase())} {formatTime(option.minute, locale)}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        <div className={`price-row ${isGroup ? "" : "is-two"}`}>
          <Field label={t("Price per hour")}>
            <MoneyInput
              large
              label={t("Price per hour")}
              value={rateText}
              suffix="/ h"
              onChange={(value) => update({ rate: value })}
            />
          </Field>
          <div className="price-figure">
            <span className="field-label">{t("Per student")}</span>
            <b>{formatMoney(perStudent, locale)}</b>
          </div>
          {isGroup ? (
            <div className="price-figure">
              <span className="field-label">
                {t("Per class · {count} students", { count: members.length })}
              </span>
              <b>{formatMoney(perStudent * members.length, locale)}</b>
            </div>
          ) : null}
        </div>
        {rateChanged ? (
          <p className="rate-change">
            {isGroup
              ? t("The rate of {name} will change (was {amount}).", { name: group?.name || "", amount: formatMoney(baseRate, locale) })
              : t("Own rate for {name} (was {amount}).", {
                  name: student?.fullName?.split(" ")[0] || "",
                  amount: formatMoney(baseRate, locale),
                })}
            <button type="button" className="link-button" onClick={() => update({ rate: "" })}>
              {t("Restore")}
            </button>
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
