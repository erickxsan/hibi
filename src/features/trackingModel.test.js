import { describe, expect, it } from "vitest";
import {
  buildAssessmentOptions,
  buildAttendanceTracking,
  buildGradeTracking,
  buildPaymentTracking,
  trackingRange,
} from "./trackingModel";

const state = {
  settings: { asOfDate: "2026-07-25" },
  groups: [
    { id: "g1", name: "Math" },
    { id: "g2", name: "Science" },
  ],
  students: [
    { id: "s1", fullName: "Ana", code: "S-1", status: "Active", groupIds: ["g1", "g2"] },
    { id: "s2", fullName: "Ben", code: "S-2", status: "Active", groupIds: ["g1"] },
    { id: "s3", fullName: "Cam", code: "S-3", status: "Active", groupIds: ["g2"] },
  ],
};
const range = trackingRange("2026-07-25", "month");
const grades = [
  {
    id: "other-group",
    date: "2026-07-20",
    studentId: "s1",
    studentName: "Ana",
    assessment: "Fractions",
    score: 1,
    maxScore: 10,
    classSessionKey: "2026-07-20|g:g2|12:00",
  },
  {
    id: "legacy-unscoped",
    date: "2026-07-20",
    studentId: "s1",
    studentName: "Ana",
    assessment: "Fractions",
    score: 0,
    maxScore: 10,
  },
  {
    id: "a",
    date: "2026-07-20",
    studentId: "s1",
    studentName: "Ana",
    assessment: "Fractions",
    score: 9,
    maxScore: 10,
    classSessionKey: "2026-07-20|g:g1|10:00",
  },
  {
    id: "b",
    date: "2026-07-20",
    studentId: "s2",
    studentName: "Ben",
    assessment: "Fractions",
    score: 5,
    maxScore: 10,
    classSessionKey: "2026-07-20|g:g1|10:00",
  },
];
const classes = [
  {
    id: "c1",
    classDate: "2026-07-20",
    startTime: "10:00",
    groupId: "g1",
    studentId: "s1",
    studentName: "Ana",
    classStatus: "Completed",
    attendance: "P",
    charge: 100,
    recognizedPaid: 100,
    outstanding: 0,
    paymentDate: "2026-07-20",
  },
  {
    id: "c2",
    classDate: "2026-07-20",
    startTime: "10:00",
    groupId: "g1",
    studentId: "s2",
    studentName: "Ben",
    classStatus: "Completed",
    attendance: "A",
    charge: 100,
    recognizedPaid: 0,
    outstanding: 100,
    paymentDate: "",
  },
  {
    id: "c3",
    classDate: "2026-07-24",
    startTime: "12:00",
    groupId: "g2",
    studentId: "s3",
    studentName: "Cam",
    classStatus: "Completed",
    attendance: "P",
    charge: 200,
    recognizedPaid: 50,
    outstanding: 150,
    paymentDate: "2026-07-24",
  },
  {
    id: "c4",
    classDate: "2026-07-21",
    startTime: "12:00",
    groupId: "g2",
    studentId: "s1",
    studentName: "Ana",
    classStatus: "Completed",
    attendance: "A",
    charge: 200,
    recognizedPaid: 0,
    outstanding: 200,
    paymentDate: "",
  },
  {
    id: "legacy-unscoped",
    classDate: "2026-07-22",
    startTime: "14:00",
    groupId: "",
    studentId: "s1",
    studentName: "Ana",
    classStatus: "Completed",
    attendance: "A",
    charge: 300,
    recognizedPaid: 0,
    outstanding: 300,
    paymentDate: "",
  },
];

