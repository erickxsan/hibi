import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/index.jsx";
import { Segmented, Select } from "../components/ui";
import { addDays } from "../domain/dates";
import {
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
import { CHART_VIEWS, PLOT_VIEWS, STUDENT_SPARK_GRADES, TREND_PROJECTION } from "./chartViewsModel";
import "../components/chartViews.css";

/*
 * The chart views that join the original dot and bar plots: each one drawn small for an Inicio card and
 * large for Inicio's detail and Seguimiento, plus what a selected mark says (title, figure, list) and the
 * one sentence a card closes with.
 */

const RED = "var(--bermellon)";
const OCRE = "var(--ocre)";
const JADE = "var(--jade)";
const INDIGO = "var(--indigo)";
const MUTED = "var(--sumi-subtle)";
/** A Monday, to name the weekday columns of a calendar. */
const MONDAY = "2026-01-05";

export const STAMP_COLORS = Object.freeze({
  bermellon: "var(--bermellon)",
  ocre: "var(--ocre)",
  jade: "var(--jade)",
  indigo: "var(--indigo)",
  kraft: "var(--sumi-subtle)",
});

const LABELS = Object.freeze({
  calendar: "Calendar",
  map: "Map",
  slots: "By time slot",
  trend: "Trend",
  assignments: "By assignment",
  scatter: "Absences and grades",
  histogram: "Histogram",
  boxes: "By group",
  students: "By student",
  submissions: "Submissions",
  pace: "Pace",
  upcoming: "Coming up",
  punctuality: "Punctuality",
  sources: "By group",
});

/** The selector's name for a view («Cierre del mes» only names a month). */
export function chartViewLabel(view, monthly) {
  if (view === "close") return monthly ? "Month close" : "Accumulated";
  return LABELS[view] || view;
}

export function isPlotView(view) {
  return PLOT_VIEWS.includes(view);
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function firstName(name) {
  return String(name || "").split(" ")[0];
}

function pct(ratio, locale) {
  return Number.isFinite(ratio) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ratio * 100) : "—";
}

function shortMoney(value, locale) {
  if (Math.abs(value) >= 1000)
    return `$${new Intl.NumberFormat(locale, { maximumFractionDigits: Math.abs(value) >= 10_000 ? 0 : 1 }).format(value / 1000)}k`;
  return formatMoney(Math.round(value), locale);
}

function daysText(days, t) {
  if (days === 0) return t("on the day");
  return `${days > 0 ? "+" : "−"}${t("{count} d", { count: Math.abs(days) })}`;
}

function attendanceTone(value, threshold) {
  if (value === null || value === undefined) return "";
  return value < threshold.attendance ? "text-bad" : "text-ok";
}

/* ---------- The view picker ---------- */

function useWideViewport(query = "(min-width: 1181px)") {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return wide;
}

/** The text segmented control that picks a metric's view; a menu where the options would not fit. */
export function ChartViewPicker({ metric, value, onChange, monthly = false, menu = false, className = "" }) {
  const { t } = useI18n();
  const wide = useWideViewport();
  const views = CHART_VIEWS[metric] || [];
  if (menu || !wide)
    return (
      <Select
        small
        className={`chart-view-select ${className}`.trim()}
        aria-label={t("Chart view")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {views.map((view) => (
          <option key={view} value={view}>
            {t(chartViewLabel(view, monthly))}
          </option>
        ))}
      </Select>
    );
  return (
    <Segmented
      className={`chart-view-picker ${className}`.trim()}
      value={value}
      onChange={onChange}
      label={t("Chart view")}
      items={views.map((view) => ({ value: view, label: chartViewLabel(view, monthly) }))}
    />
  );
}

/* ---------- Titles, captions and the closing sentence ---------- */

/** The heading of a view in the detail and in Seguimiento. */
export function chartViewTitle(view, context) {
  const { t } = context;
  const titles = {
    calendar: "Attendance day by day",
    map: "Each student's latest classes",
    slots: "Attendance by time slot",
    trend: "Trend of the last 12 weeks",
    scatter: "Attendance and grade of each student",
    histogram: "How many grades fall in each range",
    boxes: "Grades by group",
    students: "Each student's last grades",
    submissions: "Submissions of each assignment",
    close: context.monthly ? "Accumulated and probable close" : "Accumulated collections",
    upcoming: "Due in the next 14 days",
    punctuality: "Days before or after the due date",
    sources: "Where your money comes from",
  };
  return titles[view] ? t(titles[view]) : "";
}

export function chartViewEmpty(view, data) {
  if (!data) return false;
  switch (view) {
    case "calendar":
      return !data.cells.some((cell) => cell.sessions?.length || cell.total);
    case "map":
      return !data.rows.length;
    case "slots":
      return !data.slots.length;
    case "trend":
      return !data.weeks.some((week) => week.value !== null);
    case "scatter":
      return !data.points.length;
    case "histogram":
      return !data.bins.length;
    case "boxes":
      return !data.boxes.length;
    case "students":
      return !data.students.length;
    case "submissions":
      return !data.rows.length;
    case "close":
      return data.lastReal < 0;
    case "upcoming":
      return !(data.total > 0);
    case "punctuality":
      return !data.rows.length;
    case "sources":
      return !data.sources.length;
    default:
      return false;
  }
}

/** The two small captions under a card's chart. */
export function chartViewCaptions(view, data, context) {
  const { t, locale } = context;
  if (!data || chartViewEmpty(view, data)) return ["", ""];
  const short = (date) => formatShortDate(date, locale, { weekday: false });
  switch (view) {
    case "calendar":
      return data.layout === "days"
        ? [short(data.cells[0].date), short(data.cells.at(-1).date)]
        : [capitalize(monthShort(data.cells[0].date, locale)), capitalize(monthShort(data.cells.at(-1).date, locale))];
    case "map":
      return [t("Lowest attendance first"), t("Latest →")];
    case "slots":
      return [slotName(data.slots[0], locale), data.slots.length > 1 ? slotName(data.slots.at(-1), locale) : ""];
    case "trend":
      return [
        short(data.weeks[0].start),
        t("projection to {date}", { date: short(addDays(data.weeks.at(-1).start, 7 * TREND_PROJECTION + 6)) }),
      ];
    case "scatter":
      return [t("Less attendance"), t("More attendance")];
    case "histogram":
      return [String(data.from), "10"];
    case "boxes":
      return [t("Lowest median first"), ""];
    case "students":
      return [t("Going down first"), t("Last {count} grades", { count: STUDENT_SPARK_GRADES })];
    case "submissions":
      return [t("Newest first"), ""];
    case "close":
      return [closeLabel(data.series[0], 0, context), closeLabel(data.series.at(-1), data.series.length - 1, context)];
    case "upcoming":
      return [short(data.days[0].date), short(data.days.at(-1).date)];
    case "punctuality":
      return [t("Late, up"), t("Early, down")];
    case "sources":
      return [t("Your groups"), formatMoney(data.total, locale)];
    default:
      return ["", ""];
  }
}

function slotName(slot, locale) {
  return `${capitalize(weekdayShort(addDays(MONDAY, slot.weekday - 1), locale))} ${formatTime(slot.startTime, locale)}`;
}

/** The sentence a card closes with, and its color. */
export function chartViewInsight(view, data, context) {
  const { t, locale, threshold, names, nameOf, groupName } = context;
  const limit = pct(threshold.attendance, locale);
  const none = { text: t("No data in this period."), color: MUTED };
  if (!data || chartViewEmpty(view, data))
    return view === "upcoming" ? { text: t("Nothing due in the next 14 days"), color: MUTED } : none;
  switch (view) {
    case "calendar": {
      if (data.worst && data.worst.value < threshold.attendance)
        return {
          text: t("{weekday} is your weakest day ({value}%)", {
            weekday: weekdayLong(addDays(MONDAY, data.worst.index), locale),
            value: pct(data.worst.value, locale),
          }),
          color: RED,
        };
      const low = data.cells.filter((cell) => cell.total && cell.value < threshold.attendance).length;
      return low
        ? {
            text: t(low === 1 ? "{count} day below {value}%" : "{count} days below {value}%", {
              count: low,
              value: limit,
            }),
            color: RED,
          }
        : { text: t("Every day above {value}%", { value: limit }), color: JADE };
    }
    case "map": {
      const streaks = data.rows.filter((row) => row.trailing >= 2);
      if (streaks.length)
        return {
          text: t(
            streaks.length === 1
              ? "{names} missed several classes in a row"
              : "{names} missed several classes in a row (plural)",
            {
              names: names(streaks.map((row) => row.student.fullName)),
            },
          ),
          color: RED,
        };
      const low = data.rows.filter((row) => row.attendance < threshold.attendance);
      return low.length
        ? {
            text: t(low.length === 1 ? "{names} is below {value}%" : "{names} are below {value}%", {
              names: names(low.map((row) => row.student.fullName)),
              value: limit,
            }),
            color: RED,
          }
        : { text: t("Everyone above {value}%", { value: limit }), color: JADE };
    }
    case "slots": {
      const low = data.slots.filter((slot) => slot.average < threshold.attendance).length;
      return low
        ? {
            text: t(low === 1 ? "{count} time slot below {value}%" : "{count} time slots below {value}%", {
              count: low,
              value: limit,
            }),
            color: RED,
          }
        : { text: t("Every time slot above {value}%", { value: limit }), color: JADE };
    }
    case "trend": {
      if (!data.projection) return { text: t("A few more weeks are needed to see where it is heading"), color: MUTED };
      if (data.crossing)
        return {
          text:
            data.crossing === 1
              ? t("At this pace it drops below {value}% next week", { value: limit })
              : t("At this pace it drops below {value}% in {count} weeks", { value: limit, count: data.crossing }),
          color: RED,
        };
      if (data.below)
        return {
          text: t(data.below === 1 ? "Below {value}% this week" : "Below {value}% for {count} weeks", {
            value: limit,
            count: data.below,
          }),
          color: RED,
        };
      const change = Math.round(((data.current ?? 0) - (data.first ?? 0)) * 100);
      if (change <= -3) return { text: t("Down {value} pp in 12 weeks", { value: Math.abs(change) }), color: OCRE };
      if (change >= 3) return { text: t("Up {value} pp in 12 weeks", { value: change }), color: JADE };
      return { text: t("Steady over the last 12 weeks"), color: JADE };
    }
    case "scatter": {
      const risk = data.points.filter((point) => point.zone === "risk");
      if (risk.length)
        return {
          text: t(
            risk.length === 1
              ? "{names} misses classes and scores below {value}"
              : "{names} miss classes and score below {value}",
            {
              names: names(risk.map((point) => point.student.fullName)),
              value: formatScore(threshold.grade, locale),
            },
          ),
          color: RED,
        };
      return { text: t("Nobody misses classes and scores low at once"), color: INDIGO };
    }
    case "histogram": {
      if (data.low)
        return {
          text: t(data.low === 1 ? "{count} grade below {value}" : "{count} grades below {value}", {
            count: data.low,
            value: formatScore(threshold.grade, locale),
          }),
          color: RED,
        };
      const mode = data.bins.reduce((top, bin) => (bin.count > top.count ? bin : top));
      const low = Math.floor(mode.low);
      return {
        text: t("Most grades are between {low} and {high}", { low, high: Math.min(10, low + 1) }),
        color: INDIGO,
      };
    }
    case "boxes": {
      const lowest = data.boxes[0];
      return {
        text:
          data.boxes.length > 1
            ? t("{group} has the lowest median ({value})", {
                group: groupName(lowest.groupId),
                value: formatScore(lowest.median, locale),
              })
            : t("Median {value} in {group}", {
                group: groupName(lowest.groupId),
                value: formatScore(lowest.median, locale),
              }),
        color: lowest.median < threshold.grade ? RED : INDIGO,
      };
    }
    case "students": {
      const down = data.students.filter((item) => item.trend === "down");
      return down.length
        ? {
            text: t(down.length === 1 ? "{names} is going down" : "{names} are going down", {
              names: names(down.map((item) => item.student.fullName)),
            }),
            color: RED,
          }
        : { text: t("Nobody is going down"), color: INDIGO };
    }
    case "submissions": {
      const latest = data.rows[0];
      if (latest.missing)
        return {
          text: t(
            latest.missing === 1
              ? "{names} did not hand in {assessment}"
              : "{names} did not hand in {assessment} (plural)",
            {
              names: names(
                latest.cells.filter((cell) => cell.status === "missing").map((cell) => nameOf(cell.studentId)),
              ),
              assessment: latest.assessment,
            },
          ),
          color: RED,
        };
      if (data.ungraded)
        return {
          text: t(data.ungraded === 1 ? "{count} submission to grade" : "{count} submissions to grade", {
            count: data.ungraded,
          }),
          color: OCRE,
        };
      return { text: t("Everything graded"), color: INDIGO };
    }
    case "close": {
      if (data.projection)
        return {
          text: t("You will probably close at {amount}", { amount: formatMoney(data.projection.probable, locale) }),
          color: data.previousTotal !== null && data.projection.probable < data.previousTotal ? OCRE : JADE,
        };
      if (data.previous) {
        const difference = data.collected - (data.previous[data.lastReal] || 0);
        return {
          text:
            difference >= 0
              ? t("{amount} ahead of the previous period", { amount: formatMoney(difference, locale) })
              : t("{amount} behind the previous period", { amount: formatMoney(-difference, locale) }),
          color: difference >= 0 ? JADE : OCRE,
        };
      }
      return { text: t("{amount} accumulated", { amount: formatMoney(data.collected, locale) }), color: JADE };
    }
    case "upcoming": {
      const peak = data.days[data.peak];
      return {
        text: t("{share}% of what is expected comes in on {date}", {
          share: pct(peak.total / data.total, locale),
          date: formatShortDate(peak.date, locale),
        }),
        color: JADE,
      };
    }
    case "punctuality": {
      if (data.late.length)
        return {
          text: t(
            data.late.length === 1 ? "{names} pays about {count} days late" : "{names} pay about {count} days late",
            {
              names: names(data.late.map((row) => row.student.fullName)),
              count: Math.round(data.late.reduce((sum, row) => sum + row.average, 0) / data.late.length),
            },
          ),
          color: RED,
        };
      return {
        text: t("{count} of {total} pay on time or early", { count: data.onTime, total: data.rows.length }),
        color: JADE,
      };
    }
    case "sources": {
      if (data.best)
        return {
          text: t("{group} pays you the most per hour ({amount})", {
            group: groupName(data.best.groupId),
            amount: formatMoney(data.best.rate, locale),
          }),
          color: STAMP_COLORS[data.best.colorId],
        };
      const top = data.sources[0];
      return {
        text: t("{group} brings {share}% of your money", {
          group: groupName(top.groupId),
          share: pct(top.share, locale),
        }),
        color: STAMP_COLORS[top.colorId],
      };
    }
    default:
      return none;
  }
}

/* ---------- What a selected mark says ---------- */

const EMPTY_DETAIL = Object.freeze({
  key: "",
  title: "",
  big: "—",
  sub: "",
  tone: "",
  rows: [],
  listTitle: "",
  list: [],
  emptyMessage: "",
  studentIds: null,
});

/** The mark a view highlights before anything is picked: usually what needs attention. */
export function defaultChartKey(view, data) {
  if (!data || chartViewEmpty(view, data)) return "";
  switch (view) {
    case "calendar": {
      const measured = data.cells.filter((cell) => cell.total);
      if (!measured.length) return data.cells[0].key;
      return measured.reduce((low, cell) => (cell.value < low.value ? cell : low)).key;
    }
    case "map":
      return data.rows[0].key;
    case "slots":
      return data.slots[0].key;
    case "trend": {
      const last = data.weeks.reduce((found, week, index) => (week.value !== null ? index : found), -1);
      return last >= 0 ? data.weeks[last].key : "";
    }
    case "scatter":
      return (data.points.find((point) => point.zone === "risk") || data.points[0]).key;
    case "histogram": {
      const low = data.bins.find((bin) => bin.isLow && bin.count);
      return (low || data.bins.reduce((top, bin) => (bin.count > top.count ? bin : top))).key;
    }
    case "boxes":
      return data.boxes[0].key;
    case "students":
      return data.students[0].key;
    case "submissions":
      return (data.rows.find((row) => row.missing || row.ungraded) || data.rows[0]).key;
    case "close":
      return String(data.lastReal);
    case "upcoming":
      return data.peak >= 0 ? data.days[data.peak].key : "";
    case "punctuality":
      return data.rows[0].key;
    case "sources":
      return data.sources[0].key;
    default:
      return "";
  }
}

function studentList(ids, nameOf, color, sub = (_id, _count) => "") {
  const counts = new Map();
  ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  return [...counts.entries()].map(([id, count]) => ({ id, name: nameOf(id), color, sub: sub(id, count) }));
}

/** Title, figure, sub-line and list of the selected mark (or of the default one). */
export function chartViewDetail(view, data, selectedKey, context) {
  const { t, locale, threshold, nameOf, groupName } = context;
  if (!data || chartViewEmpty(view, data))
    return { ...EMPTY_DETAIL, title: t("No data"), emptyMessage: t("No data in this period.") };
  const key = selectedKey || defaultChartKey(view, data);
  const short = (date) => formatShortDate(date, locale);
  switch (view) {
    case "calendar": {
      const cell = data.cells.find((item) => item.key === key) || data.cells[0];
      const title = cell.layout === "month" ? capitalize(monthLong(cell.date, locale)) : capitalize(short(cell.date));
      const classes = cell.sessions?.length || 0;
      if (!cell.total)
        return {
          ...EMPTY_DETAIL,
          key: cell.key,
          title,
          big: cell.state === "unreg" ? t("Not recorded") : cell.state === "fut" ? t("Upcoming") : t("No classes"),
          tone: cell.state === "unreg" ? "text-pend" : "",
          sub: classes ? t(classes === 1 ? "{count} class" : "{count} classes", { count: classes }) : "",
        };
      return {
        ...EMPTY_DETAIL,
        key: cell.key,
        title,
        big: `${pct(cell.value, locale)}%`,
        tone: attendanceTone(cell.value, threshold),
        sub: [
          cell.layout === "day" ? t(classes === 1 ? "{count} class" : "{count} classes", { count: classes }) : "",
          t("{present} of {total}", { present: cell.present, total: cell.total }),
        ]
          .filter(Boolean)
          .join(" · "),
        listTitle: t("Missed"),
        list: studentList(cell.absentIds, nameOf, RED, (_, count) =>
          count > 1 ? t("{count} absences", { count }) : "",
        ),
        emptyMessage: t("Nobody missed. Perfect attendance!"),
        emptyTone: "text-ok",
        studentIds: [...new Set(cell.sessions.flatMap((session) => (session.rows || []).map((row) => row.studentId)))],
      };
    }
    case "map": {
      const row = data.rows.find((item) => item.key === key) || data.rows[0];
      return {
        ...EMPTY_DETAIL,
        key: row.key,
        title: row.student.fullName,
        big: `${pct(row.attendance, locale)}%`,
        tone: attendanceTone(row.attendance, threshold),
        sub: [
          t("Missed {missed} of {total}", { missed: row.absences, total: row.classes }),
          row.trailing >= 2 ? t("{count} in a row", { count: row.trailing }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        listTitle: t("Missed"),
        list: row.cells
          .filter((cell) => cell.code === "A")
          .reverse()
          .map((cell) => ({
            id: cell.key,
            name: capitalize(short(cell.date)),
            short: formatShortDate(cell.date, locale, { weekday: false }),
            sub: [groupName(cell.groupId), cell.startTime ? formatTime(cell.startTime, locale) : ""]
              .filter(Boolean)
              .join(" · "),
            color: RED,
          })),
        emptyMessage: t("Never missed in this period"),
        emptyTone: "text-ok",
        studentIds: [row.student.id],
      };
    }
    case "slots": {
      const slot = data.slots.find((item) => item.key === key) || data.slots[0];
      const first = slot.sessions[0];
      const last = slot.sessions.at(-1);
      return {
        ...EMPTY_DETAIL,
        key: slot.key,
        title: `${slotName(slot, locale)} · ${slot.title}`,
        big: `${pct(slot.average, locale)}%`,
        tone: attendanceTone(slot.average, threshold),
        sub: [
          t(slot.sessions.length === 1 ? "{count} class" : "{count} classes", { count: slot.sessions.length }),
          slot.sessions.length >= 2
            ? t("from {from}% to {to}%", { from: pct(first.value, locale), to: pct(last.value, locale) })
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        listTitle: t("Absences in this slot"),
        list: slot.absences.map((item) => ({
          id: item.studentId,
          name: nameOf(item.studentId),
          value: t(item.count === 1 ? "{count} absence" : "{count} absences", { count: item.count }),
          color: RED,
        })),
        emptyMessage: t("Nobody missed. Perfect attendance!"),
        emptyTone: "text-ok",
        studentIds: [...new Set(slot.absences.map((item) => item.studentId))],
      };
    }
    case "trend": {
      const week = data.weeks.find((item) => item.key === key) || data.weeks.at(-1);
      return {
        ...EMPTY_DETAIL,
        key: week.key,
        title: t("Week of {date}", { date: formatShortDate(week.start, locale, { weekday: false }) }),
        big: week.value === null ? "—" : `${pct(week.value, locale)}%`,
        tone: attendanceTone(week.value, threshold),
        sub: week.total
          ? t("{present} of {total}", { present: week.present, total: week.total })
          : t("No classes recorded"),
        rows: data.projection
          ? [
              {
                key: t("In {count} weeks", { count: TREND_PROJECTION }),
                value: `${pct(data.projection.center.at(-1), locale)}% (${pct(data.projection.low.at(-1), locale)}–${pct(data.projection.high.at(-1), locale)}%)`,
              },
            ]
          : [],
        listTitle: week.total ? t("Missed") : "",
        list: studentList(week.absentIds, nameOf, RED, (_, count) =>
          count > 1 ? t("{count} absences", { count }) : "",
        ),
        emptyMessage: t("Nobody missed. Perfect attendance!"),
        emptyTone: "text-ok",
      };
    }
    case "scatter": {
      const point = data.points.find((item) => item.key === key) || data.points[0];
      return {
        ...EMPTY_DETAIL,
        key: point.key,
        title: point.student.fullName,
        big: `${formatScore(point.average, locale)} /10`,
        tone: point.average < threshold.grade ? "text-bad" : "text-data",
        sub: t("{value}% attendance", { value: pct(point.attendance, locale) }),
        rows: [
          {
            key: t("Zone"),
            value: t(
              point.zone === "risk" ? "Needs attention" : point.zone === "watch" ? "Keep an eye on" : "Doing well",
            ),
          },
        ],
        studentIds: [point.student.id],
      };
    }
    case "histogram": {
      const bin = data.bins.find((item) => item.key === key) || data.bins[0];
      return {
        ...EMPTY_DETAIL,
        key: bin.key,
        title: t("From {low} to {high}", { low: formatScore(bin.low, locale), high: formatScore(bin.high, locale) }),
        big: String(bin.count),
        tone: bin.isLow && bin.count ? "text-bad" : "",
        sub: t(bin.count === 1 ? "{count} grade of {total}" : "{count} grades of {total}", {
          count: bin.count,
          total: data.grades.length,
        }),
        listTitle: bin.count ? t("Grades") : "",
        list: [...bin.items]
          .sort((left, right) => left.value - right.value)
          .map((item, index) => ({
            id: `${item.studentId}-${item.assessment}-${index}`,
            name: nameOf(item.studentId),
            sub: item.assessment,
            value: formatScore(item.value, locale),
            color: item.value < threshold.grade ? RED : INDIGO,
          })),
        studentIds: [...new Set(bin.items.map((item) => item.studentId))],
      };
    }
    case "boxes": {
      const box = data.boxes.find((item) => item.key === key) || data.boxes[0];
      return {
        ...EMPTY_DETAIL,
        key: box.key,
        title: groupName(box.groupId),
        big: formatScore(box.median, locale),
        tone: box.median < threshold.grade ? "text-bad" : "text-data",
        sub: `${t("Median")} · ${t(box.count === 1 ? "{count} grade" : "{count} grades", { count: box.count })}`,
        rows: [
          { key: t("Middle half"), value: `${formatScore(box.q1, locale)} – ${formatScore(box.q3, locale)}` },
          {
            key: t("From lowest to highest"),
            value: `${formatScore(box.min, locale)} – ${formatScore(box.max, locale)}`,
          },
        ],
        listTitle: t("Students · lowest average first"),
        list: box.students.map((item) => ({
          id: item.studentId,
          name: nameOf(item.studentId),
          value: formatScore(item.average, locale),
          color: item.average < threshold.grade ? RED : INDIGO,
        })),
        studentIds: box.students.map((item) => item.studentId),
      };
    }
    case "students": {
      const item = data.students.find((entry) => entry.key === key) || data.students[0];
      return {
        ...EMPTY_DETAIL,
        key: item.key,
        title: item.student.fullName,
        big: formatScore(item.last, locale),
        tone: item.last < threshold.grade ? "text-bad" : "text-data",
        sub:
          item.trend === "flat"
            ? t("Steady")
            : `${item.delta > 0 ? "↑" : "↓"} ${formatScore(Math.abs(item.delta), locale)} · ${t(item.trend === "down" ? "going down" : "going up")}`,
        listTitle: t("Last grades"),
        list: [...item.grades].reverse().map((grade, index) => ({
          id: `${item.key}-${index}`,
          name: grade.assessment,
          short: grade.assessment,
          sub: formatShortDate(grade.date, locale, { weekday: false }),
          value: formatScore(grade.value, locale),
          color: grade.value < threshold.grade ? RED : INDIGO,
        })),
        studentIds: [item.student.id],
      };
    }
    case "submissions": {
      const row = data.rows.find((item) => item.key === key) || data.rows[0];
      const counted = row.cells.length - row.excused;
      return {
        ...EMPTY_DETAIL,
        key: row.key,
        title: row.assessment,
        big: t("{count} of {total}", { count: row.graded, total: counted }),
        sub: [
          formatShortDate(row.date, locale, { weekday: false }),
          row.groupId ? groupName(row.groupId) : "",
          row.ungraded ? t("{count} without a grade", { count: row.ungraded }) : "",
          row.missing ? t("{count} not handed in", { count: row.missing }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
        tone: row.missing ? "text-bad" : row.ungraded ? "text-pend" : "text-data",
        listTitle: row.missing || row.ungraded ? t("Pending") : "",
        list: row.cells
          .filter((cell) => cell.status === "missing" || cell.status === "ungraded")
          .reverse()
          .map((cell) => ({
            id: cell.key,
            name: nameOf(cell.studentId),
            sub: t(cell.status === "missing" ? "Not handed in" : "No grade yet"),
            color: cell.status === "missing" ? RED : OCRE,
          })),
        emptyMessage: t("Everything graded"),
        emptyTone: "text-ok",
        studentIds: row.cells.map((cell) => cell.studentId),
      };
    }
    case "close": {
      const index = Math.max(0, Math.min(Number(key), data.lastReal));
      const point = data.series[index];
      const previous = data.previous?.[index];
      const daily = point?.kind === "day";
      const rows = [
        {
          key: t(daily ? "Collected that day" : "Collected in this stretch"),
          value: formatMoney(point?.value || 0, locale),
        },
      ];
      if (previous !== undefined && previous !== null)
        rows.push({ key: t("Previous period at this point"), value: formatMoney(previous, locale) });
      if (data.projection) {
        rows.push({ key: t("Probable close"), value: formatMoney(data.projection.probable, locale) });
        rows.push({
          key: t("Between"),
          value: `${formatMoney(data.projection.low, locale)} – ${formatMoney(data.projection.high, locale)}`,
        });
      }
      const difference = previous !== undefined && previous !== null ? data.sums[index] - previous : null;
      return {
        ...EMPTY_DETAIL,
        key: String(index),
        title: t("Accumulated · {when}", {
          when: !point ? "" : daily ? formatShortDate(point.start, locale) : context.bucketTitle(point),
        }),
        big: formatMoney(data.sums[index] || 0, locale),
        tone: difference === null ? "" : difference >= 0 ? "text-ok" : "text-bad",
        sub:
          difference === null
            ? t("Accumulated in the period")
            : difference >= 0
              ? t("{amount} ahead of the previous period", { amount: formatMoney(difference, locale) })
              : t("{amount} behind the previous period", { amount: formatMoney(-difference, locale) }),
        rows,
      };
    }
    case "upcoming": {
      const day = data.days.find((item) => item.key === key) || data.days[0];
      const monthlyCount = day.items.filter((item) => item.kind === "monthly").length;
      const classCount = day.items.length - monthlyCount;
      return {
        ...EMPTY_DETAIL,
        key: day.key,
        title: capitalize(formatShortDate(day.date, locale)),
        big: formatMoney(day.total, locale),
        sub:
          [
            monthlyCount
              ? t(monthlyCount === 1 ? "{count} monthly fee" : "{count} monthly fees", { count: monthlyCount })
              : "",
            classCount
              ? t(classCount === 1 ? "{count} class to collect" : "{count} classes to collect", { count: classCount })
              : "",
          ]
            .filter(Boolean)
            .join(" · ") || t("Nothing due"),
        listTitle: day.items.length ? t("Who pays") : "",
        list: [...day.items]
          .sort((left, right) => right.amount - left.amount)
          .map((item) => ({
            id: item.key,
            name: nameOf(item.studentId),
            sub:
              item.kind === "monthly"
                ? `${t("Monthly fee")} · ${groupName(item.groupId)}`
                : [groupName(item.groupId), item.startTime ? formatTime(item.startTime, locale) : ""]
                    .filter(Boolean)
                    .join(" · "),
            value: formatMoney(item.amount, locale),
            color: item.kind === "monthly" ? JADE : INDIGO,
          })),
        studentIds: [...new Set(day.items.map((item) => item.studentId))],
      };
    }
    case "punctuality": {
      const row = data.rows.find((item) => item.key === key) || data.rows[0];
      return {
        ...EMPTY_DETAIL,
        key: row.key,
        title: row.student.fullName,
        big: row.average === 0 ? t("On time") : daysText(row.average, t),
        tone: row.average > 7 ? "text-bad" : row.average > 0 ? "text-pend" : "text-ok",
        sub: t("Average of the last {count} payments", { count: row.payments.length }),
        listTitle: t("Payments"),
        list: row.payments.map((item) => ({
          id: item.key,
          name:
            item.kind === "monthly"
              ? t("{month} monthly fee", { month: monthLong(`${item.period}-01`, locale) })
              : t("Class on {date}", { date: formatShortDate(item.due, locale, { weekday: false }) }),
          short:
            item.kind === "monthly"
              ? capitalize(monthShort(`${item.period}-01`, locale))
              : formatShortDate(item.due, locale, { weekday: false }),
          sub: t("Paid on {date}", { date: formatShortDate(item.paid, locale, { weekday: false }) }),
          value: daysText(item.days, t),
          color: item.days > 7 ? RED : item.days > 0 ? OCRE : JADE,
        })),
        studentIds: [row.student.id],
      };
    }
    case "sources": {
      const source = data.sources.find((item) => item.key === key) || data.sources[0];
      const byStudent = new Map();
      source.payments.forEach((payment) =>
        byStudent.set(payment.studentId, (byStudent.get(payment.studentId) || 0) + payment.amount),
      );
      return {
        ...EMPTY_DETAIL,
        key: source.key,
        title: groupName(source.groupId),
        big: formatMoney(source.amount, locale),
        sub: t("{share}% of the period", { share: pct(source.share, locale) }),
        rows: [
          ...(source.rate !== null ? [{ key: t("Per hour"), value: formatMoney(source.rate, locale) }] : []),
          ...(source.hours
            ? [{ key: t("Hours taught"), value: new Intl.NumberFormat(locale).format(source.hours) }]
            : []),
        ],
        listTitle: t("Who paid"),
        list: [...byStudent.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([id, amount]) => ({
            id,
            name: nameOf(id),
            value: formatMoney(amount, locale),
            color: STAMP_COLORS[source.colorId],
          })),
        studentIds: [...byStudent.keys()],
      };
    }
    default:
      return EMPTY_DETAIL;
  }
}

/* ---------- Drawing ---------- */

function MarkTip({ text }) {
  return <span className="tip">{text}</span>;
}

function dayTone(cell, threshold) {
  if (!cell.total) return cell.state === "unreg" ? "is-unreg" : cell.state === "fut" ? "is-fut" : "is-none";
  if (cell.value < threshold.attendance) return "is-low";
  return cell.value >= 0.9 ? "is-high" : "is-mid";
}

function CalendarView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  const big = size === "big";
  const label = (cell) => {
    const when =
      cell.layout === "month"
        ? capitalize(monthLong(cell.date, locale))
        : capitalize(formatShortDate(cell.date, locale));
    if (cell.total) return `${when}: ${pct(cell.value, locale)}%`;
    if (cell.state === "unreg") return `${when}: ${t("not recorded")}`;
    if (cell.state === "fut") return `${when}: ${t("upcoming")}`;
    return `${when}: ${t("no classes")}`;
  };
  const button = (cell) => (
    <button
      type="button"
      key={cell.key}
      className={`cv-day ${dayTone(cell, threshold)} ${cell.today ? "is-today" : ""} ${cell.key === selected ? "on" : ""}`
        .replace(/\s+/g, " ")
        .trim()}
      aria-label={label(cell)}
      aria-pressed={cell.key === selected}
      onClick={() => onSelect(cell.key)}
    >
      {big ? (
        <>
          <small>{cell.layout === "month" ? capitalize(monthShort(cell.date, locale)) : dayNumber(cell.date)}</small>
          <b>{cell.total ? `${pct(cell.value, locale)}%` : cell.state === "unreg" ? "—" : ""}</b>
          {cell.total ? <i style={{ width: `${Math.max(4, cell.value * 100)}%` }} /> : null}
        </>
      ) : null}
    </button>
  );
  if (data.layout === "months")
    return (
      <div
        className={`cv-cal is-months ${big ? "is-big" : "is-mini"}`}
        role="group"
        aria-label={t("Attendance by month")}
      >
        {data.cells.map(button)}
      </div>
    );
  return (
    <div className={`cv-cal ${big ? "is-big" : "is-mini"}`} role="group" aria-label={t("Attendance day by day")}>
      {big ? (
        <div className="cv-week cv-heads" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <span key={index}>{weekdayShort(addDays(MONDAY, index), locale)}</span>
          ))}
        </div>
      ) : null}
      {data.weeks.map((week, weekIndex) => (
        <div className="cv-week" key={weekIndex}>
          {week.map((cell, index) =>
            cell ? button(cell) : <span className="cv-day is-blank" key={`blank-${index}`} />,
          )}
        </div>
      ))}
      {big && data.weekdays.length ? (
        <div className="cv-week cv-avgs" aria-label={t("Average of each weekday")}>
          {data.weekdays.map((day) => (
            <span
              key={day.index}
              className={day.value !== null && day.value < threshold.attendance ? "text-bad" : ""}
              aria-label={`${weekdayLong(addDays(MONDAY, day.index), locale)}: ${day.value === null ? "—" : `${pct(day.value, locale)}%`}`}
            >
              {day.value === null ? "—" : `${pct(day.value, locale)}%`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MapView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  const big = size === "big";
  const rows = data.rows.slice(0, big ? 12 : 3);
  return (
    <div className={`cv-map ${big ? "is-big" : "is-mini"}`}>
      {rows.map((row) => (
        <button
          type="button"
          key={row.key}
          className={`cv-map-row ${row.key === selected ? "on" : ""}`}
          aria-pressed={row.key === selected}
          aria-label={`${row.student.fullName}: ${pct(row.attendance, locale)}% · ${t("Missed {missed} of {total}", { missed: row.absences, total: row.classes })}`}
          onClick={() => onSelect(row.key)}
        >
          <span className="cv-map-name">{big ? row.student.fullName : firstName(row.student.fullName)}</span>
          <span className="cv-map-cells" aria-hidden="true">
            {row.cells.slice(big ? -12 : -8).map((cell) => (
              <i
                key={cell.key}
                className={`${cell.code === "A" ? "is-absent" : "is-present"} ${cell.streak ? "is-streak" : ""}`.trim()}
              >
                {big ? cell.code : null}
              </i>
            ))}
          </span>
          {big ? (
            <b
              className={`cv-map-pct ${row.attendance < threshold.attendance ? "text-bad" : ""}`}
            >{`${pct(row.attendance, locale)}%`}</b>
          ) : null}
        </button>
      ))}
      {big && data.rows.length > rows.length ? (
        <p className="cv-more">{t("{count} more students in the list", { count: data.rows.length - rows.length })}</p>
      ) : null}
    </div>
  );
}

function SlotsView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  if (size !== "big") {
    const slots = data.slots.slice(0, 8);
    return (
      <>
        <div className="mbars cv-slot-bars">
          {slots.map((slot) => (
            <button
              type="button"
              key={slot.key}
              className={`mb ${slot.key === selected ? "on" : selected ? "dim" : ""}`}
              aria-label={`${slotName(slot, locale)} · ${slot.title}: ${pct(slot.average, locale)}%`}
              aria-pressed={slot.key === selected}
              onClick={() => onSelect(slot.key)}
            >
              <i
                style={{
                  height: `${Math.max(4, slot.average * 100)}%`,
                  background: slot.average < threshold.attendance ? RED : JADE,
                }}
              />
              <MarkTip text={`${slotName(slot, locale)} · ${pct(slot.average, locale)}%`} />
            </button>
          ))}
        </div>
        <span className="thr" style={{ bottom: `${threshold.attendance * 100}%` }} />
      </>
    );
  }
  return (
    <div className="cv-slots">
      <div className="cv-slot cv-slot-head" aria-hidden="true">
        <span>{t("Time slot")}</span>
        <span>{t("Average attendance · the mark is {value}%", { value: pct(threshold.attendance, locale) })}</span>
        <span />
        <span>{t("Classes")}</span>
        <span>{t("Difference")}</span>
      </div>
      {data.slots.map((slot) => {
        const low = slot.average < threshold.attendance;
        const delta = slot.delta === null ? null : Math.round(slot.delta * 100);
        return (
          <button
            type="button"
            key={slot.key}
            className={`cv-slot ${slot.key === selected ? "on" : ""}`}
            aria-pressed={slot.key === selected}
            onClick={() => onSelect(slot.key)}
          >
            <span className="cv-slot-name">
              <strong>{slotName(slot, locale)}</strong>
              <small>{slot.title}</small>
            </span>
            <span className="cv-track" aria-hidden="true">
              <i style={{ width: `${slot.average * 100}%`, background: low ? RED : JADE }} />
              <u style={{ left: `${threshold.attendance * 100}%` }} />
            </span>
            <b className={low ? "text-bad" : ""}>{`${pct(slot.average, locale)}%`}</b>
            <span className="cv-sparkbars" aria-hidden="true">
              {slot.sessions.slice(-6).map((item) => (
                <i
                  key={item.key}
                  style={{
                    height: `${Math.max(12, item.value * 100)}%`,
                    background: item.value < threshold.attendance ? RED : JADE,
                  }}
                />
              ))}
            </span>
            <small className={delta === null ? "muted" : delta < -4 ? "text-bad" : delta > 4 ? "text-ok" : "muted"}>
              {delta === null ? "—" : delta === 0 ? "=" : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)} pp`}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function niceFloor(value, step) {
  return Math.floor(value / step) * step;
}

function TrendView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  const big = size === "big";
  const slots = data.weeks.length + (data.projection ? TREND_PROJECTION : 0);
  const x = (index) => 2 + (index * 96) / Math.max(1, slots - 1);
  const values = [
    ...data.weeks.map((week) => week.value),
    ...(data.projection?.low || []),
    threshold.attendance,
  ].filter((value) => value !== null && value !== undefined);
  const low = Math.max(0, Math.min(niceFloor(Math.min(...values) - 0.05, 0.1), 0.6));
  const y = (value) => ((value - low) / (1 - low)) * 100;
  const lastIndex = data.weeks.length - 1;
  const averagePoints = data.average
    .map((value, index) => (value === null ? null : `${x(index).toFixed(2)},${(100 - y(value)).toFixed(2)}`))
    .filter(Boolean);
  const area = averagePoints.length
    ? `${averagePoints[0].split(",")[0]},100 ${averagePoints.join(" ")} ${averagePoints.at(-1).split(",")[0]},100`
    : "";
  const from = data.projection ? `${x(lastIndex).toFixed(2)},${(100 - y(data.projection.from)).toFixed(2)}` : "";
  const center = data.projection
    ? [
        from,
        ...data.projection.center.map(
          (value, index) => `${x(lastIndex + index + 1).toFixed(2)},${(100 - y(value)).toFixed(2)}`,
        ),
      ].join(" ")
    : "";
  const cone = data.projection
    ? [
        from,
        ...data.projection.high.map(
          (value, index) => `${x(lastIndex + index + 1).toFixed(2)},${(100 - y(value)).toFixed(2)}`,
        ),
        ...[...data.projection.low]
          .reverse()
          .map(
            (value, index) => `${x(lastIndex + TREND_PROJECTION - index).toFixed(2)},${(100 - y(value)).toFixed(2)}`,
          ),
      ].join(" ")
    : "";
  const ticks = [low, (low + 1) / 2, 1];
  return (
    <>
      {big
        ? ticks.map((value) => (
            <span className="grid" key={value} style={{ bottom: `${y(value)}%` }}>
              <b>{`${pct(value, locale)}%`}</b>
            </span>
          ))
        : null}
      {data.projection && big ? (
        <span className="cv-zone" style={{ left: `${x(lastIndex)}%` }}>
          <b>{t("Projection")}</b>
        </span>
      ) : null}
      <span className="thr" style={{ bottom: `${y(threshold.attendance)}%` }}>
        {big ? <b>{t("Low attendance · {value}%", { value: pct(threshold.attendance, locale) })}</b> : null}
      </span>
      <svg className="ln cv-trend-ln" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {cone ? <polygon className="cv-cone" points={cone} /> : null}
        {area ? <polygon points={area} /> : null}
        {averagePoints.length ? <polyline points={averagePoints.join(" ")} /> : null}
        {center ? <polyline className="pj" points={center} /> : null}
      </svg>
      {big
        ? data.weeks.map((week, index) =>
            week.value === null ? null : (
              <button
                type="button"
                key={week.key}
                className={`dt cv-week-dot ${week.value < threshold.attendance ? "low" : ""} ${week.key === selected ? "on" : ""}`
                  .replace(/\s+/g, " ")
                  .trim()}
                style={{ left: `${x(index)}%`, bottom: `${y(week.value)}%` }}
                aria-label={`${t("Week of {date}", { date: formatShortDate(week.start, locale, { weekday: false }) })}: ${pct(week.value, locale)}%`}
                aria-pressed={week.key === selected}
                onClick={() => onSelect(week.key)}
              >
                <MarkTip
                  text={`${formatShortDate(week.start, locale, { weekday: false })}: ${pct(week.value, locale)}%`}
                />
              </button>
            ),
          )
        : null}
      {big
        ? [0, 4, 8, lastIndex].map((index) => (
            <span
              key={`x-${index}`}
              className={`xl2 ${index === lastIndex ? "on" : index ? "cv-xl-minor" : ""}`}
              style={{ left: `${x(index)}%`, transform: index === 0 ? "none" : undefined }}
            >
              {index === lastIndex
                ? t("this week")
                : formatShortDate(data.weeks[index].start, locale, { weekday: false })}
            </span>
          ))
        : null}
      {big && data.projection ? (
        <span className="xl2 cv-xl-end" style={{ left: `${x(slots - 1)}%` }}>
          {formatShortDate(addDays(data.weeks.at(-1).start, 7 * TREND_PROJECTION), locale, { weekday: false })}
        </span>
      ) : null}
    </>
  );
}

function ScatterView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  const big = size === "big";
  const xLow = Math.min(0.4, niceFloor(Math.min(...data.points.map((point) => point.attendance)), 0.1));
  const yLow = Math.min(5, Math.floor(Math.min(...data.points.map((point) => point.average))));
  const x = (value) => ((value - xLow) / (1 - xLow)) * 100;
  const y = (value) => ((value - yLow) / (10 - yLow)) * 100;
  const color = (zone) => (zone === "risk" ? RED : zone === "watch" ? OCRE : INDIGO);
  const labelled = data.points.filter((point) => point.zone !== "ok").slice(0, 6);
  return (
    <div className={`cv-scatter ${big ? "is-big" : "is-mini"}`}>
      {big ? <span className="cv-axis-y">{t("Grade")}</span> : null}
      <div className="cv-scatter-main">
        <div className="cv-scatter-box">
          <span className="cv-risk" style={{ width: `${x(threshold.attendance)}%`, height: `${y(threshold.grade)}%` }}>
            {big ? <b>{t("Needs attention")}</b> : null}
          </span>
          <span className="cv-rule is-v" style={{ left: `${x(threshold.attendance)}%` }} />
          <span className="cv-rule is-h" style={{ bottom: `${y(threshold.grade)}%` }} />
          {big ? (
            <>
              <span
                className="cv-rule-label is-v"
                style={{ left: `${x(threshold.attendance)}%` }}
              >{`${pct(threshold.attendance, locale)}%`}</span>
              <span className="cv-rule-label is-h" style={{ bottom: `${y(threshold.grade)}%` }}>
                {formatScore(threshold.grade, locale)}
              </span>
            </>
          ) : null}
          {data.points.map((point, index) => (
            <button
              type="button"
              key={point.key}
              className={`cv-point ${point.key === selected ? "on" : ""}`}
              style={{
                left: `${Math.min(98, Math.max(2, x(point.attendance)))}%`,
                bottom: `${Math.min(98, Math.max(2, y(point.average)))}%`,
                background: color(point.zone),
                marginLeft: big ? 0 : `${((index % 3) - 1) * 3}px`,
              }}
              aria-label={`${point.student.fullName}: ${pct(point.attendance, locale)}% · ${formatScore(point.average, locale)}`}
              aria-pressed={point.key === selected}
              onClick={() => onSelect(point.key)}
            >
              <MarkTip
                text={`${firstName(point.student.fullName)}: ${pct(point.attendance, locale)}% · ${formatScore(point.average, locale)}`}
              />
            </button>
          ))}
          {big
            ? labelled.map((point) => (
                <span
                  key={`label-${point.key}`}
                  className={`cv-point-label ${point.zone === "risk" ? "text-bad" : "text-pend"} ${x(point.attendance) > 80 ? "is-left" : ""}`.trim()}
                  style={{
                    left: `${Math.min(98, Math.max(2, x(point.attendance)))}%`,
                    bottom: `${Math.min(98, Math.max(2, y(point.average)))}%`,
                  }}
                  aria-hidden="true"
                >
                  {firstName(point.student.fullName)}
                </span>
              ))
            : null}
        </div>
        {big ? (
          <div className="cv-ticks" aria-hidden="true">
            <span style={{ left: 0 }}>{`${pct(xLow, locale)}%`}</span>
            <span style={{ left: "50%", transform: "translateX(-50%)" }}>{t("Attendance")}</span>
            <span style={{ right: 0 }}>100%</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HistogramView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  const big = size === "big";
  const max = Math.max(...data.bins.map((bin) => bin.count), 1);
  const at = (value) => ((value - data.from) / (10 - data.from)) * 100;
  const bars = data.bins.map((bin) => (
    <button
      type="button"
      key={bin.key}
      className={`${big ? "bar" : "mb"} ${bin.key === selected ? "on" : selected && big ? "dim" : ""}`.trim()}
      aria-label={`${formatScore(bin.low, locale)}–${formatScore(bin.high, locale)}: ${bin.count}`}
      aria-pressed={bin.key === selected}
      onClick={() => onSelect(bin.key)}
    >
      {big ? (
        <span className="col">
          <i style={{ height: `${(bin.count / max) * 88}%`, background: bin.isLow ? RED : INDIGO }} />
          {bin.count ? <em className="cv-count">{bin.count}</em> : null}
        </span>
      ) : (
        <i style={{ height: `${(bin.count / max) * 100}%`, background: bin.isLow ? RED : INDIGO }} />
      )}
      {big && Number.isInteger(bin.low) ? <span className="xl cv-xl-left">{bin.low}</span> : null}
      <MarkTip text={`${formatScore(bin.low, locale)}–${formatScore(bin.high, locale)}: ${bin.count}`} />
    </button>
  ));
  if (!big) return <div className="mbars cv-hist-mini">{bars}</div>;
  return (
    <>
      {[0, 0.5, 1].map((fraction) => (
        <span className="grid" key={fraction} style={{ bottom: `${fraction * 88}%` }}>
          <b>{fraction === 0 ? "0" : Math.round(max * fraction) === max * fraction ? String(max * fraction) : ""}</b>
        </span>
      ))}
      <div className="bars cv-hist">{bars}</div>
      <span className="xl cv-xl-end-10" aria-hidden="true">
        10
      </span>
      {[
        {
          value: threshold.grade,
          className: "is-min",
          text: t("minimum {value}", { value: formatScore(threshold.grade, locale) }),
        },
        data.mean !== null
          ? {
              value: data.mean,
              className: "is-mean",
              text: t("mean {value}", { value: formatScore(data.mean, locale) }),
            }
          : null,
        data.median !== null
          ? {
              value: data.median,
              className: "is-median",
              text: t("median {value}", { value: formatScore(data.median, locale) }),
            }
          : null,
      ]
        .filter(Boolean)
        .map((mark) => (
          <span key={mark.className} className={`cv-vmark ${mark.className}`} style={{ left: `${at(mark.value)}%` }}>
            <b>{mark.text}</b>
          </span>
        ))}
    </>
  );
}

function BoxesView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold, groupName } = context;
  const big = size === "big";
  const low = Math.min(
    4,
    Math.floor(Math.min(...data.boxes.map((box) => Math.min(box.min, ...box.outliers.map((item) => item.value))))),
  );
  const x = (value) => ((value - low) / (10 - low)) * 100;
  const boxes = big ? data.boxes : data.boxes.slice(0, 5);
  return (
    <div className={`cv-boxes ${big ? "is-big" : "is-mini"}`}>
      {big || boxes.length ? (
        <span className="cv-box-limit" style={{ left: `${x(threshold.grade)}%` }} aria-hidden="true" />
      ) : null}
      {boxes.map((box) => {
        const color = STAMP_COLORS[box.colorId];
        return (
          <button
            type="button"
            key={box.key}
            className={`cv-box ${box.key === selected ? "on" : selected && !big ? "dim" : ""}`.trim()}
            aria-pressed={box.key === selected}
            aria-label={`${groupName(box.groupId)}: ${t("median {value}", { value: formatScore(box.median, locale) })}`}
            onClick={() => onSelect(box.key)}
          >
            {big ? <span className="cv-box-name">{groupName(box.groupId)}</span> : null}
            <span className="cv-box-track" aria-hidden="true">
              <i className="cv-whisker" style={{ left: `${x(box.min)}%`, width: `${x(box.max) - x(box.min)}%` }} />
              <i className="cv-cap" style={{ left: `${x(box.min)}%` }} />
              <i className="cv-cap" style={{ left: `calc(${x(box.max)}% - 2px)` }} />
              <i
                className="cv-iqr"
                style={{ left: `${x(box.q1)}%`, width: `${Math.max(1, x(box.q3) - x(box.q1))}%`, borderColor: color }}
              >
                <span style={{ background: color }} />
              </i>
              <i className="cv-median" style={{ left: `${x(box.median)}%` }} />
              {box.outliers.map((item, index) => (
                <i key={`${item.studentId}-${index}`} className="cv-outlier" style={{ left: `${x(item.value)}%` }} />
              ))}
            </span>
            {big ? (
              <b className={box.median < threshold.grade ? "text-bad" : ""}>{formatScore(box.median, locale)}</b>
            ) : null}
          </button>
        );
      })}
      {big ? (
        <div className="cv-box cv-box-axis" aria-hidden="true">
          <span />
          <span className="cv-ticks">
            {Array.from({ length: 10 - low + 1 }, (_, index) => low + index)
              .filter((value) => (10 - low > 6 ? value % 2 === 0 : true))
              .map((value) => (
                <span
                  key={value}
                  style={{
                    left: `${x(value)}%`,
                    transform: value === low ? "none" : value === 10 ? "translateX(-100%)" : "translateX(-50%)",
                  }}
                >
                  {value}
                </span>
              ))}
          </span>
          <span />
        </div>
      ) : null}
    </div>
  );
}

function sparkPoints(grades) {
  const y = (value) => 32 - (Math.max(0, Math.min(10, value)) / 10) * 30;
  const step = grades.length > 1 ? 94 / (grades.length - 1) : 0;
  return grades.map((grade, index) => [3 + index * step, y(grade.value)]);
}

function StudentsView({ data, size, selected, onSelect, context }) {
  const { t, locale, threshold } = context;
  const big = size === "big";
  const students = data.students.slice(0, big ? 15 : 5);
  const limitY = 32 - (threshold.grade / 10) * 30;
  const color = (trend) => (trend === "down" ? RED : trend === "up" ? JADE : INDIGO);
  return (
    <div className={`cv-sparks ${big ? "is-big" : "is-mini"}`}>
      {students.map((item) => {
        const points = sparkPoints(item.grades);
        const end = points.at(-1);
        return (
          <button
            type="button"
            key={item.key}
            className={`cv-spark ${item.trend === "down" ? "is-down" : ""} ${item.key === selected ? "on" : ""}`
              .replace(/\s+/g, " ")
              .trim()}
            aria-pressed={item.key === selected}
            aria-label={`${item.student.fullName}: ${item.grades.map((grade) => formatScore(grade.value, locale)).join(", ")}`}
            onClick={() => onSelect(item.key)}
          >
            <span className="cv-spark-head">
              <strong>{firstName(item.student.fullName)}</strong>
              {big ? (
                <small className={item.trend === "down" ? "text-bad" : item.trend === "up" ? "text-ok" : "muted"}>
                  {item.trend === "flat"
                    ? t("steady")
                    : `${item.delta > 0 ? "↑" : "↓"} ${formatScore(Math.abs(item.delta), locale)}`}
                </small>
              ) : null}
            </span>
            {big ? <b>{formatScore(item.last, locale)}</b> : null}
            <span className="cv-spark-line" aria-hidden="true">
              <svg viewBox="0 0 100 34" preserveAspectRatio="none">
                <line className="cv-spark-limit" x1="0" x2="100" y1={limitY} y2={limitY} />
                <polyline
                  points={points.map((point) => point.join(",")).join(" ")}
                  style={{ stroke: color(item.trend) }}
                />
              </svg>
              <i style={{ left: `${end[0]}%`, top: `${(end[1] / 34) * 100}%`, background: color(item.trend) }} />
            </span>
          </button>
        );
      })}
      {big && data.students.length > students.length ? (
        <p className="cv-more">
          {t("{count} more students in the list", { count: data.students.length - students.length })}
        </p>
      ) : null}
    </div>
  );
}

function SubmissionsView({ data, size, selected, onSelect, context }) {
  const { t, locale, nameOf, groupName } = context;
  const big = size === "big";
  const rows = data.rows.slice(0, big ? 6 : 5);
  const word = { graded: "graded", ungraded: "no grade yet", missing: "not handed in", excused: "excused" };
  return (
    <div className={`cv-subs ${big ? "is-big" : "is-mini"}`}>
      {rows.map((row) => (
        <button
          type="button"
          key={row.key}
          className={`cv-sub ${row.key === selected ? "on" : ""}`}
          aria-pressed={row.key === selected}
          aria-label={`${row.assessment}: ${t("{count} of {total}", { count: row.graded, total: row.cells.length - row.excused })}`}
          onClick={() => onSelect(row.key)}
        >
          {big ? (
            <span className="cv-sub-name">
              <strong>{row.assessment}</strong>
              <small>
                {[formatShortDate(row.date, locale, { weekday: false }), row.groupId ? groupName(row.groupId) : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
          ) : null}
          <span className="cv-sub-cells">
            {row.cells.map((cell) => (
              <i
                key={cell.key}
                className={`is-${cell.status}`}
                title={big ? `${nameOf(cell.studentId)}: ${t(word[cell.status])}` : undefined}
              >
                {big && cell.status === "missing" ? "×" : null}
              </i>
            ))}
          </span>
          {big ? <b>{`${row.graded}/${row.cells.length - row.excused}`}</b> : null}
        </button>
      ))}
    </div>
  );
}

/** A round top for a money axis (1, 1.2, 1.5, 2, 2.5… times a power of ten), close above the highest value. */
function niceCeil(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((candidate) => value / power <= candidate);
  return step * power;
}

/** Name of a step of the accumulated line: day numbers (the first with its month) or the period's stretch. */
function closeLabel(step, index, context) {
  if (step.kind !== "day") return context.bucketLabel(step);
  return index === 0 ? formatShortDate(step.start, context.locale, { weekday: false }) : dayNumber(step.start);
}

function CloseView({ data, size, selected, onSelect, context }) {
  const { t, locale } = context;
  const big = size === "big";
  const series = data.series;
  const count = series.length;
  const daily = series[0]?.kind === "day";
  const x = (index) => (count === 1 ? 50 : 3 + (index * 94) / (count - 1));
  const max = niceCeil(
    Math.max(data.sums[data.lastReal] || 0, ...(data.previous || [0]), data.projection?.high || 0, 1) * 1.05,
  );
  const y = (value) => (value / max) * 100;
  const line = data.sums
    .slice(0, data.lastReal + 1)
    .map((value, index) => `${x(index).toFixed(2)},${(100 - y(value)).toFixed(2)}`)
    .join(" ");
  const previous = data.previous
    ? data.previous.map((value, index) => `${x(index).toFixed(2)},${(100 - y(value)).toFixed(2)}`).join(" ")
    : "";
  const today = `${x(data.lastReal).toFixed(2)},${(100 - y(data.collected)).toFixed(2)}`;
  const end = x(count - 1).toFixed(2);
  const cone = data.projection
    ? `${today} ${end},${(100 - y(data.projection.high)).toFixed(2)} ${end},${(100 - y(data.projection.low)).toFixed(2)}`
    : "";
  const probable = data.projection ? `${today} ${end},${(100 - y(data.projection.probable)).toFixed(2)}` : "";
  const selectedIndex = Number(selected);
  // Day by day, today is the one mark (a month of dots would crowd the line); stretches are all marks.
  const marks = series
    .map((step, index) => ({ step, index }))
    .filter(({ index }) => index <= data.lastReal && (!daily || index === data.lastReal));
  const labels = daily
    ? series
        .map((step, index) => ({ step, index }))
        .filter(
          ({ index }) =>
            index === data.lastReal ||
            ((index % 7 === 0 || index === count - 1) && Math.abs(index - data.lastReal) > 3),
        )
    : series.map((step, index) => ({ step, index }));
  return (
    <>
      {big
        ? [0, 0.5, 1].map((fraction) => (
            <span className="grid" key={fraction} style={{ bottom: `${fraction * 100}%` }}>
              <b>{shortMoney(max * fraction, locale)}</b>
            </span>
          ))
        : null}
      <svg className="ln cv-close-ln" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {cone ? <polygon className="cv-cone" points={cone} /> : null}
        {line ? <polygon points={`${x(0).toFixed(2)},100 ${line} ${x(data.lastReal).toFixed(2)},100`} /> : null}
        {previous ? <polyline className="cv-previous" points={previous} /> : null}
        {line ? <polyline points={line} /> : null}
        {probable ? <polyline className="pj" points={probable} /> : null}
      </svg>
      {big
        ? marks.map(({ step, index }) => {
            const when =
              step.kind === "day" ? capitalize(formatShortDate(step.start, locale)) : context.bucketTitle(step);
            return (
              <button
                type="button"
                key={step.key}
                className={`dt ${daily ? "cv-day-dot" : ""} ${index === selectedIndex ? "on" : ""}`
                  .replace(/\s+/g, " ")
                  .trim()}
                style={{ left: `${x(index)}%`, bottom: `${y(data.sums[index])}%` }}
                aria-label={`${when}: ${t("{amount} accumulated", { amount: formatMoney(data.sums[index], locale) })}`}
                aria-pressed={index === selectedIndex}
                onClick={() => onSelect(String(index))}
              >
                <MarkTip text={`${when}: ${formatMoney(data.sums[index], locale)}`} />
              </button>
            );
          })
        : null}
      {big && data.projection ? (
        <span className="cv-end-tag" style={{ bottom: `${y(data.projection.probable)}%` }}>
          {shortMoney(data.projection.probable, locale)}
        </span>
      ) : null}
      {big
        ? labels.map(({ step, index }) => (
            <span
              key={`x-${step.key}`}
              className={`xl2 ${index === data.lastReal && daily ? "on" : index === selectedIndex ? "on" : ""}`}
              style={{
                left: `${x(index)}%`,
                transform: index === 0 ? "none" : index === count - 1 ? "translateX(-100%)" : undefined,
              }}
            >
              {daily && index === data.lastReal ? t("today") : closeLabel(step, index, context)}
            </span>
          ))
        : null}
    </>
  );
}

function UpcomingView({ data, size, selected, onSelect, context }) {
  const { locale } = context;
  const big = size === "big";
  const peak = Math.max(...data.days.map((day) => day.total), 1);
  const max = big ? niceCeil(peak * 1.1) : peak;
  return (
    <>
      {big
        ? [0, 0.5, 1].map((fraction) => (
            <span className="grid" key={fraction} style={{ bottom: `${fraction * 100}%` }}>
              <b>{shortMoney(max * fraction, locale)}</b>
            </span>
          ))
        : null}
      <div className={big ? "bars cv-upcoming" : "mbars cv-upcoming"}>
        {data.days.map((day, index) => {
          const tip = `${capitalize(formatShortDate(day.date, locale))}: ${formatMoney(day.total, locale)}`;
          const on = day.key === selected;
          return (
            <button
              type="button"
              key={day.key}
              className={`${big ? "bar" : "mb"} ${on ? "on" : selected && day.total ? "dim" : ""}`.trim()}
              aria-label={tip}
              aria-pressed={on}
              disabled={!day.total}
              onClick={() => onSelect(day.key)}
            >
              <span className={big ? "col cv-stack" : "cv-stack"}>
                <i
                  style={{
                    height: `${(day.classes / max) * 100}%`,
                    background: INDIGO,
                    borderRadius: day.monthly ? 0 : "4px 4px 0 0",
                  }}
                />
                <i style={{ height: `${(day.monthly / max) * 100}%`, background: JADE, borderRadius: "4px 4px 0 0" }} />
                {big && index === data.peak ? <em className="cv-count">{shortMoney(day.total, locale)}</em> : null}
              </span>
              {big ? (
                <span className="xl">
                  {day.date.slice(8) === "01" ? `1 ${monthShort(day.date, locale)}` : dayNumber(day.date)}
                </span>
              ) : null}
              <MarkTip text={tip} />
            </button>
          );
        })}
      </div>
    </>
  );
}

function PunctualityView({ data, size, selected, onSelect, context }) {
  const { t } = context;
  const big = size === "big";
  const color = (days) => (days > 7 ? RED : days > 0 ? OCRE : JADE);
  if (!big) {
    const rows = data.rows.slice(0, 12);
    const span = Math.max(1, ...rows.map((row) => Math.abs(row.average)));
    return (
      <>
        <span className="cv-mid" />
        <div className="cv-diverge">
          {rows.map((row) => {
            const height = (Math.abs(row.average) / span) * 50;
            return (
              <button
                type="button"
                key={row.key}
                className={`cv-dv ${row.key === selected ? "on" : selected ? "dim" : ""}`.trim()}
                aria-pressed={row.key === selected}
                aria-label={`${row.student.fullName}: ${daysText(row.average, t)}`}
                onClick={() => onSelect(row.key)}
              >
                <i
                  style={
                    row.average > 0
                      ? { bottom: "50%", height: `${height}%`, background: color(row.average) }
                      : row.average < 0
                        ? { top: "50%", height: `${height}%`, background: color(row.average) }
                        : { top: "calc(50% - 1.5px)", height: "3px", background: MUTED }
                  }
                />
              </button>
            );
          })}
        </div>
      </>
    );
  }
  const x = (days) => ((Math.max(-10, Math.min(20, days)) + 10) / 30) * 100;
  const rows = data.rows.slice(0, 12);
  return (
    <div className="cv-punct">
      <div className="cv-punct-row cv-punct-head" aria-hidden="true">
        <span />
        <span className="cv-ticks">
          <span style={{ left: 0 }} className="text-ok">
            {t("← pays early")}
          </span>
          <span style={{ left: `${x(0)}%`, transform: "translateX(-50%)" }}>{t("due")}</span>
          <span style={{ right: 0 }} className="text-bad">
            {t("pays late →")}
          </span>
        </span>
        <span />
      </div>
      {rows.map((row) => (
        <button
          type="button"
          key={row.key}
          className={`cv-punct-row ${row.key === selected ? "on" : ""}`}
          aria-pressed={row.key === selected}
          onClick={() => onSelect(row.key)}
        >
          <span className="cv-punct-name">{row.student.fullName}</span>
          <span className="cv-punct-track" aria-hidden="true">
            <u style={{ left: `${x(0)}%` }} />
            <i
              className="cv-range"
              style={{
                left: `${x(row.min)}%`,
                width: `${Math.max(1, x(row.max) - x(row.min))}%`,
                background: color(row.average),
              }}
            />
            <i className="cv-dot" style={{ left: `${x(row.average)}%`, background: color(row.average) }} />
          </span>
          <b className={row.average > 7 ? "text-bad" : row.average > 0 ? "text-pend" : "text-ok"}>
            {row.average === 0 ? t("on time") : daysText(row.average, t)}
          </b>
        </button>
      ))}
      <div className="cv-punct-row cv-punct-axis" aria-hidden="true">
        <span />
        <span className="cv-ticks">
          {[-10, 0, 10, 20].map((days) => (
            <span
              key={days}
              style={{
                left: `${x(days)}%`,
                transform: days === -10 ? "none" : days === 20 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {days > 0 ? `+${days}` : days < 0 ? `−${Math.abs(days)}` : "0"}
            </span>
          ))}
        </span>
        <span />
      </div>
      {data.rows.length > rows.length ? (
        <p className="cv-more">{t("{count} more students in the list", { count: data.rows.length - rows.length })}</p>
      ) : null}
    </div>
  );
}

/** The width a chart gets on screen, so an SVG can be drawn at its real size and keep its text legible. */
function useBoxWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Streams from each group into the period's total; the thickness is the money. */
function riverLayout(sources, { width, labelWidth, barWidth, minGap, height, trail }) {
  const flow = height;
  const total = sources.reduce((sum, source) => sum + source.amount, 0) || 1;
  const heights = sources.map((source) => Math.max(2, (source.amount / total) * flow));
  const left = [];
  let y = 0;
  heights.forEach((h, index) => {
    const top = index === 0 ? 0 : Math.max(y, left[index - 1].center + minGap - h / 2);
    left.push({ top, bottom: top + h, center: top + h / 2 });
    y = top + h + 6;
  });
  const span = left.at(-1).bottom;
  const offset = Math.max(0, (span - flow) / 2);
  let r = offset;
  const right = heights.map((h) => {
    const top = r;
    r += h;
    return { top, bottom: top + h, center: top + h / 2 };
  });
  const x0 = labelWidth + 8;
  const x1 = width - barWidth - trail;
  const middle = (x0 + x1) / 2;
  const paths = sources.map((_, index) => {
    const a = left[index];
    const b = right[index];
    return `M${x0},${a.top} C${middle},${a.top} ${middle},${b.top} ${x1},${b.top} L${x1},${b.bottom} C${middle},${b.bottom} ${middle},${a.bottom} ${x0},${a.bottom} Z`;
  });
  return { left, right, paths, x0, x1, span: Math.max(span, flow + offset), barWidth };
}

function SourcesView({ data, size, selected, onSelect, context }) {
  const { t, locale, groupName } = context;
  const big = size === "big";
  const sources = data.sources.slice(0, 7);
  const [box, measured] = useBoxWidth(640);
  if (!big) {
    const layout = riverLayout(sources, { width: 360, labelWidth: -4, barWidth: 14, minGap: 0, height: 80, trail: 0 });
    return (
      <svg
        className="ln cv-rivers is-mini"
        viewBox={`0 0 360 ${Math.max(84, layout.span)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {sources.map((source, index) => (
          <g key={source.key} className={source.key === selected ? "on" : ""}>
            <path d={layout.paths[index]} style={{ fill: STAMP_COLORS[source.colorId] }} className="cv-stream" />
            <rect
              x={0}
              y={layout.left[index].top}
              width={4}
              height={layout.left[index].bottom - layout.left[index].top}
              style={{ fill: STAMP_COLORS[source.colorId] }}
            />
            <rect
              x={layout.x1}
              y={layout.right[index].top}
              width={14}
              height={layout.right[index].bottom - layout.right[index].top}
              style={{ fill: STAMP_COLORS[source.colorId] }}
            />
          </g>
        ))}
      </svg>
    );
  }
  // Drawn at the box's own width, so names and amounts keep their size on a phone.
  const width = Math.max(300, Math.min(680, measured));
  const narrow = width < 480;
  const labelWidth = narrow ? 112 : 196;
  const height = Math.max(narrow ? 170 : 200, sources.length * 46);
  const layout = riverLayout(sources, { width, labelWidth, barWidth: 18, minGap: 38, height, trail: 44 });
  const viewHeight = Math.ceil(layout.span + 52);
  const limit = narrow ? 14 : 24;
  return (
    <div ref={box} className="cv-rivers-box">
      <svg
        className={`cv-rivers is-big ${narrow ? "is-narrow" : ""}`.trim()}
        viewBox={`0 -30 ${width} ${viewHeight}`}
        width={width}
        height={viewHeight}
        role="group"
        aria-label={chartViewTitle("sources", context)}
      >
        <text x={layout.x1 + 9} y={-16} className="cv-river-total-label" textAnchor="middle">
          {t("Total")}
        </text>
        <text x={layout.x1 + 9} y={-2} className="cv-river-total" textAnchor="middle">
          {shortMoney(data.total, locale)}
        </text>
        {sources.map((source, index) => {
          const color = STAMP_COLORS[source.colorId];
          const on = source.key === selected;
          const fullName = groupName(source.groupId);
          const name = fullName.length > limit ? `${fullName.slice(0, limit - 1)}…` : fullName;
          // A narrow chart keeps the amount; the rate per hour is in the detail.
          const detail = [
            formatMoney(source.amount, locale),
            source.rate !== null && !narrow ? `${formatMoney(source.rate, locale)}/h` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <g
              key={source.key}
              className={`cv-river ${on ? "on" : selected ? "dim" : ""}`.trim()}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${fullName}: ${detail}`}
              onClick={() => onSelect(source.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(source.key);
                }
              }}
            >
              <path d={layout.paths[index]} style={{ fill: color }} className="cv-stream" />
              <rect
                x={layout.x0 - 8}
                y={layout.left[index].top}
                width={8}
                height={layout.left[index].bottom - layout.left[index].top}
                rx={2}
                style={{ fill: color }}
              />
              <rect
                x={layout.x1}
                y={layout.right[index].top}
                width={18}
                height={layout.right[index].bottom - layout.right[index].top}
                style={{ fill: color }}
                className="cv-river-bar"
              />
              <text x={layout.x0 - 16} y={layout.left[index].center - 2} textAnchor="end" className="cv-river-name">
                {name}
              </text>
              <text x={layout.x0 - 16} y={layout.left[index].center + 15} textAnchor="end" className="cv-river-sub">
                {detail}
              </text>
              {layout.right[index].bottom - layout.right[index].top >= 12 || index === sources.length - 1 ? (
                <text
                  x={layout.x1 + 26}
                  y={Math.min(layout.right[index].center + 4, layout.span + 2)}
                  className="cv-river-share"
                >
                  {`${pct(source.share, locale)}%`}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const VIEWS = {
  calendar: CalendarView,
  map: MapView,
  slots: SlotsView,
  trend: TrendView,
  scatter: ScatterView,
  histogram: HistogramView,
  boxes: BoxesView,
  students: StudentsView,
  submissions: SubmissionsView,
  close: CloseView,
  upcoming: UpcomingView,
  punctuality: PunctualityView,
  sources: SourcesView,
};

/** Views drawn over the shared plot frame (grid, threshold, x labels); the rest lay themselves out. */
const FRAMED = new Set(["trend", "histogram", "close", "upcoming"]);

/** The legend under a large view, so identity never rests on color alone. */
function ViewLegend({ view, data, context }) {
  const { t, locale, threshold, groupName } = context;
  const items = {
    calendar: [
      ["is-high", t("90% or more")],
      ["is-mid", t("{value}% to 89%", { value: pct(threshold.attendance, locale) })],
      ["is-low", t("Below {value}%", { value: pct(threshold.attendance, locale) })],
      ["is-unreg", t("Not recorded")],
    ],
    map: [
      ["is-present", t("Attended (P)")],
      ["is-absent", t("Missed (A)")],
      ["is-streak", t("Absences in a row")],
    ],
    trend: [
      ["is-line", t("Average of 4 weeks")],
      ["is-dot", t("Each week")],
      ...(data?.projection ? [["is-cone", t("Probable range")]] : []),
    ],
    scatter: [
      ["is-risk", t("Misses classes and scores low")],
      ["is-watch", t("One of the two")],
      ["is-ok", t("Doing well")],
    ],
    histogram: [
      ["is-indigo", t("{value} or more", { value: formatScore(threshold.grade, locale) })],
      ["is-red", t("Below {value}", { value: formatScore(threshold.grade, locale) })],
    ],
    boxes: [
      ["is-box", t("Middle half")],
      ["is-median", t("Median")],
      ["is-outlier", t("Far from the rest")],
    ],
    students: [
      ["is-red-line", t("Going down")],
      ["is-indigo-line", t("Steady")],
      ["is-jade-line", t("Going up")],
    ],
    submissions: [
      ["is-graded", t("Graded")],
      ["is-ungraded", t("No grade yet")],
      ["is-missing", t("Not handed in")],
    ],
    close: [
      ["is-line", t("This period")],
      ...(data?.previous ? [["is-previous", t("Previous period")]] : []),
      ...(data?.projection ? [["is-cone", t("Probable close range")]] : []),
    ],
    upcoming: [
      ["is-jade", t("Monthly fees")],
      ["is-indigo", t("Classes")],
    ],
    punctuality: [
      ["is-jade", t("On time or early")],
      ["is-ocre", t("Up to a week late")],
      ["is-red", t("More than a week late")],
    ],
    sources: data?.sources?.length
      ? data.sources.slice(0, 7).map((source) => [`stamp-${source.colorId}`, groupName(source.groupId)])
      : [],
  }[view];
  if (!items?.length) return null;
  return (
    <div className="leg cv-leg">
      {items.map(([tone, text]) => (
        <span key={`${tone}-${text}`}>
          <i className={`cv-key ${tone}`} />
          {text}
        </span>
      ))}
    </div>
  );
}

/**
 * One chart view. `size="mini"` fills a card's small plot; `size="big"` is the detail's and Seguimiento's
 * chart, with its frame, labels and legend.
 */
export function ChartView({ view, data, size = "mini", selected = "", onSelect = (_key) => {}, context }) {
  const { t } = context;
  const Component = VIEWS[view];
  if (!Component || !data) return null;
  const empty = chartViewEmpty(view, data);
  if (size !== "big") {
    if (empty) return null;
    return <Component data={data} size="mini" selected={selected} onSelect={onSelect} context={context} />;
  }
  if (empty)
    return (
      <div className="cv-empty">
        <p className="muted">
          {view === "upcoming" ? t("Nothing due in the next 14 days") : t("No data in this period.")}
        </p>
      </div>
    );
  return (
    <div className={`cv-frame cv-${view}`}>
      {FRAMED.has(view) ? (
        <div className="bplot cv-plot">
          <Component data={data} size="big" selected={selected} onSelect={onSelect} context={context} />
        </div>
      ) : (
        <Component data={data} size="big" selected={selected} onSelect={onSelect} context={context} />
      )}
      <ViewLegend view={view} data={data} context={context} />
    </div>
  );
}
