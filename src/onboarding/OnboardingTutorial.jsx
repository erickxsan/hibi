import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleAlert, Plus, Trash2, UsersRound } from "lucide-react";
import { Button, DurationStepper, Field, Input, Segmented, Select } from "../components/ui";
import { HibiStamp } from "../components/BrandMark";
import { StudentAvatar } from "../components/StudentAvatar";
import { STUDENT_AVATAR_IDS } from "../domain/constants";
import { periodOf } from "../domain/monthlyBilling";
import { todayDateOnly } from "../domain/dates";
import { formatHours, formatMoney, formatTime } from "../utils/displayFormat";
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

const SETUP_LABELS = ["Group", "Students", "Agenda"];

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
  const monthly = group?.billing?.mode === "monthly";
  return {
    id: group?.id || "",
    name: group?.name || "",
    subject: group?.subject || "",
    billingMode: monthly ? "monthly" : "perClass",
    rate: String(Number.isFinite(group?.hourlyRate) ? group.hourlyRate : (state.settings.hourlyRate ?? "")),
    monthlyFee: monthly ? String(group.billing.monthlyFee ?? "") : "",
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
    : [{ key: nextRowKey(), fullName: "", avatarId: STUDENT_AVATAR_IDS[0] }];
}

// Each new row takes the next animal so a pasted list already looks varied.
function avatarAfter(rows) {
  return STUDENT_AVATAR_IDS[rows.length % STUDENT_AVATAR_IDS.length];
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
  const { t: uiT } = useI18n();
  return (
    <ol
      className="onboarding-progress"
      aria-label={uiT("Step {p0} of {p1}", { p0: step - 1, p1: SETUP_LABELS.length })}
    >
      {SETUP_LABELS.map((label, index) => (
        <li
          key={label}
          className={index + 2 < step ? "is-done" : index + 2 === step ? "is-current" : ""}
          aria-current={index + 2 === step ? "step" : undefined}
        >
          <span className="onboarding-step-number" aria-hidden="true">
            {index + 2 < step ? <Check size={16} /> : index + 1}
          </span>
          <span>{uiT(label)}</span>
        </li>
      ))}
    </ol>
  );
}

// Pinned above the footer buttons so the resulting dates stay visible while the
// teacher edits days and times. A submitted schedule issue becomes an alert.
function SchedulePreview({ slots, submittedIssue, locale }) {
  const { t: uiT } = useI18n();
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
        <CalendarDays aria-hidden="true" size={18} />
        {uiT("Upcoming classes")}
      </strong>
      <ol>
        {upcomingClasses(slots, 3).map(({ slot, date }, index) => (
          <li key={`${slot.id}-${date}`} className={index === 0 ? "is-next" : ""}>
            {formatOnboardingDate(date, locale)}
            {index === 0 ? ` · ${formatTime(slot.startTime, locale)}` : ""}
          </li>
        ))}
      </ol>
      <small>{uiT("{p0} per week · {p1} a month", { p0: slots.length, p1: slots.length * 4 })}</small>
    </div>
  );
}

