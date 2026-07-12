import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./constants.js";
import { startOfMonth } from "./dates.js";

const GROUP_ALGEBRA = "group_demo_algebra_8a";
const GROUP_GEOMETRY = "group_demo_geometry_9b";
const MAYA = "student_demo_s001";
const LUCAS = "student_demo_s002";
const AVA = "student_demo_s003";

const BASE_SEED = {
  version: SCHEMA_VERSION,
  settings: { ...DEFAULT_SETTINGS },
  groups: [
    {
      id: GROUP_ALGEBRA,
      name: "Demo - Algebra 8A",
      grade: "8",
      subject: "Mathematics",
      schedule: "Mon / Wed 16:00",
      plannedSessionsPerMonth: 8,
      assistantContact: "Priya Shah | 555-2101",
      notes: "DEMO — fictional group",
    },
    {
      id: GROUP_GEOMETRY,
      name: "Demo - Geometry 9B",
      grade: "9",
      subject: "Mathematics",
      schedule: "Tue / Thu 17:00",
      plannedSessionsPerMonth: 8,
      assistantContact: "",
      notes: "DEMO — fictional group",
    },
  ],
  students: [
    {
      id: MAYA,
      code: "DEMO-S001",
      fullName: "Maya Torres",
      groupId: GROUP_ALGEBRA,
      phone: "555-0101",
      guardianContact: "Ana Torres | 555-1101 | ana.t@example.com",
      notes: "Front-row seating helps.",
      status: "Active",
    },
    {
      id: LUCAS,
      code: "DEMO-S002",
      fullName: "Lucas Bennett",
      groupId: GROUP_ALGEBRA,
      phone: "555-0102",
      guardianContact: "Jordan Bennett | 555-1102",
      notes: "Benefits from worked examples.",
      status: "Active",
    },
    {
      id: AVA,
      code: "DEMO-S003",
      fullName: "Ava Kim",
      groupId: GROUP_GEOMETRY,
      phone: "555-0103",
      guardianContact: "Min Kim | 555-1103",
      notes: "Strong visual reasoning.",
      status: "Active",
    },
    {
      id: "student_demo_s004",
      code: "DEMO-S004",
      fullName: "Liam Foster",
      groupId: GROUP_GEOMETRY,
      phone: "555-0104",
      guardianContact: "Taylor Foster | 555-1104",
      notes: "Inactive historical record.",
      status: "Inactive",
    },
  ],
  grades: [
    {
      id: "grade_demo_001",
      date: "2026-06-18",
      studentId: MAYA,
      assessment: "Linear Equations Quiz",
      category: "Quiz",
      score: 19,
      maxScore: 20,
      workStatus: "On time",
      feedback: "Accurate work; explain each transformation.",
    },
    {
      id: "grade_demo_002",
      date: "2026-06-18",
      studentId: LUCAS,
      assessment: "Linear Equations Quiz",
      category: "Quiz",
      score: 13,
      maxScore: 20,
      workStatus: "On time",
      feedback: "Check signs and show intermediate steps.",
    },
    {
      id: "grade_demo_003",
      date: "2026-06-20",
      studentId: AVA,
      assessment: "Angle Relationships Quiz",
      category: "Quiz",
      score: 18,
      maxScore: 20,
      workStatus: "On time",
      feedback: "Strong diagram reading; justify conclusions.",
    },
    {
      id: "grade_demo_004",
      date: "2026-07-02",
      studentId: MAYA,
      assessment: "Systems Project",
      category: "Project",
      score: 90,
      maxScore: 100,
      workStatus: "On time",
      feedback: "Strong model; state assumptions clearly.",
    },
    {
      id: "grade_demo_005",
      date: "2026-07-02",
      studentId: LUCAS,
      assessment: "Systems Project",
      category: "Project",
      score: null,
      maxScore: 100,
      workStatus: "Missing",
      feedback: "Submit the project and request feedback.",
    },
    {
      id: "grade_demo_006",
      date: "2026-07-07",
      studentId: AVA,
      assessment: "Proof Check",
      category: "Exam",
      score: 78,
      maxScore: 100,
      workStatus: "On time",
      feedback: "Good structure; support each claim.",
    },
  ],
  classLog: [
    {
      id: "class_demo_001",
      classDate: "2026-07-01",
      studentId: MAYA,
      classStatus: "Completed",
      attendance: "P",
      hours: 2,
      amountPaid: 100,
      paymentDate: "2026-07-01",
      paymentMethod: "Cash",
      paymentReference: "JUL-01",
      notes: "DEMO — paid",
    },
    {
      id: "class_demo_002",
      classDate: "2026-07-01",
      studentId: LUCAS,
      classStatus: "Completed",
      attendance: "L",
      hours: 2,
      amountPaid: 50,
      paymentDate: "2026-07-01",
      paymentMethod: "Cash",
      paymentReference: "JUL-01",
      notes: "DEMO — partial",
    },
    {
      id: "class_demo_003",
      classDate: "2026-07-02",
      studentId: AVA,
      classStatus: "Completed",
      attendance: "A",
      hours: 2,
      amountPaid: 0,
      paymentDate: null,
      paymentMethod: "",
      paymentReference: "JUL-02",
      notes: "DEMO — unpaid",
    },
    {
      id: "class_demo_004",
      classDate: "2026-07-06",
      studentId: MAYA,
      classStatus: "Completed",
      attendance: "P",
      hours: 2,
      amountPaid: 100,
      paymentDate: "2026-07-06",
      paymentMethod: "Transfer",
      paymentReference: "JUL-06",
      notes: "DEMO — paid",
    },
    {
      id: "class_demo_005",
      classDate: "2026-07-06",
      studentId: LUCAS,
      classStatus: "Completed",
      attendance: "A",
      hours: 2,
      amountPaid: 100,
      paymentDate: "2026-07-07",
      paymentMethod: "Transfer",
      paymentReference: "JUL-06",
      notes: "DEMO — paid",
    },
    {
      id: "class_demo_006",
      classDate: "2026-07-07",
      studentId: AVA,
      classStatus: "Completed",
      attendance: "P",
      hours: 3,
      amountPaid: 150,
      paymentDate: "2026-07-07",
      paymentMethod: "Cash",
      paymentReference: "JUL-07",
      notes: "DEMO — 3-hour class",
    },
    {
      id: "class_demo_007",
      classDate: "2026-07-08",
      studentId: MAYA,
      classStatus: "Completed",
      attendance: "E",
      hours: 2,
      amountPaid: 100,
      paymentDate: "2026-07-08",
      paymentMethod: "Cash",
      paymentReference: "JUL-08",
      notes: "DEMO — excused attendance",
    },
    {
      id: "class_demo_008",
      classDate: "2026-07-08",
      studentId: LUCAS,
      classStatus: "Completed",
      attendance: "P",
      hours: 2,
      amountPaid: 120,
      paymentDate: "2026-07-08",
      paymentMethod: "Cash",
      paymentReference: "JUL-08",
      notes: "DEMO — overpaid",
    },
    {
      id: "class_demo_009",
      classDate: "2026-07-09",
      studentId: AVA,
      classStatus: "Cancelled",
      attendance: null,
      hours: 2,
      amountPaid: 0,
      paymentDate: null,
      paymentMethod: "",
      paymentReference: "JUL-09",
      notes: "DEMO — cancelled",
    },
    {
      id: "class_demo_010",
      classDate: "2026-07-13",
      studentId: MAYA,
      classStatus: "Scheduled",
      attendance: null,
      hours: 2,
      amountPaid: 100,
      paymentDate: "2026-07-10",
      paymentMethod: "Transfer",
      paymentReference: "ADV-01",
      notes: "DEMO — advance 1 of 2",
    },
    {
      id: "class_demo_011",
      classDate: "2026-07-15",
      studentId: MAYA,
      classStatus: "Scheduled",
      attendance: null,
      hours: 2,
      amountPaid: 100,
      paymentDate: "2026-07-10",
      paymentMethod: "Transfer",
      paymentReference: "ADV-01",
      notes: "DEMO — advance 2 of 2",
    },
  ],
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export const seedState = deepFreeze(BASE_SEED);

/** Return a mutable, independent copy. Dates stay as YYYY-MM-DD strings. */
export function createSeedState(options = {}) {
  const result = clone(BASE_SEED);
  if (options.asOfDate) {
    result.settings.asOfDate = options.asOfDate;
    result.settings.selectedMonth = options.selectedMonth ?? startOfMonth(options.asOfDate);
  } else if (options.selectedMonth) {
    result.settings.selectedMonth = startOfMonth(options.selectedMonth);
  }
  return result;
}
