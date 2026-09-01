import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  LockKeyhole,
  Plus,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Button, Field, Input, Select } from "../components/ui";
import ContextualTour from "./ContextualTour";
import {
  dayLabel,
  nextDateForDay,
  ONBOARDING_DAYS,
  ONBOARDING_SETUP_STEPS,
  ONBOARDING_TOUR_START_STEP,
} from "./onboardingModel";
import "./onboarding.css";

const MASCOTS = {
  1: "/onboarding/hibi-welcome-transparent.png",
  2: "/onboarding/hibi-group-transparent.png",
  3: "/onboarding/hibi-students-transparent.png",
  4: "/onboarding/hibi-schedule-transparent.png",
};

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
  const existing = state.students.filter((student) => student.groupIds?.includes(groupId));
  return existing.length
    ? existing.map((student) => ({ ...student, key: student.id }))
    : [{ key: nextRowKey(), fullName: "" }];
}

function StepProgress({ step }) {
  return (
    <div className="onboarding-progress" aria-label={`Step ${step} of ${ONBOARDING_SETUP_STEPS}`}>
      <span>{`Step ${step} of ${ONBOARDING_SETUP_STEPS}`}</span>
      <div className="onboarding-progress-dots" aria-hidden="true">
        {Array.from({ length: ONBOARDING_SETUP_STEPS }, (_, index) => (
          <i className={index + 1 <= step ? "is-active" : ""} key={index} />
        ))}
      </div>
    </div>
  );
}

function PrivacyNote() {
  return (
    <p className="onboarding-privacy-note">
      <LockKeyhole aria-hidden="true" size={15} />
      Tutorial progress is protected with end-to-end encryption.
    </p>
  );
}

