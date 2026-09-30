import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Button, Field, Input } from "../components/ui";
import { getUiLocale, useI18n } from "../i18n";
import ContextualTour from "./ContextualTour";
import {
  dayLabel,
  dayShortLabel,
  formatOnboardingDate,
  nextClassForSchedule,
  ONBOARDING_DAYS,
  ONBOARDING_MAX_STUDENTS,
  ONBOARDING_TOUR_START_STEP,
  ONBOARDING_VERSION,
  scheduleIssue,
  splitPastedStudentNames,
  upcomingClasses,
} from "./onboardingModel";
import "./onboarding.css";

const GUIDE_MASCOT = "/onboarding/hibi-guide.png";
const SETUP_LABELS = ["Group", "Students", "Agenda"];

const DURATION_OPTIONS = Object.freeze([
  { value: 0.5, label: "30 minutes" },
  { value: 1, label: "1 hour" },
  { value: 1.5, label: "1.5 hours" },
  { value: 2, label: "2 hours" },
  { value: 2.5, label: "2.5 hours" },
  { value: 3, label: "3 hours" },
]);

function nextRowKey() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function newScheduleSlot(dayOfWeek = 1, durationHours = 1) {
  return {
    id: `onboarding-slot-${nextRowKey()}`,
    dayOfWeek,
    startTime: "10:00",
    durationHours,
  };
}

function existingGroupFor(state) {
  return state.groups.find((group) => group.id === state.settings.onboardingGroupId) || null;
}

function initialGroupDraft(state) {
  const group = existingGroupFor(state);
  const duration = Number(state.settings.defaultClassHours || 1);
  return {
    id: group?.id || "",
    name: group?.name || "",
    subject: group?.subject || "",
    weeklySchedule: group?.weeklySchedule?.length
      ? group.weeklySchedule.map((slot) => ({ ...slot }))
      : [newScheduleSlot(1, duration)],
  };
}

function initialStudentRows(state) {
  const groupId = state.settings.onboardingGroupId;
  const existing = groupId ? state.students.filter((student) => student.groupIds?.includes(groupId)) : [];
  return existing.length
    ? existing.map((student) => ({ ...student, key: student.id }))
    : [{ key: nextRowKey(), fullName: "" }];
}

// The tour speaks about the group the teacher just created. Replays fall back
// to the first scheduled group so the same hints stay concrete.
function tourContextFor(state, groupId) {
  const group =
    state.groups.find((item) => item.id === groupId) ||
    state.groups.find((item) => item.weeklySchedule?.length) ||
    state.groups[0];
  if (!group) return null;
  const next = nextClassForSchedule(group.weeklySchedule);
  return {
    groupId: group.id,
    groupName: group.name,
    studentCount: state.students.filter(
      (student) => student.status !== "Inactive" && student.groupIds?.includes(group.id),
    ).length,
    nextClass: next ? { date: next.date, time: next.slot.startTime } : null,
  };
}

