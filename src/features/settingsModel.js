import { roundMoney } from "../domain/money.js";
import { isMonthlyGroup, periodOf } from "../domain/monthlyBilling";
import { monthProjection } from "./homeDashboardModel";
import { trackingRange, trackingStudents } from "./trackingModel";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** The draft as the settings it would save, so the preview reads exactly what «Save» stores. */
export function draftSettings(settings, draft) {
  return {
    ...settings,
    hourlyRate: Number(draft.hourlyRateMxn ?? draft.hourlyRate),
    defaultClassHours: Number(draft.defaultClassHours),
    recentProjectionWeeks: Number(draft.recentProjectionWeeks),
    lowGradeThreshold: Number(draft.lowGradeThreshold),
    lowAttendanceThreshold: Number(draft.lowAttendanceThreshold),
  };
}

/** «Con estos valores»: what the class values change this month, before saving them. */
export function settingsEffects(state, derived, draft, asOf) {
  const settings = draftSettings(state.settings, draft);
  const preview = { ...state, settings };
  const period = periodOf(asOf);
  const ownRates = [
    ...(state.groups || [])
      .filter(
        (group) =>
          group.status !== "Inactive" &&
          (isMonthlyGroup(group, period) || (finite(group.hourlyRate) && group.hourlyRate !== settings.hourlyRate)),
      )
      .map((group) => group.name),
    ...(state.students || [])
      .filter(
        (student) =>
          student.status !== "Inactive" &&
          finite(student.customHourlyRate) &&
          student.customHourlyRate !== settings.hourlyRate,
      )
      .map((student) => student.fullName.split(" ")[0]),
  ];
  const students = trackingStudents(state, derived, trackingRange(asOf, "month"), "all");
  const lowGrade = settings.lowGradeThreshold * 10;
  const lowGrades = students
    .flatMap((row) =>
      row.gradeItems
        .filter((grade) => grade.value < lowGrade)
        .map((grade) => ({
          studentId: row.student.id,
          name: row.student.fullName,
          value: grade.value,
          assessment: grade.item.assessment,
          date: grade.item.date,
        })),
    )
    .sort((left, right) => right.date.localeCompare(left.date));
  return {
    classCost: roundMoney((settings.defaultClassHours || 0) * (settings.hourlyRate || 0)),
    ownRates,
    projection: monthProjection(preview, derived?.classLog || [], asOf).projected,
    lowAttendance: students
      .filter((row) => row.classes && row.attendance < settings.lowAttendanceThreshold)
      .sort((left, right) => left.attendance - right.attendance),
    lowGrades,
    lowGradeCount: new Set(lowGrades.map((item) => item.studentId)).size,
  };
}
