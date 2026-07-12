import { useEffect, useId, useRef } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Search, X } from "lucide-react";

export function Button({ children, variant = "secondary", icon: Icon, className = "", ...props }) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} type="button" {...props}>
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
  return (
    <label className={`field ${className}`.trim()}>
      <span className="field-label">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
      {!error && hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = "", ...props }) {
  return <input className={`control ${className}`.trim()} {...props} />;
}

export function Select({ className = "", children, ...props }) {
  return (
    <span className={`select-wrap ${className}`.trim()}>
      <select className="control select-control" {...props}>{children}</select>
      <ChevronDown className="select-chevron" aria-hidden="true" size={17} strokeWidth={1.8} />
    </span>
  );
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

export function Drawer({ open, onClose, title, description, children, footer, size = "normal" }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const previousFocus = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector("button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    firstFocusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
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
    document.body.classList.add("drawer-open");
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("drawer-open");
      previousFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={panelRef}
        className={`drawer drawer-${size}`}
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
          <IconButton label="Close" icon={X} onClick={onClose} />
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </section>
    </div>
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
  return (
    <div className="toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.tone || "success"}`} key={toast.id}>
          {toast.tone === "error" ? <AlertCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
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
