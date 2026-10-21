import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { IconButton, ListRow } from "../components/ui";
import { useCompactViewport } from "../components/OverlayContext";
import { addMonths, endOfMonth, startOfMonth } from "../domain/dates";
import {
  dayNumber,
  formatDayMonth,
  formatHours,
  formatMonthYear,
  formatTime,
  weekdayLong,
  weekdayShort,
} from "../utils/displayFormat";
import { buildClassWorkspaceSessionsForRange, rosterForClassSession } from "./classesWorkspaceModel";
import { calendarDays } from "../domain/pickerModels";
import { sessionInsight, SessionDetailSheet } from "./ClassSessionDetail";

/** Calendar look for a session: done, pending (not recorded), next, scheduled or cancelled. */
export function calendarTone(session, primaryKey) {
  if (session.statusLabel === "Registered") return "done";
  if (session.statusLabel === "Pending") return "pending";
  if (session.statusLabel === "Cancelled") return "cancelled";
  if (session.key === primaryKey) return "next";
  return "scheduled";
}

const TONE_LABEL = {
  done: { label: "Completed", className: "st-done", mobile: "Recorded" },
  pending: { label: "Not recorded", className: "st-pend", mobile: "Not recorded" },
  next: { label: "Next", className: "st-next", mobile: "Next" },
  scheduled: { label: "Scheduled", className: "st-prog", mobile: "Scheduled" },
  cancelled: { label: "Cancelled", className: "st-prog", mobile: "Cancelled" },
};

function chipLabel(session) {
  const [hour] = String(session.startTime || "").split(":");
  const h = Number(hour) % 12 || 12;
  return `${Number.isFinite(h) ? h : ""} · ${session.title}`;
}

