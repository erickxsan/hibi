import { Mail, Phone } from "lucide-react";
import { useI18n } from "../i18n/index.jsx";
import { Button, Field, Input } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import {
  dayNumber,
  formatMoney,
  formatPercent,
  formatScore,
  formatShortDate,
  monthLong,
  weekdayShort,
} from "../utils/displayFormat";
import { studentGroupIdsOf } from "./groupLabels";

/** «Debe $420 · vencido», «Asistencia 40% · faltó 3 de 5», «Debe $150 · jue 8 oct» or the student's groups. */
export function studentContext(month, groupNames, t, locale) {
  const flag = month.flag;
  if (flag.kind === "overdue")
    return {
      text: `${t("Owes {amount}", { amount: formatMoney(flag.amount, locale) })} · ${t("overdue (debt)")}`,
      tone: "bad",
    };
  if (flag.kind === "lowAttendance")
    return {
      text: `${t("Attendance {value}", { value: formatPercent(month.attendance, locale) })} · ${t(
        "missed {missed} of {total}",
        {
          missed: month.absences,
          total: month.classes,
        },
      )}`,
      tone: "bad",
      value: formatPercent(month.attendance, locale),
    };
  if (flag.kind === "owes")
    return {
      text: `${t("Owes {amount}", { amount: formatMoney(flag.amount, locale) })}${
        flag.date ? ` · ${formatShortDate(flag.date, locale)}` : flag.monthly ? ` · ${t("monthly fee")}` : ""
      }`,
      tone: "pend",
    };
  return { text: groupNames || t("Individual"), tone: "" };
}

export function groupNamesOf(student, groupsById, t) {
  const names = studentGroupIdsOf(student)
    .map((id) => groupsById.get(id)?.name)
    .filter(Boolean);
  if (student.isIndividual) names.push(t("individual"));
  return names.join(" · ");
}

function attendanceWord(row, t) {
  if (row.classStatus === "Cancelled") return { tone: "st-prog", text: t("Cancelled") };
  if (row.attendance === "A") return { tone: "st-venc", text: t("Absent") };
  if (row.attendance === "E") return { tone: "st-prog", text: t("Excused") };
  return { tone: "st-ok", text: t("Present") };
}

function paymentWord(row, t) {
  if (row.attendance === "A" || row.classStatus === "Cancelled") return null;
  if (Number(row.outstanding) > 0) return { tone: "st-pend", text: t("Pending") };
  if (Number(row.amountPaid) > 0) return { tone: "st-ok", text: t("Paid") };
  if (Number(row.charge) === 0) return { tone: "st-prog", text: t("Monthly fee") };
  return null;
}

function MonthFigures({ month, t, locale, compact = false }) {
  const paymentsNote = month.owed
    ? { tone: month.overdue ? "st-venc" : "st-pend", text: t(month.overdue ? "Overdue" : "Pending") }
    : { tone: "st-ok", text: t(compact ? "No debts" : "Up to date") };
  return (
    <div className="figs">
      <div className="fig">
        <span>{t("Attendance")}</span>
        <b>{formatPercent(month.attendance, locale)}</b>
        {month.classes ? (
          <span className={`st ${month.absences ? "st-venc" : "st-ok"} ${compact ? "is-plain" : ""}`}>
            {month.absences
              ? t("Missed {missed} of {total}", { missed: month.absences, total: month.classes })
              : t("Did not miss")}
          </span>
        ) : (
          <span className="fig-note">{t("No classes this month")}</span>
        )}
      </div>
      <div className="fig">
        <span>{t("Average")}</span>
        <b>
          {formatScore(month.average, locale)}
          {compact || month.average === null ? null : <small> /10</small>}
        </b>
        <span className="fig-note text-data">
          {t(month.graded === 1 ? "{count} graded assignment" : "{count} graded assignments", { count: month.graded })}
        </span>
      </div>
      <div className="fig">
        <span>{t("Payments")}</span>
        <b>{compact && !month.owed ? t("Up to date") : formatMoney(month.owed || month.paid, locale)}</b>
        <span className={`st ${paymentsNote.tone} ${compact ? "is-plain" : ""}`}>{paymentsNote.text}</span>
      </div>
    </div>
  );
}