function ScheduleRows({ rows, setRows, error }) {
  const addSlot = () => {
    const usedDays = new Set(rows.map((row) => Number(row.dayOfWeek)));
    const nextDay = ONBOARDING_DAYS.find((day) => !usedDays.has(day.value))?.value || 1;
    const duration = Number(rows[0]?.durationHours || 1);
    setRows([...rows, newScheduleSlot(nextDay, duration)]);
  };

  return (
    <section className="onboarding-weekly-schedule" aria-labelledby="onboarding-schedule-title">
      <div className="onboarding-schedule-heading">
        <span>
          <strong id="onboarding-schedule-title">Class days</strong>
          <small>Add every day this group meets. Each day can have its own time and duration.</small>
        </span>
        <Button icon={Plus} disabled={rows.length >= 7} onClick={addSlot}>
          Add another day
        </Button>
      </div>
      <div className="onboarding-schedule-rows">
        {rows.map((slot, index) => (
          <div className="onboarding-schedule-row" key={slot.id}>
            <span className="onboarding-schedule-number" aria-hidden="true">
              {index + 1}
            </span>
            <Field label="Day">
              <Select
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
              </Select>
            </Field>
            <Field label="Time">
              <Input
                type="time"
                value={slot.startTime}
                onChange={(event) =>
                  setRows(rows.map((row) => (row.id === slot.id ? { ...row, startTime: event.target.value } : row)))
                }
              />
            </Field>
            <Field label="Duration">
              <Select
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
              </Select>
            </Field>
            {rows.length > 1 ? (
              <button
                className="onboarding-remove-schedule"
                type="button"
                aria-label={`Remove class day ${index + 1}`}
                onClick={() => setRows(rows.filter((row) => row.id !== slot.id))}
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {error ? (
        <p className="onboarding-form-error onboarding-schedule-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default function OnboardingTutorial({
  open,
  state,
  actions,
  initialStep = 1,
  onStepChange,
  onNavigate,
  onDismiss,
  onComplete,
}) {
  const titleId = useId();
  const panelRef = useRef(null);
  const headingRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [step, setStep] = useState(initialStep);
  const [groupDraft, setGroupDraft] = useState(() => initialGroupDraft(state));
  const [studentRows, setStudentRows] = useState(() => initialStudentRows(state));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  const isSetup = step < ONBOARDING_TOUR_START_STEP;
  const groupId = groupDraft.id || state.settings.onboardingGroupId;
  const group = useMemo(
    () => state.groups.find((item) => item.id === groupId) || { ...groupDraft, id: groupId },
    [groupDraft, groupId, state.groups],
  );
  const studentCount = studentRows.filter((student) => student.fullName?.trim()).length;

  useEffect(() => {
    if (!open || !isSetup) return undefined;
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
  }, [isSetup, open]);

  useEffect(() => {
    if (!open || !isSetup) return;
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [isSetup, open, step]);

  useEffect(() => {
    if (!open || !isSetup) return undefined;
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
  }, [isSetup, open]);

  const moveTo = async (nextStep, persist = true) => {
    if (persist) {
      const saved = await actions.setOnboardingStep(nextStep);
      if (!saved) return false;
    }
    setErrors({});
    setStep(nextStep);
    onStepChange?.(nextStep);
    return true;
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await actions.dismissOnboarding()) onComplete?.();
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

  const saveGroup = async (event) => {
    event.preventDefault();
    const scheduleKeys = groupDraft.weeklySchedule.map((slot) => `${slot.dayOfWeek}|${slot.startTime}`);
    const nextErrors = {
      name: groupDraft.name.trim() ? "" : "Enter a group name.",
      subject: groupDraft.subject.trim() ? "" : "Enter a subject.",
      schedule: groupDraft.weeklySchedule.length
        ? new Set(scheduleKeys).size === scheduleKeys.length
          ? ""
          : "Each class day and time must be unique."
        : "Add at least one class day.",
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
    if (!studentRows.some((student) => student.fullName?.trim())) {
      setErrors({ students: "Add at least one student." });
      return;
    }
    setBusy(true);
    try {
      const savedStudents = await actions.saveOnboardingStudents(groupId, studentRows);
      if (!savedStudents) return;
      setStudentRows(savedStudents.map((student) => ({ ...student, key: student.id })));
      await moveTo(4, false);
    } finally {
      setBusy(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  if (!isSetup) {
    return (
      <ContextualTour
        step={step}
        busy={busy}
        onMove={moveTo}
        onDismiss={dismiss}
        onNavigate={onNavigate}
        onComplete={finish}
      />
    );
  }

  return createPortal(
    <div className={`onboarding-overlay onboarding-step-${step}`} role="presentation">
      <section ref={panelRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="onboarding-mascot-stage" aria-hidden="true">
          <img src={MASCOTS[step]} alt="" />
        </div>
        <div className="onboarding-card">
          <StepProgress step={step} />

          {step === 1 ? (
            <div className="onboarding-welcome">
              <p className="onboarding-eyebrow">A calmer way to run your classes</p>
              <h1 id={titleId} ref={headingRef} tabIndex="-1">
                Welcome to Hibi!
              </h1>
              <p className="onboarding-lead">Set up your teaching space, then meet Hibi.</p>
              <p>I’ll help you create a group, add students, prepare its weekly agenda, and discover the main tools.</p>
              <div className="onboarding-actions onboarding-actions-centered">
                <Button variant="primary" icon={ArrowRight} disabled={busy} onClick={() => moveTo(2)}>
                  Start
                </Button>
                <Button disabled={busy} onClick={dismiss}>
                  Explore on my own
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <form className="onboarding-form onboarding-group-form" onSubmit={saveGroup}>
              <header className="onboarding-copy">
                <p className="onboarding-eyebrow">Let’s build your classroom</p>
                <h1 id={titleId} ref={headingRef} tabIndex="-1">
                  Create your first group
                </h1>
                <p>Its weekly schedule will automatically shape your class agenda.</p>
              </header>
              <div className="onboarding-field-grid onboarding-group-fields">
                <Field label="Group name" error={errors.name} required>
                  <Input
                    autoComplete="off"
                    placeholder="e.g. Advanced English"
                    value={groupDraft.name}
                    onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })}
                  />
                </Field>
                <Field label="Subject" error={errors.subject} required>
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
                error={errors.schedule}
              />
              <PrivacyNote />
              <div className="onboarding-actions">
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(1)}>
                  Back
                </Button>
                <Button variant="primary" icon={ArrowRight} disabled={busy} type="submit">
                  {busy ? "Saving…" : "Save and continue"}
                </Button>
              </div>
            </form>
          ) : null}

          {step === 3 ? (
            <form className="onboarding-form" onSubmit={saveStudents}>
              <header className="onboarding-copy">
                <p className="onboarding-eyebrow">Your group is ready</p>
                <h1 id={titleId} ref={headingRef} tabIndex="-1">
                  Add your students
                </h1>
                <p>They’ll appear in every recurring class for this group. You can adjust membership later.</p>
              </header>
              <div className="onboarding-group-chip">
                <UsersRound aria-hidden="true" size={18} />
                <span>
                  <strong>{group.name || groupDraft.name}</strong>
                  <small>{groupDraft.weeklySchedule.length} class days each week</small>
                </span>
              </div>
              <div className="onboarding-student-list">
                {studentRows.map((student, index) => (
                  <div className="onboarding-student-row" key={student.key || student.id}>
                    <span aria-hidden="true">{index + 1}</span>
                    <Field label={`Student ${index + 1}`}>
                      <Input
                        autoComplete="off"
                        placeholder="Student name"
                        value={student.fullName}
                        onChange={(event) =>
                          setStudentRows((current) =>
                            current.map((row) =>
                              row.key === student.key ? { ...row, fullName: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </Field>
                    {studentRows.length > 1 ? (
                      <button
                        className="onboarding-remove-student"
                        type="button"
                        aria-label={`Remove student ${index + 1}`}
                        onClick={() => setStudentRows((current) => current.filter((row) => row.key !== student.key))}
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
                <Button
                  className="onboarding-add-student"
                  icon={Plus}
                  disabled={studentRows.length >= 8}
                  onClick={() => setStudentRows((current) => [...current, { key: nextRowKey(), fullName: "" }])}
                >
                  Add another student
                </Button>
              </div>
              <PrivacyNote />
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

          {step === 4 ? (
            <div className="onboarding-form onboarding-agenda-review">
              <header className="onboarding-copy">
                <p className="onboarding-eyebrow">Everything stays connected</p>
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
                      <small>{studentCount} students enrolled</small>
                    </span>
                  </span>
                  <b>Weekly</b>
                </header>
                <div className="onboarding-agenda-list">
                  {groupDraft.weeklySchedule.map((slot) => (
                    <article key={slot.id}>
                      <span className="onboarding-agenda-day">{dayLabel(slot.dayOfWeek).slice(0, 3)}</span>
                      <span>
                        <strong>{dayLabel(slot.dayOfWeek)}</strong>
                        <small>
                          <Clock3 aria-hidden="true" size={14} /> {slot.startTime} · {slot.durationHours} h
                        </small>
                      </span>
                      <span>
                        <small>Next class</small>
                        <strong>{nextDateForDay(slot.dayOfWeek)}</strong>
                      </span>
                      <Check aria-hidden="true" size={18} />
                    </article>
                  ))}
                </div>
              </section>
              <PrivacyNote />
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