describe("tracking model", () => {
  it("builds a group assessment summary without inventing missing scores", () => {
    const assessment = buildAssessmentOptions(state, grades, "g1", range)[0];
    const result = buildGradeTracking(state, grades, {
      mode: "group",
      groupId: "g1",
      assessmentKey: assessment.key,
      range,
    });
    expect(result.average).toBeCloseTo(0.7);
    expect(result.best).toBe(0.9);
    expect(result.worst).toBe(0.5);
    expect(result.tableRows).toHaveLength(2);
    expect(result.tableRows.find((row) => row.student.id === "s1").score).toBe(9);
  });

  it("summarizes attendance by student and week", () => {
    const result = buildAttendanceTracking(state, classes, { mode: "group", groupId: "g1", range });
    expect(result.average).toBe(0.5);
    expect(result.present).toBe(1);
    expect(result.absent).toBe(1);
    expect(result.sessions).toBe(1);
    expect(result.series).toHaveLength(1);
  });

  it("builds a global attendance overview from the existing attendance records", () => {
    const result = buildAttendanceTracking(state, classes, { mode: "overview", range });

    expect(result).toMatchObject({
      present: 2,
      absent: 3,
      total: 5,
      average: 0.4,
      sessions: 4,
      repeatedAbsenceStudents: 1,
      perfectAttendanceStudents: 1,
      improvingStudents: 0,
      threshold: 0.8,
    });
    expect(result.tableRows.map((row) => row.student.fullName)).toEqual(["Ben", "Ana", "Cam"]);
    expect(result.tableRows.find((row) => row.student.id === "s1")).toMatchObject({
      present: 1,
      absent: 2,
      rate: 1 / 3,
    });
    expect(result.lowestSessions).toHaveLength(2);
  });

  it("keeps the global attendance overview searchable without changing attendance values", () => {
    const result = buildAttendanceTracking(state, classes, { mode: "overview", range, search: "Cam" });

    expect(result).toMatchObject({ present: 1, absent: 0, total: 1, average: 1 });
    expect(result.tableRows).toHaveLength(1);
    expect(result.tableRows[0].student.fullName).toBe("Cam");
  });

  it("keeps completed attendance in the global overview after the current roster changes", () => {
    const historicalState = {
      ...state,
      students: [
        ...state.students,
        { id: "inactive", fullName: "Inactive student", code: "OLD-1", status: "Inactive", groupIds: ["g1"] },
      ],
    };
    const historicalClasses = [
      {
        id: "inactive-present",
        classDate: "2026-08-08",
        startTime: "08:00",
        studentId: "inactive",
        studentName: "Inactive student",
        groupId: "g1",
        groupName: "Math",
        classStatus: "Completed",
        attendance: "P",
      },
      {
        id: "removed-absent",
        classDate: "2026-08-09",
        startTime: "08:00",
        studentId: "removed",
        studentName: "Former student",
        studentCode: "OLD-2",
        groupId: "g1",
        groupName: "Math",
        classStatus: "Completed",
        attendance: "A",
      },
    ];

    const augustRange = trackingRange("2026-08-19", "month");
    const result = buildAttendanceTracking(historicalState, historicalClasses, {
      mode: "overview",
      range: augustRange,
    });

    expect(result).toMatchObject({ present: 1, absent: 1, total: 2, average: 0.5, sessions: 2 });
    expect(result.tableRows.map((row) => row.student.fullName)).toEqual(["Former student", "Inactive student"]);
  });

  it("keeps class payments granular and calculates collected versus pending", () => {
    const sessionKey = "2026-07-20|g:g1|10:00";
    const result = buildPaymentTracking(state, classes, { mode: "class", groupId: "g1", sessionKey, range });
    expect(result.generated).toBe(200);
    expect(result.collected).toBe(100);
    expect(result.pending).toBe(100);
    expect(result.paidStudents).toBe(1);
    expect(result.pendingStudents).toBe(1);
    expect(result.paidClasses).toBe(1);
    expect(result.unpaidClasses).toBe(1);
    expect(result.series).toEqual([{ label: "2026-07-20", value: 100 }]);
  });

  it("does not attribute another group or an unscoped legacy record to a multi-group student's report", () => {
    const attendance = buildAttendanceTracking(state, classes, { mode: "group", groupId: "g1", range });
    const payments = buildPaymentTracking(state, classes, { mode: "group", groupId: "g1", range });

    expect(attendance).toMatchObject({ present: 1, absent: 1, total: 2, average: 0.5 });
    expect(payments).toMatchObject({ generated: 200, collected: 100, pending: 100 });
  });

  it("builds a global payment overview with cumulative collections and forecast metadata", () => {
    const result = buildPaymentTracking(state, classes, {
      mode: "overview",
      range,
      projectionTotal: 900,
    });
    expect(result.generated).toBe(900);
    expect(result.collected).toBe(150);
    expect(result.pending).toBe(750);
    expect(result.paidClasses).toBe(1);
    expect(result.unpaidClasses).toBe(4);
    expect(result.overdue).toBe(750);
    expect(result.overdueClasses).toBe(4);
    expect(result.projection).toBe(900);
    expect(result.projectionGap).toBe(750);
    expect(result.cumulativeSeries).toEqual([
      { label: "2026-07-20", value: 100 },
      { label: "2026-07-21", value: 100 },
      { label: "2026-07-22", value: 100 },
      { label: "2026-07-24", value: 150 },
    ]);
    expect(result.tableRows).toHaveLength(3);
  });

  it("preserves the first historical identity and row order when attendance rates tie", () => {
    const rows = [
      { ...classes[0], id: "old-first", studentId: "removed", studentName: "First name", studentCode: "OLD" },
      { ...classes[0], id: "current", studentId: "s2" },
      { ...classes[0], id: "old-later", studentId: "removed", studentName: "Later name", studentCode: "NEW" },
    ];
    const original = structuredClone(rows);
    const result = buildAttendanceTracking(state, rows, { mode: "overview", range });

    expect(result.tableRows.map((row) => row.id)).toEqual(["removed", "s2"]);
    expect(result.tableRows[0]).toMatchObject({
      present: 2,
      rate: 1,
      student: { fullName: "First name", code: "OLD", status: "Inactive", groupIds: ["g1"] },
    });
    expect(rows).toEqual(original);
  });

  it("keeps weekly attendance and improvement correct across a year boundary", () => {
    const rows = [
      ["2025-12-28", "A"],
      ["2025-12-29", "A"],
      ["2026-01-04", "L"],
      ["2026-01-05", "P"],
    ].flatMap(([classDate, attendance]) =>
      ["s1", "s2"].map((studentId) => ({
        ...classes[0],
        id: `${classDate}-${studentId}`,
        classDate,
        attendance,
        studentId,
      })),
    );
    const result = buildAttendanceTracking(state, rows, {
      mode: "overview",
      range: trackingRange("2026-01-05", "all", rows),
    });

    expect(result.series).toEqual([
      { label: "2025-12-22", value: 0 },
      { label: "2025-12-29", value: 0.5 },
      { label: "2026-01-05", value: 1 },
    ]);
    expect(result).toMatchObject({ present: 4, absent: 4, total: 8, improvingStudents: 2 });
  });

  it("preserves roster order, zero-record students, and exact decimal payment sums", () => {
    const orderedState = { ...state, students: [state.students[1], state.students[0], state.students[2]] };
    const rows = [0.1, 0.2, 0.3].map((charge, index) => ({
      ...classes[0],
      id: `decimal-${index}`,
      charge,
      recognizedPaid: charge,
      outstanding: 0,
    }));
    const original = structuredClone({ state: orderedState, rows });
    const result = buildPaymentTracking(orderedState, rows, { mode: "overview", range });

    expect(result.tableRows.map((row) => row.id)).toEqual(["s2", "s1", "s3"]);
    expect(result.tableRows[0]).toMatchObject({ charged: 0, paid: 0, pending: 0, lastPayment: "" });
    expect(result.tableRows[1]).toMatchObject({ charged: 0.1 + 0.2 + 0.3, paid: 0.1 + 0.2 + 0.3, pending: 0 });
    expect(result.generated).toBe(0.1 + 0.2 + 0.3);
    expect({ state: orderedState, rows }).toEqual(original);
  });

  it("recalculates both reports after records change without retaining previous inputs", () => {
    const options = { mode: "group", groupId: "g1", range };
    const rows = structuredClone(classes);
    expect(buildAttendanceTracking(state, rows, options).present).toBe(1);
    expect(buildPaymentTracking(state, rows, options).collected).toBe(100);

    rows[1] = { ...rows[1], attendance: "P", recognizedPaid: 100, outstanding: 0, paymentDate: "2026-07-25" };
    expect(buildAttendanceTracking(state, rows, options).present).toBe(2);
    expect(buildPaymentTracking(state, rows, options)).toMatchObject({ collected: 200, pending: 0 });
    expect(buildAttendanceTracking(state, [], options).total).toBe(0);
    expect(buildPaymentTracking(state, [], options).collected).toBe(0);
  });

  it.each(["overview", "group", "student"])("ignores the selected session in %s payment reports", (mode) => {
    const options = { mode, groupId: "g1", studentId: "s1", range };
    expect(buildPaymentTracking(state, classes, { ...options, sessionKey: "2026-07-20|g:g1|10:00" })).toEqual(
      buildPaymentTracking(state, classes, { ...options, sessionKey: "" }),
    );
  });
});
