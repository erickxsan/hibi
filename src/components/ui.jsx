import { cloneElement, isValidElement, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Search, X } from "lucide-react";
import {
  closeOverlayHistory,
  pushOverlayHistory,
  subscribeToAppHistory,
} from "../navigation/appHistory";
import { BrandMark } from "./BrandMark";
import { playHibiSound, primeHibiAudio } from "../utils/hibiSounds";
export { GroupSelect, MultiSelect, Select, StudentSelect } from "./SelectControl";

let openDrawerCount = 0;

function lockDrawerBackground() {
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
  document.querySelector(".hibi-shell, .app-shell")?.removeAttribute("inert");
}

export function Button({ children, variant = "secondary", icon: Icon, className = "", ...props }) {
  const accessibleName = props["aria-label"] || (typeof children === "string" ? children : undefined);
  return (
    <button className={`button button-${variant} ${className}`.trim()} type="button" aria-label={accessibleName} {...props}>
      {Icon ? <Icon aria-hidden="true" size={18} strokeWidth={1.8} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ label, icon: Icon, className = "", ...props }) {
  return (
    <button className={`icon-button ${className}`.trim()} type="button" aria-label={label} title={label} {...props}>
      <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
    </button>
  );
}

export function Field({ label, hint, error, required, children, className = "" }) {
  const labelId = useId();
  const labelledChild = isValidElement(children) && !children.props["aria-label"] && !children.props["aria-labelledby"]
    ? cloneElement(children, { "aria-labelledby": labelId, "aria-invalid": error ? "true" : children.props["aria-invalid"] })
    : children;
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label" id={labelId}>{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
      {labelledChild}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
      {!error && hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = "", ...props }) {
  return <input className={`control ${className}`.trim()} {...props} />;
}

export function TextArea({ className = "", ...props }) {
  return <textarea className={`control textarea ${className}`.trim()} {...props} />;
}

export function SearchInput({ value, onChange, placeholder = "Search", className = "", ...props }) {
  return (
    <label className={`search-control ${className}`.trim()}>
      <Search aria-hidden="true" size={17} strokeWidth={1.8} />
      <span className="sr-only">Search</span>
      <input value={value} onChange={onChange} placeholder={placeholder} {...props} />
    </label>
  );
}

export function StatusBadge({ children, tone = "neutral", icon: Icon }) {
  return (
    <span className={`status-badge status-${tone}`}>
      {Icon ? <Icon aria-hidden="true" size={14} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

export function Tabs({ value, onChange, items, ariaLabel }) {
  return (
    <div className="tabs" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          className={value === item.value ? "tab is-active" : "tab"}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TableShell({ children, className = "", label }) {
  return (
    <div className={`table-shell ${className}`.trim()} role="region" aria-label={label} tabIndex="0">
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon = AlertCircle, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon aria-hidden="true" size={23} strokeWidth={1.7} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Drawer({ open, onClose, title, description, children, footer, size = "normal", className = "" }) {
  const titleId = useId();
  const descriptionId = useId();
  const historyId = useId();
  const panelRef = useRef(null);
  const previousFocus = useRef(null);
  const ownsHistoryEntry = useRef(false);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    if (ownsHistoryEntry.current && closeOverlayHistory(historyId)) return;
    if (onCloseRef.current?.() === false) closing.current = false;
  };

  useEffect(() => {
    if (!open) return undefined;
    closing.current = false;
    previousFocus.current = document.activeElement;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
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
      if (event.key === "Escape") {
        if (document.querySelector(".select-popover")) return;
        requestClose();
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
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
      unlockDrawerBackground();
      if (ownsHistoryEntry.current) closeOverlayHistory(historyId);
      ownsHistoryEntry.current = false;
      closing.current = false;
      previousFocus.current?.focus?.();
    };
  }, [historyId, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section
        ref={panelRef}
        className={`drawer drawer-${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="drawer-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton label="Close" icon={X} onClick={requestClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Delete", onConfirm, onClose, tone = "danger", busy = false }) {
  if (!open) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="compact"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy}>{busy ? "Saving…" : confirmLabel}</Button>
        </>
      }
    >
      <div className="dialog-message"><AlertCircle aria-hidden="true" /><p>This action changes saved data immediately.</p></div>
    </Drawer>
  );
}

export function ToastRegion({ toasts, onDismiss }) {
  const soundedToastIds = useRef(new Set());

  useEffect(() => {
    const prime = () => primeHibiAudio();
    document.addEventListener("pointerdown", prime, { capture: true, once: true });
    document.addEventListener("keydown", prime, { capture: true, once: true });
    return () => {
      document.removeEventListener("pointerdown", prime, true);
      document.removeEventListener("keydown", prime, true);
    };
  }, []);

  useEffect(() => {
    toasts.forEach((toast) => {
      if (soundedToastIds.current.has(toast.id)) return;
      soundedToastIds.current.add(toast.id);
      if (toast.tone !== "error") playHibiSound("success");
    });
  }, [toasts]);

  return (
    <div className="toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.tone || "success"}`} key={toast.id}>
          {toast.tone === "error" ? <AlertCircle aria-hidden="true" /> : <span className="toast-cat" aria-hidden="true"><BrandMark /></span>}
          <span>{toast.message}</span>
          <IconButton label="Dismiss notification" icon={X} onClick={() => onDismiss(toast.id)} />
        </div>
      ))}
    </div>
  );
}

export function SectionHeading({ title, description, actions }) {
  return (
    <div className="section-heading">
      <div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  );
}
