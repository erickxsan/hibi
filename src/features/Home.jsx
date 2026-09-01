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

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
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
  if (value == null) return <span className="home-delta neutral">New</span>;
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
  const [scope, setScope] = useState("all");
  const [selectedSessionKey, setSelectedSessionKey] = useState("");
  const scopeOptions = useMemo(() => {
    const options = new Map();
    [...sessions, ...previousSessions].forEach((session) => {
      if (!options.has(session.scopeId)) {
        options.set(session.scopeId, {
          value: session.scopeId,
          label: session.groupId ? session.title : "Individual classes",
        });
      }
    });
    return [{ value: "all", label: "All groups" }, ...options.values()];
  }, [previousSessions, sessions]);
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
          <UserRoundCheck aria-hidden="true" size={21} /> <strong>{title}</strong>
        </span>
        <label className="home-attendance-scope">
          <span className="sr-only">Attendance group</span>
          <select
            aria-label="Attendance group"
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
              {`Attendance in ${filteredSessions.length} ${filteredSessions.length === 1 ? "class" : "classes"}`}
            </span>
            <small>vs. previous period</small>
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
                  aria-label={`Class ${index + 1}: ${percent(session.attendance)} attendance`}
                  onClick={() => setSelectedSessionKey(session.key)}
                >
                  {selected ? (
                    <span className="home-attendance-tooltip" role="status">
                      {`${session.title} · ${session.attended} ${session.attended === 1 ? "student" : "students"}`}
                    </span>
                  ) : null}
                  <span className="home-attendance-session-label">{`Class ${index + 1}`}</span>
                  <span className="home-attendance-bubble">{percent(session.attendance)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="home-attendance-empty">
          <span>—</span>
          <strong>No attendance in this period</strong>
          <small>Attendance will appear after completed classes.</small>
        </div>
      )}

      <footer className={`home-attendance-footer ${filteredSessions.length ? "" : "empty"}`}>
        {filteredSessions.length ? (
          <span className={insight.tone}>
            <InsightIcon aria-hidden="true" size={15} /> {insight.message}
          </span>
        ) : null}
        <button type="button" onClick={onOpen}>
          View sessions <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </article>
  );
}

function RevenueChart({ series, period, locale }) {
  const maximum = Math.max(...series.map((item) => item.generated), 0);
  const peakIndex = series.findLastIndex((item) => maximum > 0 && item.generated === maximum);
  const label = (value) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (period === "yearly") return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
    if (period === "monthly")
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  };
  return (
    <div className="home-revenue-chart" role="img" aria-label="Revenue generated over the selected period">
      {series.map((item, index) => {
        const height = maximum ? Math.max(5, Math.round((item.generated / maximum) * 88)) : 0;
        return (
          <div className="home-revenue-bar-slot" key={item.label}>
            <span
              className={`home-revenue-bar ${item.generated ? "has-value" : ""} ${index === peakIndex ? "peak" : ""}`}
              style={{ "--revenue-bar-height": `${height}px` }}
              title={`${label(item.label)} · ${money(item.generated)}`}
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
  const activeSegments = dashboard.revenueSeries.filter((item) => item.generated > 0).length;
  return (
    <>
      <div className="home-revenue-value home-revenue-rhythm-value">
        <strong>{money(dashboard.generated)}</strong>
        <Delta value={dashboard.generatedDelta} />
        <span>{`${dashboard.completedClassCount} ${dashboard.completedClassCount === 1 ? "completed class" : "completed classes"}`}</span>
      </div>
      <RevenueChart series={dashboard.revenueSeries} period={period} locale={locale} />
      <footer className="home-revenue-footer">
        <span>
          <i aria-hidden="true" /> Value by taught classes
        </span>
        <span className="home-revenue-insight">
          <Sparkles aria-hidden="true" size={14} />
          {activeSegments
            ? `Value was concentrated in ${activeSegments} ${activeSegments === 1 ? "class day" : "class days"}`
            : "Your class value will appear here"}
        </span>
        <button type="button" onClick={onOpen}>
          Explore period <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </>
  );
}

function RevenueProjection({ dashboard, onOpen }) {
  const ratio = dashboard.revenueProjection ? Math.min(1, dashboard.generated / dashboard.revenueProjection) : 0;
  return (
    <div className="home-revenue-projection">
      <div className="home-revenue-projection-values">
        <span>
          <strong>{money(dashboard.generated)}</strong>
          <small>Generated</small>
        </span>
        <span>
          <strong>{money(dashboard.revenueProjection)}</strong>
          <small>Period projection</small>
        </span>
      </div>
      <div
        className="home-revenue-progress"
        role="progressbar"
        aria-label="Generated value toward projection"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(ratio * 100)}
      >
        <i style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="home-revenue-projection-meta">
        <span>
          <i className="complete" aria-hidden="true" />
          {`${dashboard.completedClassCount} ${dashboard.completedClassCount === 1 ? "completed class" : "completed classes"}`}
        </span>
        <span>
          <i aria-hidden="true" />
          {`${dashboard.projectedClassCount} ${dashboard.projectedClassCount === 1 ? "class to teach" : "classes to teach"}`}
        </span>
      </div>
      <footer className="home-revenue-projection-footer">
        <span>
          <BarChart3 aria-hidden="true" size={15} />
          {dashboard.revenueProjection
            ? `You have generated ${Math.round(ratio * 100)}% of this period’s projection`
            : "Add rates and scheduled classes to see a projection"}
        </span>
        <button type="button" onClick={onOpen}>
          View considered classes <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </div>
  );
}

function RevenueGroups({ dashboard, onOpen }) {
  const visibleGroups = dashboard.revenueGroups.slice(0, 4);
  const maximum = Math.max(...visibleGroups.map((item) => item.value), 0);
  return (
    <div className="home-revenue-groups">
      <div className="home-revenue-value">
        <strong>{money(dashboard.generated)}</strong>
        <span>Generated</span>
      </div>
      {visibleGroups.length ? (
        <div className="home-revenue-group-list">
          {visibleGroups.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.name}</strong>
                <small>{`${item.classCount} ${item.classCount === 1 ? "class" : "classes"}`}</small>
              </span>
              <i>
                <b style={{ width: `${maximum ? Math.round((item.value / maximum) * 100) : 0}%` }} />
              </i>
              <em>{money(item.value)}</em>
            </div>
          ))}
        </div>
      ) : (
        <p className="home-revenue-empty">Group value will appear after completed classes.</p>
      )}
      <footer className="home-revenue-projection-footer">
        <span>
          <UsersRound aria-hidden="true" size={15} /> Value generated by each teaching context
        </span>
        <button type="button" onClick={onOpen}>
          View breakdown <ArrowRight aria-hidden="true" size={16} />
        </button>
      </footer>
    </div>
  );
}

