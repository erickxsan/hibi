import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { Button, EmptyState, SearchInput, Select } from "../components/ui";
import { useCompactViewport } from "../components/OverlayContext";
import { startOfWeek } from "../domain/dates";
import { normalizeSearchText } from "../utils/searchText";
import {
  dayNumber,
  formatDayMonth,
  formatHours,
  formatPercent,
  formatScore,
  formatShortDate,
  formatTime,
  monthLong,
  weekdayShort,
} from "../utils/displayFormat";
import {
  attendanceWord,
  paymentWord,
  sessionAssessment,
  sessionInsight,
  SessionDetailSheet,
  sessionStudentLines,
} from "./ClassSessionDetail";
import { STATUS_LOOK } from "./classesWorkspaceModel";

const WEEKS_PER_PAGE = 4;

/**
 * The one status a row shows: «Sin registrar», «Cancelada» or what went wrong in a recorded class
 * («Emilio faltó», «1 pago pendiente»). A recorded class with nothing to fix shows none.
 */
function rowStatus(session, insight, t) {
  if (session.statusLabel === "Registered")
    return insight.tone === "ok" || !insight.text
      ? null
      : { className: insight.tone === "pend" ? "st-pend" : "st-venc", text: insight.text };
  const look = STATUS_LOOK[session.statusLabel] || STATUS_LOOK.Scheduled;
  return { className: look.className, text: t(look.label) };
}

function attendanceRatio(sessions) {
  const rows = sessions.flatMap((session) =>
    (session.rows || []).filter((row) => ["P", "L", "A"].includes(row.attendance)),
  );
  return rows.length ? rows.filter((row) => row.attendance !== "A").length / rows.length : null;
}

