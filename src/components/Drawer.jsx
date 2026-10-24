import { useI18n } from "../i18n";
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, X } from "lucide-react";
import { IconButton } from "./BaseButtons";
import { OverlayDepthContext, useCompactViewport } from "./OverlayContext";
import {
  closeOverlayHistory,
  popLeavesPage,
  pushOverlayHistory,
  subscribeToAppHistory,
} from "../navigation/appHistory";

let openDrawerCount = 0;
const dialogStack = [];
let scrollLock = null;

function lockDrawerBackground() {
  if (!openDrawerCount) {
    const body = document.body;
    scrollLock = {
      x: window.scrollX,
      y: window.scrollY,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      shellWasInert: document.querySelector(".hibi-shell, .app-shell")?.hasAttribute("inert"),
    };
    Object.assign(body.style, {
      position: "fixed",
      top: `${-window.scrollY}px`,
      left: `${-window.scrollX}px`,
      right: "0",
      width: "100%",
      overflow: "hidden",
    });
  }
  openDrawerCount += 1;
  document.documentElement.classList.add("drawer-open");
  document.body.classList.add("drawer-open");
  document.querySelector(".hibi-shell, .app-shell")?.setAttribute("inert", "");
}

function unlockDrawerBackground() {
  openDrawerCount = Math.max(0, openDrawerCount - 1);
  if (openDrawerCount) return;
  document.documentElement.classList.remove("drawer-open");
  document.body.classList.remove("drawer-open");
  if (!scrollLock?.shellWasInert) document.querySelector(".hibi-shell, .app-shell")?.removeAttribute("inert");
  if (scrollLock) {
    const { x, y, shellWasInert: _shellWasInert, ...style } = scrollLock;
    Object.assign(document.body.style, style);
    window.scrollTo({ left: x, top: y, behavior: "auto" });
    scrollLock = null;
  }
}

