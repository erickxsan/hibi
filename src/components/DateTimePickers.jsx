import { useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";
import { useI18n } from "../i18n";
import { addDays, addMonths, isDateOnly, parseDateOnly, startOfMonth, todayDateOnly } from "../domain/dates";
import {
  calendarDays,
  clockArc,
  clockPoint,
  hourAvailability,
  minutesToTime,
  pickerDateLabel,
  slotAvailability,
  timeToMinutes,
  WEEKDAY_ORDER,
} from "../domain/pickerModels";
import { PickerPopover } from "./PickerPopover";

function changed(onChange, value, name) {
  const target = { value, ...(name ? { name } : {}) };
  onChange?.({ target, currentTarget: target });
}

function Trigger({ open, triggerRef, title, value, icon: Icon, disabled, className, props, onClick, dialogId }) {
  return (
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? dialogId : undefined}
      aria-label={props["aria-label"] || (!props["aria-labelledby"] ? title : undefined)}
      aria-labelledby={props["aria-labelledby"]}
      aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]}
      aria-required={props.required || props["aria-required"]}
      disabled={disabled}
      className={`select-trigger-hibi ${open ? "is-open" : ""} ${className || ""}`.trim()}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) onClick();
        }
      }}
    >
      <Icon className="select-lead" aria-hidden="true" />
      <span className="select-value">{value || title}</span>
      <ChevronDown className="select-chevron" aria-hidden="true" />
    </button>
  );
}

