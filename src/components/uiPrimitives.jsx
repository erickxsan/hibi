import { useI18n } from "../i18n";
import { useEffect, useId, useRef } from "react";
import { AlertCircle, Check, ChevronRight, Minus, Plus, X } from "lucide-react";
import { Button, IconButton } from "./BaseButtons";
import { Drawer } from "./Drawer";
import { HibiStamp } from "./BrandMark";
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
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
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
export function EmptyState({ icon: Icon = AlertCircle, title, description, action, stamp = false }) {
  return (
    <div className="empty-state">
      {stamp ? (
        <HibiStamp size={72} />
      ) : (
        <span className="empty-icon">
          <Icon aria-hidden="true" size={23} strokeWidth={1.7} />
        </span>
      )}
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

export function ListRow({
  avatar,
  name,
  context = null,
  value = null,
  onClick = undefined,
  disabled = false,
  className = "",
  contextTone = "",
  valueTone = "",
  label = undefined,
}) {
  const content = (
    <>
      {avatar}
      <span className="list-row-text">
        <strong>{name}</strong>
        {context ? <small className={contextTone ? `text-${contextTone}` : undefined}>{context}</small> : null}
      </span>
      <span className={`list-row-value ${valueTone ? `text-${valueTone}` : ""}`.trim()}>{value}</span>
    </>
  );
  const classes = `list-row ${avatar ? "" : "no-avatar"} ${className}`.trim();
  // A row without an action is plain information, not a control.
  if (!onClick) {
    return (
      <div className={`${classes} is-static`} aria-label={label}>
        {content}
      </div>
    );
  }
  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-label={label}>
      {content}
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
            <HibiStamp size={32} />
          )}
          <span>{uiT(toast.message)}</span>
          <IconButton label={uiT("Dismiss notification")} icon={X} onClick={() => onDismiss(toast.id)} />
        </div>
      ))}
    </div>
  );
}

/** @param {import("./ui.types").SectionHeadingProps} props */
export function SectionHeading({ title, description, actions, kicker = undefined }) {
  return (
    <div className="page-heading">
      <div>
        {kicker ? <span className="page-kicker">{kicker}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

/** Two to four exclusive options. `tone="soft"` is the kraft track used inside forms (Única / Recurrente). */
export function Segmented({ value, onChange, items, label, tone = "", className = "", disabled = false }) {
  const { t: uiT } = useI18n();
  return (
    <div className={`segmented ${tone ? `is-${tone}` : ""} ${className}`.trim()} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          className={value === item.value ? "active" : ""}
          aria-pressed={value === item.value}
          disabled={disabled || item.disabled}
          onClick={() => onChange(item.value)}
        >
          {item.raw ? item.label : uiT(item.label)}
        </button>
      ))}
    </div>
  );
}

/** P / A for one student. A new class starts unmarked (value ""). */
export function AttendanceChoice({ value = "", name, onChange, large = false, disabled = false }) {
  const { t: uiT } = useI18n();
  const choose = (next) => onChange(value === next ? "" : next);
  return (
    <span
      className={`choice-group attendance-choice ${large ? "is-large" : ""}`.trim()}
      role="group"
      aria-label={uiT("Attendance for {p0}", { p0: name })}
    >
      <button
        type="button"
        className={value === "P" ? "is-present" : ""}
        aria-pressed={value === "P"}
        aria-label={uiT("Present")}
        disabled={disabled}
        onClick={() => choose("P")}
      >
        P
      </button>
      <button
        type="button"
        className={value === "A" ? "is-absent" : ""}
        aria-pressed={value === "A"}
        aria-label={uiT("Absent")}
        disabled={disabled}
        onClick={() => choose("A")}
      >
        A
      </button>
    </span>
  );
}

const PAYMENT_CHOICES = [
  { value: "Paid", label: "Paid", icon: Check, className: "is-paid" },
  { value: "Pending", label: "Pending", icon: Minus, className: "is-pending" },
  { value: "Unpaid", label: "Unpaid", icon: X, className: "is-unpaid" },
];

/** ✓ – × for one student's class payment. Starts without a choice (value ""). */
export function PaymentChoice({ value = "", name, onChange, disabled = false }) {
  const { t: uiT } = useI18n();
  return (
    <span className="choice-group payment-choice" role="group" aria-label={uiT("Payment for {p0}", { p0: name })}>
      {PAYMENT_CHOICES.map((choice) => {
        const Icon = choice.icon;
        return (
          <button
            key={choice.value}
            type="button"
            className={value === choice.value ? choice.className : ""}
            aria-pressed={value === choice.value}
            aria-label={uiT(choice.label)}
            title={uiT(choice.label)}
            disabled={disabled}
            onClick={() => onChange(value === choice.value ? "" : choice.value)}
          >
            <Icon aria-hidden="true" strokeWidth={2.4} />
          </button>
        );
      })}
    </span>
  );
}

/** «$ 90 / h»: an amount with a currency prefix and a unit suffix. */
export function MoneyInput({ value, onChange, suffix = "", label, className = "", large = false, ...props }) {
  return (
    <label className={`money-input ${large ? "is-large" : ""} ${className}`.trim()}>
      <span aria-hidden="true">$</span>
      <input
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ""))}
        {...props}
      />
      {suffix ? <span aria-hidden="true">{suffix}</span> : null}
    </label>
  );
}

export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")} h`;
}

function parseDuration(text) {
  const match = String(text)
    .trim()
    .match(/^(\d{1,2})(?::(\d{1,2}))?\s*h?$/i);
  if (!match) return null;
  return match[2] === undefined ? Number(match[1]) * 60 : Number(match[1]) * 60 + Number(match[2]);
}

/** Duration in steps of 15 minutes with − / +; the value can also be typed (2, 1:30). */
export function DurationStepper({ minutes, onChange, label, min = 15, max = 600, step = 15 }) {
  const { t: uiT } = useI18n();
  const clamp = (value) => Math.min(max, Math.max(min, Math.round(value / step) * step));
  return (
    <span className="duration-stepper" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={uiT("Shorter")}
        disabled={minutes <= min}
        onClick={() => onChange(clamp(minutes - step))}
      >
        <Minus aria-hidden="true" />
      </button>
      <input
        key={minutes}
        aria-label={label}
        defaultValue={formatDuration(minutes)}
        onBlur={(event) => {
          const parsed = parseDuration(event.target.value);
          if (parsed === null) event.target.value = formatDuration(minutes);
          else onChange(clamp(parsed));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <button
        type="button"
        aria-label={uiT("Longer")}
        disabled={minutes >= max}
        onClick={() => onChange(clamp(minutes + step))}
      >
        <Plus aria-hidden="true" />
      </button>
    </span>
  );
}