function ScheduleRows({ rows, setRows }) {
  const { t: uiT } = useI18n();
  const addSlot = () => {
    const usedDays = new Set(rows.map((row) => Number(row.dayOfWeek)));
    const nextDay = ONBOARDING_DAYS.find((day) => !usedDays.has(day.value))?.value || 1;
    const duration = Number(rows[0]?.durationHours || 1);
    setRows([...rows, newScheduleSlot(nextDay, duration)]);
  };

  return (
    <section className="onboarding-weekly-schedule" aria-labelledby="onboarding-schedule-title">
      <h2 id="onboarding-schedule-title">{uiT("Class days")}</h2>
      <div className="onboarding-schedule-rows">
        {rows.map((slot, index) => (
          <div className="onboarding-schedule-row" key={slot.id}>
            <Field label={uiT("Day")}>
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
                    {uiT(day.label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={uiT("Time")}>
              <Input
                type="time"
                required
                value={slot.startTime}
                onChange={(event) =>
                  setRows(rows.map((row) => (row.id === slot.id ? { ...row, startTime: event.target.value } : row)))
                }
              />
            </Field>
            <div className="field">
              <span className="field-label">{uiT("Duration")}</span>
              <DurationStepper
                label={uiT("Duration of class day {p0}", { p0: index + 1 })}
                minutes={Math.round(Number(slot.durationHours) * 60)}
                onChange={(minutes) =>
                  setRows(rows.map((row) => (row.id === slot.id ? { ...row, durationHours: minutes / 60 } : row)))
                }
              />
            </div>
            <button
              className="onboarding-remove-schedule"
              type="button"
              disabled={rows.length === 1}
              aria-label={uiT("Remove class day {p0}", { p0: index + 1 })}
              onClick={() => setRows(rows.filter((row) => row.id !== slot.id))}
            >
              <Trash2 aria-hidden="true" size={17} />
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="onboarding-add-day" icon={Plus} disabled={rows.length >= 7} onClick={addSlot}>
        {uiT("Add another day")}
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
  const { t: uiT } = useI18n();
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
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
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

  const monthly = groupDraft.billingMode === "monthly";
  const saveGroup = async (event) => {
    event.preventDefault();
    if (busy) return;
    const nextErrors = {
      name: groupDraft.name.trim() ? "" : "Enter a group name.",
      subject: groupDraft.subject.trim() ? "" : "Enter a subject.",
      schedule: scheduleIssue(groupDraft.weeklySchedule),
      price:
        Number(monthly ? groupDraft.monthlyFee : groupDraft.rate) >= 0 &&
        String(monthly ? groupDraft.monthlyFee : groupDraft.rate).trim() !== ""
          ? ""
          : "Enter a price.",
    };
    if (nextErrors.name || nextErrors.subject || nextErrors.schedule || nextErrors.price) return setErrors(nextErrors);
    const rate = Number(groupDraft.rate);
    setBusy(true);
    try {
      const id = await actions.saveOnboardingGroup({
        id: groupDraft.id || undefined,
        name: groupDraft.name.trim(),
        subject: groupDraft.subject.trim(),
        schedule: groupDraft.weeklySchedule.map((slot) => `${dayLabel(slot.dayOfWeek)} · ${slot.startTime}`).join("; "),
        weeklySchedule: groupDraft.weeklySchedule,
        plannedSessionsPerMonth: Math.max(4, groupDraft.weeklySchedule.length * 4),
        // The general rate stays in Settings; only a different price becomes the group's own.
        hourlyRate: !monthly && rate !== Number(state.settings.hourlyRate) ? rate : null,
        billing: monthly
          ? {
              mode: "monthly",
              monthlyFee: Number(groupDraft.monthlyFee),
              due: { type: "dayOfMonth", day: 5 },
              effectiveFrom: periodOf(state.settings.asOfDate || todayDateOnly()),
            }
          : undefined,
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

  const cycleAvatar = (key) =>
    setStudentRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const index = STUDENT_AVATAR_IDS.indexOf(row.avatarId);
        return { ...row, avatarId: STUDENT_AVATAR_IDS[(index + 1) % STUDENT_AVATAR_IDS.length] };
      }),
    );

  const updateStudent = (key, fullName) =>
    setStudentRows((current) => current.map((row) => (row.key === key ? { ...row, fullName } : row)));

  const addStudentRow = (afterKey) => {
    if (studentRows.length >= ONBOARDING_MAX_STUDENTS) return;
    const row = { key: nextRowKey(), fullName: "", avatarId: avatarAfter(studentRows) };
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
    const added = rest.map((fullName, index) => ({
      key: nextRowKey(),
      fullName,
      avatarId: STUDENT_AVATAR_IDS[(studentRows.length + index) % STUDENT_AVATAR_IDS.length],
    }));
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
  const hero = (title, description) => (
    <header className="onboarding-copy">
      <HibiStamp className="onboarding-heading-mascot" size={76} />
      <div>
        <h1 id={titleId} ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <p>{description}</p>
      </div>
    </header>
  );
  const groupLine = [
    group.subject || groupDraft.subject,
    groupDraft.weeklySchedule[0]
      ? `${uiT(dayLabel(groupDraft.weeklySchedule[0].dayOfWeek)).toLowerCase()} ${formatTime(groupDraft.weeklySchedule[0].startTime, locale)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const priceLine = monthly
    ? uiT("{amount} a month · monthly fee", { amount: formatMoney(Number(groupDraft.monthlyFee) || 0, locale) })
    : uiT("{amount} per hour · per-class billing", { amount: formatMoney(Number(groupDraft.rate) || 0, locale) });

  return createPortal(
    <div className={`onboarding-overlay onboarding-step-${completed ? "done" : step}`} role="presentation">
      <section ref={panelRef} className="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="onboarding-card">
          {step > 1 && !completed ? (
            <div className="onboarding-top">
              <button className="onboarding-defer" type="button" disabled={busy} onClick={continueLater}>
                {uiT("Continue later")}
              </button>
              <StepProgress step={step} />
            </div>
          ) : null}

          {completed ? (
            <div className="onboarding-welcome onboarding-complete">
              <HibiStamp className="onboarding-welcome-mascot" size={96} />
              <h1 id={titleId} ref={headingRef} tabIndex={-1}>
                {uiT("You’re all set!")}
              </h1>
              <p>{uiT("Your group, students, and agenda are ready. What would you like to do next?")}</p>
              {upcomingClass ? (
                <p className="onboarding-complete-next">
                  <CalendarDays aria-hidden="true" size={18} />
                  <span>{uiT("Next class")}</span>
                  <strong>
                    {formatOnboardingDate(upcomingClass.date, locale)} · {formatTime(upcomingClass.time, locale)}
                  </strong>
                </p>
              ) : null}
              <div className="onboarding-actions onboarding-actions-centered">
                <Button icon={UsersRound} onClick={() => onComplete?.("community")}>
                  {uiT("Add more students")}
                </Button>
                <Button variant="primary" icon={ArrowRight} onClick={() => onComplete?.("classes")}>
                  {uiT("Open my next class")}
                </Button>
              </div>
              <button
                className="onboarding-defer onboarding-complete-close"
                type="button"
                onClick={() => onComplete?.()}
              >
                {uiT("Close")}
              </button>
            </div>
          ) : null}

          {!completed && step === 1 ? (
            <div className="onboarding-welcome">
              <HibiStamp className="onboarding-welcome-mascot" size={96} />
              <h1 id={titleId} ref={headingRef} tabIndex={-1}>
                {uiT("Hi, teacher! This is Hibi")}
              </h1>
              <p>{uiT("In three steps you create a group, add your students and Hibi prepares your agenda.")}</p>
              <ol className="onboarding-welcome-steps" aria-label={uiT("Setup steps")}>
                {SETUP_LABELS.map((label, index) => (
                  <li key={label}>
                    <b>{index + 1}</b> {uiT(label)}
                  </li>
                ))}
              </ol>
              <div className="onboarding-actions onboarding-actions-centered">
                <Button disabled={busy} onClick={dismiss}>
                  {uiT("Explore on my own")}
                </Button>
                <Button variant="primary" className="has-trailing-icon" disabled={busy} onClick={() => moveTo(2)}>
                  {uiT("Start")}
                  <ArrowRight aria-hidden="true" size={18} />
                </Button>
              </div>
              <p className="onboarding-welcome-note">{uiT("You can pick it up anytime from Settings.")}</p>
            </div>
          ) : null}

          {!completed && step === 2 ? (
            <form className="onboarding-form onboarding-group-form" onSubmit={saveGroup} noValidate>
              <div className="onboarding-body">
                {hero(uiT("Create your first group"), uiT("Set its class days and Hibi will prepare your agenda."))}
                <div className="onboarding-field-grid onboarding-group-fields">
                  <Field label={uiT("Group name")} error={errors.name} required>
                    <Input
                      autoComplete="off"
                      placeholder={uiT("e.g. Advanced English")}
                      value={groupDraft.name}
                      onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })}
                    />
                  </Field>
                  <Field label={uiT("Subject")} error={errors.subject}>
                    <Input
                      autoComplete="off"
                      placeholder={uiT("e.g. English")}
                      value={groupDraft.subject}
                      onChange={(event) => setGroupDraft({ ...groupDraft, subject: event.target.value })}
                    />
                  </Field>
                </div>
                <ScheduleRows
                  rows={groupDraft.weeklySchedule}
                  setRows={(weeklySchedule) => setGroupDraft({ ...groupDraft, weeklySchedule })}
                />
                <div className="field onboarding-billing">
                  <span className="field-label">{uiT("Billing")}</span>
                  <div className="onboarding-billing-row">
                    <Segmented
                      label={uiT("Billing mode")}
                      value={groupDraft.billingMode}
                      onChange={(billingMode) => setGroupDraft({ ...groupDraft, billingMode })}
                      items={[
                        { value: "perClass", label: "Per class" },
                        { value: "monthly", label: "Monthly" },
                      ]}
                    />
                    <label className="onboarding-money">
                      <span aria-hidden="true">$</span>
                      <Input
                        inputMode="decimal"
                        aria-label={monthly ? uiT("Monthly fee") : uiT("Price per hour")}
                        value={monthly ? groupDraft.monthlyFee : groupDraft.rate}
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^\d.]/g, "");
                          setGroupDraft(
                            monthly ? { ...groupDraft, monthlyFee: value } : { ...groupDraft, rate: value },
                          );
                        }}
                      />
                      <span>{monthly ? uiT("a month") : uiT("per hour")}</span>
                    </label>
                    <small
                      className={errors.price ? "field-error" : undefined}
                      role={errors.price ? "alert" : undefined}
                    >
                      {errors.price
                        ? uiT(errors.price)
                        : monthly
                          ? uiT("Due on day 5 of each month; you can change it and adjust per student later.")
                          : uiT("You can adjust it per student later or switch the group to a monthly fee.")}
                    </small>
                  </div>
                </div>
                <SchedulePreview
                  slots={groupDraft.weeklySchedule}
                  submittedIssue={Boolean(errors.schedule)}
                  locale={locale}
                />
              </div>
              <div className="onboarding-actions">
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(1)}>
                  {uiT("Back")}
                </Button>
                <Button variant="primary" className="has-trailing-icon" disabled={busy} type="submit">
                  {busy ? uiT("Saving…") : uiT("Save and continue")}
                  <ArrowRight aria-hidden="true" size={18} />
                </Button>
              </div>
            </form>
          ) : null}

          {!completed && step === 3 ? (
            <form className="onboarding-form" onSubmit={saveStudents}>
              <div className="onboarding-body">
                {hero(uiT("Add your students"), uiT("You can start with one and add more later."))}
                <div className="onboarding-group-chip">
                  <UsersRound aria-hidden="true" size={20} />
                  <span>
                    <strong>{group.name || groupDraft.name}</strong>
                    <small>{groupLine}</small>
                  </span>
                </div>
                <p className="onboarding-student-tip">
                  {uiT(
                    "Each student gets a little animal; tap it to change it. You can paste a list with one name per line.",
                  )}
                </p>
                <div className="onboarding-student-list">
                  {studentRows.map((student, index) => (
                    <div className="onboarding-student-row" key={student.key || student.id}>
                      <button
                        type="button"
                        className="onboarding-avatar"
                        aria-label={uiT("Change the animal of student {p0}", { p0: index + 1 })}
                        onClick={() => cycleAvatar(student.key)}
                      >
                        <StudentAvatar
                          avatarId={student.avatarId || STUDENT_AVATAR_IDS[index % STUDENT_AVATAR_IDS.length]}
                          name={student.fullName}
                          decorative
                        />
                      </button>
                      <Field label={uiT("Student {p0}", { p0: index + 1 })}>
                        <Input
                          ref={(node) => {
                            if (node) studentInputsRef.current.set(student.key, node);
                            else studentInputsRef.current.delete(student.key);
                          }}
                          autoComplete="off"
                          placeholder={uiT("Student name")}
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
                          aria-label={uiT("Remove student {p0}", { p0: index + 1 })}
                          onClick={() => removeStudentRow(student)}
                        >
                          <Trash2 aria-hidden="true" size={18} />
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
                    <p className="onboarding-student-tip">{uiT("You can add more students later from Community.")}</p>
                  ) : (
                    <Button
                      variant="ghost"
                      className="onboarding-add-student"
                      icon={Plus}
                      onClick={() => addStudentRow()}
                    >
                      {uiT("Add another student")}
                    </Button>
                  )}
                </div>
              </div>
              <div className="onboarding-actions">
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(2)}>
                  {uiT("Back")}
                </Button>
                <Button variant="primary" className="has-trailing-icon" disabled={busy} type="submit">
                  {busy ? uiT("Saving…") : uiT("Save and continue")}
                  <ArrowRight aria-hidden="true" size={18} />
                </Button>
              </div>
            </form>
          ) : null}

          {!completed && step === 4 ? (
            <div className="onboarding-form onboarding-agenda-review">
              <div className="onboarding-body">
                {hero(
                  uiT("Your recurring agenda is ready"),
                  uiT(
                    "Hibi creates upcoming classes from the group schedule. Change a specific session later from Classes.",
                  ),
                )}
                <section className="onboarding-agenda-card" aria-label={uiT("Recurring class agenda")}>
                  <header>
                    <CalendarDays aria-hidden="true" size={20} />
                    <span>
                      <strong>{group.name || groupDraft.name}</strong>
                      <small>
                        {uiT(studentCount === 1 ? "{p0} student" : "{p0} students", { p0: studentCount })} · {priceLine}
                      </small>
                    </span>
                    <b>{uiT("Weekly")}</b>
                  </header>
                  <div className="onboarding-agenda-list">
                    {/* One row per class day, in date order; only the first is the next class. */}
                    {upcomingClasses(groupDraft.weeklySchedule, groupDraft.weeklySchedule.length).map(
                      ({ slot, date }, index) => (
                        <article key={slot.id} className={index === 0 ? "is-next" : undefined}>
                          <span className="onboarding-agenda-day">{uiT(dayShortLabel(slot.dayOfWeek))}</span>
                          <span>
                            <strong>{uiT(dayLabel(slot.dayOfWeek))}</strong>
                            <small>
                              {formatTime(slot.startTime, locale)} · {formatHours(slot.durationHours, locale)}
                            </small>
                          </span>
                          <span className="onboarding-agenda-when">
                            {index === 0 ? <b className="onboarding-agenda-next">{uiT("Next class")}</b> : null}
                            <strong>{formatOnboardingDate(date, locale)}</strong>
                          </span>
                        </article>
                      ),
                    )}
                  </div>
                </section>
                <p className="onboarding-agenda-note">
                  <Check aria-hidden="true" size={18} />
                  <span>
                    {uiT(
                      "Each class starts unmarked: on the day of the class you take attendance with Present or Absent.",
                    )}
                  </span>
                </p>
              </div>
              <div className="onboarding-actions">
                <Button icon={ArrowLeft} disabled={busy} onClick={() => moveTo(3)}>
                  {uiT("Back")}
                </Button>
                <Button variant="primary" className="has-trailing-icon" disabled={busy} onClick={() => moveTo(5)}>
                  {uiT("Meet Hibi")}
                  <ArrowRight aria-hidden="true" size={18} />
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
