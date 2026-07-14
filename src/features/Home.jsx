import { CalendarDays, ChevronRight, Clock3, CreditCard, TrendingUp, UserRoundCheck, UsersRound } from "lucide-react";

const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(Number(value || 0));
const percent = (value) => value == null ? "—" : `${Math.round(value * 100)}%`;

function todaySessions(rows, date, groupsById, studentsById) {
  const map = new Map();
  for (const row of rows.filter((item) => item.classDate === date)) {
    const key = [row.classDate, row.startTime || "", row.groupId || `student:${row.studentId}`, row.classTitle || ""].join("|");
    if (!map.has(key)) map.set(key, { ...row, studentIds: [] });
    map.get(key).studentIds.push(row.studentId);
  }
  return [...map.values()].sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99")).map((session) => {
    const group = groupsById.get(session.groupId);
    const student = studentsById.get(session.studentIds[0]);
    return { ...session, title: session.classTitle || group?.name || student?.fullName || "Individual class", subtitle: group ? `Group ${group.name}` : student?.fullName || "Individual" };
  });
}

export default function Home({ state, derived, navigate }) {
  const dashboard = derived.dashboard || {};
  const groupsById = derived.groupsById || new Map();
  const studentsById = derived.studentsById || new Map();
  const sessions = todaySessions(state.classLog || [], state.settings.asOfDate, groupsById, studentsById);
  const cards = [
    { label: "Active groups", value: state.groups.filter((g) => (derived.groups.find((x) => x.id === g.id)?.activeStudents || 0) > 0).length, note: "Groups", icon: UsersRound, tone: "sage", page: "groups" },
    { label: "Attendance", value: percent(dashboard.overallAttendance), note: "Average", icon: UserRoundCheck, tone: "yellow", page: "classes" },
    { label: "Pending payments", value: money(dashboard.outstandingThroughToday), note: `${derived.classLog.filter((r) => Number(r.outstanding) > 0).length} class records`, icon: CreditCard, tone: "blue", page: "payments" },
    { label: "Revenue this month", value: money(dashboard.collectedSelectedMonth), note: "Collected", icon: TrendingUp, tone: "lilac", page: "payments" },
  ];
  return <div className="page hibi-home">
    <section className="welcome-row"><div><h1>Good morning, Teacher! <span>🌿</span></h1><p>You have a wonderful day ahead.</p></div></section>
    <section className="today-panel">
      <div className="panel-title"><div><CalendarDays size={21}/><h2>Today’s Classes</h2></div><button type="button" onClick={() => navigate("classes")}>View all</button></div>
      <div className="today-list">{sessions.length ? sessions.map((session) => <button key={`${session.id}-${session.studentIds.length}`} type="button" className="today-row" onClick={() => navigate("classes")}><time>{session.startTime ? new Date(`2000-01-01T${session.startTime}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Time not set"}</time><span className="today-divider"/><span className="today-copy"><strong>{session.title}</strong><small>{session.subtitle}</small></span><span className="today-status"><Clock3 size={14}/>{session.classStatus}</span></button>) : <div className="today-empty"><div><strong>No classes logged for today</strong><span>Schedule a group or individual class when you’re ready.</span></div><button type="button" className="text-action" onClick={() => navigate("classes")}>Create class <ChevronRight size={16}/></button></div>}</div>
    </section>
    <section className="overview-grid">{cards.map(({ icon: Icon, ...card }) => <button key={card.label} type="button" className={`overview-card ${card.tone}`} onClick={() => navigate(card.page)}><span className="metric-icon"><Icon size={23}/></span><span><small>{card.label}</small><strong>{card.value}</strong><em>{card.note}</em></span><ChevronRight size={18}/></button>)}</section>
    <section className="encouragement"><img src="/hibi-companion.png" alt=""/><div><strong>Little by little, your students are doing amazing! 💚</strong><p>Every class, note, and small improvement adds up.</p></div></section>
  </div>;
}
