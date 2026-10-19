import { useState } from "react";
import { Archive, Info, RotateCcw } from "lucide-react";
import { Button } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { gradePercentage } from "../domain";
import { sumMoney } from "../domain/money";
import { gradeGroupId } from "../domain/semanticIdentity";
import { useI18n } from "../i18n";

export function ArchivedGroupDetail({ group, members, state, derived, onReactivate, saving, includedInStatistics }) {
  const { t, locale } = useI18n();
  const [historyOpen, setHistoryOpen] = useState(false);
  const rows = derived.classLog.filter((row) => row.groupId === group.id);
  const grades = state.grades.filter((row) => gradeGroupId(row) === group.id);
  const recorded = rows.filter((row) => row.classStatus === "Completed" && row.classDate <= state.settings.asOfDate);
  const expected = recorded.filter((row) => ["P", "L", "A"].includes(row.attendance));
  const present = expected.filter((row) => ["P", "L"].includes(row.attendance)).length;
  const paidAmount = (row) => (row.paymentDate && row.paymentDate <= state.settings.asOfDate ? row.amountPaid : 0);
  const collected = sumMoney(rows, paidAmount);
  const outstanding = sumMoney(rows, (row) => row.outstanding);
  const scores = grades
    .filter((row) => row.date <= state.settings.asOfDate)
    .map(gradePercentage)
    .filter((score) => score != null);
  const money = (value) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: state.settings.currency }).format(value);
  const date = (value) =>
    value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value + "T12:00:00")) : "—";
  const sessions = new Map();
  rows.forEach((row) => {
    const key = row.classDate + "|" + row.startTime;
    const current = sessions.get(key) || {
      key,
      date: row.classDate,
      title: row.classTitle || t("Class"),
      count: 0,
      collected: 0,
    };
    current.count += 1;
    current.collected = sumMoney([current.collected, paidAmount(row)]);
    sessions.set(key, current);
  });
  return (
    <section className="community-detail-panel archived-group-detail" aria-label={t("Archived group details")}>
      <header className="community-group-directory-heading">
        <span className="community-group-emblem">
          <Archive size={22} aria-hidden="true" />
        </span>
        <span>
          <h2>{group.name}</h2>
          <small>
            {members.length} {t("students")} · {group.grade || group.subject}
          </small>
        </span>
        <em className="record-status">{t("Archived group")}</em>
      </header>
      <div className="community-detail-body">
        <div className="archived-group-notice">
          <Info size={18} aria-hidden="true" />
          <span>
            {t(
              includedInStatistics
                ? "This group's history is included in statistics for this session. The group remains archived."
                : "This group is excluded from general statistics. You can include its history manually.",
            )}
          </span>
        </div>
        <h3>{t("Group history")}</h3>
        <p className="archived-group-helper">{t("All saved records are preserved.")}</p>
        <div className="archived-group-metrics">
          <article>
            <strong>{sessions.size}</strong>
            <span>{t("Recorded classes")}</span>
          </article>
          <article>
            <strong>{expected.length ? Math.round((present / expected.length) * 100) + "%" : "—"}</strong>
            <span>{t("Attendance")}</span>
          </article>
          <article>
            <strong>{money(collected)}</strong>
            <span>{t("Collected")}</span>
          </article>
          <article>
            <strong>
              {scores.length ? ((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10).toFixed(1) : "—"}
            </strong>
            <span>{t("Average grade")}</span>
          </article>
          <article>
            <strong>{money(outstanding)}</strong>
            <span>{t("Outstanding balance")}</span>
          </article>
        </div>
        <h3>{t("Students in this group")}</h3>
        <div className="archived-group-members">
          {members.map((student) => (
            <div key={student.id}>
              <StudentAvatar avatarId={student.avatarId} name={student.fullName} size="small" decorative />
              <span>
                <strong>{student.fullName}</strong>
                <small>
                  {student.code}
                  {student.status === "Inactive" ? " · " + t("Inactive") : ""}
                </small>
              </span>
            </div>
          ))}
        </div>
        {historyOpen ? (
          <div className="archived-group-history">
            <h3>{t("Class and payment history")}</h3>
            {[...sessions.values()]
              .sort((left, right) => right.date.localeCompare(left.date))
              .map((session) => (
                <article key={session.key}>
                  <span>
                    <strong>{session.title}</strong>
                    <small>
                      {date(session.date)} · {session.count} {t("students")}
                    </small>
                  </span>
                  <strong>{money(session.collected)}</strong>
                </article>
              ))}
            {!sessions.size ? <p>{t("No classes recorded yet.")}</p> : null}
            {grades.length ? (
              <>
                <h3>{t("Grades")}</h3>
                {grades.map((grade) => (
                  <article key={grade.id}>
                    <span>
                      <strong>{state.students.find((student) => student.id === grade.studentId)?.fullName}</strong>
                      <small>
                        {grade.assessment} · {date(grade.date)}
                      </small>
                    </span>
                    <strong>
                      {grade.score ?? "—"} / {grade.maxScore ?? "—"}
                    </strong>
                  </article>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="community-directory-footer">
        <small>{t("Archived on {date}", { date: date(group.archivedAt) })}</small>
        <Button onClick={() => setHistoryOpen(!historyOpen)}>{t(historyOpen ? "Hide history" : "View history")}</Button>
        <Button variant="primary" icon={RotateCcw} onClick={onReactivate} disabled={saving}>
          {t("Reactivate group")}
        </Button>
      </footer>
    </section>
  );
}
