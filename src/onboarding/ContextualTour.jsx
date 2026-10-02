import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, CalendarDays, Check, UsersRound } from "lucide-react";
import { Button } from "../components/ui";
import { getUiLocale, useI18n } from "../i18n";
import { formatOnboardingDate, ONBOARDING_STEPS, ONBOARDING_TOUR_START_STEP, tourStep } from "./onboardingModel";
import { tourLayout } from "./tourLayout";

function TourFocus({ focus, context }) {
  const { t: uiT } = useI18n();
  if (focus === "group" && context?.groupName) {
    return (
      <p className="onboarding-tour-focus">
        <UsersRound aria-hidden="true" size={17} />
        <span>{uiT("Your group")}</span>
        <strong>
          {`${context.groupName} · ${context.studentCount} ${context.studentCount === 1 ? "student" : "students"}`}
        </strong>
      </p>
    );
  }
  if (focus === "nextClass" && context?.nextClass) {
    return (
      <p className="onboarding-tour-focus">
        <CalendarDays aria-hidden="true" size={17} />
        <span>{uiT("Next class")}</span>
        <strong>
          {formatOnboardingDate(context.nextClass.date, getUiLocale())} · {context.nextClass.time}
        </strong>
      </p>
    );
  }
  return null;
}

// Prefer the specific element for this workspace (such as its group row) and
// fall back to the whole section while that element is not rendered.
function findTarget(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const rect = element?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) return element;
  }
  return document.querySelector(selectors.at(-1));
}

