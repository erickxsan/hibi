import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

/**
 * @typedef {object} ConfirmRequest
 * @property {string} title Question shown as the dialog heading (already translated).
 * @property {string} [description] One short line under the heading (already translated).
 * @property {string} [kicker] Small uppercase context above the heading, e.g. the class name.
 * @property {string} confirmLabel Label of the button that accepts (already translated).
 * @property {string} [cancelLabel] Label of the button that declines; «Cancelar» by default.
 * @property {"danger" | "primary"} [tone] "danger" for destructive actions.
 */

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * In-app replacement for `window.confirm`: a centred alert dialog with the look of the archive-group
 * dialog (compact drawer). Escape, the backdrop and the cancel button decline. A destructive request uses
 * the danger button and starts on the cancel button so a stray Enter never destroys anything.
 *
 * It deliberately does not add a browser-history entry (unlike Drawer): it can open while a blocked
 * Back/Forward move is being restored, and an extra entry there would scramble the history stack.
 *
 * @param {{ request: ConfirmRequest | null, onResolve: (accepted: boolean) => void }} props
 */
export function ConfirmPrompt({ request, onResolve }) {
  const { t: uiT } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const resolveRef = useRef(onResolve);
  resolveRef.current = onResolve;
  const open = Boolean(request);
  const destructive = request?.tone === "danger";

  // Modal behaviour for the whole time a prompt is open: everything behind it is inert, Escape declines,
  // Tab stays inside, and focus returns to where it was.
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const panel = panelRef.current;
    const silenced = [
      ...document.querySelectorAll('.hibi-shell, .app-shell, [role="dialog"], [role="alertdialog"]'),
    ].filter((element) => element !== panel && !element.contains(panel) && !element.hasAttribute("inert"));
    silenced.forEach((element) => element.setAttribute("inert", ""));
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        // Captured before any drawer underneath can treat the same key as «close the drawer».
        event.preventDefault();
        event.stopPropagation();
        resolveRef.current(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter((element) => element.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      silenced.forEach((element) => element.removeAttribute("inert"));
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  // Every new question starts on its safest button.
  useEffect(() => {
    if (!request) return;
    (destructive ? cancelRef.current : confirmRef.current)?.focus();
  }, [destructive, request]);

  if (!request || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="overlay is-dialog confirm-prompt-layer"
      role="presentation"
      // Above any stack of drawers (they start at 1100 and add 10 per level).
      style={{ zIndex: 1400 }}
      onMouseDown={(event) => event.target === event.currentTarget && resolveRef.current(false)}
    >
      <section
        ref={panelRef}
        className="drawer drawer-compact confirm-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.description ? descriptionId : undefined}
      >
        <header className="drawer-header">
          <div>
            {request.kicker ? <span className="dialog-kicker">{request.kicker}</span> : null}
            <h2 id={titleId}>{request.title}</h2>
            {request.description ? <p id={descriptionId}>{request.description}</p> : null}
          </div>
        </header>
        <footer className="drawer-footer">
          <button
            ref={cancelRef}
            type="button"
            className="button button-secondary"
            onClick={() => resolveRef.current(false)}
          >
            <span>{request.cancelLabel || uiT("Cancel")}</span>
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`button ${destructive ? "button-danger" : "button-primary"}`}
            onClick={() => resolveRef.current(true)}
          >
            <span>{request.confirmLabel}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Promise-based confirmation for a component: `await confirm({...})` resolves true or false. Render
 * `prompt` once anywhere in the component. A second question replaces (and declines) an open one, and
 * an unmounted component declines whatever it still had open.
 * @returns {{ confirm: (request: ConfirmRequest) => Promise<boolean>, prompt: import("react").ReactElement, open: boolean }}
 */
export function useConfirmPrompt() {
  const [request, setRequest] = useState(
    /** @type {(ConfirmRequest & { resolve: (accepted: boolean) => void }) | null} */ (null),
  );
  const pendingRef = useRef(/** @type {{ resolve: (accepted: boolean) => void } | null} */ (null));

  const settle = useCallback((accepted) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setRequest(null);
    pending?.resolve(accepted);
  }, []);

  const confirm = useCallback(
    (/** @type {ConfirmRequest} */ options) =>
      new Promise((resolve) => {
        pendingRef.current?.resolve(false);
        const next = { ...options, resolve };
        pendingRef.current = next;
        setRequest(next);
      }),
    [],
  );

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  return { confirm, prompt: <ConfirmPrompt request={request} onResolve={settle} />, open: Boolean(request) };
}