export function ClassHistory({
  state,
  derived = undefined,
  sessions,
  currentDate,
  initialKey = "",
  onEdit,
  onOpenTracking,
}) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const [owner, setOwner] = useState("");
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState(initialKey);
  const [weeks, setWeeks] = useState(WEEKS_PER_PAGE);
  const [sheetSession, setSheetSession] = useState(null);
  const derivedRows = derived?.classLog || [];
  const history = useMemo(
    () =>
      sessions
        .filter((session) => session.statusLabel !== "Scheduled" && session.classDate <= currentDate)
        .sort((a, b) => b.classDate.localeCompare(a.classDate) || (b.startTime || "").localeCompare(a.startTime || "")),
    [currentDate, sessions],
  );
  const owners = useMemo(() => {
    const groups = new Map();
    history.forEach((session) => {
      if (session.groupId) groups.set(session.groupId, session.title);
    });
    return [...groups.entries()].map(([id, name]) => ({ id, name }));
  }, [history]);
  const needle = normalizeSearchText(search);
  const filtered = history.filter((session) => {
    if (owner === "individual" && session.groupId) return false;
    if (owner && owner !== "individual" && session.groupId !== owner) return false;
    if (!needle) return true;
    const names = (session.rows || [])
      .map((row) => (state.students || []).find((student) => student.id === row.studentId)?.fullName || "")
      .join(" ");
    return normalizeSearchText(`${session.title} ${sessionAssessment(state, session).name} ${names}`).includes(needle);
  });
  const month = currentDate.slice(0, 7);
  const monthSessions = filtered.filter((session) => session.classDate.slice(0, 7) === month);
  const recorded = monthSessions.filter((session) => session.statusLabel === "Registered");
  const averages = recorded
    .map((session) => sessionAssessment(state, session).average)
    .filter((value) => value !== null);
  const unpaid = recorded.filter((session) =>
    derivedRows.some((row) => session.rows.some((item) => item.id === row.id) && Number(row.outstanding) > 0),
  ).length;
  const kpis = [
    { label: t(compact ? "Recorded" : "Classes completed"), value: String(recorded.length) },
    {
      // Named with its month: Inicio counts the last 30 days, so a bare «Sin registrar» read as a contradiction.
      label: t("Not recorded in {month}", { month: monthLong(`${month}-01`, locale) }),
      value: String(monthSessions.filter((session) => session.statusLabel === "Pending").length),
      tone: "pend",
    },
    { label: t("Attendance"), value: formatPercent(attendanceRatio(recorded), locale) },
    ...(compact
      ? []
      : [
          {
            label: t("Assignment average"),
            value: averages.length ? formatScore(averages.reduce((a, b) => a + b, 0) / averages.length, locale) : "—",
          },
          { label: t("Unpaid classes"), value: String(unpaid), tone: unpaid ? "bad" : "" },
        ]),
  ];
  const byWeek = new Map();
  filtered.forEach((session) => {
    const week = startOfWeek(session.classDate);
    byWeek.set(week, [...(byWeek.get(week) || []), session]);
  });
  const weekEntries = [...byWeek.entries()];

  const marks = (session) => (
    <span className="pa-tags" aria-hidden="true">
      {(session.rows || [])
        .filter((row) => row.attendance)
        .map((row) => (
          <b key={row.id} className={row.attendance === "A" ? "is-a" : ""}>
            {row.attendance === "A" ? "A" : "P"}
          </b>
        ))}
    </span>
  );

  return (
    <div className="class-history" role="tabpanel" data-onboarding-tour="classes">
      <div className="history-toolbar">
        <Select
          className="history-owner-select"
          aria-label={t("Filter by group")}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="">{t("All groups")}</option>
          {owners.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
          {history.some((session) => !session.groupId) ? (
            <option value="individual">{t("Individual classes")}</option>
          ) : null}
        </Select>
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("Search class, assignment or student")}
        />
      </div>
      <div className="kpi-strip">
        {kpis.map((kpi) => (
          <div className="kpi" key={kpi.label}>
            <span>{kpi.label}</span>
            <strong className={kpi.tone ? `text-${kpi.tone}` : undefined}>{kpi.value}</strong>
          </div>
        ))}
      </div>
      {!weekEntries.length ? (
        <div className="history-empty">
          <EmptyState stamp title={t("No matching classes")} description={t("Recorded classes will appear here.")} />
        </div>
      ) : null}
      {weekEntries.slice(0, weeks).map(([week, items]) => {
        const ratio = attendanceRatio(items);
        return (
          <section
            className="history-week"
            key={week}
            aria-label={t("Week of {date}", { date: formatDayMonth(week, locale) })}
          >
            <div className="history-week-head">
              {compact ? (
                <h3 className="section-title">
                  {t("Week of {date}", { date: formatShortDate(week, locale, { weekday: false }) })}
                </h3>
              ) : (
                <span className="overline">{t("Week of {date}", { date: formatDayMonth(week, locale) })}</span>
              )}
              <small>
                {t(items.length === 1 ? "{count} class" : "{count} classes", { count: items.length })}
                {!compact && ratio !== null
                  ? ` · ${t("attendance {value}", { value: formatPercent(ratio, locale) })}`
                  : ""}
              </small>
            </div>
            {items.map((session) => {
              const open = openKey === session.key;
              const insight = sessionInsight(state, session, derivedRows, t, locale);
              const assessment = sessionAssessment(state, session);
              const status = rowStatus(session, insight, t);
              // Only an assignment earns a subtitle: «Sin tarea» and «Sin registrar» repeated the status.
              const subtitle = assessment.name
                ? `${assessment.name}${assessment.average !== null ? ` · ${t("average {value}", { value: formatScore(assessment.average, locale) })}` : ""}`
                : "";
              return (
                <div className={`history-row ${open ? "is-open" : ""}`} key={session.key}>
                  <button
                    type="button"
                    className="history-row-button"
                    aria-expanded={compact ? undefined : open}
                    onClick={() => (compact ? setSheetSession(session) : setOpenKey(open ? "" : session.key))}
                  >
                    <span className="history-date">
                      {compact ? (
                        <>
                          <b>{dayNumber(session.classDate)}</b>
                          <small>{weekdayShort(session.classDate, locale).toUpperCase()}</small>
                        </>
                      ) : (
                        <>
                          <b>{formatShortDate(session.classDate, locale)}</b>
                          <small>
                            {formatTime(session.startTime, locale)} · {formatHours(session.durationHours, locale)}
                          </small>
                        </>
                      )}
                    </span>
                    <span className="history-title">
                      <strong>
                        {session.title}
                        {session.format === "individual" ? ` · ${t("individual")}` : ""}
                      </strong>
                      <small>
                        {compact ? marks(session) : null} {subtitle}
                      </small>
                    </span>
                    <span className="history-marks">{marks(session)}</span>
                    <span className={`history-status ${status ? `st ${status.className}` : ""}`}>
                      {status ? status.text : <span className="sr-only">{t("Completed")}</span>}
                    </span>
                    {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  </button>
                  {open && !compact ? (
                    <div className="history-detail">
                      {(session.rows || []).length ? (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>{t("Student")}</th>
                              <th>{t("Attendance")}</th>
                              <th>{t("Grade")}</th>
                              <th>{t("Payment")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionStudentLines(state, session, derivedRows).map(
                              ({ student, row, derivedRow, grade }) => {
                                const attendance = attendanceWord(row);
                                const pay = paymentWord(row, derivedRow, locale, t);
                                return (
                                  <tr key={student.id}>
                                    <td>
                                      <strong>{student.fullName}</strong>
                                    </td>
                                    <td>
                                      <span
                                        className={`st ${attendance.tone === "bad" ? "st-venc" : attendance.tone === "ok" ? "st-ok" : "st-prog"}`}
                                      >
                                        {t(attendance.key)}
                                      </span>
                                    </td>
                                    <td className="tnum">
                                      <b>{grade?.score != null ? formatScore(Number(grade.score), locale) : "—"}</b>
                                    </td>
                                    <td>
                                      <span
                                        className={`st ${pay.tone === "bad" ? "st-venc" : pay.tone === "pend" ? "st-pend" : pay.tone === "ok" ? "st-ok" : "st-prog"}`}
                                      >
                                        {pay.text}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              },
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <p className="muted">{t("This class has no record yet.")}</p>
                      )}
                      <div className="history-detail-actions">
                        <button type="button" className="link-button" onClick={() => onEdit(session)}>
                          {t((session.rows || []).length ? "Edit record" : "Record class")}
                        </button>
                        {(session.rows || []).length ? (
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onOpenTracking({ type: "open-tracking", tab: "attendance" })}
                          >
                            {t("View in Tracking")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        );
      })}
      {weekEntries.length > weeks ? (
        <div className="history-more">
          <Button onClick={() => setWeeks((value) => value + WEEKS_PER_PAGE)}>{t("Show earlier weeks")}</Button>
        </div>
      ) : null}
      <SessionDetailSheet
        open={Boolean(sheetSession)}
        onClose={() => setSheetSession(null)}
        state={state}
        session={sheetSession}
        derivedRows={derivedRows}
        onEdit={onEdit}
      />
    </div>
  );
}