export function ClassCalendar({ state, derived = undefined, currentDate, primaryKey, onOpen, onEdit }) {
  const { t, locale } = useI18n();
  const compact = useCompactViewport();
  const [month, setMonth] = useState(startOfMonth(currentDate));
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [sheetSession, setSheetSession] = useState(null);
  const mondayDays = useMemo(() => calendarDays(month), [month]);
  const range = { start: mondayDays[0] || month, end: mondayDays.at(-1) || endOfMonth(month) };
  const sessions = useMemo(
    () => buildClassWorkspaceSessionsForRange(state, range.start, range.end, currentDate),
    [currentDate, range.end, range.start, state],
  );
  const byDate = useMemo(() => {
    const grouped = new Map();
    sessions.forEach((session) => grouped.set(session.classDate, [...(grouped.get(session.classDate) || []), session]));
    return grouped;
  }, [sessions]);
  const selected = byDate.get(selectedDate) || [];
  const inMonth = sessions.filter((session) => session.classDate.slice(0, 7) === month.slice(0, 7));
  const totals = {
    done: inMonth.filter((session) => session.statusLabel === "Registered").length,
    pending: inMonth.filter((session) => session.statusLabel === "Pending").length,
    upcoming: inMonth.filter((session) => ["Scheduled", "Rescheduled"].includes(session.statusLabel)).length,
  };
  const derivedRows = derived?.classLog || [];
  const move = (amount) => {
    const next = addMonths(month, amount);
    setMonth(next);
    setSelectedDate(next.slice(0, 7) === currentDate.slice(0, 7) ? currentDate : next);
  };
  const studentCount = (session) => rosterForClassSession(state, session).length;
  const kicker = `${weekdayLong(selectedDate, locale)}${selectedDate === currentDate ? ` · ${t("Today")}` : ""}`;
  const cardAction = (session, tone) => {
    if (tone === "done") return { label: "View record", run: () => onOpen(session) };
    if (tone === "pending" || tone === "next") return { label: "Record class", run: () => onOpen(session) };
    if (tone === "cancelled") return null;
    const editable =
      !(session.rows || []).length && (session.classScheduleId || session.scheduleSlotId || session.exceptionId);
    return editable
      ? { label: "Edit class", run: () => onEdit(session) }
      : { label: "Open class", run: () => onOpen(session) };
  };

  return (
    <div className="class-calendar" role="tabpanel" data-onboarding-tour="classes">
      <div className="calendar-toolbar">
        <IconButton label={t("Previous month")} icon={ChevronLeft} onClick={() => move(-1)} />
        <h2 aria-live="polite">{formatMonthYear(month, locale)}</h2>
        <IconButton label={t("Next month")} icon={ChevronRight} onClick={() => move(1)} />
        <button
          type="button"
          className="link-button today-link"
          onClick={() => {
            setMonth(startOfMonth(currentDate));
            setSelectedDate(currentDate);
          }}
        >
          {t("Today")}
        </button>
        <div className="calendar-legend" aria-hidden="true">
          {["done", "pending", "next", "scheduled"].map((tone) => (
            <span key={tone}>
              <i className={`tone-${tone}`} />
              {t(TONE_LABEL[tone].label)}
            </span>
          ))}
        </div>
      </div>
      <div className="calendar-layout">
        <section className="month-grid" aria-label={formatMonthYear(month, locale)}>
          <div className="month-grid-head" aria-hidden="true">
            {mondayDays.slice(0, 7).map((date) => (
              <span key={date}>{compact ? weekdayShort(date, locale).charAt(0) : weekdayShort(date, locale)}</span>
            ))}
          </div>
          <div className="month-grid-body">
            {mondayDays.map((date) => {
              const items = byDate.get(date) || [];
              const outside = date.slice(0, 7) !== month.slice(0, 7);
              return (
                <button
                  type="button"
                  key={date}
                  className={`month-cell ${outside ? "is-outside" : ""} ${date === currentDate ? "is-today" : ""} ${date === selectedDate ? "is-selected" : ""}`.trim()}
                  aria-pressed={date === selectedDate}
                  aria-label={t("{date}, {count} classes", {
                    date: formatDayMonth(date, locale),
                    count: items.length,
                  })}
                  onClick={() => setSelectedDate(date)}
                >
                  <b>{dayNumber(date)}</b>
                  {items.slice(0, 3).map((session) => (
                    <span key={session.key} className={`cal-chip tone-${calendarTone(session, primaryKey)}`}>
                      <span>{chipLabel(session)}</span>
                    </span>
                  ))}
                  {items.length > 3 ? <span className="cal-more">+{items.length - 3}</span> : null}
                  <span className="month-dots" aria-hidden="true">
                    {items.slice(0, 4).map((session) => (
                      <i key={session.key} className={`tone-${calendarTone(session, primaryKey)}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {compact ? (
          <div className="calendar-mobile-legend" aria-hidden="true">
            <span>
              <i style={{ background: "var(--indigo)" }} />
              {t("Recorded")}
            </span>
            <span>
              <i style={{ background: "var(--ocre)" }} />
              {t("Not recorded")}
            </span>
            <span>
              <i style={{ background: "var(--bermellon)" }} />
              {t("Next")}
            </span>
            <span>
              <i style={{ background: "var(--sumi-subtle)" }} />
              {t("Scheduled")}
            </span>
          </div>
        ) : null}
        <aside className="day-panel" aria-live="polite">
          {compact ? (
            <div className="block-head">
              <h3 className="section-title">
                {selectedDate === currentDate ? `${t("Today")} · ` : ""}
                {weekdayLong(selectedDate, locale)} {dayNumber(selectedDate)}
              </h3>
              <small className="muted">
                {t(selected.length === 1 ? "{count} class" : "{count} classes", { count: selected.length })}
              </small>
            </div>
          ) : (
            <>
              <span className="overline">{kicker}</span>
              <h3>
                {formatDayMonth(selectedDate, locale)} ·{" "}
                {t(selected.length === 1 ? "{count} class" : "{count} classes", { count: selected.length })}
              </h3>
            </>
          )}
          {compact ? (
            <div className="list-rows">
              {selected.map((session) => {
                const tone = calendarTone(session, primaryKey);
                return (
                  <ListRow
                    key={session.key}
                    avatar={<span className="list-time">{formatTime(session.startTime, locale)}</span>}
                    name={session.title}
                    context={
                      <>
                        {(session.rows || []).length
                          ? sessionInsight(state, session, derivedRows, t, locale).text
                          : `${formatHours(session.durationHours, locale)}${session.format === "group" ? ` · ${t("{count} students", { count: studentCount(session) })}` : ""}`}
                        <span className={`st ${TONE_LABEL[tone].className}`}>{t(TONE_LABEL[tone].mobile)}</span>
                      </>
                    }
                    className="with-time"
                    onClick={() => ((session.rows || []).length ? setSheetSession(session) : onOpen(session))}
                  />
                );
              })}
            </div>
          ) : (
            selected.map((session) => {
              const tone = calendarTone(session, primaryKey);
              const action = cardAction(session, tone);
              const insight = sessionInsight(state, session, derivedRows, t, locale);
              return (
                <article key={session.key} className="day-card">
                  <div className="day-card-top">
                    <span>{formatTime(session.startTime, locale)}</span>
                    <span className={`st ${TONE_LABEL[tone].className}`}>{t(TONE_LABEL[tone].label)}</span>
                  </div>
                  <strong>{session.title}</strong>
                  <small>
                    {session.format === "group"
                      ? t("{count} students", { count: studentCount(session) })
                      : t("Individual")}{" "}
                    · {formatHours(session.durationHours, locale)}
                  </small>
                  {(session.rows || []).length && insight.tone !== "ok" ? (
                    <span className="day-card-note">{insight.text}</span>
                  ) : null}
                  {action ? (
                    <button type="button" className="link-button" onClick={action.run}>
                      {t(action.label)}
                    </button>
                  ) : null}
                </article>
              );
            })
          )}
          {!selected.length ? <p className="muted">{t("No classes this day.")}</p> : null}
          {compact ? null : (
            <div className="month-totals">
              <span className="overline">{formatMonthYear(month, locale).split(" ")[0]}</span>
              <div>
                <span>{t("Classes completed")}</span>
                <b>{totals.done}</b>
              </div>
              <div>
                <span>{t("Not recorded")}</span>
                <b className="text-pend">{totals.pending}</b>
              </div>
              <div>
                <span>{t("Upcoming")}</span>
                <b>{totals.upcoming}</b>
              </div>
            </div>
          )}
        </aside>
        {compact ? (
          <div className="kpi-strip">
            <div className="kpi">
              <span>{t("Recorded")}</span>
              <strong>{totals.done}</strong>
            </div>
            <div className="kpi">
              <span>{t("Not recorded")}</span>
              <strong className="text-pend">{totals.pending}</strong>
            </div>
            <div className="kpi">
              <span>{t("Upcoming")}</span>
              <strong>{totals.upcoming}</strong>
            </div>
          </div>
        ) : null}
      </div>
      <SessionDetailSheet
        open={Boolean(sheetSession)}
        onClose={() => setSheetSession(null)}
        state={state}
        session={sheetSession}
        derivedRows={derivedRows}
        onEdit={onOpen}
      />
    </div>
  );
}