export default function ContextualTour({
  step,
  busy,
  canGoBackToSetup = false,
  context = null,
  onMove,
  onClose,
  onSkip,
  onNavigate,
  onComplete,
}) {
  const { t: uiT } = useI18n();
  const { t } = useI18n();
  const config = tourStep(step);
  const groupSelector = context?.groupId ? config?.groupSelector?.(context.groupId) : null;
  const targetSelectors = [groupSelector, config?.selector].filter(Boolean);
  const selectorKey = JSON.stringify(targetSelectors);
  const descriptionId = useId();
  const cardRef = useRef(null);
  const headingRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [layout, setLayout] = useState(null);
  const [targetReady, setTargetReady] = useState(false);

  useEffect(() => {
    if (config) onNavigate?.(config.page);
  }, [config, onNavigate]);

  useLayoutEffect(() => {
    const selectors = JSON.parse(selectorKey);
    if (!selectors.length) return undefined;
    let frame = 0;
    let target = null;
    let positioned = false;
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => scheduleMeasure()) : null;

    function measure() {
      frame = 0;
      const nextTarget = findTarget(selectors);
      if (target !== nextTarget) {
        if (target) resizeObserver?.unobserve(target);
        target = nextTarget;
        positioned = false;
        if (target) resizeObserver?.observe(target);
      }
      const height = window.visualViewport?.height || window.innerHeight;
      const width = document.documentElement.clientWidth || window.innerWidth;
      const cardHeight = cardRef.current?.getBoundingClientRect().height || 256;
      let rect = target?.getBoundingClientRect();
      const ready = Boolean(rect && rect.width > 0 && rect.height > 0);
      if (ready && !positioned) {
        positioned = true;
        if (rect.top < 16 || rect.top > height - Math.min(rect.height, 100) || rect.bottom + cardHeight + 28 > height) {
          target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
          window.scrollBy({ top: -24, behavior: "instant" });
          rect = target.getBoundingClientRect();
        }
      }
      const nextLayout = tourLayout(ready ? rect : null, { width, height }, cardHeight);
      setTargetReady(ready);
      setLayout((current) => (JSON.stringify(current) === JSON.stringify(nextLayout) ? current : nextLayout));
    }
    function scheduleMeasure() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(document.querySelector(".hibi-main") || document.body, { childList: true, subtree: true });
    if (cardRef.current) resizeObserver?.observe(cardRef.current);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    window.visualViewport?.addEventListener("resize", scheduleMeasure);
    measure();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.visualViewport?.removeEventListener("resize", scheduleMeasure);
    };
  }, [selectorKey]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    document.documentElement.classList.add("onboarding-open");
    document.body.classList.add("onboarding-open");
    const shell = document.querySelector(".hibi-shell, .app-shell");
    const wasInert = shell?.hasAttribute("inert");
    shell?.setAttribute("inert", "");
    return () => {
      document.documentElement.classList.remove("onboarding-open");
      document.body.classList.remove("onboarding-open");
      if (!wasInert) shell?.removeAttribute("inert");
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !cardRef.current) return;
      const focusable = [...cardRef.current.querySelectorAll("button:not([disabled])")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  if (!config || typeof document === "undefined") return null;
  const ordinal = step - ONBOARDING_TOUR_START_STEP + 1;
  const tourLength = ONBOARDING_STEPS - ONBOARDING_TOUR_START_STEP + 1;
  const finish = step === ONBOARDING_STEPS;
  const canGoBack = ordinal > 1 || canGoBackToSetup;
  const highlight = layout?.highlight;

  return createPortal(
    <section className="onboarding-context-tour">
      {highlight ? (
        <>
          <div className="onboarding-tour-shade top" style={{ height: highlight.top }} />
          <div
            className="onboarding-tour-shade left"
            style={{ top: highlight.top, width: highlight.left, height: highlight.height }}
          />
          <div
            className="onboarding-tour-shade right"
            style={{ top: highlight.top, left: highlight.left + highlight.width, height: highlight.height }}
          />
          <div className="onboarding-tour-shade bottom" style={{ top: highlight.top + highlight.height }} />
          <div className="onboarding-tour-highlight" style={highlight} />
        </>
      ) : (
        <div className="onboarding-tour-shade full" />
      )}
      <div
        ref={cardRef}
        className="onboarding-context-callout"
        role="dialog"
        aria-modal="true"
        aria-label={config.label + " tour"}
        aria-describedby={descriptionId}
        data-placement={layout?.side || "none"}
        style={
          layout
            ? { left: layout.left, top: layout.top, width: layout.width, "--tour-pointer": layout.pointer + "px" }
            : undefined
        }
      >
        <header className="onboarding-tour-heading">
          <img src="/onboarding/hibi-guide.webp" alt={uiT("")} className="onboarding-tour-avatar" />
          <div>
            <p className="onboarding-tour-location">
              {t(config.label) + " · " + ordinal + " " + t("of") + " " + tourLength}
            </p>
            <h2 ref={headingRef} tabIndex={-1}>
              {config.title}
            </h2>
          </div>
        </header>
        <p id={descriptionId} className="onboarding-tour-description">
          {config.description}
        </p>
        <TourFocus focus={config.focus} context={context} />
        {!targetReady ? (
          <p role="status" className="onboarding-tour-loading">
            {uiT("Opening this section…")}
          </p>
        ) : null}
        <div
          className="onboarding-tour-progress"
          role="progressbar"
          aria-label={uiT("Tour progress")}
          aria-valuemin={0}
          aria-valuemax={tourLength}
          aria-valuenow={ordinal}
        >
          {Array.from({ length: tourLength }, (_, index) => (
            <span key={index} className={index < ordinal ? "is-active" : ""} />
          ))}
        </div>
        <footer className="onboarding-tour-actions">
          <button className="onboarding-tour-skip" type="button" disabled={busy} onClick={onSkip}>
            {uiT("Skip tour")}
          </button>
          {canGoBack ? (
            <Button className="onboarding-tour-back" icon={ArrowLeft} disabled={busy} onClick={() => onMove(step - 1)}>
              {uiT("Back")}
            </Button>
          ) : null}
          <Button
            className="onboarding-tour-next"
            variant="primary"
            icon={finish ? Check : ArrowRight}
            disabled={busy || !targetReady}
            onClick={() => (finish ? onComplete() : onMove(step + 1))}
          >
            {finish ? uiT("Finish tour") : uiT("Next")}
          </Button>
        </footer>
      </div>
    </section>,
    document.body,
  );
}