function StepProgress({ step }) {
  return (
    <ol className="onboarding-progress" aria-label={`Step ${step - 1} of ${SETUP_LABELS.length}`}>
      {SETUP_LABELS.map((label, index) => (
        <li
          key={label}
          className={index + 2 <= step ? "is-active" : ""}
          aria-current={index + 2 === step ? "step" : undefined}
        >
          <span className="onboarding-step-number" aria-hidden="true">
            {index + 2 < step ? <Check size={16} /> : index + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

// Pinned above the footer buttons so the resulting dates stay visible while the
// teacher edits days and times. A submitted schedule issue becomes an alert.
function SchedulePreview({ slots, submittedIssue, locale }) {
  const issue = scheduleIssue(slots);
  if (issue) {
    return (
      <p
        className="onboarding-schedule-preview has-issue"
        role={submittedIssue ? "alert" : undefined}
        aria-live="polite"
      >
        <CircleAlert aria-hidden="true" size={16} />
        {issue}
      </p>
    );
  }
  return (
    <div className="onboarding-schedule-preview" aria-live="polite">
      <strong>
        <CalendarDays aria-hidden="true" size={16} />
        Upcoming classes
      </strong>
      <ol>
        {upcomingClasses(slots, 3).map(({ slot, date }, index) => (
          <li key={`${slot.id}-${date}`} className={index === 0 ? "is-next" : ""}>
            {formatOnboardingDate(date, locale)} <span>{slot.startTime}</span>
          </li>
        ))}
      </ol>
      <small>{`${slots.length} per week · ${slots.length * 4} a month`}</small>
    </div>
  );
}

function ScheduleRows({ rows, setRows }) {
  const addSlot = () => {
    const usedDays = new Set(rows.map((row) => Number(row.dayOfWeek)));
    const nextDay = ONBOARDING_DAYS.find((day) => !usedDays.has(day.value))?.value || 1;
    const duration = Number(rows[0]?.durationHours || 1);
    setRows([...rows, newScheduleSlot(nextDay, duration)]);
  };

  return (
    <section className="onboarding-weekly-schedule" aria-labelledby="onboarding-schedule-title">
      <h2 id="onboarding-schedule-title">Class days</h2>
      <div className="onboarding-schedule-rows">
        {rows.map((slot, index) => (
          <div className="onboarding-schedule-row" key={slot.id}>
            <Field label="Day">
              <select
                className="control"
                value={String(slot.dayOfWeek)}
                onChange={(event) =>
                  setRows(
                    rows.map((row) => (row.id === slot.id ? { ...row, dayOfWeek: Number(event.target.value) } : row)),
                  )
                }
              >
                {ONBOARDING_DAYS.map((day) => (
                  <option value={day.value} key={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Time">
              <Input
                type="time"
                required
                value={slot.startTime}
                onChange={(event) =>
                  setRows(rows.map((row) => (row.id === slot.id ? { ...row, startTime: event.target.value } : row)))
                }
              />
            </Field>
            <Field label="Duration">
              <select
                className="control"
                value={String(slot.durationHours)}
                onChange={(event) =>
                  setRows(
                    rows.map((row) =>
                      row.id === slot.id ? { ...row, durationHours: Number(event.target.value) } : row,
                    ),
                  )
                }
              >
                {DURATION_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="onboarding-remove-schedule"
              type="button"
              disabled={rows.length === 1}
              aria-label={`Remove class day ${index + 1}`}
              onClick={() => setRows(rows.filter((row) => row.id !== slot.id))}
            >
              <Trash2 aria-hidden="true" size={17} />
            </button>
          </div>
        ))}
      </div>
      <Button className="onboarding-add-day" icon={Plus} disabled={rows.length >= 7} onClick={addSlot}>
        Add another day
      </Button>
    </section>
  );
}

export default function OnboardingTutorial({
  open,
  state,
  actions,
  initialStep = 1,
  mode = "full",
  onStepChange,
  onNavigate,
  onDismiss,
  onComplete,
}) {
  useI18n();
  const titleId = useId();
  const panelRef = useRef(null);
  const headingRef = useRef(null);
  const previousFocusRef = useRef(null);
  const studentInputsRef = useRef(new Map());
  const [step, setStep] = useState(initialStep);
  const [groupDraft, setGroupDraft] = useState(() => initialGroupDraft(state));
  const [studentRows, setStudentRows] = useState(() => initialStudentRows(state));
  const [removedStudentIds, setRemovedStudentIds] = useState([]);
  const [focusStudentKey, setFocusStudentKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [completed, setCompleted] = useState(false);

  // Only an unfinished first run saves tour progress; replays leave settings untouched.
  const firstRun = Number(state.settings.onboardingVersion) < ONBOARDING_VERSION;
  const tourOnly = mode === "tour";
  const isSetup = step < ONBOARDING_TOUR_START_STEP;
  const showsDialog = isSetup || completed;
  const groupId = groupDraft.id || state.settings.onboardingGroupId;
  const group = useMemo(
    () => state.groups.find((item) => item.id === groupId) || { ...groupDraft, id: groupId },
    [groupDraft, groupId, state.groups],
  );
  const tourContext = useMemo(() => tourContextFor(state, groupId), [groupId, state]);
  const studentCount = studentRows.filter((student) => student.fullName?.trim()).length;
  const locale = getUiLocale();

  useEffect(() => {
    if (!open || !showsDialog) return undefined;
    previousFocusRef.current = document.activeElement;
    document.documentElement.classList.add("onboarding-open");
    document.body.classList.add("onboarding-open");
    const shell = document.querySelector(".hibi-shell, .app-shell");
    shell?.setAttribute("inert", "");
    return () => {
      document.documentElement.classList.remove("onboarding-open");
      document.body.classList.remove("onboarding-open");
      shell?.removeAttribute("inert");
      previousFocusRef.current?.focus?.();
    };
  }, [showsDialog, open]);

  useEffect(() => {
    if (!open || !showsDialog) return;
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [showsDialog, open, step]);

  useEffect(() => {
    if (!focusStudentKey) return;
    studentInputsRef.current.get(focusStudentKey)?.focus();
    setFocusStudentKey(null);
  }, [focusStudentKey, studentRows]);

  useEffect(() => {
    if (!open || !showsDialog) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showsDialog, open]);

  const moveTo = async (nextStep, persist = true) => {
    if (persist && busy) return false;
    if (persist) setBusy(true);
    try {
      if (persist && !(await actions.setOnboardingStep(nextStep))) return false;
      setErrors({});
      setStep(nextStep);
      onStepChange?.(nextStep);
      return true;
    } finally {
      if (persist) setBusy(false);
    }
  };

  // Tour steps only change what is highlighted, so they advance immediately and
  // save the checkpoint in the background.
  const moveTour = (nextStep) => {
    if (busy) return;
    if (nextStep < ONBOARDING_TOUR_START_STEP) {
      moveTo(nextStep);
      return;
    }
    setStep(nextStep);
    onStepChange?.(nextStep);
    if (firstRun) actions.setOnboardingStep(nextStep);
  };

  const continueLater = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await actions.setOnboardingStep(step)) onDismiss?.();
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await actions.dismissOnboarding())) return;
      if (tourOnly) onComplete?.();
      else setCompleted(true);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await actions.dismissOnboarding()) onDismiss?.();
    } finally {
      setBusy(false);
    }
  };

  const closeTour = () => {
    if (busy) return;
    if (firstRun) continueLater();
    else onDismiss?.();
  };

  const saveGroup = async (event) => {
    event.preventDefault();
    if (busy) return;
    const nextErrors = {
      name: groupDraft.name.trim() ? "" : "Enter a group name.",
      subject: groupDraft.subject.trim() ? "" : "Enter a subject.",
      schedule: scheduleIssue(groupDraft.weeklySchedule),
    };
    if (nextErrors.name || nextErrors.subject || nextErrors.schedule) return setErrors(nextErrors);
    setBusy(true);
    try {
      const id = await actions.saveOnboardingGroup({
        id: groupDraft.id || undefined,
        name: groupDraft.name.trim(),
        subject: groupDraft.subject.trim(),
        schedule: groupDraft.weeklySchedule.map((slot) => `${dayLabel(slot.dayOfWeek)} · ${slot.startTime}`).join("; "),
        weeklySchedule: groupDraft.weeklySchedule,
        plannedSessionsPerMonth: Math.max(4, groupDraft.weeklySchedule.length * 4),
      });
      if (!id) return;
      setGroupDraft((current) => ({ ...current, id }));
      await moveTo(3, false);
    } finally {
      setBusy(false);
    }
  };

  const saveStudents = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!studentRows.some((student) => student.fullName?.trim())) {
      setErrors({ students: "Add at least one student." });
      return;
    }
    setBusy(true);
    try {
      const savedStudents = await actions.saveOnboardingStudents(groupId, studentRows, removedStudentIds);
      if (!savedStudents) return;
      setRemovedStudentIds([]);
      setStudentRows(savedStudents.map((student) => ({ ...student, key: student.id })));
      await moveTo(4, false);
    } finally {
      setBusy(false);
    }
  };

  const updateStudent = (key, fullName) =>
    setStudentRows((current) => current.map((row) => (row.key === key ? { ...row, fullName } : row)));

  const addStudentRow = (afterKey) => {
    if (studentRows.length >= ONBOARDING_MAX_STUDENTS) return;
    const row = { key: nextRowKey(), fullName: "" };
    setStudentRows((current) => {
      const index = afterKey ? current.findIndex((item) => item.key === afterKey) : current.length - 1;
      return [...current.slice(0, index + 1), row, ...current.slice(index + 1)];
    });
    setFocusStudentKey(row.key);
  };

  const removeStudentRow = (student) => {
    if (student.id) setRemovedStudentIds((current) => [...current, student.id]);
    setStudentRows((current) => current.filter((row) => row.key !== student.key));
  };

  // Enter moves down the list like a roster; an empty last row submits it.
  const handleStudentKeyDown = (event, student, index) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (index === studentRows.length - 1 && !student.fullName?.trim()) return;
    event.preventDefault();
    const next = studentRows[index + 1];
    if (next) setFocusStudentKey(next.key);
    else addStudentRow(student.key);
  };

  const handleStudentPaste = (event, student) => {
    const names = splitPastedStudentNames(event.clipboardData?.getData("text"));
    if (names.length < 2) return;
    event.preventDefault();
    const room = ONBOARDING_MAX_STUDENTS - studentRows.length + 1;
    const [first, ...rest] = names.slice(0, room);
    const added = rest.map((fullName) => ({ key: nextRowKey(), fullName }));
    setStudentRows((current) => {
      const index = current.findIndex((row) => row.key === student.key);
      const replaced = { ...current[index], fullName: first };
      return [...current.slice(0, index), replaced, ...added, ...current.slice(index + 1)];
    });
    setFocusStudentKey(added.at(-1)?.key || student.key);
  };

  if (!open || typeof document === "undefined") return null;

  if (!showsDialog) {
    return (
      <ContextualTour
        step={step}
        busy={busy}
        canGoBackToSetup={!tourOnly}
        context={tourContext}
        onMove={moveTour}
        onClose={closeTour}
        onSkip={dismiss}
        onNavigate={onNavigate}
        onComplete={finish}
      />
    );
  }

  const upcomingClass = tourContext?.nextClass;

  return createPortal(
    <div className={`onboarding-overlay onboarding-step-${completed ? "done" : step}`} role="presentation">
      <section ref={panelRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="onboarding-card">
          {step > 1 && !completed ? (
            <>
              <button className="onboarding-defer" type="button" disabled={busy} onClick={continueLater}>
                Continue later
              </button>
              <StepProgress step={step} />
            </>
          ) : null}

          {completed ? (
            <div className="onboarding-welcome onboarding-complete">
              <img className="onboarding-welcome-mascot" src={GUIDE_MASCOT} alt="" />
              <h1 id={titleId} ref={headingRef} tabIndex="-1">
                You’re all set!
              </h1>
              <p>Your group, students, and agenda are ready. What would you like to do next?</p>
              {upcomingClass ? (
                <p className="onboarding-complete-next">
                  <CalendarDays aria-hidden="true" size={18} />
                  <span>Next class</span>
                  <strong>
                    {formatOnboardingDate(upcomingClass.date, locale)} · {upcomingClass.time}
                  </strong>
                </p>
              ) : null}
              <div className="onboarding-actions onboarding-actions-centered">
                <Button variant="primary" icon={ArrowRight} onClick={() => onComplete?.("classes")}>
                  Open my next class
                </Button>
                <Button icon={UsersRound} onClick={() => onComplete?.("community")}>
                  Add more students
                </Button>
              </div>
              <button
                className="onboarding-defer onboarding-complete-close"
                type="button"
                onClick={() => onComplete?.()}
              >
                Close
              </button>
            </div>
          ) : null}

          {!completed && step === 1 ? (
            <div className="onboarding-welcome">
              <img className="onboarding-welcome-mascot" src={GUIDE_MASCOT} alt="" />
              <h1 id={titleId} ref={headingRef} tabIndex="-1">
                Welcome to Hibi!
              </h1>
              <p>Create a group, add your students, and let Hibi prepare your agenda.</p>
              <div className="onboarding-actions onboarding-actions-centered">
                <Button variant="primary" icon={ArrowRight} disabled={busy} onClick={() => moveTo(2)}>
                  Start
                </Button>
                <Button disabled={busy} onClick={dismiss}>
                  Explore on my own
                </Button>
              </div>
              <p className="onboarding-welcome-note">You can start the guided setup anytime from Settings.</p>
            </div>
          ) : null}

          {!completed && step === 2 ? (
            <form className="onboarding-form onboarding-group-form" onSubmit={saveGroup} noValidate>
              <header className="onboarding-copy">
                <img className="onboarding-heading-mascot" src={GUIDE_MASCOT} alt="" />
                <h1 id={titleId} ref={headingRef} tabIndex="-1">
                  Create your first group
                </h1>
                <p>Set its class days and Hibi will prepare your agenda.</p>
              </header>
              <div className="onboarding-field-grid onboarding-group-fields">
                <Field label="Group name" error={errors.name}>
                  <Input
                    autoComplete="off"
                    placeholder="e.g. Advanced English"
                    value={groupDraft.name}
                    onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })}
                  />
                </Field>
                <Field label="Subject" error={errors.subject}>
                  <Input
                    autoComplete="off"
                    placeholder="e.g. English"
                    value={groupDraft.subject}
                    onChange={(event) => setGroupDraft({ ...groupDraft, subject: event.target.value })}
                  />
                </Field>
              </div>
              <ScheduleRows
                rows={groupDraft.weeklySchedule}
                setRows={(weeklySchedule) => setGroupDraft({ ...groupDraft, weeklySchedule })}
              />
              <div className="onboarding-actions">
                <SchedulePreview
                  slots={groupDraft.weeklySchedule}
                  submittedIssue={Boolean(errors.schedule)}
                  locale={locale}
                />
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(1)}>
                  Back
                </Button>
                <Button variant="primary" icon={ArrowRight} disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save and continue"}
                </Button>
              </div>
            </form>
          ) : null}

          {!completed && step === 3 ? (
            <form className="onboarding-form" onSubmit={saveStudents}>
              <header className="onboarding-copy">
                <img className="onboarding-heading-mascot" src={GUIDE_MASCOT} alt="" />
                <h1 id={titleId} ref={headingRef} tabIndex="-1">
                  Add your students
                </h1>
                <p>You can start with one and add more later.</p>
              </header>
              <div className="onboarding-group-chip">
                <UsersRound aria-hidden="true" size={18} />
                <span>
                  <strong>{group.name || groupDraft.name}</strong>
                  <small>{`${groupDraft.weeklySchedule.length} class days each week`}</small>
                </span>
              </div>
              <p className="onboarding-student-tip">
                Tip: paste a list with one name per line. Press Enter to add the next student.
              </p>
              <div className="onboarding-student-list">
                {studentRows.map((student, index) => (
                  <div className="onboarding-student-row" key={student.key || student.id}>
                    <span aria-hidden="true">{index + 1}</span>
                    <Field label={`Student ${index + 1}`}>
                      <Input
                        ref={(node) => {
                          if (node) studentInputsRef.current.set(student.key, node);
                          else studentInputsRef.current.delete(student.key);
                        }}
                        autoComplete="off"
                        placeholder="Student name"
                        value={student.fullName}
                        onChange={(event) => updateStudent(student.key, event.target.value)}
                        onKeyDown={(event) => handleStudentKeyDown(event, student, index)}
                        onPaste={(event) => handleStudentPaste(event, student)}
                      />
                    </Field>
                    {studentRows.length > 1 ? (
                      <button
                        className="onboarding-remove-student"
                        type="button"
                        aria-label={`Remove student ${index + 1}`}
                        onClick={() => removeStudentRow(student)}
                      >
                        <Trash2 aria-hidden="true" size={17} />
                      </button>
                    ) : null}
                  </div>
                ))}
                {errors.students ? (
                  <p className="onboarding-form-error" role="alert">
                    {errors.students}
                  </p>
                ) : null}
                {studentRows.length >= ONBOARDING_MAX_STUDENTS ? (
                  <p className="onboarding-student-tip">You can add more students later from Community.</p>
                ) : (
                  <Button className="onboarding-add-student" icon={Plus} onClick={() => addStudentRow()}>
                    Add another student
                  </Button>
                )}
              </div>
              <div className="onboarding-actions">
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(2)}>
                  Back
                </Button>
                <Button variant="primary" icon={ArrowRight} disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save and continue"}
                </Button>
              </div>
            </form>
          ) : null}

          {!completed && step === 4 ? (
            <div className="onboarding-form onboarding-agenda-review">
              <header className="onboarding-copy">
                <img className="onboarding-heading-mascot" src={GUIDE_MASCOT} alt="" />
                <h1 id={titleId} ref={headingRef} tabIndex="-1">
                  Your recurring agenda is ready
                </h1>
                <p>
                  Hibi creates upcoming classes from the group schedule. Change a specific session later from Classes.
                </p>
              </header>
              <section className="onboarding-agenda-card" aria-label="Recurring class agenda">
                <header>
                  <span>
                    <CalendarDays aria-hidden="true" size={22} />
                    <span>
                      <strong>{group.name || groupDraft.name}</strong>
                      <small>{`${studentCount} students enrolled`}</small>
                    </span>
                  </span>
                  <b>Weekly</b>
                </header>
                <div className="onboarding-agenda-list">
                  {/* One row per class day, in date order; only the first is the next class. */}
                  {upcomingClasses(groupDraft.weeklySchedule, groupDraft.weeklySchedule.length).map(
                    ({ slot, date }, index) => (
                      <article key={slot.id} className={index === 0 ? "is-next" : undefined}>
                        <span className="onboarding-agenda-day">{dayShortLabel(slot.dayOfWeek)}</span>
                        <span>
                          <strong>{dayLabel(slot.dayOfWeek)}</strong>
                          <small>
                            <Clock3 aria-hidden="true" size={14} /> {slot.startTime} · {slot.durationHours} h
                          </small>
                        </span>
                        <span>
                          {index === 0 ? <b className="onboarding-agenda-next">Next class</b> : null}
                          <strong>{formatOnboardingDate(date, locale)}</strong>
                        </span>
                      </article>
                    ),
                  )}
                </div>
              </section>
              <div className="onboarding-actions">
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(3)}>
                  Back
                </Button>
                <Button variant="primary" icon={ArrowRight} disabled={busy} onClick={() => moveTo(5)}>
                  Meet Hibi
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
