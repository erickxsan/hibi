import { useState } from "react";
import { Archive, ChevronRight, Pencil, RotateCcw, Search, Trash2 } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { BottomSheet, Button, Drawer, ListRow } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { GroupBadgePicker } from "../components/GroupBadge";
import { groupBillingFor, nextPeriod, periodOf } from "../domain/monthlyBilling";
import {
  formatHours,
  formatMoney,
  formatPercent,
  formatScore,
  formatShortDate,
  formatTime,
  monthLong,
  relativeDay,
} from "../utils/displayFormat";
import { normalizeSearchText } from "../utils/searchText";
import { groupDaysLong, groupScheduleLong, studentGroupIdsOf } from "./groupLabels";
import { contactForStudent, CONTACT_VIEWS, groupMemberContact } from "./communityContacts";
import { billingDraftFor } from "./communityModel";

function firstName(name) {
  return String(name || "").split(" ")[0];
}

/** «Hoy · 4:00 p. m.» or «jue 22 oct · 5:00 p. m.». */
export function nextClassLabel(next, asOf, t, locale) {
  if (!next) return "";
  const relative = relativeDay(next.classDate, asOf);
  return `${relative ? t(relative.key) : formatShortDate(next.classDate, locale)} · ${formatTime(next.startTime, locale)}`;
}

/** The one contact under a member's name: «Tutor · 55 0142 8810», their own phone or their email. */
function memberContactLabel(student, t) {
  const contact = groupMemberContact(student);
  if (!contact) return "";
  return contact.view === CONTACT_VIEWS.GUARDIAN_PHONE ? t("Tutor · {phone}", { phone: contact.value }) : contact.value;
}

