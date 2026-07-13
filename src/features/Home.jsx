import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChartNoAxesCombined,
  CircleAlert,
  CircleCheckBig,
  ClipboardList,
  Clock3,
  Star,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {
  Button,
  Drawer,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  TableShell,
} from "../components/ui";
import { getUiLocale, useI18n } from "../i18n";

const EMPTY_ARRAY = Object.freeze([]);

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatMoney(value) {
  const number = finiteNumber(value);
  return number === null ? "\u2014" : new Intl.NumberFormat(getUiLocale(), {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(number);
}

function formatNumber(value) {
  const number = finiteNumber(value);
  return number === null ? "\u2014" : new Intl.NumberFormat(getUiLocale(), { maximumFractionDigits: 0 }).format(number);
}

function formatPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return "\u2014";
  const percent = Math.abs(number) <= 1 ? number * 100 : number;
  return `${Math.round(percent)}%`;
}

function dateFromDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, style = "long") {
  const date = dateFromDateOnly(value);
  if (!date) return "\u2014";
  return new Intl.DateTimeFormat(getUiLocale(), {
    month: "short",
    day: "numeric",
    ...(style === "long" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

function formatMonth(value) {
  const month = typeof value === "string" ? `${value.slice(0, 7)}-01` : "";
  const date = dateFromDateOnly(month);
  return date ? new Intl.DateTimeFormat(getUiLocale(), {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date) : "\u2014";
}

function initials(name) {
  if (typeof name !== "string" || !name.trim()) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function groupName(row) {
  if (typeof row?.groupName === "string" && row.groupName.trim()) return row.groupName;
  if (typeof row?.group === "string" && row.group.trim()) return row.group;
  if (typeof row?.group?.name === "string" && row.group.name.trim()) return row.group.name;
  if (typeof row?.name === "string" && row.name.trim()) return row.name;
  return "Unassigned";
}

function studentName(row) {
  return row?.fullName ?? row?.studentName ?? row?.name ?? "Unnamed student";
}

function studentId(row) {
  return row?.studentId ?? row?.id ?? row?.code ?? "";
}

function updatePreferences(actions, patch) {
  if (typeof actions?.updatePreferences === "function") {
    actions.updatePreferences(patch);
    return;
  }
  for (const [key, value] of Object.entries(patch)) {
    const directAction = key === "selectedMonth"
      ? actions?.setSelectedMonth
      : key === "selectedStudentId"
        ? actions?.setSelectedStudentId
        : key === "asOfDate"
          ? actions?.setAsOfDate
          : null;
    if (typeof directAction === "function") directAction(value);
    else if (typeof actions?.updatePreference === "function") actions.updatePreference(key, value);
    else if (typeof actions?.setPreference === "function") actions.setPreference(key, value);
  }
}

function MetricCard({ icon: Icon, value, label, tone }) {
  const isProjection = tone.endsWith("-wide");
  return (
    <article className={`${isProjection ? "projection-card " : ""}metric-card metric-card-${tone}`}>
      <span className="metric-icon metric-card-icon" aria-hidden="true">
        <Icon size={25} strokeWidth={1.65} />
      </span>
      <div className="metric-copy metric-card-copy">
        <strong className="metric-value">{value}</strong>
        <span className="metric-label">{label}</span>
      </div>
    </article>
  );
}

function StudentStatus({ student }) {
  const alerts = arrayOrEmpty(student?.alerts);
  const hasAcademicData = (student?.gradeAverage ?? student?.averageGrade) != null
    || (student?.attendance ?? student?.attendanceRate) != null
    || Number(student?.missingAssignments ?? student?.missing ?? 0) > 0
    || Number(student?.outstanding ?? 0) > 0;
  if (!hasAcademicData && !alerts.length) return <StatusBadge tone="neutral">No data</StatusBadge>;
  const isAtRisk = alerts.some((alert) => alert === "Low grade" || alert === "Low attendance");
  const hasAttention = alerts.length > 0;
  const label = isAtRisk ? "At risk" : hasAttention ? alerts[0] : "On track";
  const tone = isAtRisk ? "danger" : hasAttention ? "warning" : "success";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

function DetailRow({ label, children }) {
  return (
    <div className="home-detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function StudentDetail({ student, futurePaid, lastClass, nextClass, compact = false }) {
  if (!student) {
    return (
      <EmptyState
        icon={UsersRound}
        title="Select a student"
        description="Choose a student above to see their academic and payment snapshot."
      />
    );
  }

  return (
    <div className={compact ? "home-student-detail is-compact" : "home-student-detail"}>
      <header className="panel-heading selected-student-header home-student-identity">
        <span className="avatar avatar-lilac home-avatar" aria-hidden="true">{initials(studentName(student))}</span>
        <div>
          <h2>{studentName(student)}</h2>
          <p>{groupName(student)}</p>
        </div>
      </header>

      <dl className="student-detail-list home-detail-list">
        <DetailRow label="Status"><StudentStatus student={student} /></DetailRow>
        <DetailRow label="Grade">{formatPercent(student.gradeAverage ?? student.averageGrade)}</DetailRow>
        <DetailRow label="Attendance">{formatPercent(student.attendance ?? student.attendanceRate)}</DetailRow>
        <DetailRow label="Missing assignments">{formatNumber(student.missingAssignments ?? student.missing)}</DetailRow>
        <DetailRow label="Outstanding">{formatMoney(student.outstanding)}</DetailRow>
        <DetailRow label="Paid for future classes">{formatMoney(futurePaid)}</DetailRow>
      </dl>

      <dl className="student-detail-list home-detail-list home-detail-list-secondary">
        <DetailRow label="Last class">{formatDate(lastClass)}</DetailRow>
        <DetailRow label="Next class">{formatDate(nextClass)}</DetailRow>
        <DetailRow label="Contact">{student.guardianContact || student.phone || "\u2014"}</DetailRow>
      </dl>

      {student.latestFeedback ? (
        <div className="home-student-note">
          <h3>Latest feedback</h3>
          <p>{student.latestFeedback}</p>
        </div>
      ) : null}
      <div className="home-student-note">
        <h3>Notes</h3>
        <p>{student.notes || "No notes yet."}</p>
      </div>
    </div>
  );
}

function TrendPanel({ title, data, period = "week" }) {
  const rows = arrayOrEmpty(data);
  let maximum = 0;
  for (const row of rows) maximum = Math.max(maximum, finiteNumber(row?.collected ?? row?.amount ?? row?.value) ?? 0);

  return (
    <section className="panel trend-panel home-trend-panel" aria-labelledby={`home-${period}-trend`}>
      <h2 className="dashboard-section-title" id={`home-${period}-trend`}>{title}</h2>
      {rows.length ? (
        <div className="bar-chart home-bar-chart" role="img" aria-label={`${title}, shown as a bar chart`}>
          {rows.map((row, index) => {
            const value = finiteNumber(row?.collected ?? row?.amount ?? row?.value) ?? 0;
            const height = maximum > 0 ? Math.max(value > 0 ? 8 : 3, (value / maximum) * 120) : 3;
            const rawDate = period === "month" ? row?.month ?? row?.start : row?.start ?? row?.weekStart;
            const label = period === "month" ? formatMonth(rawDate) : formatDate(rawDate, "short");
            return (
              <div className="bar-item home-bar-item" key={`${rawDate ?? period}-${index}`}>
                <span className="bar-value home-bar-value">{formatMoney(value)}</span>
                <span className="bar home-bar-fill" style={{ height: `${height}px` }} aria-hidden="true" />
                <span className="home-bar-label">{label}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="No collection history"
          description="Collections appear here after payments are logged."
        />
      )}
    </section>
  );
}

export default function Home({ state = {}, derived = {}, asOfDate, actions = {}, navigate = () => {} }) {
  const { language } = useI18n();
  const dashboard = derived?.dashboard ?? {};
  const preferences = state?.preferences ?? state?.settings ?? {};
  const students = arrayOrEmpty(state?.students);
  const classLog = arrayOrEmpty(state?.classLog);
  const groupRows = arrayOrEmpty(dashboard.groupSummaries ?? derived?.groupSummaries ?? derived?.groups);
  const studentRows = arrayOrEmpty(
    dashboard.studentSummaries ?? dashboard.studentSnapshots ?? derived?.studentSummaries ?? derived?.students,
  );

  const initialMonth = (preferences.selectedMonth ?? dashboard.selectedMonth ?? "").slice(0, 7);
  const preferredStudentId = preferences.selectedStudentId ?? preferences.studentId ?? "";
  const fallbackStudentId = studentId(studentRows.find((student) => student?.status === "Active") ?? studentRows[0]);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [selectedStudentId, setSelectedStudentId] = useState(preferredStudentId || fallbackStudentId);
  const [studentDrawerOpen, setStudentDrawerOpen] = useState(false);

  useEffect(() => {
    const nextMonth = (preferences.selectedMonth ?? dashboard.selectedMonth ?? "").slice(0, 7);
    if (nextMonth) setSelectedMonth(nextMonth);
  }, [dashboard.selectedMonth, preferences.selectedMonth]);

  useEffect(() => {
    const nextStudent = preferences.selectedStudentId ?? preferences.studentId;
    if (nextStudent) setSelectedStudentId(nextStudent);
  }, [preferences.selectedStudentId, preferences.studentId]);

  const studentById = useMemo(() => {
    const map = new Map();
    for (const student of students) map.set(student.id, student);
    for (const student of studentRows) map.set(studentId(student), { ...map.get(studentId(student)), ...student });
    return map;
  }, [studentRows, students]);

  const selectedStudent = studentById.get(selectedStudentId) ?? studentRows[0] ?? null;
  const resolvedStudentId = studentId(selectedStudent);

  const selectedStudentSchedule = useMemo(() => {
    const boundary = asOfDate ?? dashboard.asOfDate ?? preferences.asOfDate ?? "";
    let futurePaid = 0;
    let lastClass = "";
    let nextClass = "";

    for (const row of classLog) {
      if (row?.studentId !== resolvedStudentId || typeof row?.classDate !== "string") continue;
      const paid = finiteNumber(row?.amountPaid) ?? 0;
      if (row.classDate > boundary && row?.paymentDate && row.paymentDate <= boundary) futurePaid += paid;
      if (row.classDate <= boundary && row.classStatus === "Completed" && (!lastClass || row.classDate > lastClass)) {
        lastClass = row.classDate;
      }
      if (row.classDate > boundary && row.classStatus === "Scheduled" && (!nextClass || row.classDate < nextClass)) {
        nextClass = row.classDate;
      }
    }
    return { futurePaid, lastClass, nextClass };
  }, [asOfDate, classLog, dashboard.asOfDate, preferences.asOfDate, resolvedStudentId]);

  const chooseStudent = (id, openDrawer = false) => {
    setSelectedStudentId(id);
    updatePreferences(actions, { selectedStudentId: id });
    if (openDrawer) setStudentDrawerOpen(true);
  };

  const academicMetrics = [
    { icon: UsersRound, value: formatNumber(dashboard.activeStudents), label: "Active students", tone: "lavender" },
    { icon: Star, value: formatPercent(dashboard.overallGrade), label: "Overall grade", tone: "coral" },
    { icon: CircleCheckBig, value: formatPercent(dashboard.overallAttendance), label: "Overall attendance", tone: "sage" },
    { icon: ClipboardList, value: formatNumber(dashboard.missingAssignments), label: "Missing assignments", tone: "amber" },
  ];
  const moneyMetrics = [
    { icon: WalletCards, value: formatMoney(dashboard.collectedThisWeek), label: "Collected this week", tone: "teal" },
    { icon: CalendarDays, value: formatMoney(dashboard.collectedSelectedMonth), label: "Collected — selected month", tone: "lavender" },
    { icon: CircleAlert, value: formatMoney(dashboard.outstandingThroughToday ?? dashboard.outstanding), label: "Outstanding", tone: "coral" },
    { icon: Clock3, value: formatMoney(dashboard.paidForFutureClasses ?? dashboard.paidForFuture), label: "Paid for future classes", tone: "amber" },
  ];

  return (
    <div className="page home-page">
      <section className="toolbar-row home-toolbar" aria-label="Dashboard filters">
        <Field label="Selected month">
          <Input
            type="month"
            value={selectedMonth}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedMonth(value);
              if (value) updatePreferences(actions, { selectedMonth: `${value}-01` });
            }}
          />
        </Field>
        <Field label="As of">
          <Input
            type="date"
            value={asOfDate ?? dashboard.asOfDate ?? preferences.asOfDate ?? ""}
            onChange={(event) => updatePreferences(actions, { asOfDate: event.target.value })}
          />
        </Field>
        <Field label="Student view">
          <Select
            value={resolvedStudentId}
            onChange={(event) => chooseStudent(event.target.value)}
          >
            {studentRows.length ? null : <option value="">No students</option>}
            {studentRows.map((student) => (
              <option key={studentId(student)} value={studentId(student)}>
                {studentName(student)}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="primary" onClick={() => navigate("class-log")}>Log class</Button>
      </section>

      <div className="dashboard-main-grid home-layout">
        <div className="dashboard-tables home-main-column">
          <section className="metric-section home-metric-section" aria-labelledby="academic-metrics-title">
            <h1 className="dashboard-section-title" id="academic-metrics-title">Academic metrics</h1>
            <div className="metric-grid home-metric-grid">
              {academicMetrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
            </div>
          </section>

          <section className="metric-section home-metric-section" aria-labelledby="money-metrics-title">
            <h2 id="money-metrics-title">Money metrics (MXN)</h2>
            <div className="metric-grid home-metric-grid">
              {moneyMetrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
            </div>
          </section>

          <section className="metric-section home-metric-section" aria-labelledby="projections-title">
            <h2 id="projections-title">Projections (MXN)</h2>
            <div className="projection-grid home-projection-grid">
              <MetricCard
                icon={TrendingUp}
                value={formatMoney(dashboard.idealRevenue ?? dashboard.idealMonthlyRevenue)}
                label="Ideal monthly revenue"
                tone="teal-wide"
              />
              <MetricCard
                icon={ChartNoAxesCombined}
                value={formatMoney(dashboard.recentProjection ?? dashboard.recentCollectionsProjection)}
                label="Recent collections projection"
                tone="lavender-wide"
              />
            </div>
          </section>

          <div className="trend-grid home-table-grid">
            <section className="panel home-table-panel" aria-labelledby="group-summary-title">
              <div className="panel-heading"><h2 id="group-summary-title">Group summary</h2></div>
              {groupRows.length ? (
                <TableShell label="Group summary">
                  <table className="data-table home-summary-table" style={{ minWidth: "640px" }}>
                    <thead>
                      <tr>
                        <th scope="col">Group</th>
                        <th scope="col">Students</th>
                        <th scope="col">Avg. grade</th>
                        <th scope="col">Attendance</th>
                        <th scope="col">Missing</th>
                        <th scope="col">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((group, index) => (
                        <tr key={group?.id ?? `${groupName(group)}-${index}`}>
                          <th scope="row"><span className={`home-group-name tone-${(index % 4) + 1}`}>{groupName(group)}</span></th>
                          <td>{formatNumber(group?.activeStudents ?? group?.studentCount)}</td>
                          <td>{formatPercent(group?.averageGrade ?? group?.avgGrade)}</td>
                          <td>{formatPercent(group?.attendance ?? group?.attendanceRate)}</td>
                          <td>{formatNumber(group?.missingAssignments ?? group?.missing)}</td>
                          <td>{formatMoney(group?.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Total</th>
                        <td>{formatNumber(dashboard.activeStudents)}</td>
                        <td>{formatPercent(dashboard.overallGrade)}</td>
                        <td>{formatPercent(dashboard.overallAttendance)}</td>
                        <td>{formatNumber(dashboard.missingAssignments)}</td>
                        <td>{formatMoney(dashboard.outstandingThroughToday ?? dashboard.outstanding)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </TableShell>
              ) : (
                <EmptyState icon={UsersRound} title="No groups yet" description="Add a group in Setup to begin." action={<Button onClick={() => navigate("setup")}>Go to Setup</Button>} />
              )}
            </section>

            <section className="panel home-table-panel" aria-labelledby="student-snapshot-title">
              <div className="panel-heading"><h2 id="student-snapshot-title">Student snapshot</h2></div>
              {studentRows.length ? (
                <>
                  <TableShell label="Student snapshot">
                    <table className="data-table home-summary-table" style={{ minWidth: "780px" }}>
                      <thead>
                        <tr>
                          <th scope="col">Student</th>
                          <th scope="col">Group</th>
                          <th scope="col">Grade</th>
                          <th scope="col">Attendance</th>
                          <th scope="col">Missing</th>
                          <th scope="col">Outstanding</th>
                          <th scope="col">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentRows.slice(0, 6).map((student) => {
                          const id = studentId(student);
                          return (
                            <tr key={id} className={id === resolvedStudentId ? "is-selected" : undefined}>
                              <th scope="row">
                                <button className="home-student-link" type="button" onClick={() => chooseStudent(id, true)}>
                                  <span className="avatar avatar-lilac home-mini-avatar" aria-hidden="true">{initials(studentName(student))}</span>
                                  <span>{studentName(student)}</span>
                                </button>
                              </th>
                              <td>{groupName(student)}</td>
                              <td>{formatPercent(student?.gradeAverage ?? student?.averageGrade)}</td>
                              <td>{formatPercent(student?.attendance ?? student?.attendanceRate)}</td>
                              <td>{formatNumber(student?.missingAssignments ?? student?.missing)}</td>
                              <td>{formatMoney(student?.outstanding)}</td>
                              <td><StudentStatus student={student} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableShell>
                  <button className="home-table-link" type="button" onClick={() => navigate("setup")}>{language === "es"
                    ? `Ver ${studentRows.length === 1 ? "al alumno" : `los ${studentRows.length} alumnos`}`
                    : `View all ${studentRows.length} ${studentRows.length === 1 ? "student" : "students"}`}</button>
                </>
              ) : (
                <EmptyState icon={UsersRound} title="No students yet" description="Add a student in Setup to see their snapshot." action={<Button onClick={() => navigate("setup")}>Go to Setup</Button>} />
              )}
            </section>
          </div>

          <div className="trend-grid home-trend-grid">
            <TrendPanel title="Collections – Last 8 weeks (MXN)" data={dashboard.weeklyCollections} period="week" />
            <TrendPanel title="Collections – Last 6 months (MXN)" data={dashboard.monthlyCollections} period="month" />
          </div>
        </div>

        <aside className="panel selected-student-panel home-student-panel" aria-label="Selected student details">
          <StudentDetail student={selectedStudent} {...selectedStudentSchedule} />
          {selectedStudent ? (
            <Button className="home-profile-button" onClick={() => setStudentDrawerOpen(true)}>View full profile</Button>
          ) : null}
        </aside>
      </div>

      <Drawer
        open={studentDrawerOpen}
        onClose={() => setStudentDrawerOpen(false)}
        title={selectedStudent ? studentName(selectedStudent) : "Student profile"}
        description={selectedStudent ? groupName(selectedStudent) : undefined}
        footer={selectedStudent ? <Button variant="primary" onClick={() => navigate("class-log")}>Log class</Button> : null}
      >
        <StudentDetail student={selectedStudent} {...selectedStudentSchedule} compact />
      </Drawer>
    </div>
  );
}
