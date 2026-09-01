import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "../components/ui";
import { ONBOARDING_STEPS, ONBOARDING_TOUR_START_STEP, tourStep } from "./onboardingModel";

const TARGET_PADDING = 8;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function paddedRect(rect) {
  if (!rect) return null;
  const left = Math.max(0, rect.left - TARGET_PADDING);
  const top = Math.max(0, rect.top - TARGET_PADDING);
  const right = Math.min(window.innerWidth, rect.right + TARGET_PADDING);
  const bottom = Math.min(window.innerHeight, rect.bottom + TARGET_PADDING);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function calloutPosition(rect) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(360, viewportWidth - 32);
  const reservedBottom = viewportWidth <= 720 ? 218 : 158;
  let left;
  let top;

  if (rect.right + width + 26 <= viewportWidth) {
    left = rect.right + 20;
    top = rect.top + Math.min(32, rect.height * 0.18);
  } else if (rect.left - width - 26 >= 0) {
    left = rect.left - width - 20;
    top = rect.top + Math.min(32, rect.height * 0.18);
  } else {
    left = clamp(rect.left, 16, viewportWidth - width - 16);
    const below = rect.bottom + 18;
    top = below + 210 < viewportHeight - reservedBottom ? below : rect.top - 228;
  }

  return {
    left: clamp(left, 16, viewportWidth - width - 16),
    top: clamp(top, 16, viewportHeight - reservedBottom - 206),
    width,
  };
}

function mascotPosition(rect, position) {
  const width = window.innerWidth <= 720 ? 104 : 150;
  const presets = {
    home: { left: rect.right - width * 0.82, top: rect.top - width * 0.72, rotate: -3 },
    community: { left: rect.right - width * 0.5, top: rect.top + 24, rotate: 4 },
    classes: { left: rect.left + rect.width * 0.54, top: rect.top - width * 0.7, rotate: -5 },
    tracking: { left: rect.left - width * 0.55, top: rect.top + 22, rotate: -4 },
    settings: { left: rect.right - width * 0.34, top: rect.top - width * 0.34, rotate: 4 },
  };
  const selected = presets[position] || presets.home;
  return {
    width,
    left: clamp(selected.left, 8, window.innerWidth - width - 8),
    top: clamp(selected.top, 8, window.innerHeight - width - 170),
    transform: `rotate(${selected.rotate}deg)`,
  };
}

export default function ContextualTour({ step, busy, onMove, onDismiss, onNavigate, onComplete }) {
  const config = tourStep(step);
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    if (config) onNavigate?.(config.page);
  }, [config, onNavigate]);

  useLayoutEffect(() => {
    if (!config) return undefined;
    let frame = 0;
    let target = null;
    let didScroll = false;

    const measure = () => {
      target = document.querySelector(config.selector);
      if (!target) {
        setTargetRect(null);
        return;
      }
      if (!didScroll) {
        didScroll = true;
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTargetRect(paddedRect(target.getBoundingClientRect())));
    };

    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [config]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    document.documentElement.classList.add("onboarding-open");
    document.body.classList.add("onboarding-open");
    const shell = document.querySelector(".hibi-shell, .app-shell");
    shell?.setAttribute("inert", "");
    requestAnimationFrame(() => panelRef.current?.querySelector(".onboarding-tour-next")?.focus());
    return () => {
      document.documentElement.classList.remove("onboarding-open");
      document.body.classList.remove("onboarding-open");
      shell?.removeAttribute("inert");
      previousFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll("button:not([disabled])")];
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
  }, []);

  const positions = useMemo(() => {
    if (!targetRect) return null;
    return {
      callout: calloutPosition(targetRect),
      mascot: mascotPosition(targetRect, config?.mascotPosition),
    };
  }, [config?.mascotPosition, targetRect]);

  if (!config || typeof document === "undefined") return null;

  const ordinal = step - ONBOARDING_TOUR_START_STEP + 1;
  const tourLength = ONBOARDING_STEPS - ONBOARDING_TOUR_START_STEP + 1;
  const finish = step === ONBOARDING_STEPS;
  const next = () => (finish ? onComplete() : onMove(step + 1));

  return createPortal(
    <section
      ref={panelRef}
      className={`onboarding-context-tour onboarding-context-${config.mascotPosition}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${config.label} tour`}
    >
      {targetRect ? (
        <>
          <div className="onboarding-tour-shade top" style={{ height: targetRect.top }} />
          <div
            className="onboarding-tour-shade left"
            style={{ top: targetRect.top, width: targetRect.left, height: targetRect.height }}
          />
          <div
            className="onboarding-tour-shade right"
            style={{ top: targetRect.top, left: targetRect.right, height: targetRect.height }}
          />
          <div className="onboarding-tour-shade bottom" style={{ top: targetRect.bottom }} />
          <div className="onboarding-tour-highlight" style={targetRect} />
        </>
      ) : (
        <div className="onboarding-tour-shade full" />
      )}

      {positions ? (
        <>
          <img className="onboarding-context-mascot" src={config.mascot} alt="" style={positions.mascot} />
          <aside className="onboarding-context-callout" style={positions.callout} aria-live="polite">
            <strong>{config.title}</strong>
            <p>{config.description}</p>
            <div>
              <button type="button" disabled={busy} onClick={onDismiss}>
                Skip tour
              </button>
              <Button variant="primary" icon={finish ? Check : ArrowRight} disabled={busy} onClick={next}>
                Got it
              </Button>
            </div>
          </aside>
        </>
      ) : null}

      <footer className="onboarding-tour-controller">
        <span className="onboarding-tour-copy">
          <small>{`MEET HIBI · ${ordinal} OF ${tourLength}`}</small>
          <strong>{config.label}</strong>
          <span>{config.helper}</span>
        </span>
        <span className="onboarding-tour-controls">
          <Button icon={ArrowLeft} disabled={busy} onClick={() => onMove(step - 1)}>
            Back
          </Button>
          <Button
            className="onboarding-tour-next"
            variant="primary"
            icon={finish ? Check : ArrowRight}
            disabled={busy}
            onClick={next}
          >
            {finish ? "Finish tour" : "Next"}
          </Button>
        </span>
      </footer>
    </section>,
    document.body,
  );
}
