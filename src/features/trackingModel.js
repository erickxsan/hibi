import { addDays, endOfMonth, parseDateOnly, startOfMonth, startOfWeek } from "../domain/dates";
import { gradeGroupId } from "../domain/semanticIdentity";
import { classWorkspaceSessionKey } from "./classesWorkspaceModel";

export const TRACKING_TABS = Object.freeze(["grades", "attendance", "payments"]);
export const TRACKING_PERIODS = Object.freeze(["week", "month", "thirty", "all"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + (finite(selector(row)) ? selector(row) : 0), 0);
}

function inclusiveDayCount(start, end) {
  return Math.max(1, Math.round((parseDateOnly(end) - parseDateOnly(start)) / 86_400_000) + 1);
}

function studentGroupIds(student) {
  return Array.isArray(student?.groupIds) ? student.groupIds : student?.groupId ? [student.groupId] : [];
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function matchesSearch(values, search) {
  const needle = normalize(search);
  return !needle || normalize(values.join(" ")).includes(needle);
}

export function trackingRange(asOfDate, period = "month", datedRows = []) {
  const end = asOfDate;
  const earliest =
    datedRows
      .map((row) => row.date || row.classDate || row.paymentDate)
      .filter(Boolean)
      .sort()[0] || asOfDate;
  const start =
    period === "week"
      ? startOfWeek(asOfDate, 1)
      : period === "thirty"
        ? addDays(asOfDate, -29)
        : period === "all"
          ? earliest
          : startOfMonth(asOfDate);
  return { start, end, period };
}

export function inTrackingRange(date, range) {
  return Boolean(date && date >= range.start && date <= range.end);
}

export function studentsForGroup(state, groupId) {
  return (state.students || []).filter(
    (student) => student.status !== "Inactive" && studentGroupIds(student).includes(groupId),
  );
}

export function buildAssessmentOptions(state, gradeRows, groupId, range) {
  const studentIds = new Set(studentsForGroup(state, groupId).map((student) => student.id));
  const options = new Map();
  for (const row of gradeRows) {
    if (
      !studentIds.has(row.studentId) ||
      gradeGroupId(row) !== groupId ||
      !inTrackingRange(row.date, range) ||
      !row.assessment
    )
      continue;
    const maximum = row.maxScore ?? row.maximum ?? 0;
    const key = `${row.date}|${row.assessment}|${maximum}`;
    if (!options.has(key)) options.set(key, { key, date: row.date, assessment: row.assessment, maximum });
  }
  return [...options.values()].sort(
    (left, right) => right.date.localeCompare(left.date) || left.assessment.localeCompare(right.assessment),
  );
}

function gradeStatus(percentage) {
  if (percentage == null) return { label: "Not graded", tone: "neutral" };
  if (percentage >= 0.9) return { label: "Excellent", tone: "success" };
  if (percentage >= 0.8) return { label: "Very good", tone: "success" };
  if (percentage >= 0.6) return { label: "Fair", tone: "warning" };
  return { label: "Needs support", tone: "danger" };
}

export function buildGradeTracking(
  state,
  gradeRows,
  { mode, groupId, studentId, assessmentKey, range, search = "", classRows = [] },
) {
  const studentsById = new Map((state.students || []).map((student) => [student.id, student]));
  const roster =
    mode === "student"
      ? (state.students || []).filter((student) => student.id === studentId)
      : studentsForGroup(state, groupId);
  const rosterIds = new Set(roster.map((student) => student.id));
  let rows = gradeRows.filter(
    (row) =>
      rosterIds.has(row.studentId) &&
      (mode !== "group" || gradeGroupId(row) === groupId) &&
      inTrackingRange(row.date, range),
  );
  const assessment =
    mode === "group"
      ? buildAssessmentOptions(state, gradeRows, groupId, range).find((item) => item.key === assessmentKey)
      : null;
  if (assessment)
    rows = rows.filter((row) => `${row.date}|${row.assessment}|${row.maxScore ?? row.maximum ?? 0}` === assessment.key);
  rows = rows.filter((row) => matchesSearch([row.studentName, row.assessment, row.category], search));

  const tableRows =
    mode === "group" && assessment
      ? roster
          .filter((student) => matchesSearch([student.fullName, student.code], search))
          .map((student) => {
            const grade = rows.find((row) => row.studentId === student.id);
            const maximum = grade?.maxScore ?? grade?.maximum ?? assessment.maximum;
            const percentage = finite(grade?.score) && finite(maximum) && maximum > 0 ? grade.score / maximum : null;
            const relatedClass = classRows.find(
              (row) =>
                row.studentId === student.id &&
                row.groupId === groupId &&
                row.classDate === assessment.date &&
                row.classStatus !== "Cancelled",
            );
            const sessionKey =
              grade?.classSessionKey ||
              (relatedClass
                ? classWorkspaceSessionKey({
                    ...relatedClass,
                    studentId: relatedClass.groupId ? "" : relatedClass.studentId,
                  })
                : "");
            return {
              id: student.id,
              student,
              grade,
              date: assessment.date,
              assessment: assessment.assessment,
              score: grade?.score ?? null,
              maximum,
              percentage,
              status: gradeStatus(percentage),
              sessionKey,
            };
          })
      : rows
          .map((grade) => {
            const student = studentsById.get(grade.studentId);
            const maximum = grade.maxScore ?? grade.maximum ?? 0;
            const percentage = finite(grade.score) && finite(maximum) && maximum > 0 ? grade.score / maximum : null;
            const relatedClass = classRows.find(
              (row) =>
                row.studentId === grade.studentId && row.classDate === grade.date && row.classStatus !== "Cancelled",
            );
            const sessionKey =
              grade.classSessionKey ||
              (relatedClass
                ? classWorkspaceSessionKey({
                    ...relatedClass,
                    studentId: relatedClass.groupId ? "" : relatedClass.studentId,
                  })
                : "");
            return {
              id: grade.id,
              student,
              grade,
              date: grade.date,
              assessment: grade.assessment,
              score: grade.score ?? null,
              maximum,
              percentage,
              status: gradeStatus(percentage),
              sessionKey,
            };
          })
          .sort((left, right) => right.date.localeCompare(left.date));

  const graded = tableRows.filter((row) => row.percentage != null);
  const percentages = graded.map((row) => row.percentage);
  const average = percentages.length ? sum(percentages, (value) => value) / percentages.length : null;
  const distribution = [
    { label: "0–59", value: percentages.filter((value) => value < 0.6).length, tone: "red" },
    { label: "60–69", value: percentages.filter((value) => value >= 0.6 && value < 0.7).length, tone: "orange" },
    { label: "70–79", value: percentages.filter((value) => value >= 0.7 && value < 0.8).length, tone: "yellow" },
    { label: "80–89", value: percentages.filter((value) => value >= 0.8 && value < 0.9).length, tone: "sage" },
    { label: "90–100", value: percentages.filter((value) => value >= 0.9).length, tone: "green" },
  ];
  const series =
    mode === "student"
      ? graded
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((row) => ({ label: row.date, value: row.percentage }))
      : [];
  return {
    assessment,
    tableRows,
    average,
    best: percentages.length ? Math.max(...percentages) : null,
    worst: percentages.length ? Math.min(...percentages) : null,
    gradedCount: graded.length,
    missingCount: tableRows.length - graded.length,
    distribution,
    series,
  };
}

function attendanceStatus(rate) {
  if (rate == null) return { label: "No data", tone: "neutral" };
  if (rate >= 0.85) return { label: "Good", tone: "success" };
  if (rate >= 0.75) return { label: "At risk", tone: "warning" };
  return { label: "Low attendance", tone: "danger" };
}

function attended(code) {
  return code === "P" || code === "L";
}

export function buildAttendanceTracking(state, classRows, { mode, groupId, studentId, range, search = "" }) {
  const activeStudents = (state.students || []).filter((student) => student.status !== "Inactive");
  const roster =
    mode === "overview"
      ? activeStudents
      : mode === "student"
        ? (state.students || []).filter((student) => student.id === studentId)
        : studentsForGroup(state, groupId);
  const rosterIds = new Set(roster.map((student) => student.id));
  const relevant = classRows.filter(
    (row) =>
      row.classStatus === "Completed" &&
      rosterIds.has(row.studentId) &&
      (mode !== "group" || row.groupId === groupId) &&
      inTrackingRange(row.classDate, range) &&
      (mode !== "overview" || matchesSearch([row.studentName, row.classTitle, row.groupName], search)),
  );
  const studentsById = new Map((state.students || []).map((student) => [student.id, student]));
  const groupsById = new Map((state.groups || []).map((group) => [group.id, group]));
  const tableRows =
    mode === "student"
      ? relevant
          .filter((row) => matchesSearch([row.classTitle, row.groupName, row.classDate], search))
          .sort((a, b) => b.classDate.localeCompare(a.classDate))
          .map((row) => ({
            id: row.id,
            student: roster[0],
            classDate: row.classDate,
            startTime: row.startTime || "",
            classTitle: row.classTitle || row.groupName || "Class",
            attendance: row.attendance,
            present: attended(row.attendance) ? 1 : 0,
            absent: row.attendance === "A" ? 1 : 0,
            rate: ["P", "L", "A"].includes(row.attendance) ? (attended(row.attendance) ? 1 : 0) : null,
            status: attendanceStatus(
              ["P", "L", "A"].includes(row.attendance) ? (attended(row.attendance) ? 1 : 0) : null,
            ),
            sessionKey: classWorkspaceSessionKey({ ...row, studentId: row.groupId ? "" : row.studentId }),
          }))
      : roster
          .filter((student) => matchesSearch([student.fullName, student.code], search))
          .map((student) => {
            const rows = relevant.filter((row) => row.studentId === student.id);
            const recorded = rows.filter((row) => ["P", "L", "A"].includes(row.attendance));
            const present = recorded.filter((row) => attended(row.attendance)).length;
            const absent = recorded.filter((row) => row.attendance === "A").length;
            const rate = recorded.length ? present / recorded.length : null;
            const lastRow = rows.slice().sort((left, right) => right.classDate.localeCompare(left.classDate))[0];
            const groupNames = [
              ...new Set(rows.map((row) => row.groupName || groupsById.get(row.groupId)?.name).filter(Boolean)),
            ];
            return {
              id: student.id,
              student,
              present,
              absent,
              rate,
              lastClass:
                rows
                  .map((row) => row.classDate)
                  .sort()
                  .at(-1) || "",
              status: attendanceStatus(rate),
              groupName: groupNames.join(", "),
              sessionKey: lastRow
                ? classWorkspaceSessionKey({ ...lastRow, studentId: lastRow.groupId ? "" : lastRow.studentId })
                : "",
            };
          })
          .filter((row) => mode !== "overview" || row.rate != null)
          .sort((left, right) => {
            if (mode !== "overview") return 0;
            if (left.rate == null) return 1;
            if (right.rate == null) return -1;
            return left.rate - right.rate || right.absent - left.absent;
          });
  const recorded = relevant.filter((row) => ["P", "L", "A"].includes(row.attendance));
  const present = recorded.filter((row) => attended(row.attendance)).length;
  const absent = recorded.filter((row) => row.attendance === "A").length;
  const sessions = new Set(
    relevant.map((row) => classWorkspaceSessionKey({ ...row, studentId: row.groupId ? "" : row.studentId })),
  ).size;
  const weekly = new Map();
  for (const row of recorded) {
    const week = startOfWeek(row.classDate, 1);
    const current = weekly.get(week) || { label: week, present: 0, total: 0 };
    current.total += 1;
    if (attended(row.attendance)) current.present += 1;
    weekly.set(week, current);
  }
  const series = [...weekly.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((item) => ({ label: item.label, value: item.total ? item.present / item.total : 0 }));
  const studentWeekly = new Map();
  for (const row of recorded) {
    const week = startOfWeek(row.classDate, 1);
    const values = studentWeekly.get(row.studentId) || new Map();
    const current = values.get(week) || { present: 0, total: 0 };
    current.total += 1;
    if (attended(row.attendance)) current.present += 1;
    values.set(week, current);
    studentWeekly.set(row.studentId, values);
  }
  const improvingStudents = [...studentWeekly.values()].filter((values) => {
    const weeks = [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
    if (weeks.length < 2) return false;
    const first = weeks[0][1];
    const last = weeks.at(-1)[1];
    return last.present / last.total > first.present / first.total;
  }).length;
  const sessionRows = new Map();
  for (const row of recorded) {
    const key = classWorkspaceSessionKey({ ...row, studentId: row.groupId ? "" : row.studentId });
    const current = sessionRows.get(key) || {
      key,
      classDate: row.classDate,
      startTime: row.startTime || "",
      title:
        row.groupName ||
        groupsById.get(row.groupId)?.name ||
        row.classTitle ||
        studentsById.get(row.studentId)?.fullName ||
        "Class",
      present: 0,
      total: 0,
    };
    current.total += 1;
    if (attended(row.attendance)) current.present += 1;
    sessionRows.set(key, current);
  }
  const lowestSessions = [...sessionRows.values()]
    .map((item) => ({ ...item, rate: item.total ? item.present / item.total : null }))
    .sort((left, right) => left.rate - right.rate || right.classDate.localeCompare(left.classDate))
    .slice(0, 2);
  return {
    tableRows,
    average: recorded.length ? present / recorded.length : null,
    sessions,
    present,
    absent,
    total: recorded.length,
    series,
    repeatedAbsenceStudents: tableRows.filter((row) => row.absent >= 2).length,
    perfectAttendanceStudents: tableRows.filter((row) => row.rate === 1).length,
    improvingStudents,
    lowestSessions,
    threshold: finite(state.settings?.lowAttendanceThreshold) ? state.settings.lowAttendanceThreshold : 0.8,
  };
}

function paymentStatus(row, asOfDate) {
  const charge = finite(row.charge) ? row.charge : 0;
  const paid = finite(row.recognizedPaid) ? row.recognizedPaid : finite(row.amountPaid) ? row.amountPaid : 0;
  if (charge > 0 && paid >= charge) return { label: "Paid", tone: "success" };
  if (row.classDate < asOfDate) return { label: "Overdue", tone: "danger" };
  return { label: "Pending", tone: "warning" };
}

export function buildPaymentTracking(
  state,
  classRows,
  { mode, groupId, studentId, sessionKey, range, search = "", projectionTotal },
) {
  const asOfDate = state.settings?.asOfDate || range.end;
  const useStudentOwner = mode === "student" || (mode === "class" && !groupId);
  const activeStudents = (state.students || []).filter((student) => student.status !== "Inactive");
  const roster =
    mode === "overview"
      ? activeStudents
      : useStudentOwner
        ? activeStudents.filter((student) => student.id === studentId)
        : studentsForGroup(state, groupId);
  const rosterIds = new Set(roster.map((student) => student.id));
  const groupScoped = (mode === "group" || mode === "class") && Boolean(groupId);
  let relevant = classRows.filter(
    (row) =>
      row.classStatus !== "Cancelled" &&
      rosterIds.has(row.studentId) &&
      (!groupScoped || row.groupId === groupId) &&
      inTrackingRange(row.classDate, range),
  );
  if (mode === "class" && sessionKey)
    relevant = relevant.filter(
      (row) => classWorkspaceSessionKey({ ...row, studentId: row.groupId ? "" : row.studentId }) === sessionKey,
    );
  relevant = relevant.filter((row) => matchesSearch([row.studentName, row.classTitle, row.groupName], search));
  const sessions = new Map();
  for (const row of classRows.filter(
    (item) => item.classStatus !== "Cancelled" && inTrackingRange(item.classDate, range),
  )) {
    if (groupId && row.groupId !== groupId) continue;
    if (!groupId && useStudentOwner && row.studentId !== studentId) continue;
    const key = classWorkspaceSessionKey({ ...row, studentId: row.groupId ? "" : row.studentId });
    if (!sessions.has(key))
      sessions.set(key, {
        key,
        classDate: row.classDate,
        startTime: row.startTime || "",
        title: row.classTitle || row.groupName || row.studentName || "Class",
      });
  }
  const studentsById = new Map((state.students || []).map((student) => [student.id, student]));
  const aggregateByStudent = mode === "group" || mode === "overview";
  const tableRows = aggregateByStudent
    ? roster
        .filter((student) => matchesSearch([student.fullName, student.code], search))
        .map((student) => {
          const rows = relevant.filter((row) => row.studentId === student.id);
          const charged = sum(rows, (row) => row.charge);
          const paid = sum(rows, (row) => row.recognizedPaid);
          const pending = Math.max(charged - paid, 0);
          const lastPayment =
            rows
              .map((row) => row.paymentDate)
              .filter(Boolean)
              .sort()
              .at(-1) || "";
          const overdue = rows.some((row) => paymentStatus(row, asOfDate).label === "Overdue");
          return {
            id: student.id,
            student,
            charged,
            paid,
            pending,
            lastPayment,
            status:
              pending <= 0 && charged > 0
                ? { label: "Up to date", tone: "success" }
                : overdue
                  ? { label: "Overdue", tone: "danger" }
                  : { label: "Pending", tone: "warning" },
          };
        })
    : relevant
        .map((row) => ({
          id: row.id,
          student: studentsById.get(row.studentId),
          classDate: row.classDate,
          startTime: row.startTime || "",
          classTitle: row.classTitle || row.groupName || "Class",
          charged: finite(row.charge) ? row.charge : 0,
          paid: finite(row.recognizedPaid) ? row.recognizedPaid : 0,
          pending: finite(row.outstanding)
            ? row.outstanding
            : Math.max((row.charge || 0) - (row.recognizedPaid || 0), 0),
          paymentDate: row.paymentDate || "",
          status: paymentStatus(row, asOfDate),
          sessionKey: classWorkspaceSessionKey({ ...row, studentId: row.groupId ? "" : row.studentId }),
        }))
        .sort((a, b) => b.classDate.localeCompare(a.classDate));
  const generated = sum(relevant, (row) => row.charge);
  const collected = sum(relevant, (row) => row.recognizedPaid);
  const pending = Math.max(generated - collected, 0);
  const paidStudents = new Set(
    relevant.filter((row) => paymentStatus(row, asOfDate).label === "Paid").map((row) => row.studentId),
  ).size;
  const pendingStudents = new Set(
    relevant.filter((row) => paymentStatus(row, asOfDate).label !== "Paid").map((row) => row.studentId),
  ).size;
  const paidClasses = relevant.filter((row) => paymentStatus(row, asOfDate).label === "Paid").length;
  const unpaidClasses = relevant.length - paidClasses;
  const overdueRows = relevant.filter((row) => paymentStatus(row, asOfDate).label === "Overdue");
  const overdue = sum(overdueRows, (row) =>
    finite(row.outstanding)
      ? row.outstanding
      : Math.max((row.charge || 0) - (row.recognizedPaid || row.amountPaid || 0), 0),
  );
  const daily = new Map();
  for (const row of relevant)
    daily.set(row.classDate, (daily.get(row.classDate) || 0) + (finite(row.recognizedPaid) ? row.recognizedPaid : 0));
  const series = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => ({ label, value }));
  let runningCollected = 0;
  const cumulativeSeries = series.map((item) => {
    runningCollected += item.value;
    return { ...item, value: runningCollected };
  });
  const projectionEnd =
    range.period === "month" ? endOfMonth(asOfDate) : range.period === "week" ? addDays(range.start, 6) : range.end;
  const elapsedDays = inclusiveDayCount(range.start, asOfDate > projectionEnd ? projectionEnd : asOfDate);
  const totalDays = inclusiveDayCount(range.start, projectionEnd);
  const paceProjection = collected > 0 ? (collected / elapsedDays) * totalDays : 0;
  const projection = Math.max(
    collected,
    finite(projectionTotal) && projectionTotal >= 0 ? projectionTotal : paceProjection,
  );
  return {
    tableRows,
    sessions: [...sessions.values()].sort(
      (a, b) => b.classDate.localeCompare(a.classDate) || b.startTime.localeCompare(a.startTime),
    ),
    generated,
    collected,
    pending,
    overdue,
    overdueClasses: overdueRows.length,
    paidStudents,
    pendingStudents,
    paidClasses,
    unpaidClasses,
    series,
    cumulativeSeries,
    projection,
    projectionGap: Math.max(projection - collected, 0),
    projectionStart: range.start,
    projectionEnd,
    actualEnd: asOfDate,
    totalStudents: new Set(relevant.map((row) => row.studentId)).size,
  };
}
