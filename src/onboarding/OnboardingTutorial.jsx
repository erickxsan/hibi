import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Button, Field, Input, Segmented } from "../components/ui";
import { firstBillingPeriod, periodOf } from "../domain/monthlyBilling";
import { todayDateOnly } from "../domain/dates";
import { formatMoney, formatTime, monthLong } from "../utils/displayFormat";
import { getUiLocale, useI18n } from "../i18n";
import {
  canSaveOnboardingDraft,
  formatOnboardingDate,
  INITIAL_ONBOARDING_DRAFT,
  ONBOARDING_DAYS,
  onboardingGroupPayload,
  TUTORIAL_DUE,
  upcomingClasses,
} from "./onboardingModel";
import TutorialDay from "./TutorialDay";
import TutorialPractice from "./TutorialPractice";
import { TutorialCat } from "./tutorialShared";
import "../i18n/screenTranslations.js";
import "./onboarding.css";

// Below this width the tutorial uses its phone layout: bottom menu, one column.
const COMPACT_QUERY = "(max-width: 1100px)";
const LEARNED = Object.freeze([
  "Home tells you what is next",
  "In Classes you take attendance and get paid",
  "Tracking fills itself in",
  "Community keeps each group",
]);

function useCompactTutorial() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return compact;
}

function useFocusOnMount() {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

/** Sunrise between the day and the practice: the cat wakes up and hands over. */
function Sunrise({ onPractice, onSetup }) {
  const { t: uiT } = useI18n();
  const headingRef = useFocusOnMount();
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAwake(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <section className="tt-sunrise">
      <div className="tt-moon" aria-hidden="true" />
      <div className="tt-sun" aria-hidden="true" />
      <TutorialCat mood={awake ? "thump wave" : "sleep"} size={128} />
      <div className="tt-sunrise-copy">
        <p className="tt-eyebrow">{uiT("You’ve seen a day")}</p>
        <h1 ref={headingRef} tabIndex={-1} className="tt-sunrise-title">
          {uiT("Now you teach it")}
        </h1>
        <p className="tt-sub">{uiT("A practice class with sample students. Two minutes, and nothing is saved.")}</p>
        <div className="tt-sunrise-actions">
          <Button variant="primary" onClick={onPractice}>
            {uiT("Teach my practice class")}
          </Button>
          <Button variant="ghost" onClick={onSetup}>
            {uiT("Skip to creating my group")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** «Tu primer grupo»: the only step that saves. Creating it also marks the tutorial as done. */
function GroupSetup({ state, actions, onCreated, onLater }) {
  const { t: uiT } = useI18n();
  const locale = getUiLocale();
  const headingRef = useFocusOnMount();
  const hintId = useId();
  const [draft, setDraft] = useState(INITIAL_ONBOARDING_DRAFT);
  const [savedId, setSavedId] = useState("");
  const [busy, setBusy] = useState(false);
  const asOf = state.settings.asOfDate || todayDateOnly();
  const monthly = draft.billingMode === "monthly";
  const edit = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const upcoming = upcomingClasses(
    draft.days.map((dayOfWeek) => ({ id: String(dayOfWeek), dayOfWeek, startTime: draft.time })),
    3,
  );
  const billingStart = firstBillingPeriod({ mode: "monthly", due: TUTORIAL_DUE }, asOf);
  const dueHint =
    billingStart === periodOf(asOf)
      ? uiT("Due on day 5 of each month; you can change it and adjust per student later.")
      : uiT(
          "Billing starts in {month} and is due on day 5 of each month. Classes before then are not charged; you can change it later.",
          { month: monthLong(`${billingStart}-01`, locale) },
        );

  const run = async (work) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const create = (event) => {
    event.preventDefault();
    if (!canSaveOnboardingDraft(draft)) return;
    run(async () => {
      // When the group was saved but closing the tutorial failed, trying again only closes it.
      const id = savedId || (await actions.saveOnboardingGroup(onboardingGroupPayload(draft, state.settings, asOf)));
      if (!id) return;
      setSavedId(id);
      if (await actions.dismissOnboarding()) onCreated();
    });
  };
  const later = () =>
    run(async () => {
      if (await actions.dismissOnboarding()) onLater();
    });

  return (
    <div className="tt-veil">
      <form className="tt-dialog" onSubmit={create}>
        <p className="tt-eyebrow tt-accent">{uiT("Now for real, yours")}</p>
        <h1 ref={headingRef} tabIndex={-1} className="tt-dialog-title">
          {uiT("Your first group")}
        </h1>
        <div className="tt-form">
          <Field label={uiT("Group name")}>
            <Input
              autoComplete="off"
              placeholder={uiT("e.g. Advanced English")}
              value={draft.name}
              onChange={(event) => edit({ name: event.target.value })}
            />
          </Field>
          <fieldset className="tt-fieldset">
            <legend className="field-label">{uiT("Class days")}</legend>
            <div className="tt-days">
              {ONBOARDING_DAYS.map((day) => {
                const on = draft.days.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    className={`tt-day-button ${on ? "is-on" : ""}`.trim()}
                    aria-pressed={on}
                    aria-label={uiT(day.label)}
                    onClick={() =>
                      edit({
                        days: on ? draft.days.filter((value) => value !== day.value) : [...draft.days, day.value],
                      })
                    }
                  >
                    {new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(
                      new Date(2026, 10, 1 + day.value, 12),
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="tt-form-row">
            <Field label={uiT("Time")}>
              <Input
                type="time"
                durationMinutes={(Number(state.settings.defaultClassHours) || 1) * 60}
                value={draft.time}
                onChange={(event) => edit({ time: event.target.value })}
              />
            </Field>
            <Field label={monthly ? uiT("Monthly fee") : uiT("Price per hour")}>
              {/* Left empty, a per-class group charges the general rate, so that is what the field shows. */}
              <Input
                inputMode="decimal"
                autoComplete="off"
                placeholder={monthly ? undefined : formatMoney(Number(state.settings.hourlyRate) || 0, locale)}
                aria-describedby={monthly ? hintId : undefined}
                value={draft.price}
                onChange={(event) => edit({ price: event.target.value.replace(/[^\d.]/g, "") })}
              />
            </Field>
          </div>
          {monthly ? (
            <p className="tt-muted" id={hintId}>
              {dueHint}
            </p>
          ) : null}
          <Segmented
            label={uiT("Billing mode")}
            value={draft.billingMode}
            onChange={(billingMode) => edit({ billingMode })}
            items={[
              { value: "perClass", label: "Per class" },
              { value: "monthly", label: "Monthly fee" },
            ]}
          />
          <p className="tt-muted" aria-live="polite">
            <b>{uiT("Upcoming classes")}:</b>{" "}
            {upcoming.length
              ? `${upcoming.map(({ date }) => formatOnboardingDate(date, locale)).join(" · ")} · ${formatTime(draft.time, locale)}`
              : uiT("Choose at least one day")}
          </p>
        </div>
        <div className="tt-dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={later}>
            {uiT("Not now")}
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !canSaveOnboardingDraft(draft)}>
            {busy ? uiT("Saving…") : uiT("Create my agenda")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Finale({ onEnter }) {
  const { t: uiT } = useI18n();
  const headingRef = useFocusOnMount();
  return (
    <>
      <div className="tt-confetti" aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <i
            key={index}
            style={{
              left: `${(index * 37 + 5) % 97}%`,
              animationDelay: `${(index % 7) * 0.16}s`,
            }}
          />
        ))}
      </div>
      <div className="tt-veil">
        <div className="tt-dialog is-centered">
          <TutorialCat mood="thump happy" size={104} />
          <h1 ref={headingRef} tabIndex={-1} className="tt-dialog-title">
            {uiT("Now you know how to teach with Hibi")}
          </h1>
          <ul className="tt-learned">
            {LEARNED.map((text, index) => (
              <li key={text} style={{ animationDelay: `${0.1 + index * 0.15}s` }}>
                <Check aria-hidden="true" strokeWidth={2.6} />
                {uiT(text)}
              </li>
            ))}
          </ul>
          <Button variant="primary" className="tt-wide" onClick={onEnter}>
            {uiT("Enter my Hibi")}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * The welcome tutorial, «Primero lo ves, luego lo haces»: a day with Hibi told in six moments, a sunrise,
 * a practice class with sample students, and the teacher's first real group. Only that last form saves.
 */
export default function OnboardingTutorial({ state, actions, onClose }) {
  const { t: uiT } = useI18n();
  const compact = useCompactTutorial();
  const [stage, setStage] = useState("day");

  // Modal for its whole life: the app behind is inert and does not scroll; focus returns on close.
  useEffect(() => {
    const previous = document.activeElement;
    const shell = document.querySelector(".hibi-shell");
    document.documentElement.classList.add("onboarding-open");
    document.body.classList.add("onboarding-open");
    shell?.setAttribute("inert", "");
    return () => {
      document.documentElement.classList.remove("onboarding-open");
      document.body.classList.remove("onboarding-open");
      shell?.removeAttribute("inert");
      /** @type {HTMLElement | null} */ (previous)?.focus?.();
    };
  }, []);

  const withPractice = stage === "practice" || stage === "setup" || stage === "done";
  return createPortal(
    <div
      className={`tt-root ${compact ? "is-compact" : ""}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={uiT("Welcome tutorial")}
    >
      {stage === "day" ? <TutorialDay compact={compact} onDone={() => setStage("sunrise")} /> : null}
      {stage === "sunrise" ? (
        <Sunrise onPractice={() => setStage("practice")} onSetup={() => setStage("setup")} />
      ) : null}
      {withPractice ? (
        <TutorialPractice compact={compact} backdrop={stage !== "practice"} onFinish={() => setStage("setup")} />
      ) : null}
      {stage === "setup" ? (
        <GroupSetup state={state} actions={actions} onCreated={() => setStage("done")} onLater={() => onClose()} />
      ) : null}
      {stage === "done" ? <Finale onEnter={() => onClose("home")} /> : null}
    </div>,
    document.body,
  );
}