/** @param {import("./picker.types").DatePickerProps} props */
export function DatePicker({
  value = "",
  onChange,
  name,
  today = todayDateOnly(),
  allowPast = true,
  min,
  max,
  classDates = [],
  repeatDates = [],
  disabled = false,
  className = "",
  ...props
}) {
  const { t, locale } = useI18n();
  const triggerRef = useRef(null);
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(startOfMonth(isDateOnly(value) ? value : today));
  const minimum = min || (allowPast ? "" : today);
  const permitted = (date) => (!minimum || date >= minimum) && (!max || date <= max);
  const choose = (date) => {
    changed(onChange, date, name);
    setOpen(false);
  };
  const title = props["aria-label"] || t("Choose a date");
  const dates = calendarDays(month);
  const focusDay = (date) => {
    if (!permitted(date)) return;
    if (!dates.includes(date)) setMonth(startOfMonth(date));
    requestAnimationFrame(() => document.getElementById(`${prefix}-${date}`)?.focus());
  };
  return (
    <span className={`select-menu-wrap date-control ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <Trigger
        open={open}
        triggerRef={triggerRef}
        title={title}
        value={pickerDateLabel(value, locale, { weekday: "short", day: "numeric", month: "short" })}
        icon={CalendarDays}
        disabled={disabled}
        className=""
        props={props}
        dialogId={prefix}
        onClick={() => {
          setMonth(startOfMonth(isDateOnly(value) ? value : today));
          setOpen(!open);
        }}
      />
      <PickerPopover
        open={open && !disabled}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title={title}
        className="date-picker"
      >
        <div id={prefix}>
          <div className="date-picker-head">
            <button
              type="button"
              className="date-nav"
              aria-label={t("Previous month")}
              disabled={Boolean(minimum && month <= startOfMonth(minimum))}
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <b aria-live="polite">{pickerDateLabel(month, locale, { month: "long", year: "numeric" })}</b>
            <button
              type="button"
              className="date-nav"
              aria-label={t("Next month")}
              disabled={Boolean(max && month >= startOfMonth(max))}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className="date-weekdays" aria-hidden="true">
            {WEEKDAY_ORDER.map((day, i) => (
              <span key={day}>{pickerDateLabel(addDays("2024-01-01", i), locale, { weekday: "narrow" })}</span>
            ))}
          </div>
          <div className="date-grid" role="group" aria-label={t("Calendar days")}>
            {dates.map((date) => (
              <button
                id={`${prefix}-${date}`}
                key={date}
                type="button"
                className={`date-day ${date.slice(0, 7) !== month.slice(0, 7) ? "is-outside" : ""} ${!permitted(date) ? "is-past" : ""} ${date === today ? "is-today" : ""} ${repeatDates.includes(date) ? "is-repeat" : ""} ${date === value ? "is-selected" : ""}`.trim()}
                aria-label={pickerDateLabel(date, locale, { dateStyle: "full" })}
                aria-pressed={date === value}
                data-picker-autofocus={
                  permitted(date) && date === (isDateOnly(value) ? value : today) ? "true" : undefined
                }
                aria-current={date === today ? "date" : undefined}
                disabled={!permitted(date)}
                onClick={() => choose(date)}
                onKeyDown={(event) => {
                  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
                  if (delta) {
                    event.preventDefault();
                    focusDay(addDays(date, delta));
                  } else if (event.key === "PageUp" || event.key === "PageDown") {
                    event.preventDefault();
                    focusDay(addMonths(date, event.key === "PageUp" ? -1 : 1));
                  }
                }}
              >
                {parseDateOnly(date).getUTCDate()}
                {classDates.includes(date) ? <i aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
          <div className="date-picker-foot">
            <div className="date-legend">
              <span>
                <i />
                {t("Has classes")}
              </span>
              {repeatDates.length ? (
                <span>
                  <em />
                  {t("Repeats")}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="date-nav date-today"
              disabled={!permitted(today)}
              onClick={() => choose(today)}
            >
              {t("Today")}
            </button>
            {!props.required && props["aria-required"] !== "true" && value ? (
              <button type="button" className="date-nav" aria-label={t("Clear date")} onClick={() => choose("")}>
                <X size={16} />
              </button>
            ) : null}
          </div>
        </div>
      </PickerPopover>
    </span>
  );
}

/** @param {import("./picker.types").TimePickerProps} props */
export function TimePicker({
  value = "",
  onChange,
  name,
  durationMinutes = 60,
  busy = [],
  minMinutes = 480,
  maxMinutes = 1260,
  disabled = false,
  className = "",
  ...props
}) {
  const { t, locale } = useI18n();
  const triggerRef = useRef(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("hours");
  const [draft, setDraft] = useState(timeToMinutes(value) ?? 600);
  const format = (minutes) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(
      new Date(Date.UTC(2000, 0, 1, 0, minutes)),
    );
  const base = draft >= 720 ? 720 : 0;
  const hour = Math.floor(draft / 60);
  const minute = draft % 60;
  const current = slotAvailability(draft, durationMinutes, busy, minMinutes, maxMinutes);
  const available = (start) => slotAvailability(start, durationMinutes, busy, minMinutes, maxMinutes).available;
  const setPeriod = (nextBase) => {
    const proposed = nextBase + (draft % 720);
    const candidates = Array.from({ length: 48 }, (_, i) => nextBase + i * 15).filter(available);
    if (available(proposed)) setDraft(proposed);
    else if (candidates.length) setDraft(candidates[0]);
    setMode("hours");
  };
  const degrees = mode === "hours" ? (hour % 12) * 30 : minute * 6;
  const knob = clockPoint(degrees);
  const title = props["aria-label"] || t("Choose a time");
  const visibleBusy = busy.filter((block) => block.end > base && block.start < base + 720);
  return (
    <span className={`select-menu-wrap time-control ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
      <Trigger
        open={open}
        triggerRef={triggerRef}
        title={title}
        value={timeToMinutes(value) === null ? "" : format(timeToMinutes(value))}
        icon={Clock3}
        disabled={disabled}
        className=""
        props={props}
        dialogId={id}
        onClick={() => {
          setDraft(timeToMinutes(value) ?? Math.max(minMinutes, 600));
          setMode("hours");
          setOpen(!open);
        }}
      />
      <PickerPopover
        open={open && !disabled}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title={title}
        className="time-clock"
      >
        <div id={id}>
          <div className="time-clock-top">
            <div className="time-clock-read">
              <button
                type="button"
                aria-label={t("Choose hours")}
                className={mode === "hours" ? "on" : ""}
                aria-pressed={mode === "hours"}
                onClick={() => setMode("hours")}
              >
                {hour % 12 || 12}
              </button>
              <span>:</span>
              <button
                type="button"
                aria-label={t("Choose minutes")}
                aria-pressed={mode === "minutes"}
                className={mode === "minutes" ? "on" : ""}
                onClick={() => setMode("minutes")}
              >
                {String(minute).padStart(2, "0")}
              </button>
            </div>
            <div className="time-clock-ampm" role="group" aria-label={t("Time of day")}>
              {[0, 720].map((period) => (
                <button
                  type="button"
                  key={period}
                  className={base === period ? "on" : ""}
                  aria-pressed={base === period}
                  disabled={!Array.from({ length: 48 }, (_, i) => period + i * 15).some(available)}
                  onClick={() => setPeriod(period)}
                >
                  {t(period ? "p.m." : "a.m.")}
                </button>
              ))}
            </div>
          </div>
          <div className="time-dial" role="group" aria-label={t(mode === "hours" ? "Hours" : "Minutes")}>
            <svg viewBox="0 0 240 240" aria-hidden="true">
              <circle className="time-dial-face" cx="120" cy="120" r="100" />
              {mode === "hours" ? (
                <>
                  <circle className="time-dial-track" cx="120" cy="120" r="112" />
                  {visibleBusy.map((block, i) => (
                    <path key={i} className="time-dial-busy" d={clockArc(block.start, block.end, base)} />
                  ))}
                  <path
                    className={`time-dial-class ${!current.available ? "bad" : ""}`}
                    d={clockArc(draft, draft + durationMinutes, base)}
                  />
                </>
              ) : null}
              <line className="time-dial-hand" x1="120" y1="120" x2={knob.x} y2={knob.y} />
              <circle className={`time-dial-knob ${!current.available ? "bad" : ""}`} cx={knob.x} cy={knob.y} r="18" />
              <circle className="time-dial-pin" cx="120" cy="120" r="3" />
            </svg>
            {Array.from({ length: 12 }, (_, i) => {
              const point = clockPoint(i * 30);
              const h = base / 60 + i;
              const status = hourAvailability(h, durationMinutes, busy, minMinutes, maxMinutes);
              const start = hour * 60 + i * 5;
              const minuteStatus = slotAvailability(start, durationMinutes, busy, minMinutes, maxMinutes);
              const tick = mode === "minutes" && i % 3 !== 0;
              const off = mode === "hours" ? status.off : !minuteStatus.inRange;
              const occupied = mode === "hours" ? status.busy : Boolean(minuteStatus.conflicts.length);
              const selected = mode === "hours" ? h === hour : i * 5 === minute;
              const label =
                mode === "hours" ? format(h * 60) : t("{value} minutes", { value: String(i * 5).padStart(2, "0") });
              return (
                <button
                  key={i}
                  type="button"
                  className={`time-dial-num ${selected ? "is-selected" : ""} ${off ? "is-off" : occupied ? "is-busy" : ""} ${tick ? "is-tick" : ""}`.trim()}
                  style={{ left: `${point.x / 2.4}%`, top: `${point.y / 2.4}%` }}
                  disabled={tick || off || occupied}
                  aria-hidden={tick ? "true" : undefined}
                  aria-label={
                    tick
                      ? undefined
                      : `${label}${off ? ` · ${t("Outside working hours")}` : occupied ? ` · ${t("Occupied")}` : ""}`
                  }
                  aria-pressed={tick ? undefined : selected}
                  onClick={() => {
                    if (mode === "hours") {
                      setDraft(status.firstFree);
                      setMode("minutes");
                    } else {
                      changed(onChange, minutesToTime(start), name);
                      setOpen(false);
                    }
                  }}
                >
                  {tick ? "" : mode === "hours" ? i || 12 : String(i * 5).padStart(2, "0")}
                </button>
              );
            })}
          </div>
          <div className="time-clock-legend">
            <span>
              <i className="k1" />
              {t("Your class")}
            </span>
            <span>
              <i className="k2" />
              {t("Occupied")}
            </span>
          </div>
          {visibleBusy.length ? (
            <p className="time-clock-note">
              {t("Occupied: {classes}", {
                classes: visibleBusy
                  .map((block) => `${block.label || t("Class")} ${format(block.start)}–${format(block.end)}`)
                  .join(" · "),
              })}
            </p>
          ) : null}
          <div className="time-foot" aria-live="polite">
            <span>
              {format(draft)} – {format(draft + durationMinutes)}
            </span>
            <span className={current.available ? "picker-available" : "picker-conflict"}>
              {t(
                current.available
                  ? "Free time"
                  : !current.inRange
                    ? "Outside working hours"
                    : "Conflicts with another class",
              )}
            </span>
          </div>
        </div>
      </PickerPopover>
    </span>
  );
}
