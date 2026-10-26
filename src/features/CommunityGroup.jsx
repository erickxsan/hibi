import { useState } from "react";
import { Archive, ChevronRight, RotateCcw, UserPlus } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { BottomSheet, Button, Drawer, Field, Input, ListRow, StudentSelect } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { nextPeriod, normalizeGroupBilling, periodOf } from "../domain/monthlyBilling";
import {
  dayNumber,
  formatHours,
  formatMoney,
  formatPercent,
  formatScore,
  formatShortDate,
  formatTime,
  monthLong,
  relativeDay,
  weekdayShort,
} from "../utils/displayFormat";
import { groupDaysLong, groupScheduleLong, studentGroupIdsOf } from "./groupLabels";
import { contactForStudent, CONTACT_VIEWS } from "./communityContacts";
import { joiningOptions } from "./communityModel";
import { BillingFields } from "./CommunityEditors";
import { studentContext } from "./CommunityStudent";

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function firstName(name) {
  return String(name || "").split(" ")[0];
}

/** «Hoy · 4:00 p. m.» or «jue 22 oct · 5:00 p. m.». */
export function nextClassLabel(next, asOf, t, locale) {
  if (!next) return "";
  const relative = relativeDay(next.classDate, asOf);
  return `${relative ? t(relative.key) : formatShortDate(next.classDate, locale)} · ${formatTime(next.startTime, locale)}`;
}

