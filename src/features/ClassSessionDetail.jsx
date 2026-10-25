import { useI18n } from "../i18n/index.jsx";
import { isBillableAttendance } from "../domain/attendanceBilling.js";
import { BottomSheet, Button, ListRow } from "../components/ui";
import { StudentAvatar } from "../components/StudentAvatar";
import { formatLongDate, formatMoney, formatScore, formatTime } from "../utils/displayFormat";
import { rosterForClassSession } from "./classesWorkspaceModel";

function firstName(name = "") {
  return String(name).split(" ")[0];
}

function joinNames(names, locale) {
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
}

/** Grades saved for a class session (exact session key, else legacy same-day grades of its roster). */
export function sessionGrades(state, session) {
  const exact = (state.grades || []).filter((grade) => grade.classSessionKey === session.key);
  if (exact.length) return exact;
  const ids = new Set((session.rows || []).map((row) => row.studentId));
  return (state.grades || []).filter(
    (grade) => !grade.classSessionKey && grade.date === session.classDate && ids.has(grade.studentId),
  );
}

/** Assignment name and average for a recorded class. */
export function sessionAssessment(state, session) {
  const grades = sessionGrades(state, session);
  const scored = grades.filter((grade) => grade.score != null);
  return {
    name: grades[0]?.assessment || "",
    max: grades[0]?.maxScore || null,
    average: scored.length ? scored.reduce((sum, grade) => sum + Number(grade.score), 0) / scored.length : null,
    grades,
  };
}

/**
 * The one line that matters about a class: who missed it, a low grade, a missing grade, a pending payment,
 * or «Todo en orden». tone: "bad" | "pend" | "ok".
 */
export function sessionInsight(state, session, derivedRows, t, locale) {
  if (session.statusLabel === "Pending") return { tone: "pend", text: t("Record attendance and payment") };
  if (session.statusLabel === "Cancelled") return { tone: "", text: t("Cancelled") };
  if (!(session.rows || []).length) return { tone: "", text: "" };
  const name = (id) => firstName((state.students || []).find((student) => student.id === id)?.fullName);
  const absent = session.rows.filter((row) => row.attendance === "A").map((row) => name(row.studentId));
  if (absent.length)
    return {
      tone: "bad",
      text: t("{names} missed", { names: joinNames(absent, locale) }).replace(/^./, (c) => c.toUpperCase()),
    };
  const { grades } = sessionAssessment(state, session);
  const threshold = Number(state.settings?.lowGradeThreshold ?? 0.7);
  const low = grades.filter(
    (grade) => grade.score != null && grade.maxScore && grade.score / grade.maxScore < threshold,
  );
  if (low.length)
    return { tone: "bad", text: t(low.length === 1 ? "One low grade" : "{count} low grades", { count: low.length }) };
  const present = session.rows.filter((row) => row.attendance === "P" || row.attendance === "L");
  const ungraded = grades.length
    ? present.filter((row) => !grades.some((grade) => grade.studentId === row.studentId && grade.score != null))
    : [];
  if (ungraded.length)
    return {
      tone: "pend",
      text: t("Grade missing for {names}", {
        names: joinNames(
          ungraded.map((row) => name(row.studentId)),
          locale,
        ),
      }),
    };
  const rows = derivedRows.filter((row) => session.rows.some((item) => item.id === row.id));
  const owed = rows.filter((row) => Number(row.outstanding) > 0);
  if (owed.length)
    return {
      tone: "bad",
      text: t(owed.length === 1 ? "1 payment pending" : "{count} payments pending", { count: owed.length }),
    };
  return { tone: "ok", text: t("All in order") };
}

/** Per-student lines for a recorded class. */
export function sessionStudentLines(state, session, derivedRows) {
  const { grades } = sessionAssessment(state, session);
  return rosterForClassSession(state, session).map((student) => {
    const row = (session.rows || []).find((item) => item.studentId === student.id);
    const derivedRow = derivedRows.find((item) => item.id === row?.id);
    const grade = grades.find((item) => item.studentId === student.id);
    return { student, row, derivedRow, grade };
  });
}

export function attendanceWord(row) {
  if (!row?.attendance) return { key: "Unmarked", tone: "" };
  return row.attendance === "A" || row.attendance === "E"
    ? { key: "Absent", tone: "bad" }
    : { key: "Present", tone: "ok" };
}

export function paymentWord(row, derivedRow, locale, t) {
  if (!row || Number(row.appliedCharge) === 0 || !isBillableAttendance(row)) return { text: "—", tone: "" };
  const outstanding = Number(derivedRow?.outstanding || 0);
  if (outstanding > 0) {
    // ✓ – ×: «–» is pending, «×» (not paid) reads as overdue.
    const overdue = row.paymentState === "Unpaid";
    return {
      text: `${t(overdue ? "Overdue" : "Pending")} ${formatMoney(outstanding, locale)}`,
      tone: overdue ? "bad" : "pend",
    };
  }
  return { text: t("Paid"), tone: "ok" };
}

/** Mobile sheet with one recorded class: who came, paid and the grade. */
export function SessionDetailSheet({ open, onClose, state, session, derivedRows = [], onEdit }) {
  const { t, locale } = useI18n();
  if (!session) return null;
  const assessment = sessionAssessment(state, session);
  const recorded = Boolean((session.rows || []).length);
  const kicker = recorded ? t("Recorded") : t(session.statusLabel === "Pending" ? "Not recorded" : "Scheduled");
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      kicker={kicker}
      title={session.title}
      description={`${formatLongDate(session.classDate, locale)} · ${formatTime(session.startTime, locale)}`}
    >
      {assessment.name ? <p className="sheet-line">{t("Assignment: {name}", { name: assessment.name })}</p> : null}
      <div className="list-rows">
        {sessionStudentLines(state, session, derivedRows).map(({ student, row, derivedRow, grade }) => {
          const attendance = attendanceWord(row);
          const pay = paymentWord(row, derivedRow, locale, t);
          const owes = pay.tone === "bad" || pay.tone === "pend";
          return (
            <ListRow
              key={student.id}
              avatar={<StudentAvatar avatarId={student.avatarId} name={student.fullName} decorative />}
              name={student.fullName}
              context={
                recorded
                  ? `${t(attendance.key)}${row?.attendance === "P" ? ` · ${owes ? t("payment pending") : pay.text === "—" ? "" : t("paid")}` : ""}`.replace(
                      / · $/,
                      "",
                    )
                  : t("Unmarked")
              }
              contextTone={attendance.tone === "bad" ? "bad" : owes ? "pend" : ""}
              value={
                grade?.score != null
                  ? formatScore(Number(grade.score), locale)
                  : assessment.name && row?.attendance === "P"
                    ? t("Not graded")
                    : ""
              }
              valueTone={grade?.score == null && assessment.name ? "pend" : ""}
              className="is-static"
            />
          );
        })}
      </div>
      <Button
        onClick={() => {
          onClose();
          onEdit(session);
        }}
      >
        {t(recorded ? "Edit record" : session.statusLabel === "Pending" ? "Record class" : "Open class")}
      </Button>
    </BottomSheet>
  );
}