export function StudentDetail({
  student,
  draft,
  setDraft,
  month,
  recent,
  groupsById,
  onSave,
  onArchive,
  onReactivate,
  onEdit,
  onOpenTracking,
  saving,
  dirty,
}) {
  const { t, locale } = useI18n();
  const inactive = student.status === "Inactive";
  return (
    <section className="detail" aria-labelledby="community-student-title">
      <div className="detail-head">
        <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="large" />
        <div className="detail-title">
          <h2 id="community-student-title">{student.fullName}</h2>
          <span className="detail-meta">
            <span className="tnum">{student.code}</span>
            <span>{groupNamesOf(student, groupsById, t) || t("No group")}</span>
            <span className={`st ${inactive ? "st-prog" : "st-ok"}`}>{t(inactive ? "Inactive" : "Active")}</span>
          </span>
        </div>
        <button type="button" className="link-button" onClick={onEdit}>
          {t("Edit enrollment and rate")}
        </button>
      </div>
      <div className="blk">
        <h3 className="overline">{t("This month")}</h3>
        <MonthFigures month={month} t={t} locale={locale} />
      </div>
      <div className="blk">
        <div className="blk-head">
          <h3 className="overline">{t("Latest classes")}</h3>
          <button type="button" className="link-button" onClick={onOpenTracking}>
            {t("View in Tracking")}
          </button>
        </div>
        {recent.length ? (
          <div className="table-scroll" role="region" aria-label={t("Latest classes")} tabIndex={0}>
            <table className="hist">
              <thead>
                <tr>
                  <th scope="col">{t("Date")}</th>
                  <th scope="col">{t("Group")}</th>
                  <th scope="col">{t("Attendance")}</th>
                  <th scope="col">{t("Payment")}</th>
                  <th scope="col">{t("Grade")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ row, groupName, gradeValue }) => {
                  const attendance = attendanceWord(row, t);
                  const payment = paymentWord(row, t);
                  return (
                    <tr key={row.id}>
                      <td className="tnum">{formatShortDate(row.classDate, locale)}</td>
                      <td>{groupName || t("Individual")}</td>
                      <td>
                        <span className={`st ${attendance.tone}`}>{attendance.text}</span>
                      </td>
                      <td>
                        {payment ? (
                          <span className={`st ${payment.tone}`}>{payment.text}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="tnum">
                        {gradeValue === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            <b>{formatScore(gradeValue, locale)}</b> /10
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t("No classes recorded yet.")}</p>
        )}
      </div>
      <div className="blk is-last">
        <h3 className="overline">{t("Details")}</h3>
        <div className="form-grid is-three">
          <Field label={t("Full name")} required>
            <Input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} />
          </Field>
          <Field label={t("Student email")}>
            <Input
              type="email"
              value={draft.studentEmail}
              onChange={(event) => setDraft({ ...draft, studentEmail: event.target.value })}
            />
          </Field>
          <Field label={t("Guardian phone")}>
            <Input
              type="tel"
              className="tnum"
              value={draft.guardianPhone}
              onChange={(event) => setDraft({ ...draft, guardianPhone: event.target.value })}
            />
          </Field>
          <Field label={t("Student phone")}>
            <Input
              type="tel"
              placeholder={t("Optional")}
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Field>
        </div>
        <Field label={t("Short notes")}>
          <Input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        </Field>
        <div className="detail-actions">
          {inactive ? (
            <Button variant="ghost" onClick={onReactivate} disabled={saving}>
              {t("Reactivate")}
            </Button>
          ) : (
            <Button variant="ghost" className="is-danger-text" onClick={onArchive} disabled={saving}>
              {t("Deactivate student")}
            </Button>
          )}
          <Button onClick={onSave} disabled={saving || !dirty}>
            {saving ? t("Saving…") : t("Save changes")}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Mobile sheet: the month, the P/A of this month's classes, the latest classes and quick contact. */
export function StudentSheet({ student, month, recent, groupsById, asOf, onEdit }) {
  const { t, locale } = useI18n();
  const email = student.studentEmail;
  const phone = student.guardianPhone || student.phone;
  return (
    <div className="student-sheet">
      <div className="detail-head">
        <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="large" />
        <div className="detail-title">
          <span className="detail-meta">
            {[student.code, groupNamesOf(student, groupsById, t)].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <MonthFigures month={month} t={t} locale={locale} compact />
      {month.sequence.length ? (
        <div>
          <h3 className="overline">{t("Classes of {month}", { month: monthLong(asOf, locale) })}</h3>
          <div className="pa-row">
            {month.sequence.map((code, index) => (
              <span
                key={index}
                className={code === "A" ? "is-absent" : "is-present"}
                aria-label={t(code === "A" ? "Absent" : "Present")}
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {recent.length ? (
        <div>
          <h3 className="overline">{t("Latest classes")}</h3>
          <div className="sheet-rows">
            {recent.map(({ row, groupName, grade, gradeValue }) => {
              const attendance = attendanceWord(row, t);
              return (
                <div className="sheet-row" key={row.id}>
                  <span className="sheet-row-date">
                    {weekdayShort(row.classDate, locale)} {dayNumber(row.classDate)}
                  </span>
                  <span>
                    <span className={`st ${attendance.tone}`}>{attendance.text}</span>
                    <small>{[groupName || t("Individual"), grade?.assessment].filter(Boolean).join(" · ")}</small>
                  </span>
                  <b>{gradeValue === null ? "—" : formatScore(gradeValue, locale)}</b>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {student.notes ? <p className="muted">{t("Note: {text}", { text: student.notes })}</p> : null}
      <div className="sheet-actions">
        {phone ? (
          <a className="button button-secondary" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
            <Phone aria-hidden="true" />
            {t("Call the tutor")}
          </a>
        ) : null}
        {email ? (
          <a className="button button-secondary" href={`mailto:${email}`}>
            <Mail aria-hidden="true" />
            {t("Write an email")}
          </a>
        ) : null}
        <Button onClick={onEdit}>{t("Edit student")}</Button>
      </div>
    </div>
  );
}
