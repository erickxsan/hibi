import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { BottomSheet, Button, IconButton, Segmented } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { addDays, endOfMonth } from "../domain/dates";
import {
  axisTickLabels,
  dayNumber,
  formatMoney,
  formatScore,
  formatShortDate,
  formatTime,
  monthLong,
  monthShort,
  weekdayLong,
  weekdayShort,
} from "../utils/displayFormat";
import "../components/charts.css";
import { debtSummary, defaultPointIndex, monthProjection, studentPeriodRows } from "./homeDashboardModel";

const RED = "var(--bermellon)";
const OCRE = "var(--ocre)";
const JADE = "var(--jade)";
const INDIGO = "var(--indigo)";

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function firstName(name) {
  return String(name || "").split(" ")[0];
}

function percentText(ratio, locale) {
  return Number.isFinite(ratio) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ratio * 100) : "—";
}

/** Thresholds on the chart scale (0–100). */
export function thresholds(state) {
  const attendance = Number(state?.settings?.lowAttendanceThreshold);
  const grade = Number(state?.settings?.lowGradeThreshold);
  return {
    attendance: Number.isFinite(attendance) ? attendance : 0.8,
    grade: (Number.isFinite(grade) ? grade : 0.7) * 10,
  };
}

export function previousLabel(period, asOf, t, locale) {
  if (period === "today") return t("last {weekday}", { weekday: weekdayLong(asOf, locale) });
  if (period === "weekly") return t("last week");
  if (period === "monthly") return monthLong(`${addDays(`${asOf.slice(0, 7)}-01`, -1)}`, locale);
  return String(Number(asOf.slice(0, 4)) - 1);
}

/**
 * The dates a comparison covers: «1–22 sep», «24 ago–22 sep», «septiembre» for a whole month, and the
 * year when it is not the current one («1 ene–22 oct 2025»). Money comparisons name it so a month in
 * progress never reads as if it were measured against a whole month.
 */
export function comparisonSpan(start, end, asOf, locale) {
  if (!start || !end) return "";
  const otherYear = end.slice(0, 4) !== String(asOf || end).slice(0, 4);
  const year = otherYear ? ` ${end.slice(0, 4)}` : "";
  const date = (value) => formatShortDate(value, locale, { weekday: false });
  if (start.slice(4) === "-01-01" && end.slice(4) === "-12-31" && start.slice(0, 4) === end.slice(0, 4))
    return end.slice(0, 4);
  if (start === end) return `${date(start)}${year}`;
  if (start.slice(8) === "01" && end === endOfMonth(start)) return `${monthLong(start, locale)}${year}`;
  if (start.slice(0, 7) === end.slice(0, 7))
    return `${dayNumber(start)}–${dayNumber(end)} ${monthShort(end, locale)}${year}`;
  return `${date(start)}–${date(end)}${year}`;
}

/** «↓ 49% vs. 1–22 sep»: the money comparison shared by Inicio and Seguimiento. */
export function moneyDeltaText(delta, start, end, asOf, t, locale) {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return "";
  const percent = Math.round(delta * 100);
  return `${percent >= 0 ? "↑" : "↓"} ${t("{value}% vs. {previous}", {
    value: Math.abs(percent),
    previous: comparisonSpan(start, end, asOf, locale),
  })}`;
}

