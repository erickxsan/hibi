import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Calculator,
  ChevronRight,
  Clock3,
  CreditCard,
  GraduationCap,
  Info,
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

function RevenueChart({ series, period, locale }) {
  const width = 760;
  const height = 210;
  const plotHeight = 164;
  const points = linePoints(
    series.map((item) => item.value),
    width,
    plotHeight,
    18,
  );
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${points.at(-1).x.toFixed(1)} ${plotHeight} L${points[0].x.toFixed(1)} ${plotHeight} Z`;
  const label = (value) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (period === "yearly") return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
    if (period === "monthly") return new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(date);
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
  };
  return (
    <div className="home-revenue-chart" role="img" aria-label="Revenue generated over the selected period">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1="18" x2={width - 18} y1={plotHeight * ratio} y2={plotHeight * ratio} />
        ))}
        <path className="revenue-area" d={area} />
        <path className="revenue-line" d={path} />
        {points.map((point, index) => (
          <g key={`${series[index]?.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text x={point.x} y="198" textAnchor="middle">
              {label(series[index]?.label)}
            </text>
          </g>
        ))}
      </svg>
    </div>
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
  const attendanceSpark = useMemo(
    () =>
      (derived.students || [])
        .map((student) => student.attendance)
        .filter((value) => value != null)
        .slice(-6),
    [derived.students],
  );
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

      <section className="home-today-panel" aria-labelledby="home-today-title">
        <header>
          <span>
            <CalendarDays aria-hidden="true" size={23} />
            <h2 id="home-today-title">Today’s classes</h2>
          </span>
          <div className="home-today-summary">
            <span>
              <CalendarDays aria-hidden="true" size={16} />
              {dashboard.sessions.length} classes today
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
        <MetricPanel
          icon={UserRoundCheck}
          title={`Average attendance ${noun}`}
          value={percent(dashboard.attendance)}
          delta={dashboard.attendanceDelta}
          deltaKind="points"
          caption="Compared with the previous period"
          message="Steady progress. Keep it up!"
          tone="green"
          ringValue={dashboard.attendance}
          sparkValues={attendanceSpark}
          onClick={() => navigate("grades")}
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
        <article className="home-revenue-panel">
          <header>
            <span>
              <TrendingUp aria-hidden="true" size={21} />
              <strong>Value generated {noun}</strong>
              <Info aria-label="Charges generated by classes in this period" size={15} />
            </span>
            <span className="home-period-label">{PERIOD_LABELS[period]}</span>
          </header>
          <div className="home-revenue-value">
            <strong>{money(dashboard.generated)}</strong>
            <Delta value={dashboard.generatedDelta} />
            <small>vs. previous period</small>
          </div>
          <RevenueChart series={dashboard.revenueSeries} period={period} locale={locale} />
        </article>
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
