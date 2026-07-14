import {
  CalendarDays,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  CreditCard,
  GraduationCap,
  TrendingUp,
  UserRoundCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { getUiLocale } from "../i18n";

function money(value) {
  return new Intl.NumberFormat(getUiLocale(), { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function percent(value) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function formatTime(value) {
  if (!value) return "Time not set";
  return new Date(`2000-01-01T${value}`).toLocaleTimeString(getUiLocale(), { hour: "numeric", minute: "2-digit" });
}

function todaySessions(rows, date, groupsById, studentsById) {
  const map = new Map();
  for (const row of rows.filter((item) => item.classDate === date)) {
    const key = [row.classDate, row.startTime || "", row.groupId || `student:${row.studentId}`, row.classTitle || ""].join("|");
    if (!map.has(key)) map.set(key, { ...row, studentIds: [] });
    map.get(key).studentIds.push(row.studentId);
  }
  return [...map.values()]
    .sort((left, right) => (left.startTime || "99:99").localeCompare(right.startTime || "99:99"))
    .map((session) => {
      const group = groupsById.get(session.groupId);
      const student = studentsById.get(session.studentIds[0]);
      return {
        ...session,
        title: session.classTitle || group?.name || student?.fullName || "Individual class",
        subtitle: group ? `Group ${group.name}` : student?.fullName || "Individual",
      };
    });
}

export default function Home({ state, derived, openPage, navigate }) {
  const dashboard = derived.dashboard || {};
  const groupsById = derived.groupsById || new Map();
  const studentsById = derived.studentsById || new Map();
  const sessions = todaySessions(state.classLog || [], state.settings.asOfDate, groupsById, studentsById);
  const cards = [
    { label: "Active groups", value: state.groups.filter((group) => (derived.groups.find((item) => item.id === group.id)?.activeStudents || 0) > 0).length, note: "Groups", icon: UsersRound, tone: "sage", page: "groups" },
    { label: "Attendance", value: percent(dashboard.overallAttendance), note: "Average", icon: UserRoundCheck, tone: "yellow", page: "classes" },
    { label: "Pending payments", value: money(dashboard.outstandingThroughToday), note: `${derived.classLog.filter((row) => Number(row.outstanding) > 0).length} class records`, icon: CreditCard, tone: "blue", page: "payments" },
    { label: "Revenue this month", value: money(dashboard.collectedSelectedMonth), note: "Collected", icon: TrendingUp, tone: "lilac", page: "payments" },
  ];
  const insights = [
    { label: "Active students", value: dashboard.activeStudents || 0, icon: Users, page: "students" },
    { label: "Overall grade", value: percent(dashboard.overallGrade), icon: GraduationCap, page: "grades" },
    { label: "Missing assignments", value: dashboard.missingAssignments || 0, icon: ClipboardList, page: "grades" },
    { label: "Paid for future classes", value: money(dashboard.paidForFutureClasses), icon: CircleAlert, page: "payments" },
  ];

  return (
    <div className="page hibi-home">
      <section className="welcome-row"><div><h1>Good morning, Teacher! <span>🌿</span></h1><p>You have a wonderful day ahead. Balances are calculated through {state.settings.asOfDate}.</p></div></section>
      <section className="today-panel">
        <div className="panel-title"><div><CalendarDays size={21} /><h2>Today’s Classes</h2></div><button type="button" onClick={() => openPage("classes", "class-history")}>View all</button></div>
        <div className="today-list">
          {sessions.length ? sessions.map((session) => <button key={`${session.id}-${session.studentIds.length}`} type="button" className="today-row" onClick={() => openPage("classes", "class-history")}><time>{formatTime(session.startTime)}</time><span className="today-divider" /><span className="today-copy"><strong>{session.title}</strong><small>{session.subtitle}</small></span><span className="today-status"><Clock3 size={14} />{session.classStatus}</span></button>) : <div className="today-empty"><div><strong>No classes logged for today</strong><span>Record a group or individual class when you’re ready.</span></div><button type="button" className="text-action" onClick={() => openPage("classes", "new-class")}>Create class <ChevronRight size={16} /></button></div>}
        </div>
      </section>
      <section className="overview-grid">{cards.map(({ icon: Icon, ...card }) => <button key={card.label} type="button" className={`overview-card ${card.tone}`} onClick={() => navigate(card.page)}><span className="metric-icon"><Icon size={23} /></span><span><small>{card.label}</small><strong>{card.value}</strong><em>{card.note}</em></span><ChevronRight size={18} /></button>)}</section>
      <section className="insight-strip" aria-label="Academic and payment snapshot">{insights.map(({ icon: Icon, ...item }) => <button type="button" key={item.label} onClick={() => navigate(item.page)}><Icon size={18} /><span><small>{item.label}</small><strong>{item.value}</strong></span><ChevronRight size={15} /></button>)}</section>
      <section className="encouragement"><img src="/hibi-companion.png" alt="" /><div><strong>Little by little, your students are doing amazing! 💚</strong><p>Every class, note, and small improvement adds up.</p></div></section>
    </div>
  );
}
