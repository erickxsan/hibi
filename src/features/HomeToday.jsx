import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { BottomSheet, Button, IconButton, ListRow } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import {
  formatMoney,
  formatPercent,
  formatScore,
  formatShortDate,
  formatSpan,
  formatTime,
  formatTimeRange,
  monthLong,
} from "../utils/displayFormat";

function clockLabel(minutes, locale, { suffix = true } = {}) {
  const text = formatTime(minutes, locale);
  return suffix ? text : text.replace(/\s.*$/, "");
}

function firstName(name) {
  return String(name || "").split(" ")[0];
}

/** Short status under each student of a class card. */
export function noteChip(note, t, locale) {
  switch (note.kind) {
    case "absences":
      return { tone: "st-venc", text: t("{missed} absences of {total}", { missed: note.missed, total: note.total }) };
    case "owes":
      return { tone: "st-pend", text: t("Owes {amount}", { amount: formatMoney(note.amount, locale) }) };
    case "ungraded":
      return { tone: "st-pend", text: t("Ungraded") };
    case "monthlyPending":
      return { tone: "st-pend", text: t("Monthly fee") };
    case "customFee":
      return { tone: "st-ok", text: t("Own fee") };
    default:
      return { tone: "st-ok", text: t("Up to date") };
  }
}

/** Sentence after the student's name in «Antes de empezar». */
export function noteSentence(note, t, locale) {
  switch (note.kind) {
    case "absences":
      return t("missed {missed} of their last {total} classes.", { missed: note.missed, total: note.total });
    case "owes": {
      // The amount spans every unpaid class; name how many so it does not read as one class.
      const parameters = {
        amount: formatMoney(note.amount, locale),
        count: note.count,
        date: formatShortDate(note.date, locale, { weekday: false }),
      };
      return note.count > 1
        ? t("owes {amount} from {count} classes since {date}.", parameters)
        : t("owes {amount} from the class on {date}.", parameters);
    }
    case "ungraded":
      return t("has no grade in {assessment}.", { assessment: note.assessment });
    case "monthlyPending":
      return t("their {month} monthly fee is pending.", { month: monthLong(`${note.period}-01`, locale) });
    default:
      return "";
  }
}

function noteDot(note) {
  return note.tone === "bad" ? "var(--bermellon)" : "var(--ocre)";
}

/** Notes still worth showing: with text and not marked as seen. */
function openNotes(item, t, locale) {
  return item.notes.filter((entry) => !entry.dismissed && noteSentence(entry.note, t, locale));
}

/** «Marcar como visto»: hides a note until something new happens (another unpaid class, absence, month…). */
function SeenButton({ entry, onDismiss }) {
  const { t } = useI18n();
  if (!entry.key || !onDismiss) return null;
  return (
    <IconButton
      className="note-seen"
      icon={Check}
      label={t("Mark as seen: {name}", { name: firstName(entry.student.fullName) })}
      onClick={() => onDismiss([entry.key], true)}
    />
  );
}

/** Seen notes of a class and the way to show them again. */
function HiddenNotes({ item, onDismiss }) {
  const { t } = useI18n();
  const hidden = item.notes.filter((entry) => entry.dismissed);
  if (!hidden.length || !onDismiss) return null;
  return (
    <button
      type="button"
      className="link-button note-hidden"
      onClick={() =>
        onDismiss(
          hidden.map((entry) => entry.key),
          false,
        )
      }
    >
      {t(hidden.length === 1 ? "{count} seen notice · Show again" : "{count} seen notices · Show again", {
        count: hidden.length,
      })}
    </button>
  );
}

function stateLabel(item, now, t) {
  if (item.state === "done") return t("Completed");
  if (item.state === "pending") return t("Not recorded");
  if (item.state === "live") return t("In progress");
  if (item.state === "next") return `${t("Next")} · ${t("in {span}", { span: formatSpan(item.start - now) })}`;
  return t("Scheduled");
}

