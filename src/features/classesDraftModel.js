import { roundMoney, sumMoney } from "../domain/money";
import { resolveHourlyRate } from "../domain/schedule";
import { coveredByMonthlyFee, deriveMonthlyCharges, periodOf } from "../domain/monthlyBilling";
import { rosterForClassSession } from "./classesWorkspaceModel";

const EMPTY_CLASS_DRAFT = {
  entries: {},
  assessmentOn: false,
  assessment: "",
  maximum: 10,
};

/** The maximum score the teacher used last for this group or student, else 10. */
export function lastMaximumScore(state = {}, session = null) {
  const owner = session?.groupId ? `g:${session.groupId}` : session?.studentId ? `s:${session.studentId}` : "";
  const latest = (state.grades || [])
    .filter(
      (grade) => Number(grade.maxScore) > 0 && (!owner || String(grade.classSessionKey || "").includes(`|${owner}|`)),
    )
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0];
  return latest ? Number(latest.maxScore) : 10;
}

function attendanceFromRow(row) {
  if (row?.attendance === "P" || row?.attendance === "L") return "P";
  if (row?.attendance === "A" || row?.attendance === "E") return "A";
  return "";
}

/** A saved row keeps its recorded payment state; a new class starts without a choice. */
function paymentFromRow(row) {
  if (!row) return "";
  if (["Paid", "Pending", "Unpaid"].includes(row.paymentState)) return row.paymentState;
  if (Number(row.appliedCharge) === 0) return "";
  return Number(row.amountPaid || 0) > 0 && Number(row.amountPaid) >= Number(row.appliedCharge || 0)
    ? "Paid"
    : "Pending";
}

export function buildClassDraft(state = {}, session = null) {
  if (!session) return EMPTY_CLASS_DRAFT;

  const roster = rosterForClassSession(state, session);
  const rosterIds = new Set(roster.map((student) => student.id));
  const exactGrades = (state.grades || []).filter((grade) => grade.classSessionKey === session.key);
  const legacyGrades = exactGrades.length
    ? []
    : (state.grades || []).filter(
        (grade) => !grade.classSessionKey && grade.date === session.classDate && rosterIds.has(grade.studentId),
      );
  const candidateGrades = exactGrades.length ? exactGrades : legacyGrades;
  const selectedAssessment = candidateGrades[0]?.assessment || "";
  const sessionGrades = selectedAssessment
    ? candidateGrades.filter((grade) => grade.assessment === selectedAssessment)
    : [];

  return {
    entries: Object.fromEntries(
      roster.map((student) => {
        const row = (session.rows || []).find((item) => item.studentId === student.id);
        const grade = sessionGrades.find((item) => item.studentId === student.id);
        return [
          student.id,
          {
            attendance: attendanceFromRow(row),
            paymentState: paymentFromRow(row),
            paymentTouched: false,
            score: grade?.score == null ? "" : String(grade.score),
            classId: row?.id || "",
            gradeId: grade?.id || "",
          },
        ];
      }),
    ),
    assessmentOn: Boolean(selectedAssessment),
    assessment: selectedAssessment,
    maximum: sessionGrades[0]?.maxScore ?? lastMaximumScore(state, session),
  };
}

function keepLocalChange(local, baseline, remote, key) {
  if (!local || !Object.hasOwn(local, key)) return remote?.[key];
  if (!baseline || !Object.hasOwn(baseline, key)) return local[key];
  return local[key] !== baseline[key] ? local[key] : remote?.[key];
}

export function rebaseClassDraft(local = EMPTY_CLASS_DRAFT, baseline = EMPTY_CLASS_DRAFT, remote = EMPTY_CLASS_DRAFT) {
  const entries = Object.fromEntries(
    Object.entries(remote.entries || {}).map(([studentId, remoteEntry]) => {
      const localEntry = local.entries?.[studentId];
      const baselineEntry = baseline.entries?.[studentId];
      const paymentState = keepLocalChange(localEntry, baselineEntry, remoteEntry, "paymentState");
      return [
        studentId,
        {
          ...remoteEntry,
          attendance: keepLocalChange(localEntry, baselineEntry, remoteEntry, "attendance"),
          paymentState,
          paymentTouched: paymentState !== remoteEntry.paymentState,
          score: keepLocalChange(localEntry, baselineEntry, remoteEntry, "score"),
        },
      ];
    }),
  );

  return {
    entries,
    assessmentOn: keepLocalChange(local, baseline, remote, "assessmentOn"),
    assessment: keepLocalChange(local, baseline, remote, "assessment"),
    maximum: keepLocalChange(local, baseline, remote, "maximum"),
  };
}

/**
 * Charge of one student's class before payments: hours × the rate (or a historical charge). A saved
 * record keeps the rate of its day, so marking an absent student present later charges that price.
 */
export function classChargeFor(state, session, studentId, existing = null) {
  if (Number(existing?.appliedCharge) > 0) return roundMoney(Number(existing.appliedCharge));
  const hours = existing?.hours ?? session?.durationHours ?? state.settings?.defaultClassHours ?? 2;
  const rate = Number.isFinite(existing?.appliedHourlyRate)
    ? existing.appliedHourlyRate
    : resolveHourlyRate(state, studentId, session?.groupId || "");
  return roundMoney(Number(hours) * (rate || 0));
}

/**
 * Class records ready for saveProgress. Only present students carry the per-class charge and the payment
 * chosen. Absent students carry a $0 charge. Students covered by a monthly fee and unmarked students carry
 * a $0 charge too, but a payment already recorded for them is kept: a per-class payment made before the
 * group turned monthly still counts toward that month's fee.
 */
