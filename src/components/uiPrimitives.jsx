import { useI18n } from "../i18n";
import { useEffect, useId, useRef } from "react";
import { AlertCircle, ChevronRight, X } from "lucide-react";
import { Button, IconButton } from "./BaseButtons";
import { Drawer } from "./Drawer";
import { BrandMark } from "./BrandMark";
import { playHibiSound, primeHibiAudio } from "../utils/hibiSounds";

/** @param {import("./ui.types").StatusBadgeProps} props */
export function StatusBadge({ children, tone = "neutral", icon: Icon }) {
  return (
    <span className={`status-badge status-${tone}`}>
      {Icon ? <Icon aria-hidden="true" size={14} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

export function Tabs({ value, onChange, items, ariaLabel }) {
  const { t: uiT } = useI18n();
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
          {uiT(item.label)}
        </button>
      ))}
    </div>
  );
}

export function TableShell({ children, className = "", label }) {
  return (
    <div className={`table-shell ${className}`.trim()} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** @param {import("./ui.types").EmptyStateProps} props */
export function EmptyState({ icon: Icon = AlertCircle, title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon aria-hidden="true" size={23} strokeWidth={1.7} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Switch({ checked, onChange, label, className = "", disabled = false, ...props }) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={Boolean(checked)}
      disabled={disabled}
      className={`switch ${checked ? "is-on" : ""} ${className}`.trim()}
      onClick={() => onChange(!checked)}
    />
  );
}

export function FieldRow({ label, hint, children, className = "" }) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div
      className={`field-row ${className}`.trim()}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
    >
      <span className="field-row-label" id={labelId}>
        {label}
      </span>
      <div>
        <div className="field-row-control">{children}</div>
        {hint ? (
          <div className="field-row-hint" id={hintId}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ListRow({ avatar, name, context, value, onClick, disabled = false, className = "" }) {
  return (
    <button type="button" className={`list-row ${className}`.trim()} onClick={onClick} disabled={disabled}>
      {avatar}
      <span className="list-row-text">
        <strong>{name}</strong>
        {context ? <small>{context}</small> : null}
      </span>
      <span className="list-row-value">{value}</span>
      <ChevronRight className="list-row-chev" aria-hidden="true" />
    </button>
  );
}

export function AttendanceRing({ value, className = "" }) {
  const { t } = useI18n();
  const percentage = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null;
  return (
    <span
      className={`attendance-ring ${className}`.trim()}
      role="img"
      aria-label={percentage === null ? t("No attendance data") : t("Attendance: {value}%", { value: percentage })}
      style={
        /** @type {import("react").CSSProperties} */ ({
          "--value": `${percentage ?? 0}%`,
          "--ring": percentage === null ? "var(--line)" : percentage >= 80 ? "var(--jade)" : "var(--bermellon)",
        })
      }
    >
      <b aria-hidden="true">{percentage === null ? "—" : `${percentage}%`}</b>
    </span>
  );
}

/** @param {import("./ui.types").ConfirmDialogProps} props */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
  tone = "danger",
  busy = false,
  confirmDisabled = false,
  children,
}) {
  const { t: uiT } = useI18n();
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
          <Button onClick={onClose} disabled={busy}>
            {uiT("Cancel")}
          </Button>
          <Button variant={tone} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? uiT("Saving…") : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="dialog-message">
        <AlertCircle aria-hidden="true" />
        <p>{uiT("This action changes saved data immediately.")}</p>
      </div>
      {children}
    </Drawer>
  );
}

export function ToastRegion({ toasts, onDismiss }) {
  const { t: uiT } = useI18n();
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
    <div className="toast-region" aria-live="polite" aria-label={uiT("Notifications")}>
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.tone || "success"}`} key={toast.id}>
          {toast.tone === "error" ? (
            <AlertCircle aria-hidden="true" />
          ) : (
            <span className="toast-cat" aria-hidden="true">
              <BrandMark />
            </span>
          )}
          <span>{uiT(toast.message)}</span>
          <IconButton label={uiT("Dismiss notification")} icon={X} onClick={() => onDismiss(toast.id)} />
        </div>
      ))}
    </div>
  );
}

/** @param {import("./ui.types").SectionHeadingProps} props */
export function SectionHeading({ title, description, actions }) {
  return (
    <div className="section-heading">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  );
}