export function TodayTimeline({ timeline, selectedKey, onSelect }) {
  const { t, locale } = useI18n();
  const span = timeline.dayEnd - timeline.dayStart || 1;
  const pct = (minutes) => Math.max(0, Math.min(100, ((minutes - timeline.dayStart) / span) * 100));
  const hours = [];
  const firstHour = Math.floor(timeline.dayStart / 60) * 60;
  for (let minute = firstHour; minute <= timeline.dayEnd; minute += 60) hours.push(minute);
  // Keep at least ~72 px per hour so a one-hour class never shrinks into an unreadable chip.
  const minWidth = Math.max(860, (hours.length - 1) * 72);
  const showNow = timeline.now >= timeline.dayStart && timeline.now <= timeline.dayEnd;
  return (
    <div className="tlw" role="region" aria-label={t("Today's timeline")} tabIndex={0}>
      <div className="tl" style={{ minWidth: `${minWidth}px` }}>
        {hours.map((minute, index) => (
          <span
            key={minute}
            className={`tk ${(minute / 60) % 2 === 0 ? "mj" : ""} ${index === 0 ? "first" : index === hours.length - 1 ? "last" : ""}`.trim()}
            style={{ left: `${pct(minute)}%` }}
          >
            <b>{(minute / 60) % 2 === 0 ? formatTime(minute, locale).replace(":00", "") : ""}</b>
          </span>
        ))}
        <span className="rail" />
        {showNow ? <span className="rail-past" style={{ width: `${pct(timeline.now)}%` }} /> : null}
        {/* The free stretch starts now, so it only shows while now is on the line. */}
        {showNow && timeline.freeMinutes > 0 && timeline.next ? (
          <span
            className="free"
            style={{ left: `${pct(timeline.now)}%`, width: `${pct(timeline.next.start) - pct(timeline.now)}%` }}
          >
            {pct(timeline.next.start) - pct(timeline.now) > 14 ? (
              <b>{t("Free · {span}", { span: formatSpan(timeline.freeMinutes) })}</b>
            ) : null}
          </span>
        ) : null}
        {timeline.items.map((item, index) => {
          const label = stateLabel(item, timeline.now, t);
          return (
            <button
              type="button"
              key={item.key}
              className={`blk ${item.state} ${item.key === selectedKey ? "sel" : ""}`.trim()}
              style={{
                left: `${pct(item.start)}%`,
                width: `calc(${pct(item.end) - pct(item.start)}% - 4px)`,
                animationDelay: `${0.2 + index * 0.12}s`,
              }}
              aria-pressed={item.key === selectedKey}
              aria-label={t("{title}, {range}, {state}", {
                title: item.session.title,
                range: formatTimeRange(item.session.startTime, item.session.durationHours, locale),
                state: label,
              })}
              onClick={() => onSelect(item.key)}
            >
              <span className="bt">
                {formatTimeRange(item.session.startTime, item.session.durationHours, locale).replace(/ – /, "–")}
              </span>
              <strong>{item.session.title}</strong>
              <span className="bl">{label}</span>
              {item.alerts ? (
                <span className="badge" aria-hidden="true">
                  {item.alerts}
                </span>
              ) : null}
            </button>
          );
        })}
        {showNow ? (
          <span className="needle" style={{ left: `${pct(timeline.now)}%` }}>
            <span className="nl">{t("Now · {time}", { time: clockLabel(timeline.now, locale) })}</span>
            <span className="nd" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function recordedChip(row, t) {
  if (row?.attendance === "A") return { tone: "st-venc", text: t("Absent") };
  if (row?.paymentState === "Pending" || row?.paymentState === "Unpaid")
    return { tone: "st-pend", text: t("Did not pay today") };
  return { tone: "st-ok", text: t("Present") };
}

export function ClassCard({ item, now, derived, onRecord, onOpenRecord, onDismissNotes = undefined }) {
  const { t, locale } = useI18n();
  const session = item.session;
  const done = item.state === "done";
  const individual = session.format === "individual";
  const notes = openNotes(item, t, locale);
  const seenKeys = notes.map((entry) => entry.key).filter(Boolean);
  const rowsByStudent = new Map((session.rows || []).map((row) => [row.studentId, row]));
  const range = formatTimeRange(session.startTime, session.durationHours, locale);
  let kicker;
  let kickerTone = "";
  if (done) {
    kicker = `${t("Completed")} · ${range}`;
    kickerTone = "is-done";
  } else if (item.state === "live") {
    kicker = t("In progress · ends at {time}", { time: formatTime(item.end, locale) });
    kickerTone = "is-next";
  } else if (item.state === "next") {
    kicker = t("Next · starts in {span}", { span: formatSpan(item.start - now) });
    kickerTone = "is-next";
  } else if (item.state === "pending") {
    kicker = t("Finished · not recorded");
    kickerTone = "is-next";
  } else kicker = `${t("Scheduled")} · ${range}`;
  const summary =
    done && item.attendance
      ? t("{present} of {total} present", { present: item.attendance.present, total: item.attendance.total })
      : individual
        ? `${t("Individual class")} · ${formatSpan(item.end - item.start)}`
        : `${range} · ${t(item.roster.length === 1 ? "{count} student" : "{count} students", { count: item.roster.length })}`;
  const student = individual ? item.roster[0] : null;
  const derivedStudent = student ? (derived?.students || []).find((entry) => entry.id === student.id) : null;
  return (
    <article className="dcard" aria-label={session.title}>
      <div className="dmain">
        <span className={`overline ${kickerTone}`}>{kicker}</span>
        <h3>{session.title}</h3>
        <span className="dsub">{summary}</span>
        <div className="roster">
          {item.roster.map((person) => {
            const entry = item.notes.find((note) => note.student.id === person.id);
            // A note marked as seen leaves no chip: it is neither news nor «al día».
            const chip = done
              ? recordedChip(rowsByStudent.get(person.id), t)
              : entry?.dismissed
                ? null
                : noteChip(entry?.note || { kind: "upToDate" }, t, locale);
            return (
              <div className="rs" key={person.id}>
                <StudentAvatar avatarId={person.avatarId} name={person.fullName} decorative />
                <b>{individual ? person.fullName : firstName(person.fullName)}</b>
                {chip ? <span className={`st ${chip.tone}`}>{chip.text}</span> : null}
              </div>
            );
          })}
          {derivedStudent ? (
            <>
              <div className="rstat">
                <span>{t("Attendance")}</span>
                <b>{formatPercent(derivedStudent.attendance, locale)}</b>
              </div>
              <div className="rstat">
                <span>{t("Average")}</span>
                <b>
                  {formatScore(
                    Number.isFinite(derivedStudent.gradeAverage) ? derivedStudent.gradeAverage * 10 : NaN,
                    locale,
                  )}
                </b>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="dside">
        <div className="dside-head">
          <span className="overline">{t(done ? "Left pending" : "Before you start")}</span>
          {onDismissNotes && seenKeys.length > 1 ? (
            <button type="button" className="link-button" onClick={() => onDismissNotes(seenKeys, true)}>
              {t("Mark all as seen")}
            </button>
          ) : null}
        </div>
        {notes.length ? (
          notes.slice(0, 4).map((entry) => (
            <p className="dnote" key={entry.student.id}>
              <i style={{ background: noteDot(entry.note) }} />
              <span>
                <strong>{firstName(entry.student.fullName)}</strong> {noteSentence(entry.note, t, locale)}
              </span>
              <SeenButton entry={entry} onDismiss={onDismissNotes} />
            </p>
          ))
        ) : (
          <p className="dnote">
            <i style={{ background: "var(--jade)" }} />
            <span>
              {t(item.notes.some((entry) => entry.dismissed) ? "No new notices." : "Everyone is up to date.")}
            </span>
          </p>
        )}
        <HiddenNotes item={item} onDismiss={onDismissNotes} />
        {done ? (
          <Button onClick={() => onOpenRecord(session)}>{t("View record")}</Button>
        ) : (
          <Button variant="primary" onClick={() => onRecord(session)}>
            {t("Record class")}
          </Button>
        )}
      </div>
    </article>
  );
}

function agendaLine(item, t, locale) {
  const session = item.session;
  if (item.state === "done" && item.attendance) {
    const absent = item.attendance.absentIds
      .map((id) => item.roster.find((student) => student.id === id)?.fullName)
      .filter(Boolean)
      .map(firstName);
    const base = `${t("Recorded")} · ${t("{present} of {total}", { present: item.attendance.present, total: item.attendance.total })}`;
    return absent.length
      ? `${base} · ${t("{names} missed", { names: new Intl.ListFormat(locale, { type: "conjunction" }).format(absent) })}`
      : base;
  }
  if (item.state === "pending") return t("Not recorded");
  const flag = item.notes.find((entry) => !entry.dismissed && entry.note.kind === "owes");
  const when = item.state === "live" ? t("In progress") : t("Later");
  if (session.format === "individual" && flag)
    return `${when} · ${t("owes {amount}", { amount: formatMoney(flag.note.amount, locale) })}`;
  return `${when} · ${t(item.roster.length === 1 ? "{count} student" : "{count} students", { count: item.roster.length })}`;
}

/** Mobile: a vertical agenda with «ahora» and the next class opened as the main card. */
export function TodayAgenda({ timeline, onRecord, onOpen, onDismissNotes = undefined }) {
  const { t, locale } = useI18n();
  const [rosterItem, setRosterItem] = useState(null);
  const focus = timeline.live || timeline.next;
  const nowIndex = timeline.items.findIndex((item) => item.start > timeline.now || item === focus);
  const rows = [];
  timeline.items.forEach((item, index) => {
    if (index === nowIndex)
      rows.push(
        <div
          className="now"
          key="now"
          aria-label={t("Now, {time}", { time: clockLabel(timeline.now, locale, { suffix: false }) })}
        >
          <i />
          <span>
            {t("{time} now", { time: clockLabel(timeline.now, locale, { suffix: false }) })}
            {timeline.freeMinutes > 0 ? (
              <em>· {t("{span} free", { span: formatSpan(timeline.freeMinutes) })}</em>
            ) : null}
          </span>
        </div>,
      );
    if (item === focus) {
      const notes = openNotes(item, t, locale);
      rows.push(
        <article className="nx" key={item.key} aria-labelledby={`nx-${index}`}>
          <div className="k">
            <span>{t(item.state === "live" ? "In progress" : "Next")}</span>
            <span>
              {item.state === "live"
                ? t("ends at {time}", { time: formatTime(item.end, locale) })
                : t("in {span}", { span: formatSpan(item.start - timeline.now) })}
            </span>
          </div>
          <h3 id={`nx-${index}`}>{item.session.title}</h3>
          <p className="sub">{formatTimeRange(item.session.startTime, item.session.durationHours, locale)}</p>
          <button
            type="button"
            className="avs"
            onClick={() => setRosterItem(item)}
            aria-label={t("View students of {title}", { title: item.session.title })}
          >
            {item.roster.slice(0, 6).map((student) => (
              <StudentAvatar key={student.id} avatarId={student.avatarId} name={student.fullName} decorative />
            ))}
            <b>{t("View students")}</b>
          </button>
          {notes.length ? (
            <div className="flags">
              {notes.slice(0, 2).map((entry) => (
                <span className="flag" key={entry.student.id}>
                  <i style={{ background: noteDot(entry.note) }} />
                  <span>
                    {firstName(entry.student.fullName)} {noteSentence(entry.note, t, locale).replace(/\.$/, "")}
                  </span>
                  <SeenButton entry={entry} onDismiss={onDismissNotes} />
                </span>
              ))}
            </div>
          ) : null}
          <HiddenNotes item={item} onDismiss={onDismissNotes} />
          <Button variant="primary" onClick={() => onRecord(item.session)}>
            {t("Record class")}
          </Button>
        </article>,
      );
      return;
    }
    rows.push(
      <button
        type="button"
        key={item.key}
        className={`ar ${item.state === "done" ? "done" : ""}`.trim()}
        onClick={() => onOpen(item.session)}
      >
        <span className="dt" />
        <span className="tm">{clockLabel(item.start, locale, { suffix: false })}</span>
        <span>
          <strong>
            {item.session.title}
            {item.session.format === "individual" ? ` · ${t("individual")}` : ""}
          </strong>
          <small>{agendaLine(item, t, locale)}</small>
        </span>
        <ChevronRight className="chev" aria-hidden="true" />
      </button>,
    );
  });
  if (nowIndex === -1 && timeline.items.length)
    rows.push(
      <div className="now" key="now">
        <i />
        <span>{t("{time} now", { time: clockLabel(timeline.now, locale, { suffix: false }) })}</span>
      </div>,
    );
  return (
    <>
      <div className="ag">{rows}</div>
      <BottomSheet
        open={Boolean(rosterItem)}
        onClose={() => setRosterItem(null)}
        title={rosterItem?.session.title || ""}
        kicker={t("Students")}
      >
        <div className="list-rows">
          {(rosterItem?.notes || []).map(({ student, note, dismissed }) => {
            const chip = dismissed ? null : noteChip(note, t, locale);
            return (
              <ListRow
                key={student.id}
                avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />}
                name={student.fullName}
                context={chip ? <span className={`st ${chip.tone}`}>{chip.text}</span> : null}
              />
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
