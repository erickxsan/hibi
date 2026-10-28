import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, X } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import {
  BottomSheet,
  Button,
  Drawer,
  Field,
  IconButton,
  Input,
  ListRow,
  SectionHeading,
  Segmented,
  Select,
  Tabs,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { ArchivedGroupsScope } from "../components/ArchivedGroupsScope";
import { useCompactViewport } from "../components/OverlayContext";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { attendanceBilling } from "../domain/attendanceBilling.js";
import { todayDateOnly } from "../domain/dates";
import {
  axisTickLabels,
  dayNumber,
  formatDayMonth,
  formatMoney,
  formatScore,
  formatShortDate,
  formatTime,
  monthLong,
  monthShort,
} from "../utils/displayFormat";
import { assignmentsIn, defaultPointIndex, shortNames } from "./homeDashboardModel";
import { ChartView, ChartViewPicker, chartViewDetail, chartViewEmpty, chartViewTitle, isPlotView } from "./ChartViews";
import { buildChartView, CHART_VIEWS } from "./chartViewsModel";
import {
  bucketLabel,
  bucketTitle,
  collectionsMax,
  compactMoney,
  comparisonSpan,
  moneyDeltaText,
  overdueLine,
  Plot,
} from "./HomeMetrics";
import { groupNamesOf } from "./CommunityStudent";
import {
  monthlyBlocks,
  trackingKpis,
  trackingMetric,
  trackingRange,
  trackingRecords,
  trackingStudents,
} from "./trackingModel";
import "../i18n/screenTranslations.js";
import "../components/charts.css";
import "./tracking.css";

// One order for desktop tabs and the phone switch (attendance is also the default view).
const TAB_ITEMS = [
  { value: "attendance", label: "Attendance" },
  { value: "grades", label: "Grades" },
  { value: "payments", label: "Payments" },
];
const MODE_ITEMS = [
  { value: "summary", label: "Summary" },
  { value: "breakdown", label: "Breakdown" },
];
const TAB_VALUES = TAB_ITEMS.map((item) => item.value);
/** Each tab's metric in the shared chart views. */
const TAB_METRIC = Object.freeze({ attendance: "attendance", grades: "grade", payments: "collections" });

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function percentText(ratio, locale) {
  return Number.isFinite(ratio)
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(ratio * 100)}%`
    : "—";
}

function escapeExcel(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadExcel(filename, title, rows) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const table = `<table><caption>${escapeExcel(title)}</caption><thead><tr>${headers.map((header) => `<th>${escapeExcel(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeExcel(row[header])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${table}</body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function attendanceWord(row, t) {
  if (row.classStatus === "Cancelled") return { tone: "st-prog", text: t("Cancelled") };
  if (row.attendance === "A") return { tone: "st-venc", text: t("Absent") };
  if (row.attendance === "E") return { tone: "st-prog", text: t("Excused") };
  if (attendanceBilling(row) === "unmarked") return { tone: "st-prog", text: t("Unmarked") };
  return { tone: "st-ok", text: t("Present") };
}

function paymentWord(record, t) {
  if (record.payment === "paid") return { tone: "st-ok", text: t("Paid") };
  if (record.payment === "pending") return { tone: "st-pend", text: t("Pending") };
  if (record.payment === "covered") return { tone: "st-prog", text: t("Monthly fee") };
  return { tone: "", text: "—" };
}

/** «Mensualidades · octubre» for one monthly group: progress and «Marcar pagada» / «Deshacer». */
function MonthlyBlock({ block, asOf, onToggle, busy, compact = false }) {
  const { t, locale } = useI18n();
  const month = monthLong(`${block.period}-01`, locale);
  const due = block.billing?.due;
  const dueText =
    due?.type === "nthClass"
      ? t("due at class {nth} of the month", { nth: due.nth === "last" ? t("last (class)") : `${due.nth}.ª` })
      : t("due on day {day}", { day: due?.day ?? "" });
  const pct = block.expectedAmount ? Math.round((block.paidAmount / block.expectedAmount) * 100) : 0;
  return (
    <section className="mens" aria-label={t("Monthly fees · {month} · {group}", { month, group: block.group.name })}>
      <div className="mhd">
        {compact ? (
          <div className="mhd-top">
            <span className="overline">{t("Monthly fees · {month}", { month })}</span>
            <span className="mhd-count">
              <b>{t("{paid} of {total}", { paid: block.paidCount, total: block.total })}</b>
              <small>{t("paid (plural)")}</small>
            </span>
          </div>
        ) : (
          <span className="overline">{t("Monthly fees · {month}", { month })}</span>
        )}
        <h2>{block.group.name}</h2>
        <p>
          {t("{amount} a month", { amount: formatMoney(block.billing?.monthlyFee || 0, locale) })} · {dueText}
          {block.dueDate === asOf
            ? ` (${t("today")})`
            : block.dueDate
              ? ` (${formatShortDate(block.dueDate, locale)})`
              : ""}
        </p>
        {compact ? null : (
          <div className="mprog">
            <b>{t("{paid} of {total}", { paid: block.paidCount, total: block.total })}</b>
            <span>
              {t("paid · {amount} of {expected}", {
                amount: formatMoney(block.paidAmount, locale),
                expected: formatMoney(block.expectedAmount, locale),
              })}
            </span>
          </div>
        )}
        <div
          className="pbar"
          role="progressbar"
          aria-label={t("Monthly fees paid")}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        {!compact && block.perClass.length ? (
          <small>
            {t(
              block.perClass.length === 1
                ? "{names} pays per class in this group; their payments stay in the list."
                : "{names} pay per class in this group; their payments stay in the list.",
              {
                names: shortNames(
                  block.perClass.map((student) => student.fullName),
                  locale,
                ),
              },
            )}
          </small>
        ) : null}
      </div>
      <div className="mlist">
        {block.rows.map(({ charge, student }) => {
          const paid = charge.status === "paid";
          const sub = paid
            ? charge.paidAt === asOf
              ? t("Paid today")
              : `${charge.adjusted ? `${t("Own fee")} · ` : compact ? `${t("Group fee")} · ` : ""}${t("paid on {day}", { day: dayNumber(charge.paidAt) })}`
            : charge.status === "waived"
              ? t("Free this month")
              : charge.dueDate === asOf
                ? t("Due today")
                : charge.status === "overdue"
                  ? t("Overdue · {date}", { date: formatShortDate(charge.dueDate, locale, { weekday: false }) })
                  : t("Due {date}", { date: formatShortDate(charge.dueDate, locale) });
          return (
            <div className="mrow" key={charge.id}>
              <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
              <span className="nm">
                <strong>{student.fullName}</strong>
                <small className={charge.status === "overdue" ? "text-bad" : undefined}>{sub}</small>
              </span>
              {compact && paid ? null : <span className="mamt">{formatMoney(charge.amount, locale)}</span>}
              {paid ? (
                <span className="mok">
                  <span className="st st-ok">{t("Paid (fee)")}</span>
                  {charge.paidAt === asOf ? (
                    <button type="button" className="mlk" disabled={busy} onClick={() => onToggle(charge, false)}>
                      {t("Undo")}
                    </button>
                  ) : null}
                </span>
              ) : charge.status === "waived" ? null : (
                <button type="button" className="mbtn" disabled={busy} onClick={() => onToggle(charge, true)}>
                  {t("Mark paid (fee)")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {compact ? (
        <p className="mfoot">
          {t("{amount} of {expected}", {
            amount: formatMoney(block.paidAmount, locale),
            expected: formatMoney(block.expectedAmount, locale),
          })}
          {block.perClass.length
            ? ` · ${t(
                block.perClass.length === 1
                  ? "{names} pays per class in this group."
                  : "{names} pay per class in this group.",
                {
                  names: shortNames(
                    block.perClass.map((student) => student.fullName),
                    locale,
                  ),
                },
              )}`
            : ""}
        </p>
      ) : null}
    </section>
  );
}

/** Rows of a student's history inside the range. */
function StudentHistory({ row, records, groupsById, onClose, onOpenStudent }) {
  const { t, locale } = useI18n();
  const student = row.student;
  const threshold = 0.8;
  return (
    <section className="stu" aria-labelledby="tracking-student-title">
      <div className="stuh">
        <StudentAvatar avatarId={student.avatarId} name={student.fullName} />
        <div className="stuh-title">
          <h3 id="tracking-student-title">{student.fullName}</h3>
          <span>{groupNamesOf(student, groupsById, t) || t("Individual")}</span>
        </div>
        <button type="button" className="link-button" onClick={onOpenStudent}>
          {t("View profile")}
        </button>
        <IconButton label={t("Close history")} icon={X} onClick={onClose} />
      </div>
      <div className="stats">
        <div>
          <span>{t("Attendance")}</span>
          <b className={row.attendance !== null && row.attendance < threshold ? "text-bad" : ""}>
            {percentText(row.attendance, locale)}
          </b>
        </div>
        <div>
          <span>{t("Average")}</span>
          <b>{formatScore(row.average, locale)}</b>
        </div>
        <div>
          <span>{t("Paid")}</span>
          <b>{formatMoney(row.paid, locale)}</b>
        </div>
        <div>
          <span>{t("To collect")}</span>
          <b className={row.owed ? (row.overdue ? "text-bad" : "text-pend") : ""}>
            {row.owed ? formatMoney(row.owed, locale) : "—"}
          </b>
        </div>
      </div>
      <div className="hist" role="table" aria-label={t("History of {name}", { name: student.fullName })}>
        <div className="hr th" role="row">
          <span role="columnheader">{t("Date")}</span>
          <span role="columnheader">{t("Class")}</span>
          <span role="columnheader">{t("Attendance")}</span>
          <span role="columnheader">{t("Grade")}</span>
          <span role="columnheader">{t("Payment")}</span>
        </div>
        {records.map((record) => {
          const attendance = attendanceWord(record.row, t);
          const payment = paymentWord(record, t);
          return (
            <div className="hr" role="row" key={record.row.id}>
              <span role="cell" className="tnum">
                {formatShortDate(record.row.classDate, locale)}
              </span>
              <span role="cell">
                {[record.className || t("Individual"), record.assessment].filter(Boolean).join(" · ")}
              </span>
              <span role="cell">
                <span className={`st ${attendance.tone}`}>{attendance.text}</span>
              </span>
              <span role="cell" className="tnum hr-grade">
                {record.grade === null ? (record.ungraded ? t("Ungraded") : "—") : formatScore(record.grade, locale)}
              </span>
              <span role="cell">
                {payment.tone ? <span className={`st ${payment.tone}`}>{payment.text}</span> : "—"}
              </span>
            </div>
          );
        })}
        {!records.length ? <p className="muted">{t("No classes in this period.")}</p> : null}
      </div>
    </section>
  );
}

export default function Tracking({
  state,
  derived,
  actions = undefined,
  openPage = undefined,
  intent = undefined,
  clearIntent = undefined,
  archiveScope = undefined,
}) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const liveDate = state.settings?.asOfDate || todayDateOnly();
  const [reportDate, setReportDate] = useState("");
  const [dateDraft, setDateDraft] = useState(liveDate);
  const [dateOpen, setDateOpen] = useState(false);
  const [period, setPeriod] = useState("month");
  // «Rango personalizado»: its own first and last day; the last one is the report date of the figures.
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [rangeDraft, setRangeDraft] = useState({ start: "", end: "" });
  const [rangeOpen, setRangeOpen] = useState(false);
  const asOf = period === "custom" ? customRange.end : reportDate || liveDate;
  const [tab, setTab] = useState("attendance");
  const [mode, setMode] = useState("summary");
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(false);
  const [studentId, setStudentId] = useState("");
  // The chart view of each tab; a tab opens on its metric's first view.
  const [views, setViews] = useState({});
  const [chip, setChip] = useState("all");
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setSelected(null);
    setFocus(false);
    setChip("all");
  };
  const changeTab = useHistoryBackedState({
    key: "tracking-tab",
    value: tab,
    onChange: (value) => {
      setTab(value);
      reset();
    },
    defaultValue: "attendance",
    allowedValues: TAB_VALUES,
  });
  useEffect(() => {
    if (intent?.type !== "open-tracking") return;
    if (TAB_VALUES.includes(intent.tab)) changeTab(intent.tab, { replace: true });
    clearIntent?.();
  }, [changeTab, clearIntent, intent]);

  const groupsById = useMemo(() => new Map((state.groups || []).map((group) => [group.id, group])), [state.groups]);
  const range = useMemo(
    () => trackingRange(asOf, period, state, customRange.start),
    [asOf, customRange.start, period, state],
  );
  const students = useMemo(() => trackingStudents(state, derived, range, scope), [derived, range, scope, state]);
  const kpis = useMemo(
    () => trackingKpis(state, derived, range, scope, students),
    [derived, range, scope, state, students],
  );
  const metric = useMemo(() => trackingMetric(state, derived, range, scope, tab), [derived, range, scope, state, tab]);
  const blocks = useMemo(
    () => (tab === "payments" ? monthlyBlocks(state, asOf, scope) : []),
    [asOf, scope, state, tab],
  );
  const records = useMemo(
    () =>
      mode === "breakdown" || studentId
        ? trackingRecords(state, derived, range, scope, mode === "breakdown" ? "" : studentId)
        : [],
    [derived, mode, range, scope, state, studentId],
  );
  const threshold = useMemo(
    () => ({ attendance: kpis.threshold, grade: kpis.gradeThreshold }),
    [kpis.gradeThreshold, kpis.threshold],
  );
  const viewOptions = CHART_VIEWS[TAB_METRIC[tab]];
  const view = viewOptions.includes(views[tab]) ? views[tab] : viewOptions[0];
  const plot = isPlotView(view);
  const index = typeof selected !== "number" || selected >= metric.points.length ? defaultPointIndex(metric) : selected;
  const point = focus && plot ? metric.points[index] : null;
  const studentsById = useMemo(
    () => new Map((state.students || []).map((student) => [student.id, student])),
    [state.students],
  );
  const viewData = useMemo(
    () =>
      plot
        ? null
        : buildChartView(view, {
            state,
            derived,
            asOf: range.end,
            start: range.start,
            end: range.end,
            group: scope,
            threshold,
            rows: students,
            assignments: tab === "grades" && range.start ? assignmentsIn(state, range.start, range.end, scope) : [],
            points: metric.points,
            previousStart: range.previousStart,
            previousEnd: range.previousEnd,
            monthly: period === "month",
          }),
    [derived, metric.points, period, plot, range, scope, state, students, tab, threshold, view],
  );
  const viewContext = {
    t,
    locale,
    threshold,
    monthly: period === "month",
    points: metric.points,
    names: (list) => shortNames(list, locale),
    nameOf: (id) => studentsById.get(id)?.fullName || t("Former student"),
    groupName: (id) => (id ? groupsById.get(id)?.name || "" : t("Individual")),
    bucketLabel: (item) => (item ? bucketLabel(item, locale) : ""),
    bucketTitle: (item) => (item ? bucketTitle(item, t, locale) : ""),
  };
  const viewDetail = plot
    ? null
    : chartViewDetail(view, viewData, focus && typeof selected === "string" ? selected : "", viewContext);
  const selectedRow = students.find((row) => row.student.id === studentId) || null;

  const groupChips = [
    { value: "all", label: t("All groups") },
    ...(state.groups || [])
      .filter((group) => group.status !== "Inactive")
      .map((group) => ({ value: group.id, label: group.name })),
    ...((state.students || []).some(
      (student) => student.status !== "Inactive" && (student.isIndividual || !(student.groupIds || []).length),
    )
      ? [{ value: "individual", label: t("Individual (plural)") }]
      : []),
  ];
  const periodOptions = [
    {
      value: "month",
      label: t("This month · {month}", { month: monthLong(asOf, locale) }),
      short: capitalize(monthLong(asOf, locale)),
      meta: t("{start} to {end} · through today", {
        start: dayNumber(range.period === "month" ? range.start : `${asOf.slice(0, 7)}-01`),
        end: formatShortDate(asOf, locale, { weekday: false }),
      }),
    },
    { value: "week", label: t("This week"), short: t("This week"), meta: "" },
    { value: "thirty", label: t("Last 30 days"), short: t("30 days"), meta: "" },
    { value: "all", label: t("All records"), short: t("All"), meta: "" },
    period === "custom"
      ? {
          value: "custom",
          label: t("Range · {span}", { span: comparisonSpan(range.start, range.end, liveDate, locale) }),
          short: comparisonSpan(range.start, range.end, liveDate, locale),
          meta: "",
        }
      : { value: "custom", label: t("Custom range…"), short: t("Range…"), meta: "" },
  ];
  const openRange = () => {
    setRangeDraft({ start: range.start || asOf, end: asOf });
    setRangeOpen(true);
  };
  const choosePeriod = (value) => {
    if (value === "custom") return openRange();
    setPeriod(value);
    reset();
  };
  const rangeInvalid = !rangeDraft.start || !rangeDraft.end || rangeDraft.start > rangeDraft.end;

  // The linked list: sorted by what needs attention, filtered by a figure or by the chosen point.
  let list = [...students];
  if (tab === "attendance") list.sort((left, right) => (left.attendance ?? 2) - (right.attendance ?? 2));
  if (tab === "grades")
    list.sort(
      (left, right) => right.ungraded.length - left.ungraded.length || (left.average ?? 11) - (right.average ?? 11),
    );
  if (tab === "payments") list.sort((left, right) => right.owed - left.owed || right.paid - left.paid);
  let focusLabel = null;
  if (viewDetail && focus) {
    // A picked mark of a chart view narrows the list to the students it concerns.
    if (viewDetail.studentIds) {
      const ids = new Set(viewDetail.studentIds);
      list = list.filter((row) => ids.has(row.student.id));
    }
    focusLabel = { title: viewDetail.title, sub: [viewDetail.big, viewDetail.sub].filter(Boolean).join(" · ") };
  } else if (point) {
    if (tab === "payments") {
      const ids = new Set(point.payments.map((item) => item.studentId));
      list = list.filter((row) => ids.has(row.student.id));
      focusLabel = {
        title: bucketTitle(point, t, locale),
        sub: point.payments.length
          ? `${t(point.payments.length === 1 ? "{count} payment" : "{count} payments", { count: point.payments.length })} · ${formatMoney(point.value, locale)}`
          : t("No payments in this stretch."),
      };
    } else if (point.assignment) {
      const grades = new Map(point.assignment.grades.map((grade) => [grade.studentId, grade.value]));
      const ids = new Set([...grades.keys(), ...point.assignment.missing]);
      list = list
        .filter((row) => ids.has(row.student.id))
        .sort((left, right) => (grades.get(left.student.id) ?? -1) - (grades.get(right.student.id) ?? -1));
      focusLabel = {
        title: `${point.assignment.assessment} · ${formatShortDate(point.date, locale)}`,
        sub: `${point.assignment.groupId ? `${groupsById.get(point.assignment.groupId)?.name || ""} · ` : ""}${t("average {value}", { value: formatScore(point.assignment.average, locale) })}`,
      };
    }
  }

  const rowView = (row) => {
    const result = {
      sub: groupNamesOf(row.student, groupsById, t) || t("Individual"),
      value: "",
      tone: "",
      squares: null,
      bars: null,
      status: null,
      hit: false,
    };
    if (tab === "attendance") {
      result.value = percentText(row.attendance, locale);
      result.tone = row.attendance !== null && row.attendance < kpis.threshold ? "text-bad" : "";
      result.squares = row.sequence.slice(-6);
      if (row.absences) {
        result.sub = `${t(row.absences === 1 ? "{count} absence" : "{count} absences", { count: row.absences })} · ${result.sub}`;
      }
    } else if (tab === "grades") {
      result.value = formatScore(row.average, locale);
      result.tone = row.average !== null && row.average < kpis.gradeThreshold ? "text-bad" : "";
      result.bars = row.grades;
      if (point?.assignment) {
        const grade = point.assignment.grades.find((item) => item.studentId === row.student.id);
        result.hit = (grade && grade.value < kpis.gradeThreshold) || point.assignment.missing.includes(row.student.id);
        result.sub = grade
          ? `${point.assignment.assessment}: ${formatScore(grade.value, locale)}`
          : t("No grade in {assessment}", { assessment: point.assignment.assessment });
      } else if (row.ungraded.length) {
        result.sub = t("Ungraded: {names}", { names: row.ungraded.join(", ") });
        result.status = { tone: "st-pend", text: t("Needs a grade") };
      } else if (row.grades.some((value) => value < kpis.gradeThreshold))
        result.status = { tone: "st-venc", text: t("Low grade") };
    } else {
      result.value = formatMoney(row.owed || row.paid, locale);
      result.tone = row.owed ? (row.overdue ? "text-bad" : "text-pend") : "";
      result.status = row.owed
        ? { tone: row.overdue ? "st-venc" : "st-pend", text: t(row.overdue ? "Overdue" : "Pending") }
        : null;
      const monthly = row.monthlyDue[0];
      if (point) {
        const amount = point.payments
          .filter((item) => item.studentId === row.student.id)
          .reduce((sum, item) => sum + item.amount, 0);
        result.sub = t("Paid {amount} in this stretch", { amount: formatMoney(amount, locale) });
      } else if (monthly) {
        result.sub = `${t("Monthly fee")} · ${
          monthly.dueDate === asOf
            ? t("due today")
            : t("due {date}", { date: formatShortDate(monthly.dueDate, locale, { weekday: false }) })
        } · ${groupsById.get(monthly.groupId)?.name || ""}`;
      } else result.sub = `${t("Paid {amount}", { amount: formatMoney(row.paid, locale) })} · ${result.sub}`;
    }
    return result;
  };

  const toggleMonthly = async (charge, paid) => {
    if (!actions?.setMonthlyPaid || busy) return;
    setBusy(true);
    try {
      await actions.setMonthlyPaid({
        studentId: charge.studentId,
        groupId: charge.groupId,
        period: charge.period,
        amount: charge.amount,
        paid,
      });
    } finally {
      setBusy(false);
    }
  };

  const exportVisible = () => {
    const rows =
      mode === "breakdown" || tab === "attendance" || tab === "grades"
        ? trackingRecords(state, derived, range, scope).map((record) => ({
            [t("Date")]: record.row.classDate,
            [t("Class")]: record.className || t("Individual"),
            [t("Student")]: record.student.fullName,
            [t("Attendance")]: attendanceWord(record.row, t).text,
            [t("Assignment")]: record.assessment,
            [t("Grade")]: record.grade === null ? "" : formatScore(record.grade, locale),
            [t("Payment")]: paymentWord(record, t).text,
          }))
        : students.map((row) => ({
            [t("Student")]: row.student.fullName,
            [t("Groups")]: groupNamesOf(row.student, groupsById, t),
            [t("Paid")]: row.paid,
            [t("Owed")]: row.owed,
            [t("Overdue")]: row.overdue,
          }));
    if (!rows.length) return actions?.notify?.("There is nothing to export in this view.", "error");
    downloadExcel(
      `hibi-${tab}-${range.start}-${range.end}.xls`,
      `${t("Hibi {section} · {start} to {end}", {
        section: t(TAB_ITEMS.find((item) => item.value === tab).label),
        start: formatShortDate(range.start, locale, { weekday: false }),
        end: formatShortDate(range.end, locale, { weekday: false }),
      })} · ${t(archiveScope?.included ? "Includes archived groups" : "Archived groups excluded")}`,
      rows,
    );
    actions?.notify?.("Excel export downloaded");
  };

  // Every comparison uses Inicio's wording, naming the dates it covers: «↑ 4 pp vs. 1–22 sep».
  const comparison = comparisonSpan(kpis.payments.previousStart, kpis.payments.previousEnd, asOf, locale);
  // Money figures use Inicio's wording: «↓ 49% vs. 1–22 sep» and «$12,900 vencidos ($3,200 de octubre · …)».
  const paymentsDelta = moneyDeltaText(
    kpis.payments.delta,
    kpis.payments.previousStart,
    kpis.payments.previousEnd,
    asOf,
    t,
    locale,
  );
  const paymentsDeltaTone = paymentsDelta ? (kpis.payments.delta >= 0 ? "text-ok" : "text-bad") : "";
  const owedNote = [
    overdueLine(kpis.payments, t, locale),
    kpis.payments.inactiveOwed > 0
      ? t("Aside, {amount} in classes owed by inactive students.", {
          amount: formatMoney(kpis.payments.inactiveOwed, locale),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // The phone's headline figure and its comparison.
  const headlineNote =
    tab === "attendance"
      ? kpis.attendance.delta !== null
        ? `${kpis.attendance.delta >= 0 ? "↑" : "↓"} ${t("{value} pp vs. {previous}", { value: Math.abs(Math.round(kpis.attendance.delta * 100)), previous: comparison })}`
        : t("{present} of {total} records", { present: kpis.attendance.present, total: kpis.attendance.records })
      : tab === "grades"
        ? kpis.grades.delta !== null
          ? Math.round(kpis.grades.delta * 10) === 0
            ? t("Same as {previous}", { previous: comparison })
            : `${kpis.grades.delta >= 0 ? "↑" : "↓"} ${t("{value} vs. {previous}", { value: formatScore(Math.abs(kpis.grades.delta), locale), previous: comparison })}`
          : t(kpis.grades.count === 1 ? "{count} grade" : "{count} grades", { count: kpis.grades.count })
        : paymentsDelta ||
          t(kpis.payments.paymentCount === 1 ? "{count} payment" : "{count} payments", {
            count: kpis.payments.paymentCount,
          });
  const headlineTone =
    tab === "attendance"
      ? kpis.attendance.delta === null
        ? ""
        : kpis.attendance.delta >= 0
          ? "text-ok"
          : "text-bad"
      : tab === "grades"
        ? "text-data"
        : paymentsDeltaTone;

  const chartTitle = plot
    ? t(tab === "grades" ? "Average by assignment" : "Collections by payment date")
    : chartViewTitle(view, viewContext);
  const ticks =
    tab === "grades"
      ? ["0", "5", "10"]
      : [0, 0.5, 1].map((fraction) => compactMoney(collectionsMax(metric.points) * fraction, locale));
  const listTitle = focusLabel
    ? t("Students · {count} in the filter", { count: list.length })
    : t(
        tab === "attendance"
          ? "Students · lowest attendance first"
          : tab === "grades"
            ? "Students · what is pending first"
            : "Students · what is owed first",
      );

  const pickPoint = (value) => {
    setSelected(value);
    setFocus(true);
  };
  const pickView = (value) => {
    setViews((current) => ({ ...current, [tab]: value }));
    setSelected(null);
    setFocus(false);
  };
  const scopeNode = archiveScope?.count ? <ArchivedGroupsScope scope={archiveScope} /> : null;

  const rangeDrawer = (
    <Drawer
      open={rangeOpen}
      onClose={() => setRangeOpen(false)}
      title={t("Custom range")}
      description={t("Choose the first and last day to review.")}
      size="compact"
      footer={
        <>
          <Button onClick={() => setRangeOpen(false)}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            disabled={rangeInvalid}
            onClick={() => {
              setCustomRange(rangeDraft);
              setPeriod("custom");
              setReportDate("");
              setRangeOpen(false);
              reset();
            }}
          >
            {t("Apply")}
          </Button>
        </>
      }
    >
      <Field label={t("From")}>
        <Input
          type="date"
          value={rangeDraft.start}
          max={rangeDraft.end || liveDate}
          onChange={(event) => setRangeDraft({ ...rangeDraft, start: event.target.value })}
        />
      </Field>
      <Field label={t("To")}>
        <Input
          type="date"
          value={rangeDraft.end}
          min={rangeDraft.start}
          max={liveDate}
          onChange={(event) => setRangeDraft({ ...rangeDraft, end: event.target.value })}
        />
      </Field>
    </Drawer>
  );

  if (compact) {
    const mobileChips =
      tab === "attendance"
        ? [
            { value: "all", label: t("All"), count: students.length },
            {
              value: "low",
              label: t("Below {value}%", { value: Math.round(kpis.threshold * 100) }),
              count: kpis.attendance.low.length,
            },
            { value: "absences", label: t("With absences"), count: kpis.attendance.withAbsences.length },
          ]
        : tab === "grades"
          ? [
              { value: "all", label: t("All"), count: students.length },
              { value: "low", label: t("Low grades"), count: kpis.grades.low.length },
              { value: "ungraded", label: t("Ungraded"), count: kpis.grades.ungraded.length },
            ]
          : [
              { value: "all", label: t("All"), count: students.length },
              { value: "overdue", label: t("Overdue"), count: kpis.payments.overdueStudents.length },
              { value: "pending", label: t("Pending"), count: kpis.payments.pendingStudents.length },
            ];
    const chipSets = {
      low: tab === "attendance" ? kpis.attendance.low : kpis.grades.low,
      absences: kpis.attendance.withAbsences,
      ungraded: kpis.grades.ungraded,
      overdue: kpis.payments.overdueStudents,
      pending: kpis.payments.pendingStudents,
    };
    const mobileList = chip !== "all" && chipSets[chip] ? list.filter((row) => chipSets[chip].includes(row)) : list;
    const bars = !plot ? [] : tab === "payments" ? metric.points : metric.points.filter((item) => item.kind === "reg");
    // Past a dozen bars the values crowd each other; the sheet still shows each one.
    const dense = bars.length > 12;
    const max = tab === "payments" ? Math.max(...bars.map((item) => item.value), 1) : 1;
    const hero =
      tab === "attendance"
        ? {
            value: percentText(kpis.attendance.value, locale),
            delta: headlineNote,
            deltaTone: headlineTone,
            line: `${t(
              kpis.attendance.low.length === 1 ? "{count} student below {value}%" : "{count} students below {value}%",
              {
                count: kpis.attendance.low.length,
                value: Math.round(kpis.threshold * 100),
              },
            )} · ${t(kpis.attendance.absences === 1 ? "{count} absence" : "{count} absences", { count: kpis.attendance.absences })}`,
          }
        : tab === "grades"
          ? {
              value: kpis.grades.value === null ? "—" : formatScore(kpis.grades.value, locale),
              delta: headlineNote,
              deltaTone: headlineTone,
              line: `${t(kpis.grades.low.length === 1 ? "{count} with a low grade" : "{count} with low grades", { count: kpis.grades.low.length })} · ${t(
                "{count} ungraded",
                { count: kpis.grades.ungraded.length },
              )}`,
            }
          : {
              value: formatMoney(kpis.payments.collected, locale),
              delta: headlineNote,
              deltaTone: headlineTone,
              line: `${t("To collect {amount}", { amount: formatMoney(kpis.payments.owed, locale) })} · ${owedNote}`,
            };
    const sheetPoint = sheet?.type === "point" ? metric.points[sheet.index] : null;
    const sheetStudent = sheet?.type === "student" ? students.find((row) => row.student.id === sheet.id) : null;
    return (
      <div className="page tracking-page is-compact" data-onboarding-tour="tracking">
        <div className="tracking-head">
          <div>
            <h1>{t("Tracking")}</h1>
            {reportDate && period !== "custom" ? (
              <span className="overline">
                {t("Report date: {date}", { date: formatShortDate(reportDate, locale) })}
              </span>
            ) : null}
          </div>
          <Select
            small
            aria-label={t("Report period")}
            value={period}
            onChange={(event) => choosePeriod(event.target.value)}
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.short}
              </option>
            ))}
          </Select>
        </div>
        <Segmented
          tone="soft"
          className="tracking-switch"
          value={tab}
          label={t("Tracking views")}
          onChange={(value) => changeTab(value)}
          items={TAB_ITEMS}
        />
        {scopeNode}
        <div className="tracking-hero">
          <b>{hero.value}</b>
          {hero.delta ? <span className={hero.deltaTone}>{hero.delta}</span> : null}
          <small>{hero.line}</small>
        </div>
        {blocks.map((block) => (
          <MonthlyBlock key={block.group.id} block={block} asOf={asOf} onToggle={toggleMonthly} busy={busy} compact />
        ))}
        <ChartViewPicker
          metric={TAB_METRIC[tab]}
          value={view}
          monthly={period === "month"}
          menu
          className="tracking-view-select"
          onChange={pickView}
        />
        {!plot ? (
          <section
            className={`tracking-view hibi-chart ${tab === "grades" ? "is-indigo" : ""}`}
            aria-label={chartTitle}
          >
            <h2 className="overline">{chartTitle}</h2>
            <ChartView
              view={view}
              data={viewData}
              size="big"
              selected={viewDetail?.key}
              onSelect={pickPoint}
              context={viewContext}
            />
            {viewDetail && !chartViewEmpty(view, viewData) ? (
              <div className="tracking-pick" aria-live="polite">
                <b>{viewDetail.title}</b>
                <span>{[viewDetail.big, viewDetail.sub].filter(Boolean).join(" · ")}</span>
              </div>
            ) : null}
          </section>
        ) : bars.length ? (
          <div className="tracking-bars">
            <div className="ch" role="group" aria-label={chartTitle}>
              {tab === "payments" ? null : (
                <span className="thr" style={{ bottom: `${kpis.gradeThreshold * 10}%` }}>
                  <b>{formatScore(kpis.gradeThreshold, locale)}</b>
                </span>
              )}
              {bars.map((item) => {
                const pointIndex = metric.points.indexOf(item);
                const ratio = tab === "payments" ? item.value / max : item.value / 10;
                const low = tab === "grades" && item.value < kpis.gradeThreshold;
                const label =
                  tab === "payments"
                    ? item.value
                      ? compactMoney(item.value, locale)
                      : ""
                    : formatScore(item.value, locale);
                return (
                  <button
                    type="button"
                    key={item.key}
                    className={`cb ${low ? "is-low" : ""} ${tab === "grades" ? "is-grade" : ""}`}
                    aria-label={`${tab === "payments" ? bucketTitle(item, t, locale) : `${formatShortDate(item.date, locale)} · ${item.assignment?.assessment || ""}`}: ${label || formatMoney(0, locale)}`}
                    onClick={() => setSheet({ type: "point", index: pointIndex })}
                  >
                    {dense ? null : <em>{label}</em>}
                    <i style={{ height: `${Math.max(3, ratio * 100)}%` }} />
                  </button>
                );
              })}
            </div>
            <div className="cx" aria-hidden="true">
              {axisTickLabels(
                bars.map((item) =>
                  tab === "payments"
                    ? item.kind === "month"
                      ? monthShort(item.start, locale)
                      : dayNumber(item.start)
                    : dayNumber(item.date),
                ),
                dense ? 8 : 12,
              ).map((text, index) => (
                <span key={bars[index].key}>{text}</span>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">{t("No data in this period.")}</p>
        )}
        <section>
          <div className="sh">
            <h2>{t("Students")}</h2>
            <span>{t(students.length === 1 ? "{count} student" : "{count} students", { count: students.length })}</span>
          </div>
          <div className="chip-row" role="group" aria-label={t("Filter students")}>
            {mobileChips.map((item) => (
              <button
                type="button"
                key={item.value}
                className={`chip ${chip === item.value ? "is-active" : ""}`}
                aria-pressed={chip === item.value}
                onClick={() => setChip(item.value)}
              >
                {item.label}
                <b>{item.count}</b>
              </button>
            ))}
          </div>
          <div className="list-rows">
            {mobileList.map((row) => {
              const look = rowView(row);
              return (
                <ListRow
                  key={row.student.id}
                  avatar={<StudentAvatar avatarId={row.student.avatarId} name={row.student.fullName} decorative />}
                  name={row.student.fullName}
                  context={
                    tab === "payments"
                      ? row.owed
                        ? `${t(row.overdue ? "Overdue" : "Pending")} · ${
                            row.monthlyDue.length
                              ? t("monthly fee")
                              : row.reasons
                                  .filter((item) => item.kind === "class")
                                  .map((item) => formatShortDate(item.date, locale))
                                  .slice(0, 2)
                                  .join(", ")
                          }`
                        : t("Paid {amount}", { amount: formatMoney(row.paid, locale) })
                      : tab === "attendance"
                        ? `${groupNamesOf(row.student, groupsById, t) || t("Individual")} · ${t("{present} of {total}", { present: row.classes - row.absences, total: row.classes })}`
                        : look.sub
                  }
                  value={tab === "payments" && !row.owed ? t("Up to date") : look.value}
                  valueTone={tab === "payments" && !row.owed ? "ok" : look.tone.replace("text-", "")}
                  onClick={() => setSheet({ type: "student", id: row.student.id })}
                />
              );
            })}
            {!mobileList.length ? <p className="muted">{t("Nobody in this filter.")}</p> : null}
          </div>
        </section>
        <Button icon={Download} className="tracking-export" onClick={exportVisible}>
          {t("Export to Excel")}
        </Button>
        <BottomSheet
          open={Boolean(sheetPoint)}
          onClose={() => setSheet(null)}
          kicker={sheetPoint ? (tab === "payments" ? t("Collections") : formatShortDate(sheetPoint.date, locale)) : ""}
          title={
            sheetPoint
              ? tab === "payments"
                ? bucketTitle(sheetPoint, t, locale)
                : sheetPoint.assignment?.assessment
              : ""
          }
        >
          {sheetPoint ? (
            <div className="point-sheet">
              {tab === "grades" ? (
                <>
                  <div className="point-big">
                    <b>{formatScore(sheetPoint.value, locale)}</b>
                    <span>{t("average · {date}", { date: formatShortDate(sheetPoint.date, locale) })}</span>
                  </div>
                  <div className="list-rows">
                    {[...sheetPoint.assignment.grades]
                      .sort((left, right) => left.value - right.value)
                      .map((grade) => {
                        const student = (state.students || []).find((s) => s.id === grade.studentId);
                        return student ? (
                          <ListRow
                            key={grade.studentId}
                            avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />}
                            name={student.fullName}
                            value={formatScore(grade.value, locale)}
                            valueTone={grade.value < kpis.gradeThreshold ? "bad" : ""}
                          />
                        ) : null;
                      })}
                    {sheetPoint.assignment.missing.map((id) => {
                      const student = (state.students || []).find((s) => s.id === id);
                      return student ? (
                        <ListRow
                          key={id}
                          avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />}
                          name={student.fullName}
                          context={t("No grade yet")}
                          contextTone="pend"
                          value="—"
                        />
                      ) : null;
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="point-big">
                    <b>{formatMoney(sheetPoint.value, locale)}</b>
                    <span>
                      {t(sheetPoint.payments.length === 1 ? "{count} payment" : "{count} payments", {
                        count: sheetPoint.payments.length,
                      })}
                    </span>
                  </div>
                  <div className="list-rows">
                    {sheetPoint.payments.map((payment) => {
                      const student = (state.students || []).find((s) => s.id === payment.studentId);
                      return student ? (
                        <ListRow
                          key={payment.id}
                          avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />}
                          name={student.fullName}
                          context={`${payment.kind === "monthly" ? t("Monthly fee") : groupsById.get(payment.groupId)?.name || t("Individual")} · ${formatShortDate(payment.date, locale)}`}
                          value={formatMoney(payment.amount, locale)}
                        />
                      ) : null;
                    })}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </BottomSheet>
        <BottomSheet
          open={Boolean(sheetStudent)}
          onClose={() => setSheet(null)}
          title={sheetStudent?.student.fullName || ""}
          kicker={periodOptions.find((option) => option.value === period)?.short}
        >
          {sheetStudent ? (
            <StudentHistory
              row={sheetStudent}
              records={trackingRecords(state, derived, range, scope, sheetStudent.student.id)}
              groupsById={groupsById}
              onClose={() => setSheet(null)}
              onOpenStudent={() => openPage?.("community", { type: "open-student", id: sheetStudent.student.id })}
            />
          ) : null}
        </BottomSheet>
        {rangeDrawer}
      </div>
    );
  }

  return (
    <div className="page tracking-page">
      <SectionHeading
        title={t("Tracking")}
        actions={
          <>
            <Select
              aria-label={t("Report period")}
              className="tracking-period"
              value={period}
              onChange={(event) => choosePeriod(event.target.value)}
            >
              {periodOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  data-meta={
                    option.value === period && reportDate
                      ? t("Up to {date}", { date: formatDayMonth(asOf, locale) })
                      : undefined
                  }
                >
                  {option.label}
                </option>
              ))}
            </Select>
            <IconButton
              label={
                period === "custom"
                  ? t("Custom range")
                  : reportDate
                    ? t("Report date: {date}", { date: formatShortDate(reportDate, locale) })
                    : t("Report date")
              }
              icon={CalendarDays}
              className={reportDate || period === "custom" ? "is-active" : ""}
              onClick={() => {
                if (period === "custom") return openRange();
                setDateDraft(asOf);
                setDateOpen(true);
              }}
            />
            <Button icon={Download} onClick={exportVisible}>
              {t("Export Excel")}
            </Button>
          </>
        }
      />
      <div className="tracking-bar" data-onboarding-tour="tracking">
        <Tabs value={tab} onChange={(value) => changeTab(value)} items={TAB_ITEMS} ariaLabel={t("Tracking views")} />
        <Segmented value={mode} onChange={setMode} label={t("Show")} items={MODE_ITEMS} />
      </div>
      <div className="tracking-scope">
        <Select
          className="tracking-group-select"
          aria-label={t("Filter by group")}
          value={scope}
          onChange={(event) => {
            setScope(event.target.value);
            reset();
            setStudentId("");
          }}
        >
          {groupChips.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
        {scopeNode}
        <ChartViewPicker
          metric={TAB_METRIC[tab]}
          value={view}
          monthly={period === "month"}
          className="tracking-view-picker"
          onChange={pickView}
        />
      </div>
      {reportDate && period !== "custom" ? (
        <p className="notice tracking-date-note">
          {t("Showing figures up to {date}.", { date: formatDayMonth(reportDate, locale) })}{" "}
          <button type="button" className="link-button" onClick={() => setReportDate("")}>
            {t("Back to today")}
          </button>
        </p>
      ) : null}
      {blocks.map((block) => (
        <MonthlyBlock key={block.group.id} block={block} asOf={asOf} onToggle={toggleMonthly} busy={busy} />
      ))}
      {mode === "summary" ? (
        <div className={`tracking-cols hibi-chart ${tab === "grades" ? "is-indigo" : ""}`}>
          <section className="tracking-chart" aria-labelledby="tracking-chart-title">
            <div className="chead">
              <h2 id="tracking-chart-title">{chartTitle}</h2>
            </div>
            {!plot ? (
              <ChartView
                view={view}
                data={viewData}
                size="big"
                selected={viewDetail?.key}
                onSelect={pickPoint}
                context={viewContext}
              />
            ) : (
              <div className={`bplot ${studentId ? "is-dim" : ""}`}>
                {ticks.map((label, tickIndex) => (
                  <span className="grid" key={tickIndex} style={{ bottom: `${tickIndex * 50}%` }}>
                    <b>{label}</b>
                  </span>
                ))}
                {metric.points.length ? (
                  <Plot
                    metric={metric}
                    selected={focus ? index : -1}
                    onSelect={pickPoint}
                    threshold={threshold}
                    size="big"
                    mineFor={
                      tab === "payments" && studentId
                        ? (bucket) =>
                            bucket.payments
                              .filter((item) => item.studentId === studentId)
                              .reduce((sum, item) => sum + item.amount, 0)
                        : null
                    }
                  />
                ) : (
                  <p className="muted xp-empty">{t("No data in this period.")}</p>
                )}
              </div>
            )}
            <div className="leg" hidden={!plot || !metric.points.length}>
              {tab === "grades" ? (
                <>
                  <span>
                    <i className="leg-dot" />
                    {t("Average of the assignment")}
                  </span>
                  <span>
                    <i className="leg-range" />
                    {t("From lowest to highest")}
                  </span>
                  <span>
                    <i className="leg-line" />
                    {t("Low grade · {value}", { value: formatScore(kpis.gradeThreshold, locale) })}
                  </span>
                </>
              ) : (
                <span>
                  <i className="leg-bar" />
                  {t("Collections by payment date")}
                </span>
              )}
            </div>
            {focusLabel ? (
              <div className="focus" aria-live="polite">
                <span className="overline">{t("Showing")}</span>
                <b>{focusLabel.title}</b>
                <span className="muted">{focusLabel.sub}</span>
                <button type="button" className="xbtn" onClick={() => setFocus(false)}>
                  {t("Clear filter")}
                </button>
              </div>
            ) : null}
            {selectedRow ? (
              <StudentHistory
                row={selectedRow}
                records={records}
                groupsById={groupsById}
                onClose={() => setStudentId("")}
                onOpenStudent={() => openPage?.("community", { type: "open-student", id: selectedRow.student.id })}
              />
            ) : null}
          </section>
          <aside className="tlist" aria-labelledby="tracking-list-title">
            <div className="lh">
              <h2 id="tracking-list-title" className="overline">
                {listTitle}
              </h2>
            </div>
            {list.map((row) => {
              const look = rowView(row);
              return (
                <button
                  type="button"
                  key={row.student.id}
                  className={`tsr ${studentId === row.student.id ? "on" : look.hit ? "hit" : ""}`}
                  aria-pressed={studentId === row.student.id}
                  onClick={() => setStudentId(studentId === row.student.id ? "" : row.student.id)}
                >
                  <StudentAvatar avatarId={row.student.avatarId} name={row.student.fullName} size="small" decorative />
                  <span className="nm">
                    <strong>{row.student.fullName}</strong>
                    <small>{look.sub}</small>
                  </span>
                  <span className="rv">
                    <b className={look.tone}>{look.value}</b>
                    {look.squares?.length ? (
                      <span className="mini" aria-hidden="true">
                        {look.squares.map((entry, squareIndex) => (
                          <span key={squareIndex} className={entry.code === "A" ? "is-absent" : "is-present"} />
                        ))}
                      </span>
                    ) : null}
                    {look.bars?.length ? (
                      <span className="mini" aria-hidden="true">
                        {look.bars.map((value, barIndex) => (
                          <i
                            key={barIndex}
                            style={{ height: `${value * 10}%` }}
                            className={value < kpis.gradeThreshold ? "is-low" : ""}
                          />
                        ))}
                      </span>
                    ) : null}
                    {look.status ? <span className={`st ${look.status.tone}`}>{look.status.text}</span> : null}
                  </span>
                </button>
              );
            })}
            {!list.length ? <p className="muted tlist-empty">{t("Nobody in this filter.")}</p> : null}
          </aside>
        </div>
      ) : (
        <section className="tracking-breakdown" aria-labelledby="tracking-breakdown-title">
          <div className="chead">
            <h2 id="tracking-breakdown-title">{t("Breakdown by class and student")}</h2>
            <span className="muted">
              {t(records.length === 1 ? "{count} record" : "{count} records", { count: records.length })}
            </span>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Breakdown")}>
            <div className="tb" role="table" aria-label={t("Records")}>
              <div className="tr th" role="row">
                <span role="columnheader">{t("Date")}</span>
                <span role="columnheader">{t("Class")}</span>
                <span role="columnheader">{t("Student")}</span>
                <span role="columnheader">{t("Attendance")}</span>
                <span role="columnheader">{t("Grade")}</span>
                <span role="columnheader">{t("Payment")}</span>
              </div>
              {records.map((record) => {
                const attendance = attendanceWord(record.row, t);
                const payment = paymentWord(record, t);
                return (
                  <div className="tr" role="row" key={record.row.id}>
                    <span role="cell" className="tnum">
                      {formatShortDate(record.row.classDate, locale)} · {formatTime(record.row.startTime, locale)}
                    </span>
                    <span role="cell">
                      {[record.className || t("Individual"), record.assessment].filter(Boolean).join(" · ")}
                    </span>
                    <span role="cell" className="tr-name">
                      {record.student.fullName}
                    </span>
                    <span role="cell">
                      <span className={`st ${attendance.tone}`}>{attendance.text}</span>
                    </span>
                    <span
                      role="cell"
                      className={`tnum tr-grade ${record.grade !== null && record.grade < kpis.gradeThreshold ? "text-bad" : ""}`}
                    >
                      {record.grade === null
                        ? record.ungraded
                          ? t("Ungraded")
                          : "—"
                        : formatScore(record.grade, locale)}
                    </span>
                    <span role="cell">
                      {payment.tone ? <span className={`st ${payment.tone}`}>{payment.text}</span> : "—"}
                    </span>
                  </div>
                );
              })}
              {!records.length ? <p className="muted">{t("No classes in this period.")}</p> : null}
            </div>
          </div>
        </section>
      )}
      <Drawer
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        title={t("Report date")}
        description={t("See the figures as they were on another day. Saved records do not change.")}
        size="compact"
        footer={
          <>
            <Button
              onClick={() => {
                setReportDate("");
                setDateOpen(false);
                reset();
              }}
            >
              {t("Use today")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setReportDate(dateDraft && dateDraft !== liveDate ? dateDraft : "");
                setDateOpen(false);
                reset();
              }}
            >
              {t("Apply")}
            </Button>
          </>
        }
      >
        <Field label={t("Report date")}>
          <Input type="date" value={dateDraft} max={liveDate} onChange={(event) => setDateDraft(event.target.value)} />
        </Field>
      </Drawer>
      {rangeDrawer}
    </div>
  );
}