export function RevenuePanel({ dashboard, period, locale, noun, onOpen }) {
  const [view, setView] = useState("rhythm");
  const [menuOpen, setMenuOpen] = useState(false);
  const switcherRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const selectedView = REVENUE_VIEWS.find((item) => item.value === view) || REVENUE_VIEWS[0];
  const ViewIcon = selectedView.Icon;
  const title = `Value generated ${noun}`;

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
          <strong>{title}</strong>
          <Info aria-label="Charges generated by classes in this period" size={15} />
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
                  items[nextIndex]?.focus();
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
                    <span>{label}</span>
                    {view === value ? <Check aria-hidden="true" size={16} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="home-period-label" aria-label={`Revenue period: ${PERIOD_LABELS[period]}`}>
            {PERIOD_LABELS[period]} <ChevronDown aria-hidden="true" size={14} />
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
  return (
    <button className={session.isNext ? "home-session next" : "home-session"} type="button" onClick={onOpen}>
      {session.isNext ? <span className="next-class-label">Next class</span> : null}
      <time>{formatTime(session.startTime)}</time>
      <ClassGlyph title={session.title} />
      <span className="home-session-copy">
        <strong>{session.title}</strong>
        <small>
          {session.attended} / {session.expected} students
        </small>
      </span>
      <span className={`home-session-status ${session.status.toLowerCase()}`}>{session.status}</span>
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
  return (
    <button className={`home-metric-panel ${tone}`} type="button" onClick={onClick}>
      <span className="home-panel-heading">
        <Icon aria-hidden="true" size={21} /> <strong>{title}</strong>
      </span>
      <span className="home-metric-content">
        <span className="home-metric-copy">
          <span className={`home-metric-value ${value === "—" ? "is-empty" : ""}`}>
            {value}
            {suffix ? <small>{suffix}</small> : null} <Delta value={delta} kind={deltaKind} />
          </span>
          <span className="home-metric-caption">{caption}</span>
          <em>{message}</em>
        </span>
        <Ring value={ringValue} tone={tone} />
        <Sparkline values={sparkValues} tone={tone} />
      </span>
    </button>
  );
}

function FinanceSummary({ icon: Icon, title, value, delta, note, tone, progress, onClick }) {
  return (
    <button className={`home-finance-summary ${tone}`} type="button" onClick={onClick}>
      <span>
        <Icon aria-hidden="true" size={18} />
      </span>
      <span>
        <strong>{title}</strong>
        <b>
          {value} {delta == null ? null : <Delta value={delta} />}
        </b>
        <small>{note}</small>
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
  return (
    <section className={`home-list-card ${tone}`}>
      <header>
        <span>
          <Icon aria-hidden="true" size={19} />
          <strong>{title}</strong>
        </span>
        <button type="button" onClick={onOpen}>
          View all
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
  return (
    <section className="home-list-card purple">
      <header>
        <span>
          <Trophy aria-hidden="true" size={19} />
          <strong>Top groups by consistency</strong>
        </span>
        <button type="button" onClick={onOpen}>
          View all
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
        <p className="home-list-empty">Attendance will appear after completed classes.</p>
      )}
    </section>
  );
}

export default function Home({ state, derived, openPage, navigate }) {
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
            Good morning, Teacher! <span aria-hidden="true">🌿</span>
          </h1>
          <p>This week you are doing great. Your classes make an impact and your students keep growing.</p>
        </div>
        <div className="home-period-tabs" role="group" aria-label="Dashboard period">
          {HOME_PERIODS.map((item) => (
            <button
              key={item}
              type="button"
              className={period === item ? "active" : ""}
              aria-pressed={period === item}
              onClick={() => setPeriod(item)}
            >
              {PERIOD_LABELS[item]}
            </button>
          ))}
        </div>
      </header>

      <section className="home-today-panel" aria-labelledby="home-today-title" data-onboarding-tour="home">
        <header>
          <span>
            <CalendarDays aria-hidden="true" size={23} />
            <h2 id="home-today-title">Today’s classes</h2>
          </span>
          <div className="home-today-summary">
            <span>
              <CalendarDays aria-hidden="true" size={16} />
              {`${dashboard.sessions.length} ${dashboard.sessions.length === 1 ? "class" : "classes"} today`}
            </span>
            <span>
              <UsersRound aria-hidden="true" size={16} />
              {dashboard.expectedStudents} students expected
            </span>
            <span className="pending">
              <Clock3 aria-hidden="true" size={16} />
              {dashboard.pendingSessions} pending
            </span>
          </div>
          <img src="/hibi-companion.png" alt="" />
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
              <strong>No classes scheduled for today</strong>
              <small>Your next recurring or one-time class will appear here.</small>
            </span>
            <button type="button" onClick={() => openPage("classes", "new-class")}>
              Create class <ArrowRight aria-hidden="true" size={16} />
            </button>
          </div>
        )}
        <button
          className="home-view-classes"
          type="button"
          disabled={!nextTodaySession}
          onClick={() => nextTodaySession && openTodaySession(nextTodaySession)}
        >
          View all my classes today <ArrowRight aria-hidden="true" size={17} />
        </button>
      </section>

      <section className="home-academic-grid" aria-label="Academic overview">
        <AttendancePanel
          title={`Average attendance ${noun}`}
          sessions={dashboard.attendanceSessions}
          previousSessions={dashboard.previousAttendanceSessions}
          onOpen={openAttendanceOverview}
        />
        <MetricPanel
          icon={Star}
          title={`Average grade ${noun}`}
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
        <aside className="home-finance-side" aria-label="Financial summary">
          <FinanceSummary
            icon={Wallet}
            title="Income this month"
            value={money(dashboard.monthlyCollected)}
            delta={dashboard.monthlyCollectedDelta}
            note="Compared with last month"
            tone="green"
            progress={dashboard.monthlyProjection ? dashboard.monthlyCollected / dashboard.monthlyProjection : 0}
            onClick={openPaymentOverview}
          />
          <FinanceSummary
            icon={TrendingUp}
            title="Monthly projection"
            value={money(dashboard.monthlyProjection)}
            delta={dashboard.monthlyProjectionDelta}
            note="Based on your recent collections"
            tone="purple"
            progress={dashboard.idealRevenue ? dashboard.monthlyProjection / dashboard.idealRevenue : 0}
            onClick={openPaymentOverview}
          />
          <FinanceSummary
            icon={CreditCard}
            title="Pending payments"
            value={money(dashboard.outstanding)}
            note={`${dashboard.outstandingRecords} records`}
            tone="purple"
            onClick={openPaymentOverview}
          />
        </aside>
      </section>

      <section className="home-lists-grid" aria-label="Students and groups overview">
        <StudentList
          title="Outstanding students"
          icon={Sparkles}
          tone="green"
          students={dashboard.topStudents}
          empty="Student highlights will appear as grades and attendance are recorded."
          showScores
          onOpen={() => openPage("community", "students")}
        />
        <StudentList
          title="Students requiring attention"
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