/** How the group charges, in two lines: «Mensual · $800» and «Vence el día 5 · 1 alumno paga distinto». */
function billingLines(group, members, state, asOf, t, locale) {
  // The arrangement the editor edits: the latest one, which may start in a later month.
  const billing = groupBillingFor(group);
  const draft = billingDraftFor(group, members);
  const monthly = billing?.mode === "monthly";
  const slots = group.weeklySchedule || [];
  const hours = slots.length ? Number(slots[0].durationHours) || 0 : Number(state.settings?.defaultClassHours) || 0;
  const rate = Number.isFinite(group.hourlyRate) ? group.hourlyRate : state.settings?.hourlyRate;
  const different = monthly
    ? Object.values(draft.adjustments).filter((adjustment) => adjustment.mode !== "group").length
    : Object.keys(draft.rates).length;
  return {
    title: monthly
      ? `${t("Monthly")} · ${formatMoney(billing.monthlyFee, locale)}`
      : `${t("Per class")} · ${t("{amount} per hour", { amount: formatMoney(rate, locale) })}`,
    detail: [
      billing?.effectiveFrom > periodOf(asOf)
        ? t("From {month}", { month: monthLong(`${billing.effectiveFrom}-01`, locale) })
        : "",
      monthly
        ? t("Due {when}", {
            when:
              billing.due.type === "dayOfMonth"
                ? t("on day {day}", { day: billing.due.day })
                : t("at class {nth}", { nth: billing.due.nth === "last" ? t("last (class)") : billing.due.nth }),
          })
        : t("{hours} per class = {amount} per student", {
            hours: formatHours(hours, locale),
            amount: formatMoney(hours * (Number(rate) || 0), locale),
          }),
      different
        ? t(different === 1 ? "{count} student pays differently" : "{count} students pay differently", {
            count: different,
          })
        : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** The month in three figures: attendance, average and what is still to collect (who owes is in Seguimiento). */
function GroupFigures({ summary, compact = false }) {
  const { t, locale } = useI18n();
  const attendance = summary.absences
    ? {
        tone: "st-pend",
        text: compact
          ? t("{count} absences", { count: summary.absences })
          : t(
              summary.sessions === 1
                ? "{absences} absences in {count} class"
                : "{absences} absences in {count} classes",
              { absences: summary.absences, count: summary.sessions },
            ),
      }
    : summary.sessions
      ? { tone: "st-ok", text: t("No absences") }
      : // «Este mes» is the block's own heading on desktop; the phone's narrow column only fits «Sin clases».
        { tone: "", text: t(compact ? "No classes" : "No classes this month") };
  const ungraded = summary.ungraded
    ? compact
      ? t("{count} ungraded", { count: summary.ungraded })
      : t(summary.ungraded === 1 ? "{count} assignment to grade" : "{count} assignments to grade", {
          count: summary.ungraded,
        })
    : "";
  return (
    <div className="figs">
      <div className="fig">
        <span>{t("Attendance")}</span>
        <b>{formatPercent(summary.monthAttendance, locale)}</b>
        <span className={`st is-plain ${attendance.tone}`}>{attendance.text}</span>
      </div>
      <div className="fig">
        <span>{t("Average")}</span>
        <b>
          {formatScore(summary.average, locale)}
          {compact || summary.average === null ? null : <small> /10</small>}
        </b>
        {ungraded ? <span className="st is-plain st-pend">{ungraded}</span> : null}
      </div>
      <div className="fig">
        <span>{t("To collect")}</span>
        <b>{formatMoney(summary.owed, locale)}</b>
        <span className={`st is-plain ${summary.owed ? (summary.overdue ? "st-venc" : "st-pend") : "st-ok"}`}>
          {t(summary.owed ? (summary.overdue ? "Overdue" : "Pending") : "Up to date")}
        </span>
      </div>
    </div>
  );
}

/** «Forma de cobro»: how the group charges and the way into its editor. */
function BillingCard({ group, members, state, asOf, onEdit }) {
  const { t, locale } = useI18n();
  const lines = billingLines(group, members, state, asOf, t, locale);
  return (
    <div className="billing-card">
      <div className="billing-card-text">
        <h3 className="overline">{t("Billing")}</h3>
        <strong>{lines.title}</strong>
        <span>{lines.detail}</span>
      </div>
      <Button icon={Pencil} onClick={onEdit}>
        {t("Edit billing")}
      </Button>
    </div>
  );
}

function TrackingLink({ onClick }) {
  const { t } = useI18n();
  return (
    <button type="button" className="link-button tracking-link" onClick={onClick}>
      {t("See attendance and payments in Tracking")}
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

/**
 * Desktop group detail. The group says who is in it and how it charges; attendance and who owes are
 * tracked in Seguimiento. Its editors (group, members, billing) open in the side drawer.
 */
export function GroupDetail({
  group,
  members,
  summary,
  next,
  asOf,
  state,
  onEdit,
  onEditBilling,
  onChangeMembers,
  onOpenStudent,
  onOpenNext,
  onOpenTracking,
  onChangeBadge,
}) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
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
  return (
    <section className="detail" aria-labelledby="community-group-title">
      <div className="detail-head is-group">
        <GroupBadgePicker group={group} onChange={onChangeBadge} />
        <div className="detail-title">
          <h2 id="community-group-title">{group.name}</h2>
          <span className="detail-meta">
            {groupScheduleLong(group, locale) ? <span>{groupScheduleLong(group, locale)}</span> : null}
            {next ? (
              <button type="button" className="link-button" onClick={onOpenNext}>
                {t("Next class: {when}", { when: nextClassLabel(next, asOf, t, locale) })}
              </button>
            ) : null}
          </span>
        </div>
        <Button icon={Pencil} onClick={onEdit}>
          {t("Edit group")}
        </Button>
      </div>
      <div className="blk">
        <h3 className="overline">{t("This month")}</h3>
        <GroupFigures summary={summary} />
      </div>
      <div className="blk">
        <div className="blk-head">
          <h3 className="overline">
            {t(members.length === 1 ? "{count} student" : "{count} students", { count: members.length })}
          </h3>
          <span className="blk-actions">
            {copied ? <span className="text-ok copied">{t("Emails copied")}</span> : null}
            {emails.length ? (
              <button type="button" className="link-button" onClick={copyEmails}>
                {t("Copy emails")}
              </button>
            ) : null}
            <button type="button" className="link-button" onClick={onChangeMembers}>
              {t("Change members")}
            </button>
          </span>
        </div>
        {members.length ? (
          <div className="dir is-members" role="table" aria-label={t("Group directory")}>
            <div className="dr th" role="row">
              <span role="columnheader">{t("Student")}</span>
              <span role="columnheader">{t("Contact")}</span>
            </div>
            {members.map((student) => (
              <button
                type="button"
                role="row"
                key={student.id}
                className="dr"
                aria-label={t("Open {name}", { name: student.fullName })}
                onClick={() => onOpenStudent(student)}
              >
                <span className="person" role="cell">
                  <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
                  <strong>{student.fullName}</strong>
                </span>
                <span className="ct" role="cell">
                  {memberContactLabel(student, t)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">{t("No active students in this group yet.")}</p>
        )}
      </div>
      <div className="blk is-last">
        <BillingCard group={group} members={members} state={state} asOf={asOf} onEdit={onEditBilling} />
        <TrackingLink onClick={onOpenTracking} />
      </div>
    </section>
  );
}

/** Phone group sheet: next class, the month in three figures, its students and how it charges. */
export function GroupSheet({
  group,
  members,
  summary,
  next,
  asOf,
  state,
  onEditBilling,
  onChangeMembers,
  onOpenStudent,
  onOpenTracking,
  onChangeBadge,
}) {
  const { t, locale } = useI18n();
  return (
    <div className="group-sheet">
      <div className="group-sheet-head">
        <GroupBadgePicker group={group} onChange={onChangeBadge} size="medium" />
        {next ? (
          <p className="muted">{t("Next class: {when}", { when: nextClassLabel(next, asOf, t, locale) })}</p>
        ) : null}
      </div>
      <GroupFigures summary={summary} compact />
      <div>
        <div className="blk-head">
          <h3 className="overline">
            {t(members.length === 1 ? "{count} student" : "{count} students", { count: members.length })}
          </h3>
          <button type="button" className="link-button" onClick={onChangeMembers}>
            {t("Change members")}
          </button>
        </div>
        <div className="list-rows">
          {members.map((student) => (
            <ListRow
              key={student.id}
              avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />}
              name={student.fullName}
              context={memberContactLabel(student, t)}
              label={t("Open {name}", { name: student.fullName })}
              onClick={() => onOpenStudent(student)}
            />
          ))}
        </div>
      </div>
      <BillingCard group={group} members={members} state={state} asOf={asOf} onEdit={onEditBilling} />
      <TrackingLink onClick={onOpenTracking} />
    </div>
  );
}

/**
 * «Cambiar integrantes»: every active student with a check; saving adds and removes them at once. In a
 * monthly group whose month already started (`firstMonth`, see joiningOptions), whoever joins is asked
 * what that month costs, as one choice for all of them.
 */
export function MembersSheet({ group, students, groupsById, firstMonth, asOf, onClose, onSave, saving }) {
  const { t, locale } = useI18n();
  const isMember = (student) => studentGroupIdsOf(student).includes(group?.id);
  const [checked, setChecked] = useState(() => new Set(students.filter(isMember).map((student) => student.id)));
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState("prorated");
  const joining = students.some((student) => checked.has(student.id) && !isMember(student));
  const choices = joining && firstMonth?.started ? firstMonthChoices(firstMonth, asOf, t, locale) : [];
  const month = monthLong(asOf, locale);
  const needle = normalizeSearchText(query);
  // Members first, then everyone else, each by name.
  const listed = students
    .filter((student) => !needle || normalizeSearchText(student.fullName).includes(needle))
    .sort(
      (left, right) => Number(isMember(right)) - Number(isMember(left)) || left.fullName.localeCompare(right.fullName),
    );
  const toggle = (id) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <BottomSheet
      open={Boolean(group)}
      onClose={onClose}
      kicker={t("Members")}
      title={group?.name || ""}
      footer={
        <Button variant="primary" disabled={saving} onClick={() => onSave(checked, choices.length ? choice : null)}>
          {saving ? t("Saving…") : t("Save members · {count}", { count: checked.size })}
        </Button>
      }
    >
      <div className="members-sheet">
        <label className="search-control">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search student")}
            aria-label={t("Search student")}
          />
        </label>
        <div className="member-checks">
          {listed.map((student) => {
            const where = [
              ...studentGroupIdsOf(student)
                .filter((id) => id !== group?.id)
                .map((id) => groupsById.get(id)?.name)
                .filter(Boolean),
              student.isIndividual ? t("Individual") : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <label className="member-check" key={student.id}>
                <input type="checkbox" checked={checked.has(student.id)} onChange={() => toggle(student.id)} />
                <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
                <span>
                  <strong>{student.fullName}</strong>
                  {where ? <small>{where}</small> : null}
                </span>
              </label>
            );
          })}
          {!listed.length ? <p className="muted">{t("No matches.")}</p> : null}
        </div>
        {choices.length ? (
          <FirstMonthChoices
            choices={choices}
            value={choice}
            onChange={setChoice}
            label={t("What do they pay for {month}?", { month })}
            heading={t("{month} already started · what do they pay?", {
              month: month.charAt(0).toUpperCase() + month.slice(1),
            })}
          />
        ) : null}
      </div>
    </BottomSheet>
  );
}

/** Deleting a group for good: what stays, what is cancelled, and archiving as the gentler way out. */
export function DeleteGroupDialog({ group, members, preview, onClose, onArchive, onConfirm, saving }) {
  const { t, locale } = useI18n();
  const names = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    members.map((student) => firstName(student.fullName)),
  );
  return (
    <BottomSheet
      open={Boolean(group)}
      onClose={onClose}
      kicker={t("Delete group")}
      title={group ? t("Delete {p0}?", { p0: group.name }) : ""}
      size="compact"
      className="archive-dialog"
      footer={
        <>
          <Button icon={Archive} onClick={onArchive} disabled={saving}>
            {t("Archive instead")}
          </Button>
          <Button variant="danger" icon={Trash2} onClick={onConfirm} disabled={saving}>
            {saving ? t("Saving…") : t("Delete for good")}
          </Button>
        </>
      }
    >
      {group && preview ? (
        <>
          <ul className="dialog-list">
            {members.length ? (
              <li>
                {t(
                  members.length === 1
                    ? "{names} stays in Hibi, without this group."
                    : "{names} stay in Hibi, without this group.",
                  { names },
                )}
              </li>
            ) : null}
            {preview.collected ? (
              <li>
                {t("The {amount} you already collected is kept in your history.", {
                  amount: formatMoney(preview.collected, locale),
                })}
              </li>
            ) : null}
            {preview.classes ? (
              <li>
                {t(
                  preview.classes === 1
                    ? "Its recorded class stays in each student's history."
                    : "Its {count} recorded classes stay in each student's history.",
                  { count: preview.classes },
                )}
              </li>
            ) : null}
          </ul>
          <p className="anote warn">
            <i />
            <span>
              {preview.cancelled
                ? t(
                    "The {amount} this group has to collect is cancelled, and its upcoming classes leave your agenda.",
                    { amount: formatMoney(preview.cancelled, locale) },
                  )
                : t("Its upcoming classes leave your agenda.")}
            </span>
          </p>
          <p className="muted">
            {t("This cannot be undone. To pause it, archive it: everything is kept and you can reactivate it.")}
          </p>
        </>
      ) : null}
    </BottomSheet>
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

/** What the first month in a monthly group can cost: the whole fee, or, once it started, its share or nothing. */
function firstMonthChoices(options, asOf, t, locale) {
  const month = monthLong(asOf, locale);
  const full = {
    value: "full",
    title: t("Full month · {amount}", { amount: formatMoney(options.amounts.full, locale) }),
    text: t("They pay all of {month}.", { month }),
    amount: options.amounts.full,
  };
  if (!options.started) return [full];
  return [
    full,
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
      title: t("From {month} · $0 now", { month: monthLong(`${nextPeriod(periodOf(asOf))}-01`, locale) }),
      text: t("The classes of {month} they take are free.", { month }),
      amount: 0,
    },
  ];
}

function FirstMonthChoices({ choices, value, onChange, heading, label }) {
  return (
    <div className="join-options" role="radiogroup" aria-label={label}>
      <h3 className="overline">{heading}</h3>
      {choices.map((item) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === item.value}
          key={item.value}
          className={`ro ${value === item.value ? "on" : ""}`}
          onClick={() => onChange(item.value)}
        >
          <i aria-hidden="true" />
          <span>
            <b>{item.title}</b>
            <small>{item.text}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A student moved to a monthly group after paying the days they move in their old group
 * (see groupChangeQuestion): ask what the first month of the new group costs, counting what was paid.
 */
export function GroupChangeSheet({ question, asOf, onClose, onConfirm, saving }) {
  const { t, locale } = useI18n();
  const [choice, setChoice] = useState("credit");
  const month = monthLong(asOf, locale);
  const choices = question
    ? [
        {
          value: "credit",
          title: t("Count what was paid · {amount}", { amount: formatMoney(question.difference, locale) }),
          text: t("The {paid} paid in {from} counts toward {month}.", {
            paid: formatMoney(question.paid, locale),
            from: question.from.join(" · "),
            month,
          }),
          amount: question.difference,
        },
        // «$0 now» says the same as a difference of $0.
        ...firstMonthChoices(question.options, asOf, t, locale).filter(
          (item) => !(item.value === "next" && question.difference === 0),
        ),
      ]
    : [];
  const picked = choices.find((item) => item.value === choice) || choices[0];
  return (
    <BottomSheet
      open={Boolean(question)}
      onClose={() => {
        // Asked again later, it starts from «Count what was paid».
        setChoice("credit");
        onClose();
      }}
      kicker={t("Change of group")}
      title={question ? t("To {group}", { group: question.group.name }) : ""}
      footer={
        <Button variant="primary" disabled={saving} onClick={() => onConfirm({ amount: picked.amount })}>
          {saving ? t("Saving…") : t("Save student")}
        </Button>
      }
    >
      <div className="join-sheet">
        <FirstMonthChoices
          choices={choices}
          value={picked?.value}
          onChange={setChoice}
          label={t("What do they pay for {month}?", { month })}
          heading={t("What do they pay for {month}?", { month })}
        />
      </div>
    </BottomSheet>
  );
}