/** «$3,200 de octubre · $9,700 de meses anteriores»: the months an overdue figure comes from. */
export function overdueSplit(summary, t, locale) {
  return [
    summary.overdueThisMonth > 0
      ? t("{amount} from {month}", {
          amount: formatMoney(summary.overdueThisMonth, locale),
          month: monthLong(`${summary.period}-01`, locale),
        })
      : "",
    summary.overdueEarlier > 0
      ? t("{amount} from earlier months", { amount: formatMoney(summary.overdueEarlier, locale) })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** «$12,900 vencidos ($3,200 de octubre · $9,700 de meses anteriores)» or «Nada vencido». */
export function overdueLine(summary, t, locale) {
  if (!(summary.overdue > 0)) return t("Nothing overdue");
  const split = overdueSplit(summary, t, locale);
  const total = t("{amount} overdue", { amount: formatMoney(summary.overdue, locale) });
  return split ? `${total} (${split})` : total;
}

/** «this week», «today»…: the period being measured, to say it has nothing in it. */
function currentLabel(period, t) {
  if (period === "today") return t("today");
  if (period === "weekly") return t("this week");
  if (period === "monthly") return t("this month");
  return t("this year");
}

/**
 * Comparison line when the current period has nothing to measure: says so and, when the previous period
 * does have a value, still shows it («Sin calificaciones esta semana · La semana pasada fue 8.5»).
 */
function emptyPeriodDelta(noneKey, previousValue, previous, period, t) {
  const none = t(noneKey, { current: currentLabel(period, t) });
  if (previousValue === null || previousValue === undefined || previousValue === "") return none;
  return `${none} · ${t("{previous} was {value}", { previous: capitalize(previous), value: previousValue })}`;
}

function pointLabel(point, period, locale) {
  if (point.month) return capitalize(monthShort(point.date, locale));
  if (period === "today") return formatTime(point.startTime, locale).replace(/\s.*$/, "");
  return `${weekdayShort(point.date, locale)} ${dayNumber(point.date)}`;
}

export function bucketLabel(bucket, locale) {
  if (bucket.kind === "month") return monthShort(bucket.start, locale);
  if (bucket.kind === "week") return `${dayNumber(bucket.start)} ${monthShort(bucket.start, locale)}`;
  return weekdayShort(bucket.start, locale);
}

export function bucketTitle(bucket, t, locale) {
  if (bucket.kind === "month") return capitalize(monthLong(bucket.start, locale));
  if (bucket.kind === "week")
    return t("From {start} to {end}", {
      start: dayNumber(bucket.start),
      end: formatShortDate(bucket.end, locale, { weekday: false }),
    });
  return formatShortDate(bucket.start, locale);
}

/** Headline numbers, delta and the one-line insight of a metric card. */
export function metricSummary(metric, context) {
  const { t, locale, period, asOf, names, threshold, rows } = context;
  const previous = previousLabel(period, asOf, t, locale);
  // Comparisons name the dates they cover («vs. 1–22 sep»), like the money ones and Seguimiento.
  const span = metric.previousStart ? comparisonSpan(metric.previousStart, metric.previousEnd, asOf, locale) : previous;
  const hasCurrent = metric.value !== null && metric.value !== undefined;
  const base = {
    delta: hasCurrent ? t("No previous period") : t("No data"),
    deltaTone: "",
    insight: "",
    insightColor: "var(--sumi-subtle)",
    // The one sentence a card shows when its period has nothing to measure, instead of its number,
    // count, chart, detail and insight each saying so in their own words.
    empty: "",
  };
  if (metric.metric === "attendance") {
    const regs = metric.points.filter((point) => point.kind === "reg");
    let insight = t("No classes recorded yet");
    let insightColor = "var(--sumi-subtle)";
    if (period === "yearly" && regs.length) {
      const best = regs.reduce((top, point) => (point.value > top.value ? point : top));
      insight = t("{month} was your best month ({value})", {
        month: capitalize(monthLong(best.date, locale)),
        value: `${percentText(best.value, locale)}%`,
      });
      insightColor = JADE;
    } else if (period === "monthly") {
      const low = rows.filter(
        (row) => row.classes >= 2 && row.attendance !== null && row.attendance < threshold.attendance,
      );
      insight = low.length
        ? t(low.length === 1 ? "{names} is below {value}%" : "{names} are below {value}%", {
            names: names(low.map((row) => row.student.fullName)),
            value: percentText(threshold.attendance, locale),
          })
        : t("Everyone above {value}%", { value: percentText(threshold.attendance, locale) });
      insightColor = low.length ? RED : JADE;
    } else if (regs.length) {
      const absent = regs.at(-1).absentIds.map(context.nameOf).filter(Boolean);
      insight = absent.length
        ? t(absent.length === 1 ? "{names} missed the last class" : "{names} missed the last class (plural)", {
            names: names(absent),
          })
        : t("Nobody missed the last class");
      insightColor = absent.length ? RED : JADE;
    }
    const count =
      period === "yearly"
        ? t("Average of {count} months", { count: regs.length })
        : [
            t(metric.registered === 1 ? "Attendance of {count} class" : "Attendance of {count} classes", {
              count: metric.registered,
            }),
            metric.upcoming ? t("{count} upcoming", { count: metric.upcoming }) : "",
            metric.unregistered ? t("{count} not recorded", { count: metric.unregistered }) : "",
          ]
            .filter(Boolean)
            .join(" · ");
    const result = {
      ...base,
      name: t("Attendance"),
      value: percentText(metric.value, locale),
      unit: metric.value === null ? "" : "%",
      count,
      insight,
      insightColor,
    };
    if (!hasCurrent) {
      result.empty = emptyPeriodDelta(
        "No classes recorded {current}",
        Number.isFinite(metric.previous) ? `${percentText(metric.previous, locale)}%` : null,
        previous,
        period,
        t,
      );
      if (Number.isFinite(metric.previous)) result.delta = result.empty;
    }
    if (metric.delta !== null) {
      const points = Math.round(metric.delta * 100);
      result.delta =
        points === 0
          ? t("Same as {previous}", { previous: span })
          : `${points > 0 ? "↑" : "↓"} ${t("{value} pp vs. {previous}", { value: Math.abs(points), previous: span })}`;
      result.deltaTone = points >= 0 ? "text-ok" : "text-bad";
    }
    return result;
  }
  if (metric.metric === "grade") {
    let insight = t("No graded assignments yet");
    let insightColor = "var(--sumi-subtle)";
    const graded = metric.assignments || [];
    const low = graded
      .flatMap((item) =>
        item.grades.filter((grade) => grade.value < threshold.grade).map((grade) => ({ ...grade, item })),
      )
      .at(-1);
    const missing = graded.filter((item) => item.missing.length).at(-1);
    if (low) {
      insight = t("{name} got {value} in {assessment}", {
        name: firstName(context.nameOf(low.studentId)),
        value: formatScore(low.value, locale),
        assessment: low.item.assessment,
      });
      insightColor = RED;
    } else if (missing) {
      insight = t("{name} still needs a grade in {assessment}", {
        name: firstName(context.nameOf(missing.missing[0])),
        assessment: missing.assessment,
      });
      insightColor = OCRE;
    } else if (metric.value !== null) {
      insight = t("You're on track. Excellent work!");
      insightColor = INDIGO;
    }
    const count =
      period === "yearly"
        ? t("Average of {count} months", { count: metric.points.length })
        : [
            t(metric.graded === 1 ? "{count} graded assignment" : "{count} graded assignments", {
              count: metric.graded,
            }),
            metric.ungraded ? t("{count} without a grade", { count: metric.ungraded }) : "",
          ]
            .filter(Boolean)
            .join(" · ");
    const result = {
      ...base,
      name: t("Grade"),
      value: formatScore(metric.value, locale),
      unit: metric.value === null ? "" : " /10",
      count,
      insight,
      insightColor,
    };
    if (!hasCurrent) {
      result.empty = emptyPeriodDelta(
        "No grades {current}",
        Number.isFinite(metric.previous) ? `${formatScore(metric.previous, locale)} /10` : null,
        previous,
        period,
        t,
      );
      if (Number.isFinite(metric.previous)) result.delta = result.empty;
    }
    if (metric.delta !== null) {
      const delta = Math.round(metric.delta * 10) / 10;
      result.delta =
        delta === 0
          ? t("Same as {previous}", { previous: span })
          : `${delta > 0 ? "↑" : "↓"} ${t("{value} vs. {previous}", { value: formatScore(Math.abs(delta), locale), previous: span })}`;
      result.deltaTone = delta >= 0 ? "text-data" : "text-bad";
    }
    return result;
  }
  let insight = metric.paymentDays
    ? t(
        metric.paymentDays === 1
          ? "Collections came in on {count} payment day"
          : "Collections came in on {count} payment days",
        {
          count: metric.paymentDays,
        },
      )
    : t("No collections in this period yet");
  if (period === "yearly") {
    const best = metric.points
      .filter((point) => !point.future)
      .reduce((top, point) => (point.value > (top?.value ?? -1) ? point : top), null);
    if (best?.value)
      insight = t("{month} was your best month ({value})", {
        month: capitalize(monthLong(best.start, locale)),
        value: formatMoney(best.value, locale),
      });
  }
  const result = {
    ...base,
    name: t("Collections"),
    value: formatMoney(metric.value, locale),
    unit: "",
    count:
      period === "yearly"
        ? t("January to {month}", { month: monthLong(asOf, locale) })
        : t(metric.payments.length === 1 ? "{count} payment recorded" : "{count} payments recorded", {
            count: metric.payments.length,
          }),
    insight,
    insightColor: metric.paymentDays || period === "yearly" ? JADE : "var(--sumi-subtle)",
    empty: metric.payments.length ? "" : t("No payments {current}", { current: currentLabel(period, t) }),
  };
  if (metric.delta !== null) {
    const percent = Math.round(metric.delta * 100);
    // «vs. 1–22 sep», not «vs. septiembre»: the label states the same stretch the figure is compared with.
    result.delta =
      period === "today" || !metric.previousStart
        ? `${percent >= 0 ? "↑" : "↓"} ${t("{value}% vs. {previous}", { value: Math.abs(percent), previous })}`
        : moneyDeltaText(metric.delta, metric.previousStart, metric.previousEnd, asOf, t, locale);
    result.deltaTone = percent >= 0 ? "text-ok" : "text-bad";
  }
  return result;
}

/**
 * What a selected point says: used by the card detail, the explorer aside and the mobile sheet.
 * @returns {any}
 */
export function pointDetail(metric, index, context) {
  const { t, locale, nameOf, groupName, threshold, rosterOf } = context;
  const empty = {
    title: t("No data"),
    big: "—",
    sub: "",
    tone: "",
    rows: [],
    listTitle: "",
    list: [],
    emptyMessage: "",
  };
  const point = metric.points[index];
  if (!point) return empty;
  if (metric.metric === "collections") {
    const list = point.payments.map((payment) => ({
      id: payment.id,
      name: nameOf(payment.studentId),
      sub: [groupName(payment.groupId), formatShortDate(payment.date, locale, { weekday: false })]
        .filter(Boolean)
        .join(" · "),
      value: formatMoney(payment.amount, locale),
      color: JADE,
    }));
    return {
      ...empty,
      title: bucketTitle(point, t, locale),
      big: point.future ? t("Upcoming") : formatMoney(point.value, locale),
      sub: t(point.payments.length === 1 ? "{count} payment" : "{count} payments", { count: point.payments.length }),
      listTitle: t("Payments recorded"),
      list,
      emptyMessage: t("No payments in this stretch."),
    };
  }
  const title = point.month
    ? capitalize(monthLong(point.date, locale))
    : metric.metric === "grade"
      ? point.assignment.assessment
      : `${formatShortDate(point.date, locale)} · ${formatTime(point.startTime, locale)}`;
  if (point.month) {
    return {
      ...empty,
      title,
      big:
        metric.metric === "attendance"
          ? `${percentText(point.value, locale)}%`
          : `${formatScore(point.value, locale)} /10`,
      sub: t(metric.metric === "attendance" ? "Average attendance of the month" : "Average of the month"),
    };
  }
  if (point.kind === "fut")
    return {
      ...empty,
      title,
      big: t("Upcoming"),
      sub: point.title,
      listTitle: t("Expected"),
      list: rosterOf(point.session).map((student) => ({
        id: student.id,
        name: student.fullName,
        color: "var(--sumi-subtle)",
      })),
      action: { type: "open", session: point.session, label: t("View in Classes") },
    };
  if (point.kind === "unreg")
    return {
      ...empty,
      title,
      big: t("Not recorded"),
      sub: point.title,
      tone: "text-pend",
      action: { type: "record", session: point.session, label: t("Record this class") },
    };
  if (metric.metric === "attendance") {
    const low = point.value < threshold.attendance;
    return {
      ...empty,
      title,
      big: `${percentText(point.value, locale)}%`,
      sub: `${point.title} · ${t(low ? "below {value}%" : "above {value}%", { value: percentText(threshold.attendance, locale) })}`,
      tone: low ? "text-bad" : "text-ok",
      rows: [
        { key: t("Present (count)"), value: t("{present} of {total}", { present: point.present, total: point.total }) },
      ],
      listTitle: t("Missed"),
      list: point.absentIds.map((id) => ({ id, name: nameOf(id), color: RED })),
      emptyMessage: t("Nobody missed. Perfect attendance!"),
      emptyTone: "text-ok",
      action: { type: "open", session: point.session, label: t("View session") },
    };
  }
  const assignment = point.assignment;
  const list = [...assignment.grades]
    .sort((left, right) => left.value - right.value)
    .map((grade) => ({
      id: grade.studentId,
      name: nameOf(grade.studentId),
      value: formatScore(grade.value, locale),
      bar: grade.value * 10,
      color: grade.value < threshold.grade ? RED : INDIGO,
    }))
    .concat(
      assignment.missing.map((id) => ({ id, name: nameOf(id), sub: t("No grade yet"), value: "—", color: OCRE })),
    );
  return {
    ...empty,
    title,
    big: `${formatScore(assignment.average, locale)} /10`,
    sub: [groupName(assignment.groupId), formatShortDate(assignment.date, locale)].filter(Boolean).join(" · "),
    tone: assignment.average < threshold.grade ? "text-bad" : "text-data",
    rows: [
      {
        key: t("From lowest to highest"),
        value: `${formatScore(assignment.low, locale)} – ${formatScore(assignment.high, locale)}`,
      },
    ],
    listTitle: t("Grades"),
    list,
  };
}

/** Dots joined by a line: attendance per class or average per assignment. */
function DotPlot({ metric, selected, onSelect, threshold, size = "mini", labels = false }) {
  const { t, locale } = useI18n();
  const scale = metric.metric === "attendance" ? 100 : 10;
  const points = metric.points;
  const count = points.length;
  const x = (index) => (count === 1 ? 50 : 4 + (index * 92) / (count - 1));
  const y = (point) => (point.kind === "reg" ? Math.max(0, Math.min(100, point.value * scale)) : 0);
  const registered = points.map((point, index) => ({ point, index })).filter(({ point }) => point.kind === "reg");
  const line = registered.map(({ point, index }) => `${x(index).toFixed(2)},${(100 - y(point)).toFixed(2)}`).join(" ");
  const area = registered.length
    ? `${x(registered[0].index).toFixed(2)},100 ${line} ${x(registered.at(-1).index).toFixed(2)},100`
    : "";
  const limit = metric.metric === "attendance" ? threshold.attendance * 100 : threshold.grade * 10;
  // Dense charts label every few points so the dates never overlap.
  const labelStep = Math.max(1, Math.ceil(count / 8));
  return (
    <>
      <span className="thr" style={{ bottom: `${limit}%` }}>
        {size === "big" ? (
          <b>
            {metric.metric === "attendance"
              ? t("Low attendance · {value}%", { value: percentText(threshold.attendance, locale) })
              : t("Low grade · {value}", { value: formatScore(threshold.grade, locale) })}
          </b>
        ) : null}
      </span>
      <svg className="ln" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {area ? <polygon points={area} /> : null}
        {line ? <polyline points={line} /> : null}
      </svg>
      {metric.metric === "grade" && size === "big"
        ? points.map((point, index) =>
            point.assignment && point.assignment.high > point.assignment.low ? (
              <span
                key={`range-${point.key}`}
                className="rg"
                style={{
                  left: `${x(index)}%`,
                  bottom: `${point.assignment.low * 10}%`,
                  height: `${(point.assignment.high - point.assignment.low) * 10}%`,
                }}
              />
            ) : null,
          )
        : null}
      {points.map((point, index) => {
        const low = point.kind === "reg" && point.value * scale < limit;
        const value =
          point.kind === "reg"
            ? metric.metric === "attendance"
              ? `${percentText(point.value, locale)}%`
              : formatScore(point.value, locale)
            : point.kind === "fut"
              ? t("upcoming")
              : t("not recorded");
        const tip = `${point.month ? capitalize(monthLong(point.date, locale)) : `${formatShortDate(point.date, locale)}${point.title ? ` · ${point.title}` : point.assignment ? ` · ${point.assignment.assessment}` : ""}`}: ${value}`;
        return (
          <button
            type="button"
            key={point.key}
            className={`dt ${point.kind !== "reg" ? point.kind : ""} ${low ? "low" : ""} ${index === selected ? "on" : ""}`
              .replace(/\s+/g, " ")
              .trim()}
            style={{ left: `${x(index)}%`, bottom: `${y(point)}%`, animationDelay: `${0.15 + index * 0.05}s` }}
            aria-label={tip}
            aria-pressed={index === selected}
            onClick={() => onSelect(index)}
          >
            <span className="tip">{tip}</span>
          </button>
        );
      })}
      {labels
        ? points.map((point, index) => (
            <span
              key={`label-${point.key}`}
              className={`xl2 ${index === selected ? "on" : ""}`}
              style={{ left: `${x(index)}%` }}
            >
              {(index > 0 && points[index - 1].date === point.date && !point.month) ||
              (index % labelStep !== 0 && index !== points.length - 1 && index !== selected)
                ? ""
                : pointLabel(point, metric.period, locale)}
            </span>
          ))
        : null}
    </>
  );
}

/** Top of the collections scale, shared by the bars, the accumulated line and the grid labels. */
export function collectionsMax(points, view, projection) {
  if (view === "cumulative") {
    const sums = cumulative(points);
    const lastReal = points.reduce((found, point, index) => (!point.future ? index : found), 0);
    return Math.max(sums[lastReal] || 0, projection, 1) * 1.08;
  }
  return Math.max(...points.map((point) => point.value), 1) * 1.08;
}

export function compactMoney(value, locale) {
  if (value >= 1000)
    return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 10_000 ? 0 : 1 }).format(value / 1000)}k`;
  return formatMoney(Math.round(value), locale);
}

function cumulative(points) {
  let running = 0;
  return points.map((point) => (running += point.future ? 0 : point.value));
}

/** Collections by payment date: bars, or the accumulated line with the projection pace. */
function BarPlot({ metric, selected, onSelect, size = "mini", view = "rhythm", projection = 0, mineFor = null }) {
  const { t, locale } = useI18n();
  const points = metric.points;
  const values = points.map((point) => point.value);
  if (view === "cumulative") {
    const sums = cumulative(points);
    const lastReal = points.reduce((found, point, index) => (!point.future ? index : found), 0);
    const max = collectionsMax(points, view, projection);
    const x = (index) => (points.length === 1 ? 50 : 4 + (index * 92) / (points.length - 1));
    const line = sums
      .slice(0, lastReal + 1)
      .map((value, index) => `${x(index).toFixed(2)},${(100 - (value / max) * 100).toFixed(2)}`)
      .join(" ");
    const pace = projection
      ? points
          .map(
            (_, index) =>
              `${x(index).toFixed(2)},${(100 - ((projection * (index + 1)) / points.length / max) * 100).toFixed(2)}`,
          )
          .join(" ")
      : "";
    return (
      <>
        <svg className="ln" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={`${x(0).toFixed(2)},100 ${line} ${x(lastReal).toFixed(2)},100`} />
          {pace ? <polyline className="pj" points={pace} /> : null}
          <polyline points={line} />
        </svg>
        {points.map((point, index) => {
          const tip = `${bucketTitle(point, t, locale)}: ${point.future ? t("upcoming") : t("{amount} accumulated", { amount: formatMoney(sums[index], locale) })}`;
          return (
            <button
              type="button"
              key={point.key}
              className={`dt ${point.future ? "fut" : ""} ${index === selected ? "on" : ""}`.trim()}
              style={{ left: `${x(index)}%`, bottom: `${point.future ? 0 : (sums[index] / max) * 100}%` }}
              aria-label={tip}
              aria-pressed={index === selected}
              disabled={point.future}
              onClick={() => onSelect(index)}
            >
              <span className="tip">{tip}</span>
            </button>
          );
        })}
        {size === "big"
          ? points.map((point, index) => (
              <span
                key={`label-${point.key}`}
                className={`xl2 ${index === selected ? "on" : ""}`}
                style={{ left: `${x(index)}%` }}
              >
                {bucketLabel(point, locale)}
              </span>
            ))
          : null}
      </>
    );
  }
  const max = collectionsMax(points, view, projection);
  const peak = Math.max(...values);
  return (
    <div className={size === "big" ? "bars" : "mbars"}>
      {points.map((point, index) => {
        const tip = `${bucketTitle(point, t, locale)}: ${point.future ? t("upcoming") : formatMoney(point.value, locale)}`;
        const height = point.future ? 10 : (point.value / max) * 100;
        return (
          <button
            type="button"
            key={point.key}
            className={`${size === "big" ? "bar" : "mb"} ${point.future ? "fut" : index === selected ? "on" : selected >= 0 ? "dim" : ""}`}
            aria-label={tip}
            aria-pressed={index === selected}
            disabled={point.future}
            onClick={() => onSelect(index)}
          >
            {size === "big" ? (
              <span className="col">
                <i
                  className={point.future ? "ph" : ""}
                  style={{ height: `${height}%`, animationDelay: `${0.15 + index * 0.05}s` }}
                >
                  {mineFor && !point.future && mineFor(point) > 0 ? (
                    <i className="mine" style={{ height: `${(mineFor(point) / (point.value || 1)) * 100}%` }} />
                  ) : null}
                </i>
              </span>
            ) : (
              <i style={{ height: `${height}%`, animationDelay: `${0.15 + index * 0.05}s` }}>
                {!point.future && point.value > 0 && point.value === peak ? <span className="pk" /> : null}
              </i>
            )}
            {size === "big" ? <span className="xl">{bucketLabel(point, locale)}</span> : null}
            <span className="tip">{tip}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Plot({ metric, selected, onSelect, threshold, size, view = "rhythm", projection = 0, mineFor = null }) {
  return metric.metric === "collections" ? (
    <BarPlot
      metric={metric}
      selected={selected}
      onSelect={onSelect}
      size={size}
      view={view}
      projection={projection}
      mineFor={mineFor}
    />
  ) : (
    <DotPlot
      metric={metric}
      selected={selected}
      onSelect={onSelect}
      threshold={threshold}
      size={size}
      labels={size === "big"}
    />
  );
}

function plotCaptions(metric, locale) {
  const points = metric.points;
  if (!points.length) return ["", ""];
  if (metric.metric === "collections") return [bucketLabel(points[0], locale), bucketLabel(points.at(-1), locale)];
  const first = points[0];
  const last = points.at(-1);
  const label = (point) => (point.month ? monthShort(point.date, locale) : formatShortDate(point.date, locale));
  return [label(first), label(last)];
}

export function MetricCard({ metric, summary, context, onOpen }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(null);
  return (
    <article
      className={`mini hibi-chart k-${metric.metric}`}
      aria-label={`${summary.name}: ${summary.value}${summary.unit}`}
    >
      <div className="nm">
        <span>{summary.name}</span>
        <button
          type="button"
          className="xbtn"
          onClick={onOpen}
          aria-label={t("View {name} detail", { name: summary.name })}
        >
          {t("View detail")}
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <div className="hl">
        <span className="big">
          {summary.value}
          <small>{summary.unit}</small>
        </span>
        {/* An empty card keeps a real comparison («↓ 100% vs. 12–14 oct») but not «Sin datos». */}
        {summary.empty && metric.delta === null ? null : (
          <span className={`dl ${summary.deltaTone}`}>{summary.delta}</span>
        )}
      </div>
      {summary.empty ? (
        <p className="mempty">{summary.empty}</p>
      ) : (
        <MetricCardBody
          metric={metric}
          summary={summary}
          context={context}
          onOpen={onOpen}
          selected={selected}
          onSelect={setSelected}
        />
      )}
    </article>
  );
}

function MetricCardBody({ metric, summary, context, onOpen, selected, onSelect }) {
  const { t, locale } = useI18n();
  const index = selected === null || selected >= metric.points.length ? defaultPointIndex(metric) : selected;
  const detail = pointDetail(metric, index, context);
  const [left, right] = plotCaptions(metric, locale);
  const chips = detail.list.slice(0, 3);
  return (
    <>
      <span className="cnt">{summary.count}</span>
      <div className="mplot">
        {metric.points.length ? (
          <Plot metric={metric} selected={index} onSelect={onSelect} threshold={context.threshold} size="mini" />
        ) : null}
      </div>
      <div className="mcap">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <div className="mdet" aria-live="polite">
        <div className="mdh">
          <span className="overline">{detail.title}</span>
          <b className={detail.tone}>{detail.big}</b>
        </div>
        <span className="mds">
          {detail.rows[0] ? `${detail.rows[0].key}: ${detail.rows[0].value} · ` : ""}
          {detail.sub}
        </span>
        <div className="mchips">
          {chips.map((item) => (
            <span className="mchip" key={item.id}>
              <i style={{ background: item.color }} />
              {firstName(item.name)}
              {item.value ? <b>{item.value}</b> : null}
            </span>
          ))}
          {detail.list.length > 3 ? (
            <button type="button" className="mmore" onClick={onOpen}>
              {t("+{count} more", { count: detail.list.length - 3 })}
            </button>
          ) : null}
          {!detail.list.length && detail.emptyMessage ? (
            <span className={`mmsg ${detail.emptyTone || "muted"}`}>{detail.emptyMessage}</span>
          ) : null}
        </div>
      </div>
      <div className="ins">
        <i style={{ background: summary.insightColor }} />
        <span>{summary.insight}</span>
      </div>
    </>
  );
}

function DetailAside({ detail, onAction }) {
  return (
    <aside className="det" aria-live="polite">
      <span className="overline">{detail.title}</span>
      <span className="big">{detail.big}</span>
      <span className={`det-sub ${detail.tone}`}>{detail.sub}</span>
      {detail.rows.length ? (
        <div>
          {detail.rows.map((row) => (
            <div className="kv" key={row.key}>
              <span className="muted">{row.key}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      ) : null}
      {detail.listTitle ? (
        <div>
          <span className="overline det-list-title">{detail.listTitle}</span>
          {detail.list.map((item) => (
            <div className="who" key={item.id}>
              <i style={{ background: item.color }} />
              <span className="wn">
                {item.name}
                {item.sub ? <small>{item.sub}</small> : null}
              </span>
              {item.bar !== undefined ? (
                <span className="wb">
                  <i style={{ width: `${item.bar}%`, background: item.color }} />
                </span>
              ) : null}
              {item.value ? <em>{item.value}</em> : null}
            </div>
          ))}
          {!detail.list.length && detail.emptyMessage ? (
            <p className={`det-empty ${detail.emptyTone || "muted"}`}>{detail.emptyMessage}</p>
          ) : null}
        </div>
      ) : null}
      {detail.extra?.list.length ? (
        <div>
          <span className="overline det-list-title">{detail.extra.title}</span>
          {detail.extra.list.map((item) => (
            <div className="who" key={item.id}>
              <i style={{ background: item.color }} />
              <span className="wn">
                {item.name}
                {item.sub ? <small>{item.sub}</small> : null}
              </span>
              {item.value ? <em>{item.value}</em> : null}
            </div>
          ))}
        </div>
      ) : null}
      {detail.action ? (
        <button type="button" className="link-button" onClick={() => onAction(detail.action)}>
          {detail.action.label}
        </button>
      ) : null}
    </aside>
  );
}

function AttendanceSquares({ sequence, t }) {
  return (
    <div className="dots" role="cell">
      {sequence.map((code, index) => (
        <span
          key={index}
          className={code === "A" ? "is-absent" : "is-present"}
          aria-label={t(code === "A" ? "Absent" : "Present")}
        >
          {code}
        </span>
      ))}
    </div>
  );
}

function StudentTable({ metric, rows, context }) {
  const { t, locale } = useI18n();
  const { threshold } = context;
  const sorted = [...rows].sort((left, right) => {
    if (metric === "attendance") return (left.attendance ?? 2) - (right.attendance ?? 2);
    if (metric === "grade")
      return right.ungraded.length - left.ungraded.length || (left.average ?? 11) - (right.average ?? 11);
    return right.owed - left.owed;
  });
  const title = t(
    metric === "attendance"
      ? "Students · lowest attendance first"
      : metric === "grade"
        ? "Students · what needs attention first"
        : "Students · what is owed first",
  );
  const headers =
    metric === "attendance"
      ? ["Student", "Attendance", "Missed classes", "Latest classes", "Status"]
      : metric === "grade"
        ? ["Student", "Average", "Assignments", "Ungraded", "Status"]
        : ["Student", "Paid in the period", "Owed", "Next class", "Status"];
  return (
    <div className="xp-table">
      <h3 className="overline">{title}</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
        <div className="tb" role="table" aria-label={title}>
          <div className="tr th" role="row">
            {headers.map((header) => (
              <span role="columnheader" key={header}>
                {t(header)}
              </span>
            ))}
          </div>
          {sorted.map((row) => {
            let status = { tone: "st-ok", text: t("Good") };
            if (metric === "attendance" && row.attendance !== null && row.attendance < threshold.attendance)
              status = { tone: "st-venc", text: t("Low attendance") };
            if (metric === "grade") {
              if (row.grades.some((value) => value < threshold.grade))
                status = { tone: "st-venc", text: t("Low grade") };
              else if (row.ungraded.length) status = { tone: "st-pend", text: t("Needs a grade") };
            }
            if (metric === "collections")
              status = row.owed
                ? row.overdue
                  ? { tone: "st-venc", text: t("Overdue") }
                  : { tone: "st-pend", text: t("Pending") }
                : { tone: "st-ok", text: t("Up to date") };
            const groups = (row.student.groupNames || []).join(" · ");
            return (
              <div className="tr" role="row" key={row.student.id}>
                <div className="person" role="cell">
                  <StudentAvatar avatarId={row.student.avatarId} name={row.student.fullName} size="small" decorative />
                  <div>
                    <strong>{row.student.fullName}</strong>
                    {groups ? <small>{groups}</small> : null}
                  </div>
                </div>
                {metric === "attendance" ? (
                  <>
                    <div className="hb" role="cell">
                      <span>
                        <i
                          style={{
                            width: `${(row.attendance ?? 0) * 100}%`,
                            background: row.attendance !== null && row.attendance < threshold.attendance ? RED : JADE,
                          }}
                        />
                      </span>
                      <b className="tnum">
                        {row.attendance === null ? "—" : `${percentText(row.attendance, locale)}%`}
                      </b>
                    </div>
                    <span className="tnum" role="cell">
                      {row.absences}
                    </span>
                    <AttendanceSquares sequence={row.sequence} t={t} />
                  </>
                ) : null}
                {metric === "grade" ? (
                  <>
                    <b
                      className={`tnum ${row.average !== null && row.average < threshold.grade ? "text-bad" : ""}`}
                      role="cell"
                    >
                      {formatScore(row.average, locale)}
                    </b>
                    <div
                      className="gb"
                      role="cell"
                      aria-label={
                        row.grades.map((value) => formatScore(value, locale)).join(", ") || t("No graded assignments")
                      }
                    >
                      {row.grades.map((value, index) => (
                        <i
                          key={index}
                          style={{ height: `${value * 10}%`, background: value < threshold.grade ? RED : INDIGO }}
                        />
                      ))}
                    </div>
                    <span role="cell">{row.ungraded.join(", ") || "—"}</span>
                  </>
                ) : null}
                {metric === "collections" ? (
                  <>
                    <span className="tnum" role="cell">
                      {formatMoney(row.paid, locale)}
                    </span>
                    <b className="tnum" role="cell">
                      {row.owed ? formatMoney(row.owed, locale) : "—"}
                    </b>
                    <span role="cell">
                      {row.nextClass
                        ? `${formatShortDate(row.nextClass.date, locale)} · ${formatTime(row.nextClass.startTime, locale)}`
                        : "—"}
                    </span>
                  </>
                ) : null}
                <span role="cell">
                  <span className={`st ${status.tone}`}>{status.text}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** «Ver detalle»: one metric at a time with its group scope, a large chart, the selected point and the students. */
// Opening the explorer replaces the card that held focus, so the chosen tab takes it.
function focusOnMount(element) {
  element?.focus({ preventScroll: true });
}

export function MetricExplorer({
  open,
  onChange,
  onClose,
  period,
  metrics,
  summaries,
  buildForGroup,
  groups,
  state,
  derived,
  asOf,
  context,
  onAction,
  initialAside = "point",
}) {
  const { t, locale } = useI18n();
  const [group, setGroup] = useState("all");
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("rhythm");
  // «Ver en la gráfica» from an overdue alert opens straight on the debts, the figure the alert quotes.
  const [aside, setAside] = useState(initialAside);
  const scoped = useMemo(() => (group === "all" ? metrics : buildForGroup(group)), [buildForGroup, group, metrics]);
  const metric = scoped[open];
  const summary = group === "all" ? summaries[open] : metricSummary(metric, { ...context, period });
  const index = selected === null || selected >= metric.points.length ? defaultPointIndex(metric) : selected;
  const rows = useMemo(() => {
    const derivedStudents = new Map((derived?.students || []).map((student) => [student.id, student]));
    return studentPeriodRows(state, derived, asOf, period, group).map((row) => ({
      ...row,
      student: derivedStudents.get(row.student.id) || row.student,
    }));
  }, [asOf, derived, group, period, state]);
  const derivedRows = useMemo(() => derived?.classLog || [], [derived]);
  const projection = useMemo(() => monthProjection(state, derivedRows, asOf), [asOf, derivedRows, state]);
  const debts = useMemo(() => debtSummary(state, derivedRows, asOf, group), [asOf, derivedRows, group, state]);
  const { owed, overdue } = debts;
  const reasonsText = (item) =>
    item.reasons
      .map((reason) =>
        reason.kind === "monthly"
          ? t("{month} monthly fee", { month: monthLong(`${reason.period}-01`, locale) })
          : t("class on {date}", { date: formatShortDate(reason.date, locale, { weekday: false }) }),
      )
      .slice(0, 3)
      .join(" · ");
  const pace = period === "monthly" && group === "all" ? projection.projected : 0;
  let detail = pointDetail(metric, index, context);
  if (open === "collections" && aside === "debts") {
    // Everything active students owe, with the overdue part split by month; inactive students apart.
    detail = {
      title: t("To collect"),
      big: formatMoney(owed, locale),
      sub: overdue ? t("{amount} overdue", { amount: formatMoney(overdue, locale) }) : t("Nothing overdue"),
      tone: overdue ? "text-bad" : "text-ok",
      rows: [
        {
          key: t("Overdue from {month}", { month: monthLong(`${debts.period}-01`, locale) }),
          value: formatMoney(debts.overdueThisMonth, locale),
        },
        { key: t("Overdue from earlier months"), value: formatMoney(debts.overdueEarlier, locale) },
        { key: t("Not due yet"), value: formatMoney(debts.notDue, locale) },
      ],
      listTitle: t("Who owes"),
      list: debts.debts.map((item) => ({
        id: item.studentId,
        name: context.nameOf(item.studentId),
        // «$900 vencidos · …» next to «$1,125»: the total matches Clases and Seguimiento.
        sub: [
          item.overdue > 0 && item.overdue < item.amount
            ? t("{amount} overdue", { amount: formatMoney(item.overdue, locale) })
            : "",
          reasonsText(item),
        ]
          .filter(Boolean)
          .join(" · "),
        value: formatMoney(item.amount, locale),
        color: item.overdue ? RED : OCRE,
      })),
      emptyMessage: t(debts.inactive.debts.length ? "No active student owes." : "Nobody owes. Everything collected!"),
      emptyTone: "text-ok",
      extra: {
        title: `${t("Classes owed by inactive students")} · ${formatMoney(debts.inactive.owed, locale)}`,
        list: debts.inactive.debts.map((item) => ({
          id: item.studentId,
          name: context.nameOf(item.studentId),
          sub: reasonsText(item),
          value: formatMoney(item.amount, locale),
          color: "var(--sumi-subtle)",
        })),
      },
    };
  } else if (open === "collections" && view === "cumulative") {
    const sums = cumulative(metric.points);
    const point = metric.points[index];
    const expected = pace ? (pace * (index + 1)) / metric.points.length : 0;
    const difference = (sums[index] || 0) - expected;
    detail = {
      title: t("Accumulated · {when}", { when: point ? bucketTitle(point, t, locale) : "" }),
      big: formatMoney(sums[index] || 0, locale),
      sub: pace
        ? difference >= 0
          ? t("{amount} ahead of pace", { amount: formatMoney(difference, locale) })
          : t("{amount} behind pace", { amount: formatMoney(-difference, locale) })
        : t("Accumulated in the period"),
      tone: pace ? (difference >= 0 ? "text-ok" : "text-bad") : "",
      rows: [
        { key: t("Collected in this stretch"), value: formatMoney(point?.value || 0, locale) },
        ...(pace
          ? [
              { key: t("Expected pace"), value: formatMoney(expected, locale) },
              { key: t("Projection for the period"), value: formatMoney(pace, locale) },
            ]
          : []),
      ],
      listTitle: "",
      list: [],
    };
  }
  const caption =
    open === "collections"
      ? t(view === "cumulative" ? "Accumulated collections" : "Collections by payment date")
      : open === "attendance"
        ? t(period === "yearly" ? "Attendance by month" : "Attendance by class")
        : t(period === "yearly" ? "Average by month" : "Average by assignment");
  const kpis =
    open === "collections"
      ? [
          {
            id: "rhythm",
            label: t("Collected this period"),
            value: formatMoney(metric.value, locale),
            note: summary.delta,
            noteTone: summary.deltaTone,
            on: view === "rhythm" && aside !== "debts",
            pick: () => {
              setView("rhythm");
              setAside("point");
              setSelected(null);
            },
          },
          {
            id: "projection",
            label: t("Month projection"),
            value: group === "all" ? formatMoney(projection.projected, locale) : "—",
            note:
              group === "all"
                ? t("{fees} in monthly fees · {classes} in upcoming classes", {
                    fees: formatMoney(projection.monthlyDue, locale),
                    classes: formatMoney(projection.perClass, locale),
                  })
                : t("Only with all groups"),
            bar: group === "all" && projection.projected ? (projection.collected / projection.projected) * 100 : null,
            on: view === "cumulative" && aside !== "debts",
            pick: () => {
              setView("cumulative");
              setAside("point");
              setSelected(null);
            },
          },
          {
            id: "debts",
            label: t("To collect"),
            value: formatMoney(owed, locale),
            note: `${t(debts.debts.length === 1 ? "{count} student" : "{count} students", { count: debts.debts.length })}${
              overdue ? ` · ${t("{amount} overdue", { amount: formatMoney(overdue, locale) })}` : ""
            }`,
            noteTone: overdue ? "text-bad" : "",
            on: aside === "debts",
            pick: () => setAside("debts"),
          },
        ]
      : [];
  return (
    <div className={`xp hibi-chart k-${open}`}>
      <div className="xp-head">
        <div className="sw" role="tablist" aria-label={t("Charts")}>
          {["attendance", "grade", "collections"].map((id) => (
            <button
              type="button"
              role="tab"
              key={id}
              ref={id === open ? focusOnMount : undefined}
              className={id === open ? "on" : ""}
              aria-selected={id === open}
              onClick={() => {
                onChange(id);
                setSelected(null);
                setAside("point");
              }}
            >
              <span>{summaries[id].name}</span>
              <b>
                {summaries[id].value}
                {summaries[id].unit}
              </b>
            </button>
          ))}
        </div>
        <IconButton label={t("Close detail and return to the three charts")} icon={X} onClick={onClose} />
      </div>
      <div className="frow">
        <div className="chip-row" role="group" aria-label={t("Filter by group")}>
          <span className="overline">{t("Group")}</span>
          {groups.map((item) => (
            <button
              type="button"
              key={item.value}
              className={`chip ${group === item.value ? "is-active" : ""}`}
              aria-pressed={group === item.value}
              onClick={() => {
                setGroup(item.value);
                setSelected(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {open === "collections" ? (
          <Segmented
            value={view}
            label={t("Collections view")}
            onChange={(value) => {
              setView(value);
              setSelected(null);
              setAside("point");
            }}
            items={[
              { value: "rhythm", label: "Pace" },
              { value: "cumulative", label: "Accumulated" },
            ]}
          />
        ) : null}
      </div>
      {kpis.length ? (
        <div className="xp-kpis">
          {kpis.map((kpi) => (
            <button
              type="button"
              key={kpi.id}
              className={`xp-kpi ${kpi.on ? "on" : ""}`}
              aria-pressed={kpi.on}
              onClick={kpi.pick}
            >
              <span>{kpi.label}</span>
              <b>{kpi.value}</b>
              <small className={kpi.noteTone || ""}>{kpi.note}</small>
              {kpi.bar !== null && kpi.bar !== undefined ? (
                <span className="pb">
                  <i style={{ width: `${Math.min(100, kpi.bar)}%` }} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="xg">
        <div>
          <p className="xp-caption">{caption}</p>
          <div className="bplot">
            {[0, 0.5, 1].map((fraction) => (
              <span className="grid" key={fraction} style={{ bottom: `${fraction * 100}%` }}>
                <b>
                  {open === "attendance"
                    ? `${fraction * 100}%`
                    : open === "grade"
                      ? String(fraction * 10)
                      : compactMoney(collectionsMax(metric.points, view, pace) * fraction, locale)}
                </b>
              </span>
            ))}
            {metric.points.length ? (
              <Plot
                metric={metric}
                selected={index}
                onSelect={(value) => {
                  setSelected(value);
                  setAside("point");
                }}
                threshold={context.threshold}
                size="big"
                view={view}
                projection={pace}
              />
            ) : (
              <p className="muted xp-empty">{t("No data in this period.")}</p>
            )}
          </div>
        </div>
        <DetailAside detail={detail} onAction={onAction} />
      </div>
      <StudentTable metric={open} rows={rows} context={context} />
    </div>
  );
}

/** Mobile: each metric as a row with a small chart; the detail rises in a sheet. */
export function MetricRows({ metrics, summaries, context, onOpenTracking, monthName }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState(null);
  const metric = open ? metrics[open] : null;
  const debts = useMemo(
    () => debtSummary(context.state, context.derivedRows, context.asOf),
    [context.asOf, context.derivedRows, context.state],
  );
  const sparkFor = (item) => {
    if (item.metric === "collections") {
      const values = item.points.filter((point) => !point.future).map((point) => point.value);
      const max = Math.max(...values, 1);
      return { bars: values.slice(-8).map((value) => ({ height: Math.max(6, (value / max) * 100), color: JADE })) };
    }
    const regs = item.points.filter((point) => point.kind === "reg");
    if (item.metric === "grade") {
      const values = regs.slice(-8).map((point) => point.value);
      if (values.length < 2) return { bars: values.map((value) => ({ height: value * 10, color: INDIGO })) };
      const line = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value * 10}`).join(" ");
      return { line };
    }
    return {
      bars: regs.slice(-9).map((point) => ({
        height: Math.max(6, point.value * 100),
        color: point.value < context.threshold.attendance ? RED : JADE,
      })),
    };
  };
  const secondary = (id) => {
    if (id === "grade") {
      const lowCount = (metrics.grade.assignments || []).reduce(
        (sum, item) => sum + item.grades.filter((grade) => grade.value < context.threshold.grade).length,
        0,
      );
      return {
        text: [
          lowCount ? t(lowCount === 1 ? "{count} low" : "{count} low (plural)", { count: lowCount }) : "",
          metrics.grade.ungraded ? t("{count} without a grade", { count: metrics.grade.ungraded }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        tone: "muted",
      };
    }
    if (id === "collections") {
      // This row sits under the month's heading, so it names the month the overdue money belongs to.
      if (debts.overdueThisMonth > 0)
        return {
          text: t("{amount} overdue from {month}", {
            amount: formatMoney(debts.overdueThisMonth, locale),
            month: monthLong(`${debts.period}-01`, locale),
          }),
          tone: "text-bad",
        };
      if (debts.overdueEarlier > 0)
        return {
          text: t("{amount} overdue from earlier months", { amount: formatMoney(debts.overdueEarlier, locale) }),
          tone: "text-bad",
        };
      return { text: summaries.collections.delta, tone: summaries.collections.deltaTone };
    }
    return { text: summaries[id].delta.replace(/^([↑↓]) /, "$1 "), tone: summaries[id].deltaTone };
  };
  const index = metric
    ? selected === null || selected >= metric.points.length
      ? defaultPointIndex(metric)
      : selected
    : -1;
  const sheetBars = metric
    ? metric.metric === "collections"
      ? metric.points.filter((point) => !point.future)
      : metric.points.filter((point) => point.kind === "reg")
    : [];
  const sheetIndex = metric ? sheetBars.indexOf(metric.points[index]) : -1;
  const max = metric?.metric === "collections" ? Math.max(...sheetBars.map((point) => point.value), 1) : 1;
  const detail = metric ? pointDetail(metric, index, context) : null;
  const rows = open ? context.rows : [];
  let list = [];
  let listTitle = "";
  let inactiveList = [];
  if (open === "attendance") {
    listTitle = t("Below {value}%", { value: percentText(context.threshold.attendance, locale) });
    list = rows
      .filter((row) => row.classes && row.attendance < context.threshold.attendance)
      .sort((left, right) => left.attendance - right.attendance)
      .map((row) => ({
        student: row.student,
        sub: t("Missed {missed} of {total}", { missed: row.absences, total: row.classes }),
        value: `${percentText(row.attendance, locale)}%`,
        tone: "text-bad",
      }));
  } else if (open === "grade") {
    listTitle = t("Need attention");
    list = rows
      .filter((row) => row.grades.some((value) => value < context.threshold.grade) || row.ungraded.length)
      .map((row) => ({
        student: row.student,
        sub: row.ungraded.length
          ? t("No grade in {assessment}", { assessment: row.ungraded[0] })
          : t("Lowest grade {value}", { value: formatScore(Math.min(...row.grades), locale) }),
        value: formatScore(row.average, locale),
        tone: row.average !== null && row.average < context.threshold.grade ? "text-bad" : "text-pend",
      }));
  } else if (open === "collections") {
    listTitle = t("Who owes");
    list = debts.debts.map((item) => ({
      student: context.studentOf(item.studentId),
      sub:
        item.overdue > 0
          ? item.overdue < item.amount
            ? t("{amount} overdue", { amount: formatMoney(item.overdue, locale) })
            : t("Overdue")
          : t("Pending"),
      value: formatMoney(item.amount, locale),
      tone: item.overdue ? "text-bad" : "text-pend",
    }));
    inactiveList = debts.inactive.debts.map((item) => ({
      student: context.studentOf(item.studentId),
      sub: t("Inactive student"),
      value: formatMoney(item.amount, locale),
      tone: "muted",
    }));
  }
  const subtitle = metric
    ? metric.metric === "attendance"
      ? t("{count} classes recorded · line at {value}%", {
          count: metric.registered,
          value: percentText(context.threshold.attendance, locale),
        })
      : metric.metric === "grade"
        ? t("{count} graded assignments · line at {value}", {
            count: metric.graded,
            value: formatScore(context.threshold.grade, locale),
          })
        : summaries.collections.count
    : "";
  return (
    <>
      {["attendance", "grade", "collections"].map((id) => {
        const summary = summaries[id];
        const spark = sparkFor(metrics[id]);
        const extra = secondary(id);
        return (
          <button
            type="button"
            className="mt"
            key={id}
            onClick={() => {
              setOpen(id);
              setSelected(null);
            }}
            aria-label={`${summary.name}: ${summary.value}${summary.unit}. ${extra.text}`}
          >
            <span>
              <span className="lb">
                {id === "grade" ? t("Grades") : id === "collections" ? t("Collected") : summary.name}
              </span>
              <span className="v">
                <b>
                  {summary.value}
                  {id === "attendance" ? summary.unit : ""}
                </b>
                <small className={extra.tone}>{extra.text}</small>
              </span>
            </span>
            <span className="spark" aria-hidden="true">
              {spark.line ? (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline points={spark.line} />
                </svg>
              ) : (
                spark.bars.map((bar, barIndex) => (
                  <i
                    key={barIndex}
                    style={{ height: `${bar.height}%`, background: bar.color, animationDelay: `${barIndex * 40}ms` }}
                  />
                ))
              )}
            </span>
            <ChevronRight className="chev" aria-hidden="true" />
          </button>
        );
      })}
      <BottomSheet
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open ? summaries[open].name : ""}
        kicker={monthName}
        description={subtitle}
        className="home-metric-sheet"
      >
        {metric ? (
          <div className="metric-sheet">
            <div className="metric-sheet-value">
              <span className="bnum">
                {summaries[open].value}
                {open === "attendance" ? summaries[open].unit : ""}
              </span>
              <span className={summaries[open].deltaTone}>{summaries[open].delta}</span>
            </div>
            {sheetBars.length ? (
              <div>
                <div className="ch" role="group" aria-label={t("{name} by point", { name: summaries[open].name })}>
                  {open !== "collections" ? (
                    <span
                      className="thr"
                      style={{
                        bottom: `${open === "attendance" ? context.threshold.attendance * 100 : context.threshold.grade * 10}%`,
                      }}
                    />
                  ) : null}
                  {sheetBars.map((point, barIndex) => {
                    const value =
                      open === "collections" ? point.value / max : open === "grade" ? point.value / 10 : point.value;
                    const low =
                      open === "attendance"
                        ? point.value < context.threshold.attendance
                        : open === "grade"
                          ? point.value < context.threshold.grade
                          : false;
                    const color = low ? RED : open === "grade" ? INDIGO : JADE;
                    const pointIndex = metric.points.indexOf(point);
                    return (
                      <button
                        type="button"
                        key={point.key}
                        className={`cb ${barIndex === sheetIndex ? "on" : "dim"}`}
                        aria-pressed={barIndex === sheetIndex}
                        aria-label={pointDetail(metric, pointIndex, context).title}
                        onClick={() => setSelected(pointIndex)}
                      >
                        <i
                          style={{
                            height: `${Math.max(4, value * 100)}%`,
                            background: color,
                            animationDelay: `${barIndex * 40}ms`,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="cx" aria-hidden="true">
                  {axisTickLabels(
                    sheetBars.map((point) =>
                      point.month || point.kind === "month"
                        ? monthShort(point.date || point.start, locale)
                        : dayNumber(point.date || point.start),
                    ),
                    8,
                  ).map((text, index) => (
                    <span key={sheetBars[index].key}>{text}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {detail && sheetIndex >= 0 ? (
              <div className="pick" aria-live="polite">
                <b>{detail.title}</b>
                <span>
                  {[detail.big, detail.sub, detail.rows[0] ? `${detail.rows[0].key}: ${detail.rows[0].value}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            ) : null}
            {open === "collections" ? (
              <div className="pick">
                <b>{t("To collect {amount}", { amount: formatMoney(debts.owed, locale) })}</b>
                <span className={debts.overdue > 0 ? "text-bad" : undefined}>{overdueLine(debts, t, locale)}</span>
              </div>
            ) : null}
            {list.length ? (
              <div>
                <span className="overline">{listTitle}</span>
                {list.map((item) => (
                  <div className="lr" key={item.student?.id}>
                    <StudentAvatar
                      avatarId={item.student?.avatarId}
                      name={item.student?.fullName}
                      size="small"
                      decorative
                    />
                    <span>
                      <strong>{item.student?.fullName}</strong>
                      <small>{item.sub}</small>
                    </span>
                    <b className={item.tone}>{item.value}</b>
                  </div>
                ))}
              </div>
            ) : null}
            {inactiveList.length ? (
              <div>
                <span className="overline">
                  {`${t("Classes owed by inactive students")} · ${formatMoney(debts.inactive.owed, locale)}`}
                </span>
                {inactiveList.map((item) => (
                  <div className="lr" key={item.student?.id}>
                    <StudentAvatar
                      avatarId={item.student?.avatarId}
                      name={item.student?.fullName}
                      size="small"
                      decorative
                    />
                    <span>
                      <strong>{item.student?.fullName}</strong>
                      <small>{item.sub}</small>
                    </span>
                    <b className={item.tone}>{item.value}</b>
                  </div>
                ))}
              </div>
            ) : null}
            <Button
              onClick={() => {
                setOpen(null);
                onOpenTracking(open);
              }}
            >
              {t("Open in Tracking")}
            </Button>
          </div>
        ) : null}
      </BottomSheet>
    </>
  );
}