export function buildClassRecords(state, session, roster, entries, { classStatus = "Completed", today }) {
  return roster.map((student) => {
    const entry = entries[student.id] || {};
    const existing =
      (session.rows || []).find((row) => row.id === entry.classId) ||
      (session.rows || []).find((row) => row.studentId === student.id);
    const hours = existing?.hours ?? session.durationHours ?? state.settings?.defaultClassHours ?? 2;
    const attendance = classStatus === "Completed" ? entry.attendance || "" : "";
    const monthly = coveredByMonthlyFee(state, student.id, session.groupId || "", session.classDate);
    const free = classStatus === "Cancelled" || attendance === "A";
    const unmarked = classStatus === "Completed" && !attendance;
    // Nothing to charge now, but whatever was already paid for the class stays recorded.
    const kept = unmarked || (monthly && !free);
    const charge = free || kept ? 0 : classChargeFor(state, session, student.id, existing);
    const payment = free || kept ? "" : entry.paymentTouched ? entry.paymentState : existing?.paymentState || "";
    const amountPaid =
      payment === "Paid"
        ? charge
        : payment === "Pending" || payment === "Unpaid"
          ? 0
          : free
            ? 0
            : (existing?.amountPaid ?? 0);
    return {
      ...existing,
      id: existing?.id,
      classDate: session.classDate,
      studentId: student.id,
      groupId: session.groupId || "",
      startTime: session.startTime || "",
      classTitle: session.title,
      scheduleSlotId: session.scheduleSlotId || "",
      scheduleOccurrenceDate: session.occurrenceDate || session.classDate,
      classStatus,
      attendance,
      hours,
      appliedCharge: charge,
      amountPaid,
      paymentDate:
        payment === "Paid"
          ? existing?.paymentDate || today
          : payment
            ? null
            : free
              ? null
              : existing?.paymentDate || null,
      paymentMethod:
        payment === "Paid"
          ? existing?.paymentMethod || "Cash"
          : payment
            ? ""
            : free
              ? ""
              : existing?.paymentMethod || "",
      paymentState: payment || (free || kept ? "" : "Pending"),
    };
  });
}

/** Live summary under the roster: «2 presentes · 1 ausente · 2 sin marcar · $150 cobrado hoy». */
export function classDraftSummary(state, session, roster, entries, monthlyPaidToday = 0) {
  const values = roster.map((student) => ({ student, entry: entries[student.id] || {} }));
  const present = values.filter(({ entry }) => entry.attendance === "P").length;
  const absent = values.filter(({ entry }) => entry.attendance === "A").length;
  let collected = monthlyPaidToday;
  let pending = 0;
  for (const { student, entry } of values) {
    if (entry.attendance !== "P" || coveredByMonthlyFee(state, student.id, session?.groupId || "", session?.classDate))
      continue;
    const charge = classChargeFor(
      state,
      session,
      student.id,
      (session?.rows || []).find((row) => row.studentId === student.id),
    );
    if (entry.paymentState === "Paid") collected += charge;
    else if (entry.paymentState) pending += charge;
  }
  const scores = values
    .filter(({ entry }) => entry.attendance === "P" && entry.score !== "" && entry.score != null)
    .map(({ entry }) => Number(entry.score))
    .filter(Number.isFinite);
  return {
    present,
    absent,
    unmarked: roster.length - present - absent,
    collected: roundMoney(collected),
    pending: roundMoney(pending),
    average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
  };
}

/**
 * One short note per student before class: absences, debts, missing grades or the monthly fee.
 * tone: "bad" (bermellón), "pend" (ocre) or "" (muted).
 */
export function studentClassNote(state, student, session, derivedRows = [], monthlyCharges = null) {
  const groupId = session?.groupId || "";
  const period = periodOf(session?.classDate);
  if (groupId && coveredByMonthlyFee(state, student.id, groupId, session.classDate)) {
    const charges = monthlyCharges || deriveMonthlyCharges(state, session.classDate);
    const charge = charges.find(
      (item) => item.studentId === student.id && item.groupId === groupId && item.period === period,
    );
    if (charge && charge.status !== "paid" && charge.status !== "waived")
      return { kind: "monthlyPending", tone: "pend", period };
    if (charge?.adjusted) return { kind: "customFee", tone: "", fee: charge.fee };
    return { kind: "upToDate", tone: "" };
  }
  const rows = derivedRows
    .filter(
      (row) =>
        row.studentId === student.id &&
        row.classStatus === "Completed" &&
        row.classDate < (session?.classDate || "9999"),
    )
    .sort((left, right) => right.classDate.localeCompare(left.classDate));
  const recent = rows.filter((row) => ["P", "L", "A"].includes(row.attendance)).slice(0, 5);
  const missed = recent.filter((row) => row.attendance === "A").length;
  if (recent.length >= 3 && missed >= 2)
    return {
      kind: "absences",
      tone: "bad",
      missed,
      total: recent.length,
      // The newest absence: a dismissed note comes back only after another one.
      lastAbsence: recent.find((row) => row.attendance === "A").classDate,
    };
  const owed = rows.filter((row) => Number(row.outstanding) > 0);
  if (owed.length)
    return {
      kind: "owes",
      tone: "pend",
      amount: sumMoney(owed, (row) => row.outstanding),
      // How many classes the amount spans and the oldest of them («Debe $1,125 de 5 clases desde el 1 oct»).
      count: owed.length,
      date: owed.at(-1).classDate,
      // The newest unpaid class: a dismissed note comes back only when another one adds to the debt.
      latest: owed[0].classDate,
    };
  const ungraded = (state.grades || [])
    .filter((grade) => grade.studentId === student.id && grade.score == null && grade.workStatus !== "Excused")
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0];
  if (ungraded) return { kind: "ungraded", tone: "pend", assessment: ungraded.assessment, gradeId: ungraded.id || "" };
  return { kind: "upToDate", tone: "" };
}
