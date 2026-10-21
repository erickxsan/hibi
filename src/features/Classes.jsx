import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Save } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import {
  AttendanceChoice,
  BottomSheet,
  Button,
  EmptyState,
  Field,
  Input,
  PaymentChoice,
  SectionHeading,
  Segmented,
  Switch,
  Tabs,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { useCompactViewport } from "../components/OverlayContext";
import { addDays, startOfWeek, todayDateOnly } from "../domain/dates";
import { scheduledClassSupportsFutureScope } from "../domain";
import { deriveMonthlyCharges, isMonthlyGroup, monthlyDueDate, normalizeGroupBilling, periodOf } from "../domain/monthlyBilling";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { confirmDiscard, draftChanged, draftSignature, useUnsavedChanges } from "../hooks/useUnsavedChanges";
import { playHibiSound } from "../utils/hibiSounds";
import {
  dayNumber,
  formatDayMonth,
  formatHours,
  formatLongDate,
  formatMoney,
  formatScore,
  formatShortDate,
  formatSpan,
  formatTime,
  formatTimeRange,
  minutesOf,
  monthLong,
  nowTimeFor,
  relativeDay,
  weekdayShort,
} from "../utils/displayFormat";
import {
  buildClassWorkspaceSessions,
  rosterForClassSession,
  selectPrimaryClassSession,
  STATUS_LOOK,
} from "./classesWorkspaceModel";
import {
  buildClassDraft,
  buildClassRecords,
  classDraftSummary,
  rebaseClassDraft,
  studentClassNote,
} from "./classesDraftModel";
import { ClassCalendar } from "./ClassCalendar";
import { ClassHistory } from "./ClassHistory";
import { NewClassDrawer } from "./NewClassDrawer";
import { EditClassDrawer } from "./EditClassDrawer";
import "./classes.css";

const TABS = [
  { value: "next", label: "Next class" },
  { value: "calendar", label: "Calendar" },
  { value: "history", label: "History" },
];

export function sessionStudentCount(state, session) {
  return rosterForClassSession(state, session).length;
}

/** «2 de 3 presentes · faltó Luna» for a recorded class, or «2 h · 5 alumnos». */
export function sessionSubline(state, session, t, locale) {
  const rows = (session.rows || []).filter((row) => row.classStatus === "Completed");
  if (rows.length) {
    const present = rows.filter((row) => row.attendance === "P" || row.attendance === "L").length;
    const absentNames = rows
      .filter((row) => row.attendance === "A")
      .map((row) => (state.students || []).find((student) => student.id === row.studentId)?.fullName?.split(" ")[0])
      .filter(Boolean);
    const base = t("{present} of {total} present", { present, total: rows.length });
    return absentNames.length
      ? `${base} · ${t("{names} missed", { names: new Intl.ListFormat(locale, { type: "conjunction" }).format(absentNames) })}`
      : base;
  }
  const hours = formatHours(session.durationHours, locale);
  if (session.format === "individual") return `${hours} · ${t("Individual")}`;
  const count = sessionStudentCount(state, session);
  return `${hours} · ${t(count === 1 ? "{count} student" : "{count} students", { count })}`;
}

function noteText(note, t, locale) {
  switch (note.kind) {
    case "absences":
      return t("Missed {missed} of their last {total} classes", { missed: note.missed, total: note.total });
    case "owes":
      return t("Owes {amount} from the class on {date}", {
        amount: formatMoney(note.amount, locale),
        date: formatShortDate(note.date, locale, { weekday: false }),
      });
    case "ungraded":
      return t("Missing grade for {assessment}", { assessment: note.assessment });
    case "monthlyPending":
      return t("{month} monthly fee pending", { month: monthLong(`${note.period}-01`, locale) });
    case "customFee":
      return t("Own fee {amount}", { amount: formatMoney(note.fee, locale) });
    default:
      return t("Up to date");
  }
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function WeekRail({ state, sessions, currentDate, weekStart, setWeekStart, selectedDay, setSelectedDay, activeKey, onSelect }) {
  const { t, locale } = useI18n();
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = days[6];
  const inWeek = sessions.filter((session) => session.classDate >= weekStart && session.classDate <= weekEnd);
  const visible = inWeek.filter((session) => session.classDate >= selectedDay);
  const pending = sessions
    .filter((session) => session.statusLabel === "Pending" && session.classDate >= addDays(currentDate, -30))
    .filter((session) => !visible.some((item) => item.key === session.key))
    .slice(-6);
  const byDate = new Map();
  visible.forEach((session) => byDate.set(session.classDate, [...(byDate.get(session.classDate) || []), session]));
  const sameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7);
  const range = sameMonth
    ? `${dayNumber(weekStart)} – ${formatDayMonth(weekEnd, locale)}`
    : `${formatShortDate(weekStart, locale, { weekday: false })} – ${formatShortDate(weekEnd, locale, { weekday: false })}`;
  const dayLabel = (date) => {
    const relative = relativeDay(date, currentDate);
    if (!relative) return formatShortDate(date, locale, { weekday: true }).replace(/ \S+$/, "");
    return relative.key === "Tomorrow" ? `${t("Tomorrow")} · ${formatShortDate(date, locale, { weekday: true }).replace(/ \S+$/, "")}` : t(relative.key);
  };
  const item = (session) => {
    const look = STATUS_LOOK[session.statusLabel];
    const showStatus = session.statusLabel !== "Scheduled" || session.key === activeKey;
    return (
      <button
        type="button"
        key={session.key}
        className={`agenda-item ${session.key === activeKey ? "is-selected" : ""}`}
        aria-current={session.key === activeKey ? "true" : undefined}
        onClick={() => onSelect(session)}
      >
        <time>{formatTime(session.startTime, locale)}</time>
        <span>
          <strong>{session.title}</strong>
          <small>{sessionSubline(state, session, t, locale)}</small>
          {showStatus ? <span className={`st ${look.className}`}>{t(look.label)}</span> : null}
        </span>
      </button>
    );
  };
  return (
    <>
      <div className="agenda-week-head">
        <span>
          {range}
          <span className="agenda-week-nav">
            <button type="button" aria-label={t("Previous week")} onClick={() => setWeekStart(addDays(weekStart, -7))}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <button type="button" aria-label={t("Next week")} onClick={() => setWeekStart(addDays(weekStart, 7))}>
              <ChevronRight aria-hidden="true" />
            </button>
          </span>
        </span>
        <small>{t(inWeek.length === 1 ? "{count} class" : "{count} classes", { count: inWeek.length })}</small>
      </div>
      <div className="week-strip" role="group" aria-label={t("Days of the week")}>
        {days.map((date) => (
          <button
            type="button"
            key={date}
            className={`${date === selectedDay ? "is-selected" : ""} ${date === currentDate ? "is-today" : ""}`.trim()}
            aria-pressed={date === selectedDay}
            aria-current={date === currentDate ? "date" : undefined}
            aria-label={formatLongDate(date, locale)}
            onClick={() => setSelectedDay(date)}
          >
            {weekdayShort(date, locale).charAt(0).toUpperCase()}
            <b>{dayNumber(date)}</b>
            <i className={inWeek.some((session) => session.classDate === date) ? "" : "is-empty"} />
          </button>
        ))}
      </div>
      <div className="agenda">
        {pending.length ? (
          <>
            <h3>{t("Not recorded")}</h3>
            {pending.map(item)}
          </>
        ) : null}
        {[...byDate.entries()].map(([date, items]) => (
          <div key={date} className="agenda-day">
            <h3>{dayLabel(date)}</h3>
            {items.map(item)}
          </div>
        ))}
        {!visible.length && !pending.length ? <p className="agenda-empty">{t("No classes left this week.")}</p> : null}
      </div>
    </>
  );
}

function MonthlyPaymentCell({ charge, today, onToggle, busy }) {
  const { t, locale } = useI18n();
  const month = capitalize(monthLong(`${charge.period}-01`, locale));
  if (charge.status === "paid") {
    const paidToday = charge.paidAt === today;
    return (
      <span className="monthly-pay">
        <span className="st st-ok">{t("{month} paid", { month })}</span>
        <small>
          {formatMoney(charge.amount, locale)} ·{" "}
          {paidToday ? t("today") : t("paid on {date}", { date: formatShortDate(charge.paidAt, locale, { weekday: false }) })}
        </small>
        {paidToday ? (
          <button type="button" className="link-button" disabled={busy} onClick={() => onToggle(charge, false)}>
            {t("Undo")}
          </button>
        ) : null}
      </span>
    );
  }
  if (charge.status === "waived") {
    return (
      <span className="monthly-pay">
        <span className="st st-prog">{t("{month} at no cost", { month })}</span>
        <small>{t("Monthly fee starts next month")}</small>
      </span>
    );
  }
  const due =
    charge.dueDate === today
      ? t("Due today, in this class")
      : charge.status === "overdue"
        ? t("Overdue since {date}", { date: formatShortDate(charge.dueDate, locale, { weekday: false }) })
        : t("Due {date}", { date: formatShortDate(charge.dueDate, locale) });
  return (
    <span className="monthly-pay">
      <span className={`st ${charge.status === "overdue" ? "st-venc" : "st-pend"}`}>
        {month} · {formatMoney(charge.amount, locale)}
      </span>
      <small>{due}</small>
      <button type="button" className="link-button" disabled={busy} onClick={() => onToggle(charge, true)}>
        {t("Mark paid")}
      </button>
    </span>
  );
}

function RosterRow({ student, entry, note, setEntry, assessmentOn, maximum, monthlyCharge, today, onMonthly, busy }) {
  const { t, locale } = useI18n();
  const attendance = entry.attendance || "";
  let payment;
  if (monthlyCharge) {
    payment = <MonthlyPaymentCell charge={monthlyCharge} today={today} onToggle={onMonthly} busy={busy} />;
  } else if (attendance === "P") {
    payment = (
      <>
        <span className="cell-label">{t("Today's payment")}</span>
        <PaymentChoice
          value={entry.paymentState || ""}
          name={student.fullName}
          onChange={(paymentState) => {
            setEntry(student.id, { paymentState, paymentTouched: true });
            playHibiSound("payment");
          }}
        />
      </>
    );
  } else if (attendance === "A") {
    payment = <span className="roster-muted">{t("— absent · not charged")}</span>;
  } else payment = <span className="roster-muted">—</span>;
  let grade;
  if (assessmentOn && attendance === "P") {
    grade = (
      <>
        <span className="cell-label">{t("Grade")}</span>
        <span className="grade-input">
          <Input
            inputMode="decimal"
            aria-label={t("Grade for {name}", { name: student.fullName })}
            value={entry.score ?? ""}
            placeholder="—"
            onChange={(event) => setEntry(student.id, { score: event.target.value.replace(",", ".") })}
          />
          <span>/{maximum || "—"}</span>
        </span>
      </>
    );
  } else grade = <span className="roster-muted">{attendance === "A" && assessmentOn ? t("— absent") : "—"}</span>;
  const empty = (node) => (!monthlyCharge && attendance !== "P" ? "is-empty" : node ? "" : "is-empty");
  return (
    <div className="roster-row" role="row">
      <span role="rowheader" className="person" data-cell="who">
        <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
        <span>
          <strong>{student.fullName}</strong>
          <small className={note.tone ? `text-${note.tone}` : "muted"}>{noteText(note, t, locale)}</small>
        </span>
      </span>
      <span role="cell" data-cell="attendance">
        <AttendanceChoice
          value={attendance}
          name={student.fullName}
          onChange={(value) => setEntry(student.id, { attendance: value })}
        />
      </span>
      <span role="cell" data-cell="payment" className={empty(payment)}>
        {payment}
      </span>
      <span role="cell" data-cell="grade" className={assessmentOn && attendance === "P" ? "" : "is-empty"}>
        {grade}
      </span>
    </div>
  );
}

export default function Classes({
  state = undefined,
  actions = undefined,
  derived = undefined,
  asOfDate,
  intent,
  clearIntent,
  registerNavigationBlocker,
  openPage = undefined,
}) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const currentDate = asOfDate || state.settings?.asOfDate || todayDateOnly();
  const sessions = useMemo(() => buildClassWorkspaceSessions(state, currentDate), [currentDate, state]);
  const [currentTime, setCurrentTime] = useState(() => nowTimeFor(currentDate, todayDateOnly()));
  useEffect(() => {
    const update = () => setCurrentTime(nowTimeFor(currentDate, todayDateOnly()));
    update();
    if (currentDate !== todayDateOnly()) return undefined;
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, [currentDate]);
  const primary = useMemo(
    () => selectPrimaryClassSession(sessions, currentDate, currentTime),
    [currentDate, currentTime, sessions],
  );
  const [tab, setTab] = useState("next");
  const [selectedKey, setSelectedKey] = useState("");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(currentDate));
  const [selectedDay, setSelectedDay] = useState(currentDate);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [newClassOpen, setNewClassOpen] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [entries, setEntries] = useState({});
  const [assessmentOn, setAssessmentOn] = useState(false);
  const [assessment, setAssessment] = useState("");
  const [maximum, setMaximum] = useState(10);
  const [saving, setSaving] = useState(false);
  const [monthlyBusy, setMonthlyBusy] = useState(false);
  const [remoteUpdate, setRemoteUpdate] = useState(null);
  const baselineRef = useRef(null);
  const hydratedSessionKeyRef = useRef("");
  const hydratedSessionRef = useRef(null);
  const observedRemoteSignatureRef = useRef("");
  const snapshot = useMemo(
    () => ({ entries, assessmentOn, assessment, maximum }),
    [assessment, assessmentOn, entries, maximum],
  );
  const dirty = Boolean(baselineRef.current) && draftChanged(snapshot, baselineRef.current);

  const selectedSession = sessions.find((session) => session.key === selectedKey) || null;
  const retainedSession =
    dirty && hydratedSessionRef.current
      ? sessions.find((session) => session.key === hydratedSessionKeyRef.current) || hydratedSessionRef.current
      : null;
  const activeSession = selectedSession || retainedSession || primary;
  const canEditActiveSession =
    activeSession &&
    !(activeSession.rows || []).length &&
    (activeSession.occurrenceDate || activeSession.classDate) >= currentDate &&
    Boolean(activeSession.classScheduleId || activeSession.scheduleSlotId || activeSession.exceptionId);
  const roster = useMemo(() => rosterForClassSession(state, activeSession), [activeSession, state]);
  const activeGroup = (state.groups || []).find((group) => group.id === activeSession?.groupId) || null;
  const monthlyCharges = useMemo(
    () =>
      activeSession && activeGroup && isMonthlyGroup(activeGroup)
        ? deriveMonthlyCharges(state, currentDate, { through: periodOf(activeSession.classDate) > periodOf(currentDate) ? periodOf(activeSession.classDate) : periodOf(currentDate) })
        : [],
    [activeGroup, activeSession, currentDate, state],
  );
  const chargeFor = (studentId) =>
    monthlyCharges.find(
      (item) =>
        item.studentId === studentId &&
        item.groupId === activeSession?.groupId &&
        item.period === periodOf(activeSession?.classDate),
    ) || null;

  const remoteDraft = useMemo(() => buildClassDraft(state, activeSession), [activeSession, state]);
  const remoteSignature = useMemo(() => draftSignature(remoteDraft), [remoteDraft]);
  const latestRemoteRef = useRef(null);
  latestRemoteRef.current = {
    session: activeSession,
    sessionKey: activeSession?.key || "",
    snapshot: remoteDraft,
    signature: remoteSignature,
  };

  const applyDraft = useCallback((next, baseline = next) => {
    setEntries(next.entries);
    setAssessmentOn(next.assessmentOn);
    setAssessment(next.assessment);
    setMaximum(next.maximum);
    baselineRef.current = baseline;
  }, []);
  const acceptRemoteDraft = useCallback(
    (remote) => {
      applyDraft(remote.snapshot);
      hydratedSessionKeyRef.current = remote.sessionKey;
      hydratedSessionRef.current = remote.session;
      observedRemoteSignatureRef.current = remote.signature;
      setRemoteUpdate(null);
    },
    [applyDraft],
  );

  useUnsavedChanges(registerNavigationBlocker, dirty, "Discard your unsaved class changes?");
  const changeTab = useHistoryBackedState({
    key: "classes-workspace-tab",
    value: tab,
    onChange: setTab,
    defaultValue: "next",
    allowedValues: ["next", "calendar", "history"],
    canChange: () => {
      if (!dirty) return true;
      if (!confirmDiscard(true, "Discard your unsaved class changes?")) return false;
      acceptRemoteDraft(latestRemoteRef.current);
      return true;
    },
  });

  const focusSession = useCallback((session) => {
    setSelectedKey(session.key);
    setWeekStart(startOfWeek(session.classDate));
    setSelectedDay(session.classDate);
  }, []);

  useEffect(() => {
    if (intent === "class-history" || intent === "add-grades") changeTab("history", { replace: true });
    if (intent?.type === "open-history-class" && typeof intent.sessionKey === "string") {
      changeTab("history", { replace: true });
    }
    if (intent?.type === "open-class" && typeof intent.sessionKey === "string") {
      const session = sessions.find((item) => item.key === intent.sessionKey);
      if (changeTab("next", { replace: true }) && session) focusSession(session);
      else if (changeTab("next", { replace: true })) setSelectedKey(intent.sessionKey);
    }
    if (intent?.type === "open-calendar") changeTab("calendar", { replace: true });
    if (intent === "new-class") setNewClassOpen(true);
    if (intent) clearIntent?.();
  }, [changeTab, clearIntent, focusSession, intent, sessions]);

  useEffect(() => {
    const remote = latestRemoteRef.current;
    if (hydratedSessionKeyRef.current !== remote.sessionKey) {
      applyDraft(remote.snapshot);
      hydratedSessionKeyRef.current = remote.sessionKey;
      hydratedSessionRef.current = remote.session;
      observedRemoteSignatureRef.current = remote.signature;
      setRemoteUpdate(null);
      return;
    }
    if (observedRemoteSignatureRef.current === remote.signature) return;
    if (dirty) {
      setRemoteUpdate((current) => (current?.signature === remote.signature ? current : remote));
      return;
    }
    applyDraft(remote.snapshot);
    hydratedSessionRef.current = remote.session;
    observedRemoteSignatureRef.current = remote.signature;
    setRemoteUpdate(null);
  }, [activeSession?.key, applyDraft, dirty, remoteSignature]);

  const keepDraft = () => {
    hydratedSessionRef.current = remoteUpdate.session;
    observedRemoteSignatureRef.current = remoteUpdate.signature;
    setRemoteUpdate(null);
  };
  const reloadRemoteDraft = () => acceptRemoteDraft(remoteUpdate || latestRemoteRef.current);
  const rebaseDraft = () => {
    const remote = remoteUpdate || latestRemoteRef.current;
    applyDraft(rebaseClassDraft(snapshot, baselineRef.current, remote.snapshot), remote.snapshot);
    hydratedSessionRef.current = remote.session;
    observedRemoteSignatureRef.current = remote.signature;
    setRemoteUpdate(null);
  };

  const setEntry = (studentId, patch) =>
    setEntries((current) => ({ ...current, [studentId]: { ...current[studentId], ...patch } }));

  const saveSession = async (classStatus = "Completed") => {
    if (!activeSession || !roster.length || !actions.saveProgress) return;
    if (remoteUpdate) return actions.notify?.("Choose how to handle the newer class data before saving.", "error");
    const trimmedAssessment = assessment.trim();
    const max = Number(maximum);
    if (assessmentOn && !trimmedAssessment)
      return actions.notify?.("Name the assignment before saving grades.", "error");
    if (assessmentOn && (!Number.isFinite(max) || max <= 0))
      return actions.notify?.("Enter a valid maximum score.", "error");
    const invalid = roster.find(
      (student) =>
        entries[student.id]?.score !== "" &&
        entries[student.id]?.score != null &&
        (!Number.isFinite(Number(entries[student.id]?.score)) ||
          Number(entries[student.id]?.score) < 0 ||
          Number(entries[student.id]?.score) > max),
    );
    if (invalid) return actions.notify?.(`Check the grade for ${invalid.fullName}.`, "error");
    const unmarked = roster.filter((student) => !entries[student.id]?.attendance).length;
    if (
      classStatus === "Completed" &&
      unmarked &&
      globalThis.confirm?.(t("{count} students are still unmarked. Save anyway?", { count: unmarked })) === false
    )
      return;
    const classRecords = buildClassRecords(state, activeSession, roster, entries, { classStatus, today: currentDate });
    const gradeRecords = assessmentOn
      ? roster.flatMap((student) => {
          const entry = entries[student.id] || {};
          if ((entry.score === "" || entry.score == null) && !entry.gradeId) return [];
          const existing =
            (state.grades || []).find((grade) => grade.id === entry.gradeId) ||
            (state.grades || []).find(
              (grade) =>
                grade.classSessionKey === activeSession.key &&
                grade.studentId === student.id &&
                grade.assessment === trimmedAssessment,
            );
          return [
            {
              ...existing,
              id: existing?.id,
              date: activeSession.classDate,
              studentId: student.id,
              assessment: trimmedAssessment,
              category: existing?.category || "Homework",
              score: entry.score === "" || entry.score == null ? null : Number(entry.score),
              maxScore: max,
              workStatus: existing?.workStatus || "On time",
              feedback: existing?.feedback || "",
              classSessionKey: activeSession.key,
            },
          ];
        })
      : [];
    setSaving(true);
    try {
      if (await actions.saveProgress({ classRecords, gradeRecords })) {
        baselineRef.current = { entries, assessmentOn, assessment, maximum };
        playHibiSound(classStatus === "Completed" ? "success" : "selection");
      }
    } finally {
      setSaving(false);
    }
  };
  const cancelSession = () => {
    if (!globalThis.confirm?.(t("Mark this class as cancelled? Existing payments will be preserved."))) return;
    saveSession("Cancelled");
  };
  const toggleMonthly = async (charge, paid) => {
    if (!actions.setMonthlyPaid) return;
    setMonthlyBusy(true);
    try {
      await actions.setMonthlyPaid({
        studentId: charge.studentId,
        groupId: charge.groupId,
        period: charge.period,
        amount: charge.amount,
        paid,
      });
    } finally {
      setMonthlyBusy(false);
    }
  };

  const selectSession = useCallback(
    (session) => {
      if (!session) return;
      setAgendaOpen(false);
      if (session.key === activeSession?.key) return;
      if (dirty && !confirmDiscard(true, "Discard your unsaved class changes?")) return;
      if (dirty) {
        hydratedSessionKeyRef.current = "";
        hydratedSessionRef.current = null;
      }
      focusSession(session);
    },
    [activeSession?.key, dirty, focusSession],
  );
  const openFromOtherTab = useCallback(
    (session) => {
      if (!session) return;
      if (dirty && !confirmDiscard(true, "Discard your unsaved class changes?")) return;
      if (dirty) {
        hydratedSessionKeyRef.current = "";
        hydratedSessionRef.current = null;
      }
      focusSession(session);
      changeTab("next");
    },
    [changeTab, dirty, focusSession],
  );

  const summary = activeSession
    ? classDraftSummary(
        state,
        activeSession,
        roster,
        entries,
        monthlyCharges
          .filter(
            (item) =>
              item.groupId === activeSession.groupId &&
              item.status === "paid" &&
              item.paidAt === currentDate &&
              roster.some((student) => student.id === item.studentId),
          )
          .reduce((sum, item) => sum + item.amount, 0),
      )
    : null;
  const derivedRows = derived?.classLog || [];
  const billing = normalizeGroupBilling(activeGroup?.billing);
  const monthlyActive = Boolean(activeGroup && activeSession && isMonthlyGroup(activeGroup, periodOf(activeSession.classDate)));
  const monthlyDue = monthlyActive ? monthlyDueDate(state, activeGroup, periodOf(activeSession.classDate)) : "";
  const ordinal = billing?.due?.type === "nthClass" ? t(billing.due.nth === "last" ? "last class" : "class {nth}", { nth: billing.due.nth }) : "";
  const monthlyBadge = monthlyActive
    ? `${t("Monthly")} · ${formatMoney(billing.monthlyFee, locale)} · ${
        monthlyDue === activeSession.classDate
          ? t("due today")
          : t("due {date}", { date: formatShortDate(monthlyDue, locale, { weekday: false }) })
      }${ordinal ? ` (${ordinal})` : ""}`
    : "";
  const relative = activeSession ? relativeDay(activeSession.classDate, currentDate) : null;
  const metaDate = activeSession
    ? `${relative ? `${t(relative.key)}, ` : ""}${formatShortDate(activeSession.classDate, locale)}`
    : "";
  const startsIn =
    activeSession && activeSession.classDate === currentDate && minutesOf(activeSession.startTime) > minutesOf(currentTime)
      ? t("in {span}", { span: formatSpan(minutesOf(activeSession.startTime) - minutesOf(currentTime)) })
      : "";
  const look = activeSession ? STATUS_LOOK[activeSession.statusLabel] : null;
  const recorded = Boolean((activeSession?.rows || []).length);
  const marked = summary ? summary.present + summary.absent : 0;

  const rail = (
    <WeekRail
      state={state}
      sessions={sessions}
      currentDate={currentDate}
      weekStart={weekStart}
      setWeekStart={(date) => {
        setWeekStart(date);
        setSelectedDay(date <= currentDate && addDays(date, 6) >= currentDate ? currentDate : date);
      }}
      selectedDay={selectedDay}
      setSelectedDay={setSelectedDay}
      activeKey={activeSession?.key}
      onSelect={selectSession}
    />
  );

  const taskFields = (
    <>
      <Field label={t("Assignment name")} className="task-name">
        <Input value={assessment} onChange={(event) => setAssessment(event.target.value)} placeholder={t("e.g. Reading ch. 3")} />
      </Field>
      <Field label={t("Maximum score")} className="task-max">
        <Input inputMode="decimal" value={maximum} onChange={(event) => setMaximum(event.target.value.replace(",", "."))} />
      </Field>
    </>
  );

  return (
    <div className={`page classes-page ${tab === "next" && activeSession ? "has-dock" : ""}`}>
      <SectionHeading
        kicker={compact ? formatLongDate(currentDate, locale) : undefined}
        title={t("Classes")}
        description={t(
          tab === "calendar"
            ? "Your month at a glance. Tap a day to see its classes."
            : tab === "history"
              ? "Everything that already happened, class by class. Tap one to see each student."
              : "Choose a class from your schedule and record it right here.",
        )}
        actions={
          <Button icon={Plus} onClick={() => setNewClassOpen(true)}>
            {t(compact ? "New" : "New class")}
          </Button>
        }
      />
      <Tabs value={tab} onChange={(value) => changeTab(value)} items={TABS} ariaLabel={t("Class views")} />
      <Segmented
        className="view-tabs-mobile"
        tone="soft"
        value={tab}
        onChange={(value) => changeTab(value)}
        label={t("Class views")}
        items={[
          { value: "next", label: "Next" },
          { value: "calendar", label: "Calendar" },
          { value: "history", label: "History" },
        ]}
      />
      {remoteUpdate ? (
        <div className="notice is-warn class-remote-update" role="alert">
          <div>
            <strong>{t("Newer class data is available")}</strong>
            <p>{t("Your unsaved attendance, payments, and grades are safe. Choose how to continue.")}</p>
            <div className="notice-actions">
              <Button onClick={keepDraft}>{t("Keep my draft")}</Button>
              <Button onClick={reloadRemoteDraft}>{t("Reload remote version")}</Button>
              <Button variant="primary" onClick={rebaseDraft}>
                {t("Rebase my draft")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "next" ? (
        <div className="split" role="tabpanel" data-onboarding-tour="classes">
          <aside className="split-rail agenda-rail" aria-label={t("Week schedule")}>
            {rail}
          </aside>
          {activeSession ? (
            <section className="split-main register" aria-labelledby="register-title">
              <button type="button" className="current-card" onClick={() => setAgendaOpen(true)}>
                <span className="current-kicker">
                  <span>
                    {relative ? t(relative.key) : formatShortDate(activeSession.classDate, locale)}
                    {activeSession.statusLabel === "Scheduled" && activeSession.key === primary?.key ? ` · ${t("next")}` : ""}
                  </span>
                  <span>{startsIn || (look ? t(look.label) : "")}</span>
                </span>
                <strong>{activeSession.title}</strong>
                <small>
                  {formatTimeRange(activeSession.startTime, activeSession.durationHours, locale)} ·{" "}
                  {t(roster.length === 1 ? "{count} student" : "{count} students", { count: roster.length })}
                </small>
                {monthlyBadge ? <span className="monthly-badge">{monthlyBadge}</span> : null}
              </button>
              <div className="register-head">
                <div>
                  <span className="register-meta">
                    {metaDate} · {formatTimeRange(activeSession.startTime, activeSession.durationHours, locale)} ·{" "}
                    {t(activeSession.format === "group" ? "Group" : "Individual")}
                    {activeSession.statusLabel !== "Scheduled" ? (
                      <span className={`st ${look.className}`}>{t(look.label)}</span>
                    ) : null}
                    {monthlyBadge ? <span className="monthly-badge">{monthlyBadge}</span> : null}
                  </span>
                  <h2 id="register-title">{activeSession.title}</h2>
                </div>
                {canEditActiveSession ? (
                  <Button variant="ghost" icon={Pencil} onClick={() => setEditingSession(activeSession)}>
                    {t("Edit class")}
                  </Button>
                ) : null}
              </div>
              <div className="task-row">
                <Field label={t("Record assignment?")}>
                  <Segmented
                    value={assessmentOn}
                    onChange={setAssessmentOn}
                    label={t("Record assignment")}
                    items={[
                      { value: true, label: "Yes" },
                      { value: false, label: "No" },
                    ]}
                  />
                </Field>
                {assessmentOn ? taskFields : null}
              </div>
              <div className="task-switch-row-wrap">
                <div className="task-switch-row">
                  <span>
                    <b>{t("Assignment")}</b>
                    <small>
                      {assessmentOn
                        ? assessment
                          ? t("{name} · out of {max}", { name: assessment, max: maximum })
                          : t("Name it below")
                        : t("This class has no assignment")}
                    </small>
                  </span>
                  <Switch label={t("Record assignment")} checked={assessmentOn} onChange={setAssessmentOn} />
                </div>
                {assessmentOn && compact ? <div className="task-fields-mobile">{taskFields}</div> : null}
              </div>
              {compact ? (
                <div className="roster-section-head">
                  <h2>{t("Students")}</h2>
                  <span>{t("They start unmarked")}</span>
                </div>
              ) : null}
              {!roster.length ? (
                <EmptyState
                  icon={CalendarDays}
                  title={t("No active students")}
                  description={t("Add active students to this group in Community before registering the class.")}
                />
              ) : (
                <div className="table-scroll roster-scroll" role="region" aria-label={t("Class student roster")} tabIndex={0}>
                  <div className="roster-grid" role="table" aria-label={t("Class student roster")}>
                    <div className="roster-head" role="row">
                      <span role="columnheader">{t("Student")}</span>
                      <span role="columnheader">{t("Attendance")}</span>
                      <span role="columnheader">{t(monthlyActive ? "Payment · monthly fee or class" : "Payment for this class")}</span>
                      <span role="columnheader">{t("Grade")}</span>
                    </div>
                    {roster.map((student) => (
                      <RosterRow
                        key={student.id}
                        student={student}
                        entry={entries[student.id] || {}}
                        note={studentClassNote(state, student, activeSession, derivedRows, monthlyCharges)}
                        setEntry={setEntry}
                        assessmentOn={assessmentOn}
                        maximum={maximum}
                        monthlyCharge={chargeFor(student.id)}
                        today={currentDate}
                        onMonthly={toggleMonthly}
                        busy={monthlyBusy}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="sheet-bar register-bar">
                <div className="register-summary" aria-live="polite">
                  <span>
                    <b>{summary.present}</b> {t(summary.present === 1 ? "present" : "present (plural)")}
                  </span>
                  <span>
                    <b>{summary.absent}</b> {t(summary.absent === 1 ? "absent" : "absent (plural)")}
                  </span>
                  <span>
                    <b>{summary.unmarked}</b> {t("unmarked")}
                  </span>
                  <span>
                    <b>{formatMoney(summary.collected, locale)}</b> {t("collected today")}
                  </span>
                  <span>
                    <b>{formatMoney(summary.pending, locale)}</b> {t("pending")}
                  </span>
                  {summary.average !== null ? (
                    <span>
                      <b>{formatScore(summary.average, locale)}</b> {t("average")}
                    </span>
                  ) : null}
                </div>
                <div className="sheet-bar-actions">
                  {dirty && recorded ? (
                    <Button variant="ghost" onClick={reloadRemoteDraft} disabled={saving}>
                      {t("Discard changes")}
                    </Button>
                  ) : null}
                  {activeSession.statusLabel !== "Cancelled" ? (
                    <Button variant="ghost" className="muted-ghost" onClick={cancelSession} disabled={saving}>
                      {t("Mark cancelled")}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    icon={Save}
                    onClick={() => saveSession("Completed")}
                    disabled={!roster.length || saving || Boolean(remoteUpdate)}
                  >
                    {saving ? t("Saving…") : recorded ? t("Save changes") : t("Save class")}
                  </Button>
                </div>
              </div>
              {compact ? (
                <div className="register-dock" aria-live="polite">
                  <div className="register-dock-top">
                    {marked
                      ? t("{present} present · {absent} absent", { present: summary.present, absent: summary.absent })
                      : t("Nobody marked yet")}
                    <span>
                      {summary.unmarked
                        ? t("{count} left", { count: summary.unmarked })
                        : `${formatMoney(summary.collected, locale)} ${t("collected")}${summary.pending ? ` · ${formatMoney(summary.pending, locale)} ${t("pending")}` : ""}`}
                    </span>
                  </div>
                  <div className="meter" aria-hidden="true">
                    <i style={{ width: `${roster.length ? Math.round((marked / roster.length) * 100) : 0}%` }} />
                  </div>
                  <div className="register-dock-actions">
                    {activeSession.statusLabel !== "Cancelled" ? (
                      <Button onClick={cancelSession} disabled={saving}>
                        {t("Cancelled")}
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Button
                      variant="primary"
                      onClick={() => saveSession("Completed")}
                      disabled={!roster.length || saving || Boolean(remoteUpdate)}
                    >
                      {saving ? t("Saving…") : recorded ? t("Save changes") : t("Save class")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <section className="split-main">
              <EmptyState
                stamp
                title={t("No upcoming classes")}
                description={t("Create a one-time or recurring class to start the daily workflow.")}
                action={
                  <Button icon={Plus} variant="primary" onClick={() => setNewClassOpen(true)}>
                    {t("New class")}
                  </Button>
                }
              />
            </section>
          )}
        </div>
      ) : tab === "calendar" ? (
        <ClassCalendar
          state={state}
          derived={derived}
          currentDate={currentDate}
          primaryKey={primary?.key}
          onOpen={openFromOtherTab}
          onEdit={(session) => setEditingSession(session)}
        />
      ) : (
        <ClassHistory
          state={state}
          derived={derived}
          sessions={sessions}
          currentDate={currentDate}
          initialKey={intent?.type === "open-history-class" ? intent.sessionKey : ""}
          onEdit={openFromOtherTab}
          onOpenTracking={(intentValue) => openPage?.("grades", intentValue)}
        />
      )}
      {compact ? (
        <BottomSheet
          open={agendaOpen}
          onClose={() => setAgendaOpen(false)}
          title={t("Choose a class")}
          kicker={t("Your week")}
        >
          <div className="agenda-sheet">{rail}</div>
        </BottomSheet>
      ) : null}
      <NewClassDrawer
        open={newClassOpen}
        onClose={() => setNewClassOpen(false)}
        state={state}
        asOfDate={currentDate}
        actions={actions}
      />
      <EditClassDrawer
        open={Boolean(editingSession)}
        session={editingSession}
        state={state}
        actions={actions}
        asOfDate={currentDate}
        futureSupported={Boolean(editingSession) && scheduledClassSupportsFutureScope(state, editingSession)}
        onClose={() => setEditingSession(null)}
      />
    </div>
  );
}
