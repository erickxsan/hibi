import { useRef, useState } from "react";
import { ChevronDown, Repeat2 } from "lucide-react";
import { useI18n } from "../i18n";
import { parseDateOnly } from "../domain/dates";
import {
  nextRecurrenceDates,
  normalizeRecurrence,
  pickerDateLabel,
  RECURRENCE_LIMITS,
  WEEKDAY_ORDER,
} from "../domain/pickerModels";
import { PickerPopover } from "./PickerPopover";

function ordinalFor(rule, t) {
  const nth = rule.startDate ? Math.ceil(parseDateOnly(rule.startDate).getUTCDate() / 7) : 1;
  return t(["first", "second", "third", "fourth", "last"][Math.min(nth, 5) - 1]);
}

export function recurrenceSummary(rule, t, locale) {
  const frequency =
    rule.interval === 1
      ? t({ daily: "Every day", weekly: "Every week", monthly: "Every month" }[rule.kind])
      : t({ daily: "Every {count} days", weekly: "Every {count} weeks", monthly: "Every {count} months" }[rule.kind], {
          count: rule.interval,
        });
  const detail =
    rule.kind === "daily"
      ? t(rule.dailyMode === "weekdays" ? "Mon to Fri" : "Every day of the week")
      : rule.kind === "weekly"
        ? rule.days.length
          ? new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(
              rule.days.map((day) => pickerDateLabel(`2024-01-0${day === 0 ? 7 : day}`, locale, { weekday: "short" })),
            )
          : t("Choose at least one day")
        : !rule.startDate
          ? ""
          : rule.monthlyMode === "dayOfMonth"
            ? t("on day {day}", { day: parseDateOnly(rule.startDate).getUTCDate() })
            : t("on the {ordinal} {weekday}", {
                ordinal: ordinalFor(rule, t),
                weekday: pickerDateLabel(rule.startDate, locale, { weekday: "long" }),
              });
  return `${frequency} · ${detail}`;
}

export function RepeatPicker({
  value = {},
  startDate = value.startDate,
  onChange,
  disabled = false,
  conflictingDays = [],
  kinds = ["daily", "weekly", "monthly"],
  className = "",
  ...props
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const rule = normalizeRecurrence({ ...value, startDate });
  const update = (patch) => onChange(normalizeRecurrence({ ...rule, ...patch }));
  const preview = nextRecurrenceDates(rule);
  const title = props["aria-label"] || t("Repeat");
  const datesLabel = preview
    .map((date) => pickerDateLabel(date, locale, { weekday: "short", day: "numeric", month: "short" }))
    .join(" · ");
  const options =
    rule.kind === "daily"
      ? [
          ["all", t("Every day of the week")],
          ["weekdays", t("Only Monday to Friday")],
        ]
      : [
          [
            "dayOfMonth",
            rule.startDate
              ? t("On day {day} of the month", { day: parseDateOnly(rule.startDate).getUTCDate() })
              : t("Same day of the month"),
          ],
          [
            "nthWeekday",
            rule.startDate
              ? t("On the {ordinal} {weekday} of the month", {
                  ordinal: ordinalFor(rule, t),
                  weekday: pickerDateLabel(rule.startDate, locale, { weekday: "long" }),
                })
              : t("Same weekday of the month"),
          ],
        ];
  return (
    <span className={`select-menu-wrap ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={props["aria-label"] || (!props["aria-labelledby"] ? title : undefined)}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        disabled={disabled}
        className={`select-trigger-hibi ${open ? "is-open" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <Repeat2 className="select-lead" aria-hidden="true" />
        <span className="select-value">{recurrenceSummary(rule, t, locale)}</span>
        <ChevronDown className="select-chevron" aria-hidden="true" />
      </button>
      <PickerPopover
        open={open && !disabled}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        title={title}
        className="repeat-picker"
      >
        <div className="repeat-kinds" role="group" aria-label={t("Recurrence pattern")}>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={rule.kind === kind ? "on" : ""}
              aria-pressed={rule.kind === kind}
              onClick={() => update({ kind, interval: 1 })}
            >
              {t({ daily: "Daily", weekly: "Weekly", monthly: "Monthly" }[kind])}
            </button>
          ))}
        </div>
        <div className="repeat-row">
          <span>{t("Every")}</span>
          <div className="repeat-stepper">
            <button
              type="button"
              aria-label={t("Decrease interval")}
              disabled={rule.interval <= 1}
              onClick={() => update({ interval: rule.interval - 1 })}
            >
              −
            </button>
            <b aria-live="polite">{rule.interval}</b>
            <button
              type="button"
              aria-label={t("Increase interval")}
              disabled={rule.interval >= RECURRENCE_LIMITS[rule.kind]}
              onClick={() => update({ interval: rule.interval + 1 })}
            >
              +
            </button>
          </div>
          <span>
            {t(
              rule.interval === 1
                ? { daily: "day", weekly: "week", monthly: "month" }[rule.kind]
                : { daily: "days", weekly: "weeks", monthly: "months" }[rule.kind],
            )}
          </span>
        </div>
        {rule.kind === "weekly" ? (
          <div className="repeat-days" role="group" aria-label={t("Days of the week")}>
            {WEEKDAY_ORDER.map((day) => (
              <button
                type="button"
                key={day}
                aria-label={pickerDateLabel(`2024-01-0${day === 0 ? 7 : day}`, locale, { weekday: "long" })}
                aria-pressed={rule.days.includes(day)}
                className={`${rule.days.includes(day) ? "on" : ""} ${conflictingDays.includes(day) ? "bad" : ""}`}
                onClick={() =>
                  update({
                    days: rule.days.includes(day) ? rule.days.filter((item) => item !== day) : [...rule.days, day],
                  })
                }
              >
                {pickerDateLabel(`2024-01-0${day === 0 ? 7 : day}`, locale, { weekday: "short" })}
              </button>
            ))}
          </div>
        ) : (
          <div role="radiogroup" aria-label={t("Repeat options")}>
            {options.map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                role="radio"
                aria-checked={(rule.kind === "daily" ? rule.dailyMode : rule.monthlyMode) === mode}
                className={`repeat-option ${(rule.kind === "daily" ? rule.dailyMode : rule.monthlyMode) === mode ? "is-on" : ""}`}
                onClick={() => update(rule.kind === "daily" ? { dailyMode: mode } : { monthlyMode: mode })}
              >
                <i aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="repeat-next" aria-live="polite">
          <b>{t("Next classes")}</b>
          <span>{datesLabel || t(rule.startDate ? "Choose at least one day" : "Choose a start date")}</span>
        </div>
      </PickerPopover>
    </span>
  );
}
