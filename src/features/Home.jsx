import { uiText } from "../i18n/index.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  CircleArrowDown,
  CircleArrowUp,
  CircleMinus,
  Clock3,
  CreditCard,
  GraduationCap,
  Info,
  LayoutGrid,
  Pencil,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  UserRoundCheck,
  UsersRound,
  Wallet,
} from "lucide-react";
import { StudentAvatar } from "../components/StudentAvatar";
import { getUiLocale, useI18n } from "../i18n";
import { createNumberFormatter } from "../utils/numberFormatter";
import { buildHomeDashboard, HOME_PERIODS } from "./homeDashboardModel";

const PERIOD_LABELS = Object.freeze({
  today: "Today",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
});

const PERIOD_NOUNS = Object.freeze({
  today: "today",
  weekly: "this week",
  monthly: "this month",
  yearly: "this year",
});

const formatMoney = createNumberFormatter({ style: "currency", currency: "MXN", maximumFractionDigits: 0 });

function money(value) {
  return formatMoney(Number(value || 0), getUiLocale());
}

function percent(value, digits = 0) {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function formatTime(value) {
  if (!value) return "Time not set";
  return new Date(`2000-01-01T${value}`).toLocaleTimeString(getUiLocale(), {
    hour: "numeric",
    minute: "2-digit",
  });
}

function Delta({ value, kind = "percent" }) {
  const { t: uiT } = useI18n();
  if (value == null) return <span className="home-delta neutral">{uiT("New")}</span>;
  const positive = value > 0;
  const negative = value < 0;
  const amount =
    kind === "points"
      ? `${Math.abs(value * 100).toFixed(0)} pp`
      : kind === "grade"
        ? Math.abs(value * 10).toFixed(1)
        : `${Math.abs(value * 100).toFixed(0)}%`;
  return (
    <span className={`home-delta ${positive ? "positive" : negative ? "negative" : "neutral"}`}>
      {positive ? "↑" : negative ? "↓" : "→"} {amount}
    </span>
  );
}

function Ring({ value, tone }) {
  const normalized = Math.max(0, Math.min(1, value || 0));
  const circumference = 2 * Math.PI * 38;
  return (
    <svg className={`home-ring ${tone}`} viewBox="0 0 96 96" aria-hidden="true">
      <circle className="ring-track" cx="48" cy="48" r="38" />
      <circle
        className="ring-value"
        cx="48"
        cy="48"
        r="38"
        pathLength={circumference}
        strokeDasharray={`${circumference * normalized} ${circumference}`}
      />
    </svg>
  );
}

function linePoints(values, width, height, padding = 5) {
  const safe = values.length > 1 ? values : [values[0] || 0, values[0] || 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const range = Math.max(max - min, 1);
  return safe.map((value, index) => ({
    x: padding + (index / (safe.length - 1)) * (width - padding * 2),
    y: height - padding - ((value - min) / range) * (height - padding * 2),
  }));
}

function Sparkline({ values, tone }) {
  const points = linePoints(values, 142, 62, 5);
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${points.at(-1).x.toFixed(1)} 62 L${points[0].x.toFixed(1)} 62 Z`;
  return (
    <svg className={`home-sparkline ${tone}`} viewBox="0 0 142 62" aria-hidden="true">
      <path className="spark-area" d={area} />
      <path className="spark-line" d={path} />
      {points.map((point, index) => (
        <circle key={`${point.x}-${index}`} cx={point.x} cy={point.y} r="2.5" />
      ))}
    </svg>
  );
}

function summarizeAttendanceSessions(sessions) {
  const totals = sessions.reduce(
    (summary, session) => ({
      attended: summary.attended + session.attended,
      expected: summary.expected + session.expected,
    }),
    { attended: 0, expected: 0 },
  );
  return {
    ...totals,
    value: totals.expected ? totals.attended / totals.expected : null,
  };
}

function attendanceInsight(sessions) {
  if (!sessions.length) return { message: "Attendance will appear after completed classes.", tone: "neutral" };
  if (sessions.length === 1) return { message: "Your first attendance result is ready.", tone: "neutral" };
  const latest = sessions.at(-1).attendance;
  const previous = sessions.at(-2).attendance;
  if (latest > previous + 0.01) return { message: "Attendance improved in the latest class", tone: "positive" };
  if (latest < previous - 0.01) return { message: "Attendance dropped in the latest class", tone: "negative" };
  return { message: "Attendance stayed steady in the latest class", tone: "neutral" };
}

export function AttendancePanel({ title, sessions, previousSessions, onOpen }) {
  const { t: uiT } = useI18n();
  const [scope, setScope] = useState("all");
  const [selectedSessionKey, setSelectedSessionKey] = useState("");
  const scopeOptions = useMemo(() => {
    const options = new Map();
    [...sessions, ...previousSessions].forEach((session) => {
      if (!options.has(session.scopeId)) {
        options.set(session.scopeId, {
          value: session.scopeId,
          label: session.groupId ? session.title : uiT("Individual classes"),
        });
      }
    });
    return [{ value: "all", label: uiT("All groups") }, ...options.values()];
  }, [previousSessions, sessions, uiT]);
  const activeScope = scopeOptions.some((option) => option.value === scope) ? scope : "all";
  const matchesScope = (session) => activeScope === "all" || session.scopeId === activeScope;
  const filteredSessions = sessions.filter(matchesScope);
  const filteredPreviousSessions = previousSessions.filter(matchesScope);
  const visibleSessions = filteredSessions.slice(-4);
  const summary = summarizeAttendanceSessions(filteredSessions);
  const previousSummary = summarizeAttendanceSessions(filteredPreviousSessions);
  const selectedSession =
    visibleSessions.find((session) => session.key === selectedSessionKey) || visibleSessions.at(-1) || null;
  const delta = summary.value != null && previousSummary.value != null ? summary.value - previousSummary.value : null;
  const insight = attendanceInsight(filteredSessions);
  const InsightIcon =
    insight.tone === "positive" ? CircleArrowUp : insight.tone === "negative" ? CircleArrowDown : CircleMinus;

  return (
    <article className="home-metric-panel home-attendance-panel green">
      <header className="home-attendance-header">
        <span className="home-panel-heading">
          <UserRoundCheck aria-hidden="true" size={21} /> <strong>{uiT(title)}</strong>
        </span>
        <label className="home-attendance-scope">
          <span className="sr-only">{uiT("Attendance group")}</span>
          <select
            aria-label={uiT("Attendance group")}
            value={activeScope}
            onChange={(event) => {
              setScope(event.target.value);
              setSelectedSessionKey("");
            }}
          >
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
        </label>
      </header>

      {visibleSessions.length ? (
        <div className="home-attendance-content">
          <div className="home-attendance-summary">
            <span className="home-metric-value">
              {percent(summary.value)} <Delta value={delta} kind="points" />
            </span>
            <span className="home-attendance-count">
              {uiT("Attendance in {p0} {p1}", {
                p0: filteredSessions.length,
                p1: uiText(filteredSessions.length === 1 ? "class" : "classes"),
              })}
            </span>
            <small>{uiT("vs. previous period")}</small>
          </div>

          <div className="home-attendance-sessions" style={{ "--attendance-session-count": visibleSessions.length }}>
            {visibleSessions.map((session, index) => {
              const selected = session.key === selectedSession?.key;
              return (
                <button
                  className={`home-attendance-session ${selected ? "selected" : ""}`}
                  key={session.key}
                  type="button"
                  aria-pressed={selected}
                  aria-label={uiT("Class {p0}: {p1} attendance", { p0: index + 1, p1: percent(session.attendance) })}
                  onClick={() => setSelectedSessionKey(session.key)}
                >
                  {selected ? (
                    <span className="home-attendance-tooltip" role="status">
                      {uiT(session.attended === 1 ? "{title} · {count} student" : "{title} · {count} students", {
                        title: session.title,
                        count: session.attended,
                      })}
                    </span>
                  ) : null}
                  <span className="home-attendance-session-label">{uiT("Class {p0}", { p0: index + 1 })}</span>
                  <span className="home-attendance-bubble">{percent(session.attendance)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="home-attendance-empty">
          <span>—</span>
          <strong>{uiT("No attendance in this period")}</strong>
          <small>{uiT("Attendance will appear after completed classes.")}</small>
        </div>
      )}

      <footer className={`home-attendance-footer ${filteredSessions.length ? "" : "empty"}`}>
        {filteredSessions.length ? (
          <span className={insight.tone}>
            <InsightIcon aria-hidden="true" size={15} /> {uiT(insight.message)}
          </span>
        ) : null}
        <button type="button" onClick={onOpen}>
          {uiT("View sessions ")}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </article>
  );
}

function RevenueChart({ series, period, locale }) {
  const { t: uiT } = useI18n();
  const maximum = Math.max(...series.map((item) => item.collected), 0);
  const peakIndex = series.findLastIndex((item) => maximum > 0 && item.collected === maximum);
  const label = (value) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (period === "yearly") return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
    if (period === "monthly")
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  };
  return (
    <div className="home-revenue-chart" role="img" aria-label={uiT("Payments received over the selected period")}>
      {series.map((item, index) => {
        const height = maximum ? Math.max(5, Math.round((item.collected / maximum) * 88)) : 0;
        return (
          <div className="home-revenue-bar-slot" key={uiT(item.label)}>
            <span
              className={`home-revenue-bar ${item.collected ? "has-value" : ""} ${index === peakIndex ? "peak" : ""}`}
              style={{ "--revenue-bar-height": `${height}px` }}
              title={`${label(item.label)} · ${money(item.collected)}`}
            />
            <small>{label(item.label)}</small>
          </div>
        );
      })}
    </div>
  );
}

const REVENUE_VIEWS = Object.freeze([
  { value: "rhythm", label: "Weekly rhythm", triggerLabel: "View: Rhythm", Icon: LayoutGrid },
  { value: "projection", label: "Projection", triggerLabel: "View: Projection", Icon: BarChart3 },
  { value: "groups", label: "By groups", triggerLabel: "View: Groups", Icon: UsersRound },
]);

function RevenueRhythm({ dashboard, period, locale, onOpen }) {
  const { t: uiT } = useI18n();
  const activeSegments = dashboard.collectionSeries.filter((item) => item.collected > 0).length;
  return (
    <>
      <div className="home-revenue-value home-revenue-rhythm-value">
        <strong>{money(dashboard.collected)}</strong>
        <Delta value={dashboard.collectedDelta} />
        <span>
          {uiT(dashboard.collectionRecordCount === 1 ? "{count} payment recorded" : "{count} payments recorded", {
            count: dashboard.collectionRecordCount,
          })}
        </span>
      </div>
      <RevenueChart series={dashboard.collectionSeries} period={period} locale={locale} />
      <footer className="home-revenue-footer">
        <span>
          <i aria-hidden="true" /> {uiT(" Collections by payment date")}
        </span>
        <span className="home-revenue-insight">
          <Sparkles aria-hidden="true" size={14} />
          {activeSegments
            ? uiT("Collections were concentrated in {p0} {p1}", {
                p0: activeSegments,
                p1: uiText(activeSegments === 1 ? "payment day" : "payment days"),
              })
            : uiT("Your collections will appear here")}
        </span>
        <button type="button" onClick={onOpen}>
          {uiT("Explore period ")}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </>
  );
}

function RevenueProjection({ dashboard, onOpen }) {
  const { t: uiT } = useI18n();
  const ratio = dashboard.collectionProjection ? Math.min(1, dashboard.collected / dashboard.collectionProjection) : 0;
  return (
    <div className="home-revenue-projection">
      <div className="home-revenue-projection-values">
        <span>
          <strong>{money(dashboard.collected)}</strong>
          <small>{uiT("Collected")}</small>
        </span>
        <span>
          <strong>{money(dashboard.collectionProjection)}</strong>
          <small>{uiT("Period projection")}</small>
        </span>
      </div>
      <div
        className="home-revenue-progress"
        role="progressbar"
        aria-label={uiT("Collected amount toward projection")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="home-revenue-projection-meta">
        <span>
          <i className="complete" aria-hidden="true" />
          {uiT(dashboard.collectionRecordCount === 1 ? "{count} payment recorded" : "{count} payments recorded", {
            count: dashboard.collectionRecordCount,
          })}
        </span>
        <span>
          <i aria-hidden="true" />
          {uiT(dashboard.projectedClassCount === 1 ? "{count} class to teach" : "{count} classes to teach", {
            count: dashboard.projectedClassCount,
          })}
        </span>
      </div>
      <footer className="home-revenue-projection-footer">
        <span>
          <BarChart3 aria-hidden="true" size={15} />
          {dashboard.collectionProjection
            ? uiT("You have collected {p0}% of this period’s projection", { p0: Math.round(ratio * 100) })
            : uiT("Add rates and scheduled classes to see a projection")}
        </span>
        <button type="button" onClick={onOpen}>
          {uiT("View considered classes ")}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </div>
  );
}

function RevenueGroups({ dashboard, onOpen }) {
  const { t: uiT } = useI18n();
  const visibleGroups = dashboard.collectionGroups.slice(0, 4);
  const maximum = Math.max(...visibleGroups.map((item) => item.value), 0);
  return (
    <div className="home-revenue-groups">
      <div className="home-revenue-value">
        <strong>{money(dashboard.collected)}</strong>
        <span>{uiT("Collected")}</span>
      </div>
      {visibleGroups.length ? (
        <div className="home-revenue-group-list">
          {visibleGroups.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.name}</strong>
                <small>
                  {uiT(item.paymentCount === 1 ? "{count} payment" : "{count} payments", { count: item.paymentCount })}
                </small>
              </span>
              <i>
                <b style={{ width: `${maximum ? Math.round((item.value / maximum) * 100) : 0}%` }} />
              </i>
              <em>{money(item.value)}</em>
            </div>
          ))}
        </div>
      ) : (
        <p className="home-revenue-empty">{uiT("Group collections will appear after payments are recorded.")}</p>
      )}
      <footer className="home-revenue-projection-footer">
        <span>
          <UsersRound aria-hidden="true" size={15} /> {uiT(" Amount collected by each group or student")}
        </span>
        <button type="button" onClick={onOpen}>
          {uiT("View breakdown ")}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </div>
  );
}

export function RevenuePanel({ dashboard, period, locale, noun, onOpen }) {
  const { t: uiT } = useI18n();
  const [view, setView] = useState("rhythm");
  const [menuOpen, setMenuOpen] = useState(false);
  const switcherRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedView = REVENUE_VIEWS.find((item) => item.value === view) || REVENUE_VIEWS[0];
  const ViewIcon = selectedView.Icon;
  const title = `Amount collected ${noun}`;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const focusFrame = requestAnimationFrame(() => {
      menuRef.current?.querySelector('[aria-checked="true"]')?.focus();
    });
    const closeOnOutsidePress = (event) => {
      if (!switcherRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <article className="home-revenue-panel">
      <header>
        <span>
          <TrendingUp aria-hidden="true" size={21} />
          <strong>{uiT(title)}</strong>
          <Info aria-label={uiT("Payments recorded in this period")} size={15} />
        </span>
        <div className="home-revenue-controls">
          <div className="home-revenue-view-switcher" ref={switcherRef}>
            <button
              ref={triggerRef}
              className={menuOpen ? "open" : ""}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="home-revenue-view-menu"
              onClick={() => setMenuOpen((current) => !current)}
            >
              <ViewIcon aria-hidden="true" size={16} />
              <span>{selectedView.triggerLabel}</span>
              <ChevronDown aria-hidden="true" size={15} />
            </button>
            {menuOpen ? (
              <div
                ref={menuRef}
                id="home-revenue-view-menu"
                className="home-revenue-view-menu"
                role="menu"
                onKeyDown={(event) => {
                  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const items = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]')];
                  const currentIndex = items.indexOf(document.activeElement);
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
                  const nextItem = items[nextIndex];
                  if (nextItem instanceof HTMLElement) nextItem.focus();
                }}
              >
                {REVENUE_VIEWS.map(({ value, label, Icon }) => (
                  <button
                    className={view === value ? "selected" : ""}
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={view === value}
                    onClick={() => {
                      setView(value);
                      setMenuOpen(false);
                    }}
                  >
                    <Icon aria-hidden="true" size={17} />
                    <span>{uiT(label)}</span>
                    {view === value ? <Check aria-hidden="true" size={16} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span
            className="home-period-label"
            aria-label={uiT("Collection period: {p0}", { p0: uiText(PERIOD_LABELS[period]) })}
          >
            {uiT(PERIOD_LABELS[period])} <ChevronDown aria-hidden="true" size={14} />
          </span>
        </div>
      </header>
      {view === "rhythm" ? (
        <RevenueRhythm dashboard={dashboard} period={period} locale={locale} onOpen={onOpen} />
      ) : view === "projection" ? (
        <RevenueProjection dashboard={dashboard} onOpen={onOpen} />
      ) : (
        <RevenueGroups dashboard={dashboard} onOpen={onOpen} />
      )}
    </article>
  );
}

function ClassGlyph({ title }) {
  const normalized = title.toLocaleLowerCase();
  const config =
    normalized.includes("math") || normalized.includes("matem")
      ? { Icon: Calculator, tone: "green" }
      : normalized.includes("read") || normalized.includes("lect")
        ? { Icon: BookOpen, tone: "orange" }
        : normalized.includes("regular") || normalized.includes("school") || normalized.includes("secund")
          ? { Icon: GraduationCap, tone: "purple" }
          : { Icon: Pencil, tone: "blue" };
  return (
    <span className={`home-class-glyph ${config.tone}`}>
      <config.Icon aria-hidden="true" size={24} />
    </span>
  );
}

function SessionCard({ session, onOpen }) {
  const { t: uiT } = useI18n();
  return (
    <button className={session.isNext ? "home-session next" : "home-session"} type="button" onClick={onOpen}>
      {session.isNext ? <span className="next-class-label">{uiT("Next class")}</span> : null}
      <time>{uiT(formatTime(session.startTime))}</time>
      <ClassGlyph title={session.title} />
      <span className="home-session-copy">
        <strong>{session.title}</strong>
        <small>
          {session.attended} / {session.expected} {uiT(" students")}
        </small>
      </span>
      <span className={`home-session-status ${session.status.toLowerCase()}`}>{uiT(session.status)}</span>
    </button>
  );
}

function MetricPanel({
  icon: Icon,
  title,
  value,
  suffix,
  delta,
  deltaKind,
  caption,
  message,
  tone,
  ringValue,
  sparkValues,
  onClick,
}) {
  const { t: uiT } = useI18n();
  return (
    <button className={`home-metric-panel ${tone}`} type="button" onClick={onClick}>
      <span className="home-panel-heading">
        <Icon aria-hidden="true" size={21} /> <strong>{uiT(title)}</strong>
      </span>
      <span className="home-metric-content">
        <span className="home-metric-copy">
          <span className={`home-metric-value ${value === "—" ? "is-empty" : ""}`}>
            {value}
            {suffix ? <small>{suffix}</small> : null} <Delta value={delta} kind={deltaKind} />
          </span>
          <span className="home-metric-caption">{uiT(caption)}</span>
          <em>{uiT(message)}</em>
        </span>
        <Ring value={ringValue} tone={tone} />
        <Sparkline values={sparkValues} tone={tone} />
      </span>
    </button>
  );
}

function FinanceSummary({ icon: Icon, title, value, delta = undefined, note, tone, progress = undefined, onClick }) {
  const { t: uiT } = useI18n();
  return (
    <button className={`home-finance-summary ${tone}`} type="button" onClick={onClick}>
      <span>
        <Icon aria-hidden="true" size={18} />
      </span>
      <span>
        <strong>{uiT(title)}</strong>
        <b>
          {value} {delta == null ? null : <Delta value={delta} />}
        </b>
        <small>{uiT(note)}</small>
        {progress == null ? null : (
          <i className="home-summary-progress">
            <span style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} />
          </i>
        )}
      </span>
      <ChevronRight aria-hidden="true" size={18} />
    </button>
  );
}

function StudentList({ title, icon: Icon, tone, students, empty, showScores = false, onOpen }) {
  const { t: uiT } = useI18n();
  return (
    <section className={`home-list-card ${tone}`}>
      <header>
        <span>
          <Icon aria-hidden="true" size={19} />
          <strong>{uiT(title)}</strong>
        </span>
        <button type="button" onClick={onOpen}>
          {uiT("View all")}
        </button>
      </header>
      {students.length ? (
        <div className="home-person-list">
          {students.map((student) => (
            <button type="button" key={student.id} onClick={onOpen}>
              <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="tiny" decorative />
              <span>
                <strong>{student.fullName}</strong>
                <small>{student.highlight}</small>
              </span>
              {showScores && student.gradeAverage != null ? (
                <b>
                  {(student.gradeAverage * 10).toFixed(1)} <Star aria-hidden="true" size={13} />
                </b>
              ) : (
                <ChevronRight aria-hidden="true" size={17} />
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="home-list-empty">{empty}</p>
      )}
    </section>
  );
}

function GroupList({ groups, onOpen }) {
  const { t: uiT } = useI18n();
  return (
    <section className="home-list-card purple">
      <header>
        <span>
          <Trophy aria-hidden="true" size={19} />
          <strong>{uiT("Top groups by consistency")}</strong>
        </span>
        <button type="button" onClick={onOpen}>
          {uiT("View all")}
        </button>
      </header>
      {groups.length ? (
        <div className="home-group-list">
          {groups.map((group, index) => (
            <button type="button" key={group.id} onClick={onOpen}>
              <span>{index + 1}</span>
              <strong>{group.name}</strong>
              <i>
                <b style={{ width: `${Math.round(group.attendance * 100)}%` }} />
              </i>
              <em>{percent(group.attendance)}</em>
            </button>
          ))}
        </div>
      ) : (
        <p className="home-list-empty">{uiT("Attendance will appear after completed classes.")}</p>
      )}
    </section>
  );
}

export default function Home({ state, derived, openPage, navigate }) {
  const { t: uiT } = useI18n();
  const { locale } = useI18n();
  const [period, setPeriod] = useState("weekly");
  const dashboard = useMemo(() => buildHomeDashboard(state, derived, period), [derived, period, state]);
  const gradeSpark = useMemo(
    () =>
      (derived.students || [])
        .map((student) => student.gradeAverage)
        .filter((value) => value != null)
        .slice(-6),
    [derived.students],
  );
  const noun = PERIOD_NOUNS[period];
  const gradeValue = dashboard.grade == null ? "—" : (dashboard.grade * 10).toFixed(1);
  const nextTodaySession = dashboard.sessions.find((session) => session.isNext) || dashboard.sessions[0];
  const openTodaySession = (session) =>
    openPage("classes", {
      type: "open-class",
      sessionKey: session.workspaceKey,
    });
  const openPaymentOverview = () =>
    openPage("grades", {
      type: "open-tracking",
      tab: "payments",
      paymentScope: "overview",
      paymentChart: "projection",
    });
  const openAttendanceOverview = () =>
    openPage("grades", {
      type: "open-tracking",
      tab: "attendance",
      attendanceScope: "overview",
    });

  return (
    <div className="page hibi-home home-dashboard">
      <header className="home-dashboard-header">
        <div>
          <h1>
            {uiT("Good morning, Teacher! ")}
            <span aria-hidden="true">🌿</span>
          </h1>
          <p>{uiT("This week you are doing great. Your classes make an impact and your students keep growing.")}</p>
        </div>
        <div className="home-period-tabs" role="group" aria-label={uiT("Dashboard period")}>
          {HOME_PERIODS.map((item) => (
            <button
              key={item}
              type="button"
              className={period === item ? "active" : ""}
              aria-pressed={period === item}
              onClick={() => setPeriod(item)}
            >
              {uiT(PERIOD_LABELS[item])}
            </button>
          ))}
        </div>
      </header>

      <section className="home-today-panel" aria-labelledby="home-today-title" data-onboarding-tour="home">
        <header>
          <span>
            <CalendarDays aria-hidden="true" size={23} />
            <h2 id="home-today-title">{uiT("Today’s classes")}</h2>
          </span>
          <div className="home-today-summary">
            <span>
              <CalendarDays aria-hidden="true" size={16} />
              {uiT("{p0} {p1} today", {
                p0: dashboard.sessions.length,
                p1: uiText(dashboard.sessions.length === 1 ? "class" : "classes"),
              })}
            </span>
            <span>
              <UsersRound aria-hidden="true" size={16} />
              {dashboard.expectedStudents} {uiT(" students expected")}
            </span>
            <span className="pending">
              <Clock3 aria-hidden="true" size={16} />
              {dashboard.pendingSessions} {uiT(" pending")}
            </span>
          </div>
          <img src="/hibi-companion.png" alt={uiT("")} />
        </header>
        {dashboard.sessions.length ? (
          <div className="home-session-rail">
            {dashboard.sessions.map((session) => (
              <SessionCard key={session.workspaceKey} session={session} onOpen={() => openTodaySession(session)} />
            ))}
          </div>
        ) : (
          <div className="home-no-classes">
            <span>
              <strong>{uiT("No classes scheduled for today")}</strong>
              <small>{uiT("Your next recurring or one-time class will appear here.")}</small>
            </span>
            <button type="button" onClick={() => openPage("classes", "new-class")}>
              {uiT("Create class ")}
              <ArrowRight aria-hidden="true" size={16} />
            </button>
          </div>
        )}
        <button
          className="home-view-classes"
          type="button"
          disabled={!nextTodaySession}
          onClick={() => nextTodaySession && openTodaySession(nextTodaySession)}
        >
          {uiT("View all my classes today ")}
          <ArrowRight aria-hidden="true" size={17} />
        </button>
      </section>

      <section className="home-academic-grid" aria-label={uiT("Academic overview")}>
        <AttendancePanel
          title={uiT("Average attendance {p0}", { p0: uiText(noun) })}
          sessions={dashboard.attendanceSessions}
          previousSessions={dashboard.previousAttendanceSessions}
          onOpen={openAttendanceOverview}
        />
        <MetricPanel
          icon={Star}
          title={uiT("Average grade {p0}", { p0: uiText(noun) })}
          value={gradeValue}
          suffix="/ 10"
          delta={dashboard.gradeDelta}
          deltaKind="grade"
          caption="Academic performance"
          message="You’re on the right track. Great work!"
          tone="orange"
          ringValue={dashboard.grade}
          sparkValues={gradeSpark}
          onClick={() => navigate("grades")}
        />
      </section>

      <section className="home-finance-grid">
        <RevenuePanel dashboard={dashboard} period={period} locale={locale} noun={noun} onOpen={openPaymentOverview} />
        <aside className="home-finance-side" aria-label={uiT("Financial summary")}>
          <FinanceSummary
            icon={Wallet}
            title={uiT("Income this month")}
            value={money(dashboard.monthlyCollected)}
            delta={dashboard.monthlyCollectedDelta}
            note="Compared with last month"
            tone="green"
            progress={dashboard.monthlyProjection ? dashboard.monthlyCollected / dashboard.monthlyProjection : 0}
            onClick={openPaymentOverview}
          />
          <FinanceSummary
            icon={TrendingUp}
            title={uiT("Monthly projection")}
            value={money(dashboard.monthlyProjection)}
            delta={dashboard.monthlyProjectionDelta}
            note="Based on your recent collections"
            tone="purple"
            progress={dashboard.idealRevenue ? dashboard.monthlyProjection / dashboard.idealRevenue : 0}
            onClick={openPaymentOverview}
          />
          <FinanceSummary
            icon={CreditCard}
            title={uiT("Pending payments")}
            value={money(dashboard.outstanding)}
            note={`${dashboard.outstandingRecords} records`}
            tone="purple"
            onClick={openPaymentOverview}
          />
        </aside>
      </section>

      <section className="home-lists-grid" aria-label={uiT("Students and groups overview")}>
        <StudentList
          title={uiT("Outstanding students")}
          icon={Sparkles}
          tone="green"
          students={dashboard.topStudents}
          empty="Student highlights will appear as grades and attendance are recorded."
          showScores
          onOpen={() => openPage("community", "students")}
        />
        <StudentList
          title={uiT("Students requiring attention")}
          icon={AlertTriangle}
          tone="orange"
          students={dashboard.attentionStudents}
          empty="No academic alerts right now. Everyone is on track."
          onOpen={() => openPage("community", "students")}
        />
        <GroupList groups={dashboard.topGroups} onOpen={() => openPage("community", "groups")} />
      </section>
    </div>
  );
}