export function AttendanceGrid({ grid, asOf, highlight, onHighlight }) {
  const { t, locale } = useI18n();
  if (!grid.columns.length) return <p className="muted">{t("No classes recorded yet.")}</p>;
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t("Attendance by class")}>
      <div
        className="mx"
        role="table"
        aria-label={t("Attendance by class")}
        style={{ gridTemplateColumns: `minmax(64px, 120px) repeat(${grid.columns.length}, minmax(48px, 56px))` }}
      >
        <span role="columnheader" />
        {grid.columns.map((column) => (
          <span className="hd" role="columnheader" key={column.key}>
            {column.date === asOf ? t("today") : `${weekdayShort(column.date, locale)} ${dayNumber(column.date)}`}
          </span>
        ))}
        {grid.rows.map((row) => (
          <div className="mx-row" role="row" key={row.student.id}>
            <span role="rowheader" className="nm-cell">
              <button
                type="button"
                className={`nm ${highlight === row.student.id ? "on" : ""}`}
                aria-pressed={highlight === row.student.id}
                onClick={() => onHighlight(highlight === row.student.id ? "" : row.student.id)}
              >
                {firstName(row.student.fullName)}
              </button>
            </span>
            {row.cells.map((cell, index) => (
              <span
                role="cell"
                key={cell.key}
                className={`cell ${cell.code} ${highlight && highlight !== row.student.id ? "dim" : ""}`}
                aria-label={`${row.student.fullName}, ${grid.columns[index].date}: ${t(cell.code === "P" ? "Present" : cell.code === "A" ? "Absent" : "Not recorded")}`}
              >
                {cell.code === "U" ? "" : cell.code}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function figureNotes(summary, members, t, locale) {
  const attendance = summary.absences
    ? {
        tone: "st-pend",
        text: t(
          summary.sessions === 1 ? "{absences} absences in {count} class" : "{absences} absences in {count} classes",
          {
            absences: summary.absences,
            count: summary.sessions,
          },
        ),
      }
    : summary.sessions
      ? { tone: "st-ok", text: t("No absences") }
      : { tone: "", text: t("No classes this month") };
  const grade = summary.ungraded
    ? {
        tone: "st-pend",
        text: t(summary.ungraded === 1 ? "{count} assignment to grade" : "{count} assignments to grade", {
          count: summary.ungraded,
        }),
      }
    : { tone: "", text: "" };
  const debtors = summary.debts
    .map((item) => members.find((student) => student.id === item.studentId)?.fullName)
    .filter(Boolean);
  const owed = summary.owed
    ? {
        tone: summary.overdue ? "st-venc" : "st-pend",
        text: `${new Intl.ListFormat(locale, { type: "conjunction" }).format(debtors.slice(0, 2).map(firstName))}${debtors.length > 2 ? ` +${debtors.length - 2}` : ""} · ${t(summary.overdue ? "overdue" : "pending")}`,
      }
    : { tone: "st-ok", text: t("Up to date") };
  return { attendance, grade, owed };
}

/** Desktop group detail: month, attendance grid, directory and the editable group data with its billing. */
export function GroupDetail({
  group,
  members,
  summary,
  grid,
  monthsById,
  next,
  asOf,
  state,
  draft,
  setDraft,
  billingDraft,
  setBillingDraft,
  applyFrom,
  setApplyFrom,
  switching,
  onSave,
  onArchive,
  onEditSchedule,
  onAddStudent,
  onOpenStudent,
  onOpenNext,
  saving,
  dirty,
}) {
  const { t, locale } = useI18n();
  const [highlight, setHighlight] = useState("");
  const [copied, setCopied] = useState(false);
  const notes = figureNotes(summary, members, t, locale);
  const emails = members
    .map((student) => contactForStudent(student, CONTACT_VIEWS.STUDENT_EMAIL).value)
    .filter(Boolean);
  const copyEmails = async () => {
    try {
      await globalThis.navigator?.clipboard?.writeText(emails.join(", "));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const slots = group.weeklySchedule || [];
  const hours = slots.length ? slots[0].durationHours : state.settings?.defaultClassHours;
  return (
    <section className="detail" aria-labelledby="community-group-title">
      <div className="detail-head is-group">
        <div className="detail-title">
          <h2 id="community-group-title">{group.name}</h2>
          <span className="detail-meta">
            {groupScheduleLong(group, locale) ? <span>{groupScheduleLong(group, locale)}</span> : null}
            <span>{t(members.length === 1 ? "{count} student" : "{count} students", { count: members.length })}</span>
          </span>
        </div>
        {next ? (
          <div className="detail-next">
            <span>{t("Next class")}</span>
            <button type="button" className="link-button" onClick={onOpenNext}>
              {nextClassLabel(next, asOf, t, locale)}
            </button>
          </div>
        ) : null}
      </div>
      <div className="blk">
        <h3 className="overline">{t("This month")}</h3>
        <div className="figs">
          <div className="fig">
            <span>{t("Attendance")}</span>
            <b>{formatPercent(summary.monthAttendance, locale)}</b>
            <span className={`st ${notes.attendance.tone}`}>{notes.attendance.text}</span>
          </div>
          <div className="fig">
            <span>{t("Average")}</span>
            <b>
              {formatScore(summary.average, locale)}
              {summary.average === null ? null : <small> /10</small>}
            </b>
            {notes.grade.text ? <span className={`st ${notes.grade.tone}`}>{notes.grade.text}</span> : null}
          </div>
          <div className="fig">
            <span>{t("To collect")}</span>
            <b>{formatMoney(summary.owed, locale)}</b>
            <span className={`st ${notes.owed.tone}`}>{notes.owed.text}</span>
          </div>
        </div>
      </div>
      <div className="blk">
        <div className="blk-head">
          <h3 className="overline">{t("Attendance by class")}</h3>
        </div>
        <AttendanceGrid grid={grid} asOf={asOf} highlight={highlight} onHighlight={setHighlight} />
      </div>
      <div className="blk">
        <div className="blk-head">
          <h3 className="overline">{t("Directory")}</h3>
          <span className="blk-actions">
            {copied ? <span className="text-ok copied">{t("Emails copied")}</span> : null}
            {emails.length ? (
              <button type="button" className="link-button" onClick={copyEmails}>
                {t("Copy emails")}
              </button>
            ) : null}
            <button type="button" className="link-button" onClick={onAddStudent}>
              {t("Add to group")}
            </button>
          </span>
        </div>
        <div className="dir" role="table" aria-label={t("Group directory")}>
          <div className="dr th" role="row">
            <span role="columnheader">{t("Student")}</span>
            <span role="columnheader">{t("Contact")}</span>
            <span role="columnheader">{t("Attendance")}</span>
            <span role="columnheader">{t("Payments")}</span>
          </div>
          {members.map((student) => {
            const month = monthsById.get(student.id);
            const others = studentGroupIdsOf(student).filter((id) => id !== group.id);
            const otherNames = others.map((id) => state.groups.find((item) => item.id === id)?.name).filter(Boolean);
            const email = contactForStudent(student, CONTACT_VIEWS.STUDENT_EMAIL).value;
            const phone = contactForStudent(student, CONTACT_VIEWS.GUARDIAN_PHONE).value;
            const pay = month?.owed
              ? {
                  tone: month.overdue ? "st-venc" : "st-pend",
                  text: `${t("Owes {amount}", { amount: formatMoney(month.owed, locale) })}${month.oldestDebt ? ` · ${formatShortDate(month.oldestDebt, locale, { weekday: false })}` : ""}`,
                }
              : null;
            const low =
              month?.attendance !== null && month?.attendance < (state.settings?.lowAttendanceThreshold ?? 0.8);
            return (
              <button
                type="button"
                role="row"
                key={student.id}
                className={`dr ${highlight === student.id ? "on" : ""}`}
                aria-label={t("Open {name}", { name: student.fullName })}
                onClick={() => onOpenStudent(student)}
              >
                <span className="person" role="cell">
                  <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
                  <span>
                    <strong>{student.fullName}</strong>
                    {/* Only what differs from the rest of the group: «Solo este grupo» was every row's default. */}
                    {otherNames.length || student.isIndividual ? (
                      <small>
                        {otherNames.length
                          ? t("Also in {groups}", { groups: otherNames.join(", ") })
                          : t("Also individual")}
                      </small>
                    ) : null}
                  </span>
                </span>
                <span className="ct" role="cell">
                  {email}
                  {email && phone ? <br /> : null}
                  {phone ? t("Tutor · {phone}", { phone }) : null}
                  {!email && !phone ? <span className="muted">—</span> : null}
                </span>
                <span role="cell" className={`dr-pct ${low ? "text-bad" : ""}`}>
                  {formatPercent(month?.attendance ?? null, locale)}
                </span>
                <span role="cell">{pay ? <span className={`st ${pay.tone}`}>{pay.text}</span> : null}</span>
              </button>
            );
          })}
          {!members.length ? <p className="muted">{t("No active students in this group yet.")}</p> : null}
        </div>
      </div>
      <div className="blk is-last">
        <h3 className="overline">{t("Group data")}</h3>
        <div className="form-grid is-three">
          <Field label={t("Group name")} required>
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={t("Schedule")}>
            <button type="button" className="control control-button" onClick={onEditSchedule}>
              {groupScheduleLong(group, locale) || t("Add a schedule")}
            </button>
          </Field>
          <Field label={t("Class length")}>
            <button type="button" className="control control-button" onClick={onEditSchedule}>
              {hours ? formatHours(hours, locale) : "—"}
            </button>
          </Field>
        </div>
        <div className="billing-block">
          <BillingFields
            draft={billingDraft}
            setDraft={setBillingDraft}
            group={group}
            members={members}
            state={state}
            asOf={asOf}
            defaultRate={state.settings?.hourlyRate}
            applyFrom={applyFrom}
            setApplyFrom={setApplyFrom}
            switching={switching}
          />
        </div>
        <div className="detail-actions">
          <Button variant="ghost" className="is-danger-text" icon={Archive} onClick={onArchive} disabled={saving}>
            {t("Archive group")}
          </Button>
          <Button onClick={onSave} disabled={saving || !dirty}>
            {saving ? t("Saving…") : t("Save changes")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Mobile group sheet: the month, billing summary, attendance grid and students as rows. */
export function GroupSheet({
  group,
  members,
  summary,
  grid,
  monthsById,
  next,
  asOf,
  state,
  onEditBilling,
  onOpenStudent,
  onAddStudent,
  onArchive,
}) {
  const { t, locale } = useI18n();
  const [highlight, setHighlight] = useState("");
  const notes = figureNotes(summary, members, t, locale);
  const billing = normalizeGroupBilling(group.billing);
  const slots = group.weeklySchedule || [];
  const hours = slots.length ? Number(slots[0].durationHours) || 0 : Number(state.settings?.defaultClassHours) || 0;
  const rate = Number.isFinite(group.hourlyRate) ? group.hourlyRate : state.settings?.hourlyRate;
  const emails = members
    .map((student) => contactForStudent(student, CONTACT_VIEWS.STUDENT_EMAIL).value)
    .filter(Boolean);
  return (
    <div className="group-sheet">
      {next ? (
        <p className="muted">{t("Next class: {when}", { when: nextClassLabel(next, asOf, t, locale) })}</p>
      ) : null}
      <div className="figs">
        <div className="fig">
          <span>{t("Attendance")}</span>
          <b>{formatPercent(summary.monthAttendance, locale)}</b>
          <span className={`st is-plain ${notes.attendance.tone}`}>
            {summary.absences ? t("{count} absences", { count: summary.absences }) : notes.attendance.text}
          </span>
        </div>
        <div className="fig">
          <span>{t("Average")}</span>
          <b>{formatScore(summary.average, locale)}</b>
          <span className="st is-plain st-pend">
            {summary.ungraded ? t("{count} ungraded", { count: summary.ungraded }) : ""}
          </span>
        </div>
        <div className="fig">
          <span>{t("To collect")}</span>
          <b>{formatMoney(summary.owed, locale)}</b>
          <span className={`st is-plain ${notes.owed.tone}`}>
            {t(summary.owed ? (summary.overdue ? "Overdue" : "Pending") : "Up to date")}
          </span>
        </div>
      </div>
      <button type="button" className="billing-summary" onClick={onEditBilling}>
        <span>
          <span className="overline">{t("Billing")}</span>
          <strong>
            {billing?.mode === "monthly"
              ? `${t("Monthly")} · ${formatMoney(billing.monthlyFee, locale)}`
              : `${t("Per class")} · ${t("{amount} per hour", { amount: formatMoney(rate, locale) })}`}
          </strong>
          <small>
            {billing?.mode === "monthly"
              ? t("Due {when}", {
                  when:
                    billing.due.type === "dayOfMonth"
                      ? t("on day {day}", { day: billing.due.day })
                      : t("at class {nth}", { nth: billing.due.nth === "last" ? t("last (class)") : billing.due.nth }),
                })
              : t("{hours} per class = {amount} per student", {
                  hours: formatHours(hours, locale),
                  amount: formatMoney(hours * (Number(rate) || 0), locale),
                })}
          </small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
      <div>
        <h3 className="overline">{t("Attendance by class")}</h3>
        <AttendanceGrid grid={grid} asOf={asOf} highlight={highlight} onHighlight={setHighlight} />
      </div>
      <div>
        <div className="blk-head">
          <h3 className="overline">
            {t(members.length === 1 ? "{count} student" : "{count} students", { count: members.length })}
          </h3>
          {emails.length ? (
            <button
              type="button"
              className="link-button"
              onClick={() => globalThis.navigator?.clipboard?.writeText(emails.join(", ")).catch(() => {})}
            >
              {t("Copy emails")}
            </button>
          ) : null}
        </div>
        <div className="list-rows">
          {members.map((student) => {
            const month = monthsById.get(student.id);
            const context = month ? studentContext(month, t("Up to date"), t, locale) : { text: "", tone: "" };
            return (
              <ListRow
                key={student.id}
                avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />}
                name={student.fullName}
                context={context.text || t("Up to date")}
                contextTone={context.tone}
                value={formatPercent(month?.attendance ?? null, locale)}
                onClick={() => onOpenStudent(student)}
              />
            );
          })}
        </div>
      </div>
      <div className="sheet-actions">
        <Button icon={UserPlus} onClick={onAddStudent}>
          {t("Add to group")}
        </Button>
        <Button variant="ghost" className="is-danger-text" icon={Archive} onClick={onArchive}>
          {t("Archive group")}
        </Button>
      </div>
    </div>
  );
}

/** Archived group: kraft emblem, history figures, what was left owed, its students and «Reactivar grupo». */
export function ArchivedGroupView({
  group,
  members,
  history,
  includedInStatistics,
  compact = false,
  onReactivate,
  saving,
}) {
  const { t, locale } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const archivedOn = group.archivedAt ? formatShortDate(group.archivedAt, locale, { weekday: false }) : "";
  const owing = history.owing;
  const owingText = owing.length
    ? t(
        compact
          ? "A balance of {amount} was left ({names}). It does not appear in your collections while the group is archived."
          : "A balance of {amount} was left ({names}). It is kept, but it does not appear in your collections while the group is archived.",
        {
          amount: formatMoney(history.outstanding, locale),
          names: owing.map((item) => (compact ? firstName(item.student.fullName) : item.student.fullName)).join(", "),
        },
      )
    : "";
  return (
    <section className={compact ? "archived-sheet" : "detail"} aria-label={t("Archived group details")}>
      {compact ? null : (
        <div className="detail-head">
          <span className="emb">
            <Archive aria-hidden="true" />
          </span>
          <div className="detail-title">
            <h2>{group.name}</h2>
            <span className="detail-meta">
              {t("{count} students · archived on {date}", { count: members.length, date: archivedOn })}
            </span>
          </div>
          <span className="tag">{t("Archived group")}</span>
        </div>
      )}
      <p className="anote">
        <i />
        <span>
          {t(
            includedInStatistics
              ? "This group's history is included in statistics for this session. The group remains archived."
              : compact
                ? "Out of Home and Tracking. You can include its history from Tracking, only during this session."
                : "Out of Home and Tracking. You can include its history from Tracking, only during this session. Everything saved is kept.",
          )}
        </span>
      </p>
      <div className={compact ? "" : "blk is-first"}>
        {compact ? null : <h3 className="overline">{t("Group history")}</h3>}
        <div className="figs">
          <div className="fig">
            <span>{t("Classes")}</span>
            <b>{history.classes}</b>
            <span className="fig-note">{t("recorded")}</span>
          </div>
          <div className="fig">
            <span>{t("Attendance")}</span>
            <b>{formatPercent(history.attendance, locale)}</b>
            <span className="fig-note text-bad">{t("{count} absences", { count: history.absences })}</span>
          </div>
          <div className="fig">
            <span>{t("Collected")}</span>
            <b>{formatMoney(history.collected, locale)}</b>
            <span className="fig-note text-ok">{t("in total")}</span>
          </div>
          {compact ? null : (
            <div className="fig">
              <span>{t("Average")}</span>
              <b>{formatScore(history.average, locale)}</b>
              <span className="fig-note text-data">
                {t(history.assignments === 1 ? "{count} assignment" : "{count} assignments", {
                  count: history.assignments,
                })}
              </span>
            </div>
          )}
        </div>
      </div>
      {owingText ? (
        <p className="anote warn">
          <i />
          <span>{owingText}</span>
        </p>
      ) : null}
      <div className={compact ? "" : "blk"}>
        <h3 className="overline">{t(compact ? "Students" : "Students in this group")}</h3>
        <div className="dir">
          {history.members.map((item) => (
            <div className="dr is-static" key={item.student.id}>
              <span className="person">
                <StudentAvatar avatarId={item.student.avatarId} name={item.student.fullName} size="small" decorative />
                <span>
                  <strong>{item.student.fullName}</strong>
                  <small>
                    {[
                      compact ? "" : item.student.code,
                      item.missed > item.attended
                        ? t("missed {missed} of {total}", { missed: item.missed, total: item.total })
                        : t("attended {attended} of {total}", { attended: item.attended, total: item.total }),
                      compact && item.average !== null ? formatScore(item.average, locale) : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </span>
              <span className={item.owed ? "text-pend dr-owed" : "muted dr-owed"}>
                {item.owed ? t("Owes {amount}", { amount: formatMoney(item.owed, locale) }) : t("Up to date")}
              </span>
            </div>
          ))}
        </div>
      </div>
      {historyOpen ? (
        <div className={compact ? "" : "blk"}>
          <h3 className="overline">{t("Classes and payments")}</h3>
          {history.sessions.map((session) => (
            <div className="hrow" key={session.key}>
              <span className="d">{formatShortDate(session.date, locale)}</span>
              <span>
                {session.title || t("Class")}{" "}
                <span className="muted">
                  · {t("{present} of {total} present", { present: session.present, total: session.total })}
                </span>
              </span>
              <b>{formatMoney(session.collected, locale)}</b>
            </div>
          ))}
          {!history.sessions.length ? <p className="muted">{t("No classes recorded yet.")}</p> : null}
        </div>
      ) : null}
      <div className="detail-actions is-archived">
        <button type="button" className="link-button" onClick={() => setHistoryOpen(!historyOpen)}>
          {t(historyOpen ? "Hide history" : compact ? "View class and payment history" : "View history")}
        </button>
        <span className="detail-actions-end">
          {compact ? null : <span className="muted">{t("Its schedules come back from today")}</span>}
          <Button variant={compact ? "primary" : "secondary"} icon={RotateCcw} onClick={onReactivate} disabled={saving}>
            {t("Reactivate group")}
          </Button>
        </span>
      </div>
    </section>
  );
}

/** Confirmation before archiving: what is kept, what leaves the agenda and the balance left. */
export function ArchiveGroupDialog({ open, group, members, summary, onClose, onConfirm, saving }) {
  const { t, locale } = useI18n();
  if (!group) return null;
  const days = groupDaysLong(group, locale);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("Archive group {name}?", { name: group.name })}
      kicker={t("Archive")}
      size="compact"
      className="archive-dialog"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon={Archive} onClick={onConfirm} disabled={saving}>
            {saving ? t("Saving…") : t("Archive group")}
          </Button>
        </>
      }
    >
      <ul className="dialog-list">
        <li>
          {t("Its {students} students, {classes} recorded classes, grades and payments are kept.", {
            students: members.length,
            classes: summary?.recordedClasses ?? 0,
          })}
        </li>
        <li>
          {days
            ? t("Its upcoming classes ({days}) leave your agenda.", { days: days.toLowerCase() })
            : t("Its upcoming classes leave your agenda.")}
        </li>
        <li>
          {t(
            "It stops counting in Home and Tracking. You will find it in Archived and can reactivate it whenever you want.",
          )}
        </li>
      </ul>
      {summary?.owed ? (
        <p className="anote warn">
          <i />
          <span>
            {t("It has {amount} to collect. The balance is kept, but it will no longer appear in your collections.", {
              amount: formatMoney(summary.owed, locale),
            })}
          </span>
        </p>
      ) : null}
    </Drawer>
  );
}

/** Add an existing student to a group; in a monthly group already started, choose what the first month costs. */
export function JoinGroupSheet({ open, group, candidates, state, asOf, onClose, onJoin, saving }) {
  const { t, locale } = useI18n();
  const [studentId, setStudentId] = useState("");
  const [choice, setChoice] = useState("prorated");
  const student = candidates.find((item) => item.id === studentId) || candidates[0] || null;
  const options = group && student ? joiningOptions(state, group, student, asOf) : null;
  const month = monthLong(asOf, locale);
  const nextMonth = monthLong(`${nextPeriod(periodOf(asOf))}-01`, locale);
  const billing = normalizeGroupBilling(group?.billing);
  const choices = options?.started
    ? [
        {
          value: "full",
          title: t("Full month · {amount}", { amount: formatMoney(options.amounts.full, locale) }),
          text: t("They pay all of {month}.", { month }),
          amount: options.amounts.full,
        },
        {
          value: "prorated",
          title: t("Proportional · {amount}", { amount: formatMoney(options.amounts.prorated, locale) }),
          text: t("{remaining} of {total} classes of {month} remain.", {
            remaining: options.amounts.remaining,
            total: options.amounts.total,
            month,
          }),
          amount: options.amounts.prorated,
        },
        {
          value: "next",
          title: t("From {month} · $0 now", { month: nextMonth }),
          text: t("The classes of {month} they take are free.", { month }),
          amount: 0,
        },
      ]
    : [];
  const picked = choices.find((item) => item.value === choice) || null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      kicker={t("Add student")}
      title={group ? t("To {group}", { group: group.name }) : ""}
      description={
        billing?.mode === "monthly"
          ? t("Monthly group · {amount} a month", { amount: formatMoney(billing.monthlyFee, locale) })
          : undefined
      }
      footer={
        <Button
          variant="primary"
          disabled={!student || saving}
          onClick={() => onJoin(student, options?.started ? { amount: picked?.amount ?? options.amounts.full } : null)}
        >
          {t("Add to {group}", { group: group?.name || "" })}
        </Button>
      }
    >
      <div className="join-sheet">
        {candidates.length ? (
          <Field label={t("Student")}>
            <StudentSelect
              aria-label={t("Student")}
              students={candidates.map((item) => ({
                ...item,
                detail: (item.groupIds || [])
                  .map((id) => state.groups.find((g) => g.id === id)?.name)
                  .filter(Boolean)
                  .join(" · "),
              }))}
              value={student?.id || ""}
              onChange={(event) => setStudentId(event.target.value)}
            />
          </Field>
        ) : (
          <p className="muted">{t("Every active student is already in this group.")}</p>
        )}
        {choices.length ? (
          <div className="join-options" role="radiogroup" aria-label={t("What do they pay for {month}?", { month })}>
            <h3 className="overline">
              {t("{month} already started · what do they pay?", { month: capitalize(month) })}
            </h3>
            {choices.map((item) => (
              <button
                type="button"
                role="radio"
                aria-checked={choice === item.value}
                key={item.value}
                className={`ro ${choice === item.value ? "on" : ""}`}
                onClick={() => setChoice(item.value)}
              >
                <i aria-hidden="true" />
                <span>
                  <b>{item.title}</b>
                  <small>{item.text}</small>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
