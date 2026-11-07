import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  CircleSlash,
  Clock,
  Mail,
  PencilLine,
  Phone,
  Star,
  Undo2,
  Wallet,
} from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { StudentAvatar } from "../components/StudentAvatar";
import { GroupBadge } from "../components/GroupBadge";
import { endOfMonth } from "../domain/dates";
import { studentGroupIdsOf } from "./groupLabels";
import { groupNamesOf } from "./CommunityStudent";
import { buildClassRecords } from "./classesDraftModel";
import { buildClassWorkspaceSessionsForRange } from "./classesWorkspaceModel";
import { MonthlyFeePay } from "./MonthlyFeePay";
import { useConfirmPrompt } from "../components/ConfirmPrompt";
import { comparisonSpan } from "./HomeMetrics";
import { dayCode, defaultChargeId, studentSheetModel } from "./trackingStudentSheetModel";
import { LostIconButton, useLostPaymentActions } from "./LostPayments";
import { chargeDebt } from "./lostPaymentsModel";
import { isOverdueClassDebt } from "./homeDashboardModel";
import {
  dayNumber,
  formatDayMonth,
  formatMoney,
  formatScore,
  formatShortDate,
  formatTime,
  monthLong,
  monthShort,
  weekdayShort,
} from "../utils/displayFormat";
import "./trackingStudentSheet.css";

const TABS = [
  { value: "attendance", label: "Attendance", icon: CalendarCheck },
  { value: "grades", label: "Grades", icon: Star },
  { value: "payments", label: "Payments", icon: Wallet },
];
const CODE_WORDS = {
  P: "Present",
  A: "Absent",
  E: "Excused",
  U: "Unmarked",
  C: "Cancelled",
  F: "Upcoming",
  N: "Not recorded",
};
// 5 Oct 2026 is a Monday: the calendar starts its weeks on Monday, like the date pickers.
const MONDAY = Date.UTC(2026, 9, 5);

function percent(ratio, locale) {
  return Number.isFinite(ratio)
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ratio * 100)}%`
    : "—";
}

/** «$12.5k» / «$1.2M»: rounded down, so a debt never reads bigger than it is. */
export function shortMoney(value, locale) {
  const [unit, suffix] = value >= 1_000_000 ? [1_000_000, "M"] : [1_000, "k"];
  const short = Math.floor((value / unit) * 10) / 10;
  return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(short)}${suffix}`;
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function weekLetters(locale) {
  const format = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(MONDAY + index * 86_400_000)));
}

/** The days of a month in Monday-first weeks, with blanks before the 1st. */
function monthCells(month) {
  const last = Number(endOfMonth(month).slice(8, 10));
  const lead = (new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7;
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: last }, (_, index) => `${month.slice(0, 8)}${String(index + 1).padStart(2, "0")}`),
  ];
}