/** @param {import("./ui.types").DrawerProps} props */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "normal",
  className = "",
  presentation = "drawer",
  panelStyle,
  backLabel,
  onBack,
  showHeader = true,
  onKeyDown,
  kicker,
}) {
  const { t: uiT } = useI18n();
  const depth = useContext(OverlayDepthContext);
  const [expanded, setExpanded] = useState(false);
  const touchStart = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const historyId = useId();
  const panelRef = useRef(null);
  const previousFocus = useRef(null);
  const ownsHistoryEntry = useRef(false);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (ownsHistoryEntry.current && closeOverlayHistory(historyId)) return;
    if (onCloseRef.current?.() === false) closing.current = false;
  }, [historyId]);

  useEffect(() => {
    if (!open) return undefined;
    closing.current = false;
    previousFocus.current = document.activeElement;
    const panel = panelRef.current;
    const previousPanel = dialogStack.at(-1) || previousFocus.current?.closest?.('[role="dialog"]');
    const previousPanelWasInert = previousPanel?.hasAttribute("inert");
    previousPanel?.setAttribute("inert", "");
    dialogStack.push(panel);
    const firstFocusable =
      panel?.querySelector('[data-picker-autofocus="true"]') ||
      panel?.querySelector(
        "button:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
    firstFocusable?.focus();

    // Delaying the push by one task avoids duplicate entries from React
    // StrictMode's development-only effect setup/cleanup replay.
    const historyTimer = window.setTimeout(() => {
      ownsHistoryEntry.current = Boolean(pushOverlayHistory(historyId));
    }, 0);
    const unsubscribe = subscribeToAppHistory({
      beforePop: ({ previous, next }) => {
        const wasOpen = previous?.overlays?.includes(historyId);
        const remainsOpen = next?.overlays?.includes(historyId);
        if (!wasOpen || remainsOpen) return true;
        if (popLeavesPage({ previous, next })) {
          // The page guard already asked; this drawer closes with the page it belongs to.
          ownsHistoryEntry.current = false;
          closing.current = false;
          return true;
        }
        const accepted = onCloseRef.current?.() !== false;
        if (!accepted) {
          closing.current = false;
          return false;
        }
        ownsHistoryEntry.current = false;
        closing.current = false;
        return true;
      },
    });

    const handleKeyDown = (event) => {
      if (dialogStack.at(-1) !== panel || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [
        ...panel.querySelectorAll(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => element.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    lockDrawerBackground();
    return () => {
      window.clearTimeout(historyTimer);
      unsubscribe();
      document.removeEventListener("keydown", handleKeyDown);
      const index = dialogStack.indexOf(panel);
      if (index >= 0) dialogStack.splice(index, 1);
      dialogStack.at(-1)?.removeAttribute("inert");
      if (!previousPanelWasInert) previousPanel?.removeAttribute("inert");
      unlockDrawerBackground();
      if (ownsHistoryEntry.current) closeOverlayHistory(historyId);
      ownsHistoryEntry.current = false;
      closing.current = false;
      previousFocus.current?.focus?.();
    };
  }, [historyId, open, requestClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <OverlayDepthContext.Provider value={depth + 1}>
      <div
        className={
          presentation === "sheet"
            ? "bottom-sheet-layer"
            : `overlay ${presentation === "popover" ? "picker-popover-layer" : ""} ${size === "compact" && presentation === "drawer" ? "is-dialog" : ""}`
        }
        role="presentation"
        style={{ zIndex: 1100 + depth * 10 }}
        onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
        onPointerDown={(event) => event.target === event.currentTarget && requestClose()}
      >
        {presentation === "sheet" ? (
          <button
            type="button"
            tabIndex={-1}
            className="bottom-sheet-scrim"
            aria-hidden="true"
            onClick={requestClose}
          />
        ) : null}
        <section
          ref={panelRef}
          style={panelStyle}
          className={`${presentation === "sheet" ? `bottom-sheet ${expanded ? "is-expanded" : ""}` : presentation === "popover" ? "picker-popover" : `drawer drawer-${size}`} ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={showHeader ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          aria-label={!showHeader ? String(title) : undefined}
          onKeyDown={onKeyDown}
        >
          {presentation === "sheet" ? (
            <button
              type="button"
              className="bottom-sheet-grab"
              aria-label={uiT(expanded ? "Collapse sheet" : "Expand sheet")}
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              onTouchStart={(event) => {
                touchStart.current = event.touches[0].clientY;
              }}
              onTouchEnd={(event) => {
                if (touchStart.current !== null && event.changedTouches[0].clientY - touchStart.current > 60)
                  requestClose();
                touchStart.current = null;
              }}
            />
          ) : null}
          {showHeader ? (
            <header className={presentation === "sheet" ? "bottom-sheet-header" : "drawer-header"}>
              <div>
                {kicker ? (
                  <span className={presentation === "sheet" ? "bottom-sheet-kicker" : "dialog-kicker"}>{kicker}</span>
                ) : null}
                {backLabel ? (
                  <button type="button" className="sheet-back" onClick={onBack || requestClose}>
                    <ChevronLeft size={16} aria-hidden="true" />
                    {backLabel}
                  </button>
                ) : null}
                <h2 id={titleId}>{title}</h2>
                {description ? <p id={descriptionId}>{description}</p> : null}
              </div>
              <IconButton
                label={uiT("Close")}
                icon={X}
                onClick={requestClose}
                className={presentation === "sheet" ? "bottom-sheet-close" : ""}
              />
            </header>
          ) : null}
          <div className={presentation === "drawer" ? "drawer-body" : "picker-body"}>{children}</div>
          {footer ? <footer className="drawer-footer">{footer}</footer> : null}
        </section>
      </div>
    </OverlayDepthContext.Provider>,
    document.body,
  );
}

export function BottomSheet(props) {
  const compact = useCompactViewport();
  return <Drawer {...props} presentation={compact ? "sheet" : "drawer"} />;
}
