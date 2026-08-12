import { resolveHourlyRate } from "../domain/schedule";
import { paymentRecordState, rosterForClassSession } from "./classesWorkspaceModel";

const EMPTY_CLASS_DRAFT = {
  entries: {},
  assessmentOn: false,
  assessment: "",
  maximum: 20,
};

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
        const hours = row?.hours ?? session.durationHours ?? state.settings?.defaultClassHours ?? 2;
        const charge = hours * (resolveHourlyRate(state, student, session.groupId) || 0);
        return [
          student.id,
          {
            attendance: row?.attendance === "A" || row?.attendance === "E" ? "A" : "P",
            paymentState: paymentRecordState(row, charge),
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
    maximum: sessionGrades[0]?.maxScore ?? 20,
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