/** A small ring for a fee paid in part. */
function PartRing({ share, tone }) {
  const length = 2 * Math.PI * 9;
  return (
    <svg viewBox="0 0 24 24" className={`ssh-ring ${tone}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="9" strokeDasharray={`${(length * share).toFixed(1)} ${length.toFixed(1)}`} />
    </svg>
  );
}

/** The student's grades in order against the group's average; a missing grade is a dashed ring. */
function GradeTrend({ items, groupValue, locale, t }) {
  const width = 340;
  const height = 128;
  const top = 26;
  const bottom = 100;
  const values = items.map((item) => item.value).filter((value) => value !== null);
  // The scale starts a point under the lowest mark, so close grades still read apart.
  const low = Math.max(0, Math.min(9, Math.floor(Math.min(...values, groupValue ?? 10) - 1)));
  const y = (value) => top + ((10 - value) / (10 - low)) * (bottom - top);
  // The right edge is kept for the group's number.
  const step = items.length > 1 ? (width - 24 - 52) / (items.length - 1) : 0;
  const x = (index) => (items.length > 1 ? 24 + index * step : width / 2);
  const sameMonth = items.every((item) => item.date.slice(0, 7) === items[0].date.slice(0, 7));
  const labelEvery = Math.ceil(items.length / 8);
  // A missing grade sits at the height of the last one (or the group's, or the middle), always inside.
  let lastY = groupValue !== null ? y(groupValue) : (top + bottom) / 2;
  const points = items.map((item, index) => {
    if (item.value !== null) lastY = y(item.value);
    return { ...item, cx: x(index), cy: Math.min(bottom, Math.max(top, lastY)) };
  });
  const graded = points.filter((point) => point.value !== null);
  return (
    <svg
      className="ssh-trend"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={[
        ...items.map(
          (item) => `${item.assessment}: ${item.value === null ? t("Needs a grade") : formatScore(item.value, locale)}`,
        ),
        groupValue !== null ? t("Group {value}", { value: formatScore(groupValue, locale) }) : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <line className="ssh-trend-axis" x1="8" x2={width - 8} y1={bottom + 4} y2={bottom + 4} />
      {groupValue !== null ? (
        <>
          <line className="ssh-trend-group" x1="8" x2={width - 8} y1={y(groupValue)} y2={y(groupValue)} />
          <text className="ssh-trend-groupnum" x={width - 8} y={y(groupValue) - 6} textAnchor="end">
            {formatScore(groupValue, locale)}
          </text>
        </>
      ) : null}
      {graded.length > 1 ? (
        <polyline className="ssh-trend-line" points={graded.map((point) => `${point.cx},${point.cy}`).join(" ")} />
      ) : null}
      {points.map((point, index) => (
        <g key={point.key}>
          {point.value === null ? (
            <circle className="ssh-trend-missing" cx={point.cx} cy={point.cy} r="5" />
          ) : (
            <circle className="ssh-trend-dot" cx={point.cx} cy={point.cy} r="5" />
          )}
          {index % labelEvery === 0 || index === points.length - 1 ? (
            <>
              <text
                className={point.value === null ? "ssh-trend-ask" : "ssh-trend-value"}
                x={point.cx}
                y={point.cy - 12}
                textAnchor="middle"
              >
                {point.value === null ? "?" : formatScore(point.value, locale)}
              </text>
              <text className="ssh-trend-day" x={point.cx} y={height - 4} textAnchor="middle">
                {sameMonth ? dayNumber(point.date) : `${dayNumber(point.date)} ${monthShort(point.date, locale)}`}
              </text>
            </>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

/**
 * Seguimiento › a student, on the phone: the three figures are the tabs. Attendance is the month's
 * calendar (tap a class to mark it), grades the trend against the group, payments the monthly fees.
 */
export function TrackingStudentSheet({
  row,
  state,
  derived,
  range,
  scope,
  asOf,
  liveDate,
  initialTab,
  thresholds,
  groupsById,
  scopeKpis,
  actions,
  busy,
  onPay,
  onUndo,
  onOpenStudent,
  openPage,
  onClose,
}) {
  const { t, locale } = useI18n();
  const student = row.student;
  const model = useMemo(
    () => studentSheetModel(state, derived, { student, range, scope, asOf, liveDate, scopeKpis }),
    [asOf, derived, liveDate, range, scope, scopeKpis, state, student],
  );
  const letters = useMemo(() => weekLetters(locale), [locale]);
  const { confirm, prompt } = useConfirmPrompt();
  const [tab, setTab] = useState(initialTab);
  const [month, setMonth] = useState(model.months.at(-1));
  const [pickedDay, setPickedDay] = useState("");
  const [pickedCharge, setPickedCharge] = useState("");
  const [saving, setSaving] = useState(false);
  const lostActions = useLostPaymentActions(actions);
  // Payments and marks are dated today, so a report of an earlier day could not show the change.
  const canLose = asOf === liveDate;

  const firstGroup = groupsById.get(studentGroupIdsOf(student)[0]);
  const phone = student.guardianPhone || student.phone;
  const email = student.studentEmail;
  const compareLabel = (value) =>
    t(model.compare.scope === "all" || model.compare.scope === "individual" ? "Everyone {value}" : "Group {value}", {
      value,
    });

  // Tiles: icon and figure on one line, a meter under them, and a dot when something needs attention.
  const attendanceLow = row.attendance !== null && row.attendance < thresholds.attendance;
  const gradeLow = row.average !== null && row.average < thresholds.grade;
  const paidShare = row.paid + row.owed > 0 ? row.paid / (row.paid + row.owed) : 1;
  // `note` is what the dot means, for screen readers.
  const tiles = {
    attendance: {
      figure: percent(row.attendance, locale),
      meter: row.attendance ?? 0,
      tone: attendanceLow ? "is-bad" : "is-ok",
      dot: attendanceLow ? "is-bad" : "",
      note: attendanceLow ? t("Low attendance") : "",
    },
    grades: {
      figure: formatScore(row.average, locale),
      meter: row.average === null ? 0 : row.average / 10,
      tone: gradeLow ? "is-bad" : "is-grade",
      dot: gradeLow ? "is-bad" : row.ungraded.length ? "is-pend" : "",
      note: gradeLow ? t("Low grade") : row.ungraded.length ? t("Needs a grade") : "",
    },
    payments: {
      // Five figures do not fit a third of a phone: «$12.5k», never rounded up; the label keeps the amount.
      figure: row.owed >= 10_000 ? shortMoney(row.owed, locale) : formatMoney(row.owed, locale),
      spoken: formatMoney(row.owed, locale),
      meter: paidShare,
      tone: row.overdue ? "is-bad" : row.owed ? "is-pend" : "is-ok",
      dot: row.overdue ? "is-bad" : row.owed ? "is-pend" : "",
      note: row.overdue ? t("Overdue") : row.owed ? t("Pending") : "",
    },
  };

  // Attendance: the chosen day is the last class shown (or the first one to come).
  const cells = monthCells(month);
  const monthDays = cells.filter((date) => date && model.days.has(date));
  const day =
    pickedDay && model.days.has(pickedDay) && pickedDay.startsWith(month.slice(0, 7))
      ? pickedDay
      : monthDays.filter((date) => date <= asOf).at(-1) || monthDays[0] || "";
  const monthIndex = model.months.indexOf(month);
  const present = row.classes - row.absences;

  const mark = async (entry, code) => {
    if (!actions?.saveProgress || saving || busy) return;
    const session = buildClassWorkspaceSessionsForRange(state, entry.date, entry.date, liveDate).find(
      (item) => item.key === entry.key,
    );
    if (!session) return;
    // An absence is not charged, so a class already paid would lose its payment: ask first.
    const paid = Number((state.classLog || []).find((item) => item.id === entry.rowId)?.amountPaid) || 0;
    if (
      code === "A" &&
      paid > 0 &&
      !(await confirm({
        kicker: `${student.fullName} · ${formatShortDate(entry.date, locale)}`,
        title: t("Mark as absent?"),
        description: t("The {amount} paid for this class will be removed.", { amount: formatMoney(paid, locale) }),
        confirmLabel: t("Mark absent"),
        cancelLabel: t("Cancel"),
        tone: "danger",
      }))
    )
      return;
    const classRecords = buildClassRecords(
      state,
      session,
      [student],
      { [student.id]: { attendance: code, classId: entry.rowId } },
      { classStatus: "Completed", today: liveDate },
    );
    setSaving(true);
    try {
      await actions.saveProgress({ classRecords, gradeRecords: [] });
    } finally {
      setSaving(false);
    }
  };

  // Payments: the chosen fee, or the oldest one still owed.
  const charge =
    model.charges.find((item) => item.id === pickedCharge) ||
    model.charges.find((item) => item.id === defaultChargeId(model.charges, asOf)) ||
    null;
  const severalGroups = new Set(model.charges.map((item) => item.groupId)).size > 1;
  // Payments are dated with today's date (not the report date), so «today» and Undo follow it.
  const paidToday = (date) => date === liveDate;
  const pay = (item, amount) => {
    setPickedCharge(item.id);
    return onPay(item, amount);
  };
  const chargeChip = (item) => {
    if (item.status === "paid")
      return {
        tone: "is-ok",
        text: t("Paid · {date}", {
          date: paidToday(item.paidAt) ? t("today") : formatShortDate(item.paidAt, locale, { weekday: false }),
        }),
      };
    if (item.status === "waived") return { tone: "", text: t("Free this month") };
    if (item.status === "lost")
      return {
        tone: "",
        text: t("Lost · {date}", {
          date: paidToday(item.lostAt) ? t("today") : formatShortDate(item.lostAt, locale, { weekday: false }),
        }),
      };
    if (item.status === "overdue")
      return {
        tone: "is-bad",
        text: t("Overdue · {date}", { date: formatShortDate(item.dueDate, locale, { weekday: false }) }),
      };
    return {
      tone: item.dueDate <= asOf ? "is-pend" : "is-next",
      text:
        item.dueDate === asOf
          ? t("Due today")
          : t("Due {date}", { date: formatShortDate(item.dueDate, locale, { weekday: false }) }),
    };
  };
  const statusWord = (item) =>
    t(
      item.status === "paid"
        ? "Paid (fee)"
        : item.status === "waived"
          ? "Free this month"
          : item.status === "lost"
            ? "Lost (fee)"
            : item.status === "overdue"
              ? "Overdue (fee)"
              : "Pending",
    );

  const openClass = (sessionKey) => sessionKey && openPage?.("classes", { type: "open-history-class", sessionKey });
  // A class nobody recorded is taken in Clases, where the whole roster is saved at once.
  const takeClass = (sessionKey) => openPage?.("classes", { type: "open-class", sessionKey });
  const delta = model.gradeDelta;
  const previous = comparisonSpan(range.previousStart, range.previousEnd, asOf, locale);
  const deltaText =
    delta === null
      ? ""
      : t(delta > 0 ? "Up {value} vs. {previous}" : "Down {value} vs. {previous}", {
          value: formatScore(Math.abs(delta), locale),
          previous,
        });

  return (
    <div className="ssh">
      <div className="ssh-head">
        <button type="button" className="ssh-who" onClick={onOpenStudent}>
          <StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />
          <span className="ssh-who-text">
            <span className="ssh-name">
              {student.fullName}
              <ChevronRight aria-hidden="true" />
            </span>
            <span className="ssh-group">
              {firstGroup ? <GroupBadge group={firstGroup} size="tiny" /> : null}
              {groupNamesOf(student, groupsById, t) || t("Individual")}
            </span>
          </span>
          <span className="sr-only">{t("View profile")}</span>
        </button>
        {phone ? (
          <a className="ssh-contact" href={`tel:${phone.replace(/[^\d+]/g, "")}`} aria-label={t("Call the tutor")}>
            <Phone aria-hidden="true" />
          </a>
        ) : null}
        {email ? (
          <a className="ssh-contact" href={`mailto:${email}`} aria-label={t("Write an email")}>
            <Mail aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <div className="ssh-tiles" role="group" aria-label={t("Figures of {name}", { name: student.fullName })}>
        {TABS.map((item) => {
          const tile = tiles[item.value];
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              className={`ssh-tile ${tile.tone} ${tab === item.value ? "on" : ""}`}
              aria-pressed={tab === item.value}
              aria-label={[`${t(item.label)}: ${tile.spoken || tile.figure}`, tile.note].filter(Boolean).join(" · ")}
              onClick={() => setTab(item.value)}
            >
              <span className="ssh-tile-top">
                <Icon aria-hidden="true" />
                <b>{tile.figure}</b>
                {tile.dot ? <i className={`ssh-dot ${tile.dot}`} aria-hidden="true" /> : null}
              </span>
              <span className="ssh-meter" aria-hidden="true">
                <i style={{ width: `${Math.round(Math.min(1, Math.max(0, tile.meter)) * 100)}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      {tab === "attendance" ? (
        <div className="ssh-panel">
          <p className="ssh-line">
            <b>{t("{present} of {total} classes", { present, total: row.classes })}</b>
            {model.compare.attendance !== null ? (
              <span>{compareLabel(percent(model.compare.attendance, locale))}</span>
            ) : null}
          </p>
          {model.months.length > 1 ? (
            <div className="ssh-month">
              <button
                type="button"
                className="ssh-month-step"
                aria-label={t("Previous month")}
                disabled={monthIndex <= 0}
                onClick={() => setMonth(model.months[monthIndex - 1])}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <b>{capitalize(monthLong(month, locale))}</b>
              <button
                type="button"
                className="ssh-month-step"
                aria-label={t("Next month")}
                disabled={monthIndex >= model.months.length - 1}
                onClick={() => setMonth(model.months[monthIndex + 1])}
              >
                <ChevronRight aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div className="ssh-cal" role="group" aria-label={capitalize(monthLong(month, locale))}>
            {letters.map((letter, index) => (
              <span key={index} className="ssh-wd" aria-hidden="true">
                {letter}
              </span>
            ))}
            {cells.map((date, index) => {
              if (!date) return <span key={`b${index}`} aria-hidden="true" />;
              const entries = model.days.get(date);
              const today = date === liveDate;
              // Days of a shown month that fall outside the range are not «no class», just not looked at.
              const outside = date < range.start || date > range.end;
              if (!entries)
                return (
                  <span
                    key={date}
                    className={`ssh-day ${today ? "is-today" : ""} ${outside ? "is-outside" : ""}`}
                    aria-hidden="true"
                  >
                    {dayNumber(date)}
                  </span>
                );
              const code = dayCode(entries);
              return (
                <button
                  key={date}
                  type="button"
                  className={`ssh-day ssh-class code-${code} ${today ? "is-today" : ""} ${date === day ? "on" : ""}`}
                  aria-pressed={date === day}
                  aria-label={`${formatDayMonth(date, locale)} · ${entries.map((entry) => t(CODE_WORDS[entry.code])).join(", ")}`}
                  onClick={() => setPickedDay(date)}
                >
                  {dayNumber(date)}
                </button>
              );
            })}
          </div>
          {day
            ? model.days.get(day).map((entry) => (
                <div className="ssh-dayline" key={entry.key}>
                  <span className="ssh-dayline-text">
                    <b>{formatShortDate(entry.date, locale)}</b>
                    <span>
                      {[entry.title || t("Individual"), entry.startTime ? formatTime(entry.startTime, locale) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {entry.code === "F" ? (
                    <Clock className="ssh-dayline-soon" role="img" aria-label={t("Upcoming")} />
                  ) : entry.code === "C" ? (
                    <span className="ssh-dayline-word">{t("Cancelled")}</span>
                  ) : entry.code === "N" ? (
                    <button type="button" className="ssh-take" onClick={() => takeClass(entry.key)}>
                      {t("Open class")}
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ) : (
                    <span
                      className="ssh-pa"
                      role="group"
                      aria-label={[
                        t("Attendance"),
                        entry.title,
                        entry.startTime ? formatTime(entry.startTime, locale) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {["P", "A"].map((code) => (
                        <button
                          key={code}
                          type="button"
                          className={`code-${code} ${entry.code === code ? "on" : ""}`}
                          aria-label={t(CODE_WORDS[code])}
                          aria-pressed={entry.code === code}
                          disabled={!actions?.saveProgress}
                          onClick={() => entry.code !== code && mark(entry, code)}
                        >
                          {code}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              ))
            : null}
          {!model.days.size ? <p className="muted">{t("No classes in this period.")}</p> : null}
        </div>
      ) : null}

      {tab === "grades" ? (
        <div className="ssh-panel">
          {model.grades.length ? (
            <>
              <p className="ssh-line">
                {delta !== null && Math.round(delta * 10) !== 0 ? (
                  <span className={`ssh-delta ${delta > 0 ? "is-up" : "is-down"}`} title={deltaText}>
                    <span className="ssh-delta-face" aria-hidden="true">
                      {delta > 0 ? <ArrowUp /> : <ArrowDown />}
                      {formatScore(Math.abs(delta), locale)}
                    </span>
                    <span className="sr-only">{deltaText}</span>
                  </span>
                ) : null}
                {model.compare.grade !== null ? (
                  <span>{compareLabel(formatScore(model.compare.grade, locale))}</span>
                ) : null}
              </p>
              <GradeTrend items={model.grades} groupValue={model.compare.grade} locale={locale} t={t} />
              <div className="ssh-rows">
                {[...model.grades].reverse().map((item) => (
                  <div className="ssh-row" key={item.key}>
                    <span className="ssh-date">
                      <small>{weekdayShort(item.date, locale)}</small>
                      <b>{dayNumber(item.date)}</b>
                    </span>
                    <span className="ssh-row-name">{item.assessment}</span>
                    {item.value !== null ? (
                      <b className={item.value < thresholds.grade ? "ssh-score text-bad" : "ssh-score"}>
                        {formatScore(item.value, locale)}
                      </b>
                    ) : item.sessionKey ? (
                      <button
                        type="button"
                        className="ssh-grade"
                        aria-label={t("Grade {assessment}", { assessment: item.assessment })}
                        onClick={() => openClass(item.sessionKey)}
                      >
                        <PencilLine aria-hidden="true" />
                      </button>
                    ) : (
                      <b className="ssh-score">—</b>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">{t("No grades for this period")}</p>
          )}
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className="ssh-panel">
          {charge ? (
            <>
              <div className="ssh-stamps" role="group" aria-label={t("Monthly fee")}>
                {model.charges.map((item) => {
                  const share = item.total > 0 ? item.paid / item.total : 0;
                  const group = groupsById.get(item.groupId);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`ssh-stamp ${item.id === charge.id ? "on" : ""} ${item.status === "lost" ? "is-lost" : ""}`}
                      aria-pressed={item.id === charge.id}
                      aria-label={[capitalize(monthLong(`${item.period}-01`, locale)), group?.name, statusWord(item)]
                        .filter(Boolean)
                        .join(" · ")}
                      onClick={() => setPickedCharge(item.id)}
                    >
                      <span className="ssh-stamp-month">
                        {severalGroups && group ? <GroupBadge group={group} size="tiny" /> : null}
                        {capitalize(monthShort(`${item.period}-01`, locale))}
                      </span>
                      {item.status === "lost" ? (
                        <CircleSlash className="is-lost" aria-hidden="true" />
                      ) : item.status === "paid" || item.status === "waived" ? (
                        <CircleCheck className={item.status === "paid" ? "is-ok" : ""} aria-hidden="true" />
                      ) : item.paid > 0 ? (
                        <PartRing share={share} tone={item.status === "overdue" ? "is-bad" : "is-pend"} />
                      ) : (
                        <Clock className={item.status === "overdue" ? "is-bad" : ""} aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="ssh-fee">
                <div className="ssh-fee-top">
                  <b className={`ssh-amount ${charge.status === "lost" ? "is-lost" : chargeChip(charge).tone}`}>
                    {formatMoney(charge.status === "paid" ? charge.paid : charge.balance, locale)}
                  </b>
                  <span className={`ssh-chip ${chargeChip(charge).tone}`}>{chargeChip(charge).text}</span>
                </div>
                {severalGroups ? <span className="ssh-fee-group">{groupsById.get(charge.groupId)?.name}</span> : null}
                <div
                  className="ssh-bar"
                  role="progressbar"
                  aria-label={t("Monthly fees paid")}
                  aria-valuenow={charge.total > 0 ? Math.round((charge.paid / charge.total) * 100) : 100}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <i style={{ width: `${charge.total > 0 ? Math.round((charge.paid / charge.total) * 100) : 100}%` }} />
                </div>
                <div className="ssh-fee-foot">
                  <span className="ssh-fee-of">
                    {t("{paid} of {total}", {
                      paid: formatMoney(charge.paid, locale),
                      total: formatMoney(charge.total, locale),
                    })}
                  </span>
                  {charge.status === "lost" ? (
                    <LostIconButton
                      recover
                      name={capitalize(monthLong(`${charge.period}-01`, locale))}
                      disabled={busy || lostActions.busy}
                      onClick={() => lostActions.recover(student.id, chargeDebt(charge))}
                    />
                  ) : charge.status === "overdue" && canLose ? (
                    <LostIconButton
                      name={capitalize(monthLong(`${charge.period}-01`, locale))}
                      disabled={busy || lostActions.busy}
                      onClick={() => lostActions.lose(student.id, chargeDebt(charge))}
                    />
                  ) : null}
                </div>
              </div>
              {charge.payments.length ? (
                <div className="ssh-rows">
                  {charge.payments.map((payment) => (
                    <div className="ssh-row ssh-move" key={payment.id}>
                      {payment.partial ? <CirclePlus aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                      <span className="ssh-row-name">
                        {paidToday(payment.paidAt)
                          ? t("today")
                          : formatShortDate(payment.paidAt, locale, { weekday: false })}
                      </span>
                      <b className="ssh-score is-ok">{formatMoney(payment.amount, locale)}</b>
                      {canLose && paidToday(payment.paidAt) ? (
                        <button
                          type="button"
                          className="ssh-undo"
                          aria-label={t("Undo")}
                          disabled={busy}
                          onClick={() => onUndo({ ...charge, paymentId: payment.id })}
                        >
                          <Undo2 aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {canLose && !["paid", "waived", "lost"].includes(charge.status) ? (
                <div className="ssh-pay">
                  <MonthlyFeePay
                    key={`${charge.id}:${charge.balance}`}
                    charge={charge}
                    studentName={student.fullName}
                    onPay={pay}
                    busy={busy}
                    fullLabel={t("Mark paid (fee)")}
                    buttonClassName="button button-primary"
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {model.classDebts.length ? (
            <div className="ssh-rows">
              {model.classDebts.map((record) => {
                const lost = record.row.lostAmount > 0;
                const debt = {
                  kind: "class",
                  classId: record.row.id,
                  date: record.row.classDate,
                  amount: lost ? record.row.lostAmount : Number(record.row.outstanding),
                  ...(lost ? { lostAt: record.row.lostAt } : {}),
                };
                return (
                  <div className={`ssh-debt ${lost ? "is-lost" : ""}`.trim()} key={record.row.id}>
                    <button
                      type="button"
                      className="ssh-row ssh-owed"
                      aria-label={`${t("Open class")} · ${formatShortDate(record.row.classDate, locale)}`}
                      onClick={() => openClass(record.key)}
                    >
                      <span className="ssh-date">
                        <small>{weekdayShort(record.row.classDate, locale)}</small>
                        <b>{dayNumber(record.row.classDate)}</b>
                      </span>
                      <span className="ssh-row-name">
                        {`${record.className || t("Individual")} · ${monthShort(record.row.classDate, locale)}`}
                      </span>
                      <b className="ssh-score text-bad">{formatMoney(debt.amount, locale)}</b>
                    </button>
                    {lost ? (
                      <LostIconButton
                        recover
                        name={formatShortDate(record.row.classDate, locale, { weekday: false })}
                        disabled={busy || lostActions.busy}
                        onClick={() => lostActions.recover(student.id, debt)}
                      />
                    ) : canLose && isOverdueClassDebt(record.row.classDate, asOf) ? (
                      <LostIconButton
                        name={formatShortDate(record.row.classDate, locale, { weekday: false })}
                        disabled={busy || lostActions.busy}
                        onClick={() => lostActions.lose(student.id, debt)}
                      />
                    ) : (
                      <ChevronRight aria-hidden="true" className="ssh-debt-chevron" />
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {!charge && !model.classDebts.length ? <p className="muted">{t("Up to date")}</p> : null}
        </div>
      ) : null}

      <button type="button" className="ssh-close" onClick={onClose}>
        {t("Close")}
      </button>
      {prompt}
    </div>
  );
}
