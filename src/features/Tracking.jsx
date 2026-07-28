import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  Lightbulb,
  MoreHorizontal,
  RotateCcw,
  Search,
  Settings2,
  Star,
  TrendingDown,
  TrendingUp,
  UserRound,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import {
  Button,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  StatusBadge,
} from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { useHistoryBackedState } from "../hooks/useHistoryNavigation";
import { getUiLocale } from "../i18n";
import {
  buildAssessmentOptions,
  buildAttendanceTracking,
  buildGradeTracking,
  buildPaymentTracking,
  trackingRange,
} from "./trackingModel";

const TAB_ITEMS = [
  { value: "grades", label: "Grades" },
  { value: "attendance", label: "Attendance" },
  { value: "payments", label: "Payments" },
];
const PERIOD_ITEMS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "thirty", label: "Last 30 days" },
  { value: "all", label: "All records" },
];

function formatDate(
  value,
  options = { day: "2-digit", month: "short", year: "numeric" },
) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(getUiLocale(), options).format(
    new Date(`${value}T12:00:00`),
  );
}

function formatTime(value) {
  if (!value) return "";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(getUiLocale(), {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, hour, minute));
}

function percent(value, digits = 0) {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function gradeValue(value, maximum) {
  if (value == null) return "—";
  return `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)} / ${maximum || 10}`;
}

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
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
  const url = URL.createObjectURL(
    new Blob(["\ufeff", html], {
      type: "application/vnd.ms-excel;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TrackingTabs({ value, onChange }) {
  return (
    <div className="tracking-tabs" role="tablist" aria-label="Tracking views">
      {TAB_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ModeSwitch({ value, onChange, items }) {
  return (
    <div className="tracking-mode">
      <strong>View by</strong>
      <div role="group" aria-label="View tracking by">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            className={value === item.value ? "active" : ""}
            aria-pressed={value === item.value}
            disabled={item.disabled}
            title={
              item.disabled
                ? "Create a group in Community to use this view"
                : undefined
            }
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TrackingSelect({
  label,
  value,
  onChange,
  children,
  searchable = false,
}) {
  return (
    <label className="tracking-select">
      <strong>{label}</strong>
      <Select value={value} onChange={onChange} searchable={searchable}>
        {children}
      </Select>
    </label>
  );
}

function Metric({ icon: Icon, label, value, note, tone = "green" }) {
  return (
    <div className={`tracking-metric ${tone}`}>
      <span>
        <Icon size={24} aria-hidden="true" />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {note ? <em>{note}</em> : null}
      </div>
    </div>
  );
}

function MetricStrip({ title, children }) {
  return (
    <section className="tracking-summary">
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function TrendChart({ title, series, valueFormatter = percent }) {
  if (!series.length)
    return (
      <div className="tracking-chart">
        <h3>{title}</h3>
        <EmptyState
          icon={BarChart3}
          title="No trend yet"
          description="The chart will appear after records are saved in this period."
        />
      </div>
    );
  const width = 760;
  const height = 168;
  const padding = { left: 42, right: 20, top: 24, bottom: 34 };
  const max = Math.max(1, ...series.map((item) => item.value || 0));
  const points = series.map((item, index) => ({
    ...item,
    x:
      padding.left +
      (index / Math.max(series.length - 1, 1)) *
        (width - padding.left - padding.right),
    y:
      padding.top +
      (1 - (item.value || 0) / max) * (height - padding.top - padding.bottom),
  }));
  const line = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${points.at(-1).x} ${height - padding.bottom} L${points[0].x} ${height - padding.bottom} Z`;
  return (
    <div className="tracking-chart">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <g className="tracking-grid">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <line
              key={ratio}
              x1={padding.left}
              x2={width - padding.right}
              y1={padding.top + ratio * (height - padding.top - padding.bottom)}
              y2={padding.top + ratio * (height - padding.top - padding.bottom)}
            />
          ))}
        </g>
        <path className="tracking-area" d={area} />
        <path className="tracking-line" d={line} />
        {points.map((point) => (
          <g key={`${point.label}-${point.x}`}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text
              className="tracking-point-value"
              x={point.x}
              y={point.y - 10}
              textAnchor="middle"
            >
              {valueFormatter(point.value)}
            </text>
            <text
              className="tracking-axis-label"
              x={point.x}
              y={height - 10}
              textAnchor="middle"
            >
              {formatDate(point.label, { day: "numeric", month: "short" })}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DistributionChart({ items }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="tracking-chart tracking-distribution">
      <h3>Grade distribution</h3>
      <div>
        {items.map((item) => (
          <span key={item.label}>
            <i>
              <b
                className={item.tone}
                style={{ height: `${Math.max(5, (item.value / max) * 100)}%` }}
              />
            </i>
            <strong>{item.value}</strong>
            <small>{item.label}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function InsightPanel({ title, insights, footer }) {
  return (
    <aside className="tracking-side-card">
      <h3>
        <Lightbulb size={20} aria-hidden="true" />
        {title}
      </h3>
      <ul>
        {insights.map((insight, index) => {
          const Icon = insight.icon || CheckCircle2;
          return (
            <li
              className={insight.tone || "green"}
              key={`${insight.text}-${index}`}
            >
              <span>
                <Icon size={15} aria-hidden="true" />
              </span>
              <p>{insight.text}</p>
            </li>
          );
        })}
      </ul>
      {footer}
    </aside>
  );
}

function RecentPanel({ title, rows, renderRow, footer }) {
  return (
    <aside className="tracking-side-card tracking-recent">
      <h3>
        <CalendarDays size={19} aria-hidden="true" />
        {title}
      </h3>
      {rows.length ? (
        <div>{rows.map(renderRow)}</div>
      ) : (
        <p className="tracking-empty-copy">
          No matching records in this period.
        </p>
      )}
      {footer}
    </aside>
  );
}

function RelatedClassButton({ sessionKey, onOpen }) {
  return (
    <IconButton
      label="View related class"
      icon={MoreHorizontal}
      disabled={!sessionKey}
      onClick={() => onOpen(sessionKey)}
    />
  );
}

function StudentCell({ student }) {
  return (
    <span className="tracking-person">
      <StudentAvatar
        avatarId={student?.avatarId}
        name={student?.fullName}
        size="tiny"
        decorative
      />
      <span>
        <strong>{student?.fullName || "Unknown student"}</strong>
        <small>{student?.code || ""}</small>
      </span>
    </span>
  );
}

function GradeView({ data, mode, onOpenClass }) {
  const maximum =
    data.assessment?.maximum ||
    data.tableRows.find((row) => row.maximum)?.maximum ||
    10;
  const insights = [
    {
      icon: TrendingUp,
      text:
        data.average == null
          ? "No grades have been recorded in this view yet."
          : `The current average is ${percent(data.average, 0)}.`,
    },
    {
      icon: Star,
      text:
        data.best == null
          ? "A best result will appear after grading."
          : `The best result is ${percent(data.best, 0)}.`,
    },
    {
      icon: CircleAlert,
      tone: data.tableRows.filter(
        (row) => row.percentage != null && row.percentage < 0.6,
      ).length
        ? "orange"
        : "green",
      text: `${data.tableRows.filter((row) => row.percentage != null && row.percentage < 0.6).length} students scored below 60%.`,
    },
    {
      icon: UserRound,
      tone: data.missingCount ? "blue" : "green",
      text: `${data.missingCount} assignments remain without a grade.`,
    },
  ];
  return (
    <div className="tracking-content-grid">
      <main>
        <MetricStrip
          title={mode === "student" ? "Student summary" : "Assessment summary"}
        >
          <Metric
            icon={TrendingUp}
            label="Average grade"
            value={percent(data.average)}
          />
          <Metric icon={Star} label="Best result" value={percent(data.best)} />
          <Metric
            icon={TrendingDown}
            label="Lowest result"
            value={percent(data.worst)}
            tone="red"
          />
          <Metric
            icon={UsersRound}
            label="Graded assignments"
            value={data.gradedCount}
            tone="blue"
          />
          <Metric
            icon={UserRound}
            label="Not graded"
            value={data.missingCount}
            tone="orange"
          />
        </MetricStrip>
        {mode === "student" ? (
          <TrendChart title="Grade evolution" series={data.series} />
        ) : (
          <DistributionChart items={data.distribution} />
        )}
        <section className="tracking-table-shell" aria-label="Grade details">
          <table>
            <thead>
              <tr>
                {mode === "group" ? <th>Student</th> : <th>Assignment</th>}
                <th>Date</th>
                <th>Grade</th>
                <th>Percentage</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.tableRows.map((row) => (
                <tr key={row.id}>
                  {mode === "group" ? (
                    <td>
                      <StudentCell student={row.student} />
                    </td>
                  ) : (
                    <td>
                      <strong>{row.assessment}</strong>
                    </td>
                  )}
                  <td>{formatDate(row.date)}</td>
                  <td
                    className={
                      row.percentage != null && row.percentage < 0.6
                        ? "danger-value"
                        : "good-value"
                    }
                  >
                    {gradeValue(row.score, row.maximum)}
                  </td>
                  <td>{percent(row.percentage)}</td>
                  <td>
                    <StatusBadge tone={row.status.tone}>
                      {row.status.label}
                    </StatusBadge>
                  </td>
                  <td>
                    <RelatedClassButton
                      sessionKey={row.sessionKey}
                      onOpen={onOpenClass}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.tableRows.length ? (
            <EmptyState
              icon={Star}
              title="No grades found"
              description="Try another group, student, assessment, or period."
            />
          ) : null}
        </section>
      </main>
      <aside className="tracking-sidebar">
        <InsightPanel
          title={
            mode === "student" ? "Student insights" : "Assessment insights"
          }
          insights={insights}
        />
        <RecentPanel
          title="Latest assignments"
          rows={data.tableRows
            .filter((row) => row.percentage != null)
            .slice(0, 3)}
          renderRow={(row) => (
            <div className="tracking-recent-row" key={`recent-${row.id}`}>
              <span>
                <strong>{row.assessment}</strong>
                <small>{formatDate(row.date)}</small>
              </span>
              <b>{gradeValue(row.score, row.maximum)}</b>
            </div>
          )}
        />
      </aside>
    </div>
  );
}

function AttendanceView({ data, mode, onOpenClass }) {
  const low = data.tableRows.filter(
    (row) => row.rate != null && row.rate < 0.8,
  );
  const highCount = data.tableRows.filter(
    (row) => row.rate != null && row.rate >= 0.9,
  ).length;
  const insights = [
    {
      icon: TrendingUp,
      text:
        data.average == null
          ? "No attendance has been recorded in this period."
          : `Average attendance is ${percent(data.average)}.`,
    },
    {
      icon: CheckCircle2,
      text: `${highCount} ${highCount === 1 ? "record is" : "records are"} at or above 90%.`,
    },
    {
      icon: CircleAlert,
      tone: low.length ? "orange" : "green",
      text: `${low.length} ${mode === "group" ? "students are" : "classes are"} below 80%.`,
    },
    {
      icon: CalendarDays,
      tone: "blue",
      text: `${data.sessions} ${data.sessions === 1 ? "class session was" : "class sessions were"} included.`,
    },
  ];
  return (
    <div className="tracking-content-grid">
      <main>
        <MetricStrip title="Attendance summary">
          <Metric
            icon={UsersRound}
            label="Average attendance"
            value={percent(data.average)}
          />
          <Metric
            icon={CalendarDays}
            label="Recorded classes"
            value={data.sessions}
          />
          <Metric
            icon={UserRoundCheck}
            label="Present"
            value={data.present}
            note={`of ${data.total}`}
          />
          <Metric
            icon={UserRound}
            label="Absent"
            value={data.absent}
            note={`of ${data.total}`}
            tone="orange"
          />
        </MetricStrip>
        <TrendChart title="Attendance evolution by week" series={data.series} />
        <section
          className="tracking-table-shell"
          aria-label="Attendance details"
        >
          <table>
            <thead>
              <tr>
                {mode === "group" ? <th>Student</th> : <th>Class</th>}
                <th>Attendance</th>
                <th>Present</th>
                <th>Absences</th>
                <th>{mode === "group" ? "Last class" : "Date"}</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.tableRows.map((row) => (
                <tr key={row.id}>
                  {mode === "group" ? (
                    <td>
                      <StudentCell student={row.student} />
                    </td>
                  ) : (
                    <td>
                      <strong>{row.classTitle}</strong>
                    </td>
                  )}
                  <td
                    className={
                      row.rate != null && row.rate < 0.8
                        ? "danger-value"
                        : "good-value"
                    }
                  >
                    {percent(row.rate)}
                  </td>
                  <td>{row.present}</td>
                  <td className={row.absent ? "danger-value" : ""}>
                    {row.absent}
                  </td>
                  <td>{formatDate(row.lastClass || row.classDate)}</td>
                  <td>
                    <StatusBadge tone={row.status.tone}>
                      {row.status.label}
                    </StatusBadge>
                  </td>
                  <td>
                    <RelatedClassButton
                      sessionKey={row.sessionKey}
                      onOpen={onOpenClass}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.tableRows.length ? (
            <EmptyState
              icon={UserRoundCheck}
              title="No attendance found"
              description="Try another group, student, or period."
            />
          ) : null}
        </section>
      </main>
      <aside className="tracking-sidebar">
        <InsightPanel title="Period insights" insights={insights} />
        <RecentPanel
          title={mode === "group" ? "Attendance below 80%" : "Recent absences"}
          rows={low.slice(0, 4)}
          renderRow={(row) => (
            <div className="tracking-recent-row" key={`low-${row.id}`}>
              {mode === "group" ? (
                <StudentCell student={row.student} />
              ) : (
                <span>
                  <strong>{row.classTitle}</strong>
                  <small>{formatDate(row.classDate)}</small>
                </span>
              )}
              <b className="warning-value">{percent(row.rate)}</b>
            </div>
          )}
        />
      </aside>
    </div>
  );
}

function PaymentBar({ data }) {
  const ratio =
    data.generated > 0 ? Math.min(1, data.collected / data.generated) : 0;
  return (
    <div className="tracking-payment-chart">
      <h3>Collected vs. pending</h3>
      <div className="payment-chart-labels">
        <span>
          Collected <strong>{percent(ratio)}</strong>
        </span>
        <span>
          Pending <strong>{percent(1 - ratio)}</strong>
        </span>
      </div>
      <div className="payment-chart-track">
        <span style={{ width: `${ratio * 100}%` }} />
        <i style={{ width: `${(1 - ratio) * 100}%` }} />
      </div>
      <div className="payment-chart-values">
        <strong>{money(data.collected)}</strong>
        <span>
          Total generated <b>{money(data.generated)}</b>
        </span>
        <strong>{money(data.pending)}</strong>
      </div>
    </div>
  );
}

function PaymentView({ data, mode, onOpenClass }) {
  const pendingRows = data.tableRows.filter(
    (row) =>
      row.pending > 0 ||
      row.status?.label === "Pending" ||
      row.status?.label === "Overdue",
  );
  const insights = [
    {
      icon: CircleDollarSign,
      text: `${percent(data.generated ? data.collected / data.generated : null)} of the generated value has been collected.`,
    },
    {
      icon: CheckCircle2,
      text: `${data.paidStudents} ${data.paidStudents === 1 ? "student has" : "students have"} paid.`,
    },
    {
      icon: Clock3,
      tone: pendingRows.length ? "orange" : "green",
      text: `${data.pendingStudents} ${data.pendingStudents === 1 ? "student still has" : "students still have"} a pending balance.`,
    },
  ];
  return (
    <div className="tracking-content-grid">
      <main>
        <MetricStrip
          title={
            mode === "class" ? "Class collection summary" : "Payment summary"
          }
        >
          <Metric
            icon={CircleDollarSign}
            label="Generated value"
            value={money(data.generated)}
          />
          <Metric
            icon={CheckCircle2}
            label="Amount collected"
            value={money(data.collected)}
          />
          <Metric
            icon={Clock3}
            label="Pending amount"
            value={money(data.pending)}
            tone="orange"
          />
          {mode === "class" ? (
            <>
              <Metric
                icon={UsersRound}
                label="Students paid"
                value={data.paidStudents}
                note={`of ${data.totalStudents}`}
                tone="blue"
              />
              <Metric
                icon={UserRound}
                label="Students pending"
                value={data.pendingStudents}
                note={`of ${data.totalStudents}`}
                tone="orange"
              />
            </>
          ) : (
            <>
              <Metric
                icon={CalendarDays}
                label="Paid classes"
                value={data.paidClasses}
                tone="blue"
              />
              <Metric
                icon={CalendarDays}
                label="Unpaid classes"
                value={data.unpaidClasses}
                tone="orange"
              />
            </>
          )}
        </MetricStrip>
        <PaymentBar data={data} />
        {mode === "class" ? null : (
          <TrendChart
            title="Payment evolution"
            series={data.series}
            valueFormatter={money}
          />
        )}
        <section className="tracking-table-shell" aria-label="Payment details">
          <table>
            <thead>
              <tr>
                {mode === "student" ? <th>Class</th> : <th>Student</th>}
                <th>{mode === "group" ? "Paid" : "Amount"}</th>
                {mode === "group" ? <th>Pending</th> : null}
                <th>Payment status</th>
                <th>Payment date</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.tableRows.map((row) => (
                <tr key={row.id}>
                  {mode === "student" ? (
                    <td>
                      <strong>{row.classTitle}</strong>
                      <small>{formatDate(row.classDate)}</small>
                    </td>
                  ) : (
                    <td>
                      <StudentCell student={row.student} />
                    </td>
                  )}
                  <td>{money(mode === "group" ? row.paid : row.charged)}</td>
                  {mode === "group" ? (
                    <td className={row.pending ? "warning-value" : ""}>
                      {money(row.pending)}
                    </td>
                  ) : null}
                  <td>
                    <StatusBadge tone={row.status.tone}>
                      {row.status.label}
                    </StatusBadge>
                  </td>
                  <td>{formatDate(row.lastPayment || row.paymentDate)}</td>
                  <td>
                    <RelatedClassButton
                      sessionKey={row.sessionKey}
                      onOpen={onOpenClass}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.tableRows.length ? (
            <EmptyState
              icon={CircleDollarSign}
              title="No payments found"
              description="Try another group, student, class, or period."
            />
          ) : null}
        </section>
      </main>
      <aside className="tracking-sidebar">
        <InsightPanel title="Collection summary" insights={insights} />
        <RecentPanel
          title="Pending in this view"
          rows={pendingRows.slice(0, 4)}
          renderRow={(row) => (
            <div className="tracking-recent-row" key={`pending-${row.id}`}>
              <StudentCell student={row.student} />
              <b className="warning-value">
                {money(row.pending || row.charged)}
              </b>
            </div>
          )}
        />
      </aside>
    </div>
  );
}

export default function Tracking({
  state = {},
  derived = {},
  actions = {},
  openPage,
}) {
  const groups = (state.groups || []).filter(
    (group) => group.status !== "Inactive",
  );
  const students = (state.students || []).filter(
    (student) => student.status !== "Inactive",
  );
  const gradeRows = derived.gradeRows || state.grades || [];
  const classRows =
    derived.classLogRows || derived.classLog || state.classLog || [];
  const [tab, setTab] = useState("grades");
  const [period, setPeriod] = useState("month");
  const [search, setSearch] = useState("");
  const [gradeMode, setGradeMode] = useState(() =>
    groups.length ? "group" : "student",
  );
  const [attendanceMode, setAttendanceMode] = useState(() =>
    groups.length ? "group" : "student",
  );
  const [paymentMode, setPaymentMode] = useState(() =>
    groups.length ? "group" : "student",
  );
  const [groupId, setGroupId] = useState(groups[0]?.id || "");
  const [studentId, setStudentId] = useState(students[0]?.id || "");
  const [assessmentKey, setAssessmentKey] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const liveDate =
    state.settings?.asOfDate || new Date().toISOString().slice(0, 10);
  const [historicalDate, setHistoricalDate] = useState("");
  const [dateSettingsOpen, setDateSettingsOpen] = useState(false);
  const [dateModeDraft, setDateModeDraft] = useState("automatic");
  const [dateDraft, setDateDraft] = useState(liveDate);
  const reportDate = historicalDate || liveDate;
  const reportState = useMemo(
    () => ({
      ...state,
      settings: {
        ...state.settings,
        asOfDate: reportDate,
        selectedMonth: `${reportDate.slice(0, 7)}-01`,
      },
    }),
    [reportDate, state],
  );
  const changeTab = useHistoryBackedState({
    key: "tracking-tab",
    value: tab,
    onChange: setTab,
    defaultValue: "grades",
    allowedValues: TAB_ITEMS.map((item) => item.value),
  });
  const range = useMemo(
    () => trackingRange(reportDate, period, [...gradeRows, ...classRows]),
    [classRows, gradeRows, period, reportDate],
  );
  const assessments = useMemo(
    () => buildAssessmentOptions(reportState, gradeRows, groupId, range),
    [gradeRows, groupId, range, reportState],
  );
  useEffect(() => {
    if (!assessments.some((item) => item.key === assessmentKey))
      setAssessmentKey(assessments[0]?.key || "");
  }, [assessmentKey, assessments]);
  const gradeData = useMemo(
    () =>
      buildGradeTracking(reportState, gradeRows, {
        mode: gradeMode,
        groupId,
        studentId,
        assessmentKey,
        range,
        search,
        classRows,
      }),
    [
      assessmentKey,
      classRows,
      gradeMode,
      gradeRows,
      groupId,
      range,
      search,
      reportState,
      studentId,
    ],
  );
  const attendanceData = useMemo(
    () =>
      buildAttendanceTracking(reportState, classRows, {
        mode: attendanceMode,
        groupId,
        studentId,
        range,
        search,
      }),
    [attendanceMode, classRows, groupId, range, reportState, search, studentId],
  );
  const paymentBase = useMemo(
    () =>
      buildPaymentTracking(reportState, classRows, {
        mode: paymentMode,
        groupId,
        studentId,
        sessionKey: "",
        range,
        search,
      }),
    [classRows, groupId, paymentMode, range, reportState, search, studentId],
  );
  useEffect(() => {
    if (!paymentBase.sessions.some((item) => item.key === sessionKey))
      setSessionKey(paymentBase.sessions[0]?.key || "");
  }, [paymentBase.sessions, sessionKey]);
  const paymentData = useMemo(
    () =>
      buildPaymentTracking(reportState, classRows, {
        mode: paymentMode,
        groupId,
        studentId,
        sessionKey,
        range,
        search,
      }),
    [
      classRows,
      groupId,
      paymentMode,
      range,
      search,
      sessionKey,
      reportState,
      studentId,
    ],
  );

  const activeMode =
    tab === "grades"
      ? gradeMode
      : tab === "attendance"
        ? attendanceMode
        : paymentMode;
  const modeItems =
    tab === "payments"
      ? [
          { value: "group", label: "Group", disabled: !groups.length },
          { value: "student", label: "Student" },
          { value: "class", label: "Class" },
        ]
      : [
          { value: "group", label: "Group", disabled: !groups.length },
          { value: "student", label: "Student" },
        ];
  const setMode =
    tab === "grades"
      ? setGradeMode
      : tab === "attendance"
        ? setAttendanceMode
        : setPaymentMode;
  const useStudentOwner =
    activeMode === "student" ||
    (tab === "payments" && activeMode === "class" && !groups.length);
  const openRelatedClass = (key) =>
    openPage?.(
      "classes",
      key ? { type: "open-history-class", sessionKey: key } : "class-history",
    );
  const exportRows =
    tab === "grades"
      ? gradeData.tableRows.map((row) => ({
          Student: row.student?.fullName || "",
          Assignment: row.assessment,
          Date: row.date,
          Grade: row.score ?? "",
          Maximum: row.maximum,
          Percentage: percent(row.percentage),
          Status: row.status.label,
        }))
      : tab === "attendance"
        ? attendanceData.tableRows.map((row) => ({
            Student: row.student?.fullName || "",
            Class: row.classTitle || "",
            Date: row.lastClass || row.classDate || "",
            Attendance: percent(row.rate),
            Present: row.present,
            Absences: row.absent,
            Status: row.status.label,
          }))
        : paymentData.tableRows.map((row) => ({
            Student: row.student?.fullName || "",
            Class: row.classTitle || "",
            Date: row.classDate || "",
            Charged: row.charged ?? "",
            Paid: row.paid ?? "",
            Pending: row.pending ?? "",
            Status: row.status.label,
            PaymentDate: row.lastPayment || row.paymentDate || "",
          }));
  const exportVisible = () => {
    if (!exportRows.length)
      return actions.notify?.(
        "There is nothing to export in this view.",
        "error",
      );
    downloadExcel(
      `hibi-${tab}-${range.start}-${range.end}.xls`,
      `Hibi ${tab} · ${range.start} to ${range.end}`,
      exportRows,
    );
    actions.notify?.("Excel export downloaded");
  };

  const openDateSettings = () => {
    setDateModeDraft(historicalDate ? "historical" : "automatic");
    setDateDraft(historicalDate || liveDate);
    setDateSettingsOpen(true);
  };
  const applyDateSettings = () => {
    setHistoricalDate(dateModeDraft === "historical" ? dateDraft : "");
    setDateSettingsOpen(false);
  };
  return (
    <>
      <div className="page tracking-page">
        <header className="tracking-heading">
          <div>
            <h1>
              Tracking <span aria-hidden="true">🌿</span>
            </h1>
            <p>
              Review grades, attendance, and payments for students and groups.
            </p>
          </div>
          <div className="tracking-top-actions">
            <TrackingSelect
              label="Period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              {PERIOD_ITEMS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </TrackingSelect>
            <label className="tracking-search">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search students or groups</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search students or groups…"
              />
            </label>
            <Button icon={FileSpreadsheet} onClick={exportVisible}>
              Export Excel
            </Button>
            <Button icon={Settings2} onClick={openDateSettings}>
              Report date
            </Button>
          </div>
        </header>
        <TrackingTabs value={tab} onChange={changeTab} />
        {historicalDate ? (
          <div className="tracking-historical-banner" role="status">
            <span>
              <CalendarDays size={18} aria-hidden="true" />
              <span>
                <strong>Historical view</strong>
                <small>Data calculated through {formatDate(reportDate)}.</small>
              </span>
            </span>
            <Button icon={RotateCcw} onClick={() => setHistoricalDate("")}>
              Back to today
            </Button>
          </div>
        ) : null}
        <div className="tracking-context">
          <ModeSwitch value={activeMode} onChange={setMode} items={modeItems} />
          {useStudentOwner ? (
            <TrackingSelect
              label="Student"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              searchable
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName}
                </option>
              ))}
            </TrackingSelect>
          ) : (
            <TrackingSelect
              label="Group"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              searchable
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </TrackingSelect>
          )}
          {tab === "grades" && gradeMode === "group" ? (
            <TrackingSelect
              label="Assignment"
              value={assessmentKey}
              onChange={(event) => setAssessmentKey(event.target.value)}
              searchable
            >
              {assessments.length ? (
                assessments.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.assessment} · {formatDate(item.date)}
                  </option>
                ))
              ) : (
                <option value="">No assignments</option>
              )}
            </TrackingSelect>
          ) : null}
          {tab === "payments" && paymentMode === "class" ? (
            <TrackingSelect
              label="Class"
              value={sessionKey}
              onChange={(event) => setSessionKey(event.target.value)}
              searchable
            >
              {paymentBase.sessions.length ? (
                paymentBase.sessions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {formatDate(item.classDate)} · {formatTime(item.startTime)}{" "}
                    · {item.title}
                  </option>
                ))
              ) : (
                <option value="">No classes</option>
              )}
            </TrackingSelect>
          ) : null}
        </div>
        <section role="tabpanel">
          {tab === "grades" ? (
            <GradeView
              data={gradeData}
              mode={gradeMode}
              onOpenClass={openRelatedClass}
            />
          ) : null}
          {tab === "attendance" ? (
            <AttendanceView
              data={attendanceData}
              mode={attendanceMode}
              onOpenClass={openRelatedClass}
            />
          ) : null}
          {tab === "payments" ? (
            <PaymentView
              data={paymentData}
              mode={paymentMode}
              onOpenClass={openRelatedClass}
            />
          ) : null}
        </section>
      </div>
      <Drawer
        open={dateSettingsOpen}
        onClose={() => setDateSettingsOpen(false)}
        title="Report date"
        description="Choose the last day to include in Tracking."
        size="compact"
        footer={
          <>
            <Button onClick={() => setDateSettingsOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={dateModeDraft === "historical" && !dateDraft}
              onClick={applyDateSettings}
            >
              Apply date
            </Button>
          </>
        }
      >
        <div className="tracking-date-settings">
          <div
            className="tracking-date-mode"
            role="group"
            aria-label="Reporting date mode"
          >
            <button
              type="button"
              className={dateModeDraft === "automatic" ? "active" : ""}
              aria-pressed={dateModeDraft === "automatic"}
              onClick={() => setDateModeDraft("automatic")}
            >
              Use today
            </button>
            <button
              type="button"
              className={dateModeDraft === "historical" ? "active" : ""}
              aria-pressed={dateModeDraft === "historical"}
              onClick={() => setDateModeDraft("historical")}
            >
              Choose another date
            </button>
          </div>
          {dateModeDraft === "historical" ? (
            <>
              <Field label="Show data through">
                <Input
                  type="date"
                  max={liveDate}
                  value={dateDraft}
                  onInput={(event) => setDateDraft(event.currentTarget.value)}
                />
              </Field>
              <div className="tracking-date-note historical">
                <CalendarDays size={19} aria-hidden="true" />
                <div>
                  <strong>Historical preview</strong>
                  <p>
                    You will see grades, attendance, and payments recorded
                    through{" "}
                    <time dateTime={dateDraft}>{formatDate(dateDraft)}</time>.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="tracking-date-note">
              <CalendarDays size={19} aria-hidden="true" />
              <div>
                <strong>
                  Using today:{" "}
                  <time dateTime={liveDate}>{formatDate(liveDate)}</time>
                </strong>
                <p>Hibi will update this date automatically each day.</p>
              </div>
            </div>
          )}
        </div>
      </Drawer>
    </>
  );
}
