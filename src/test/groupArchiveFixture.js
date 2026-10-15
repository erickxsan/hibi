import {
  addDays,
  createClassLogRow,
  createGrade,
  createGroup,
  createStarterState,
  createStudent,
  startOfMonth,
  todayDateOnly,
} from "../domain";

export function createGroupArchiveFixture(today = todayDateOnly()) {
  const state = createStarterState({
    settings: {
      onboardingVersion: 2,
      onboardingStep: 9,
      hourlyRate: 100,
      defaultClassHours: 1,
      asOfDate: today,
      selectedMonth: startOfMonth(today),
    },
  });
  state.groups = [
    createGroup({
      id: "preview-algebra",
      name: "Álgebra · Grupo A",
      subject: "Matemáticas",
      grade: "Secundaria",
      hourlyRate: 100,
      weeklySchedule: [{ id: "algebra-slot", dayOfWeek: 1, startTime: "16:00", durationHours: 1 }],
      notes: "Grupo activo para probar el archivo.",
    }),
    createGroup({
      id: "preview-calculo",
      name: "Cálculo · Grupo B",
      subject: "Matemáticas",
      grade: "Bachillerato",
      hourlyRate: 100,
      weeklySchedule: [{ id: "calculo-slot", dayOfWeek: 3, startTime: "17:00", durationHours: 1 }],
    }),
    createGroup({
      id: "preview-geometria",
      name: "Geometría · Verano",
      subject: "Geometría",
      grade: "Secundaria",
      hourlyRate: 100,
      status: "Inactive",
      archivedAt: today,
      weeklySchedule: [{ id: "geometria-slot", dayOfWeek: 5, startTime: "18:00", durationHours: 1 }],
      notes: "Historial conservado. Ana también pertenece a Álgebra.",
    }),
    createGroup({
      id: "preview-regularizacion",
      name: "Regularización · Junio",
      subject: "Matemáticas",
      grade: "Secundaria",
      hourlyRate: 100,
      status: "Inactive",
      archivedAt: addDays(today, -1),
      weeklySchedule: [{ id: "regularizacion-slot", dayOfWeek: 6, startTime: "10:00", durationHours: 1 }],
    }),
  ];
  state.students = [
    createStudent({
      id: "preview-ana",
      code: "PRUEBA-01",
      fullName: "Ana Rivera",
      avatarId: "cat",
      groupIds: ["preview-algebra", "preview-geometria"],
    }),
    createStudent({
      id: "preview-luis",
      code: "PRUEBA-02",
      fullName: "Luis Pérez",
      avatarId: "dog",
      groupIds: ["preview-algebra"],
    }),
    createStudent({
      id: "preview-sofia",
      code: "PRUEBA-03",
      fullName: "Sofía Cruz",
      avatarId: "fox",
      groupIds: ["preview-calculo"],
    }),
    createStudent({
      id: "preview-mateo",
      code: "PRUEBA-04",
      fullName: "Mateo López",
      avatarId: "bear",
      groupIds: ["preview-calculo"],
    }),
    createStudent({
      id: "preview-elena",
      code: "PRUEBA-05",
      fullName: "Elena Ruiz",
      avatarId: "rabbit",
      groupIds: ["preview-geometria"],
    }),
    createStudent({
      id: "preview-daniel",
      code: "PRUEBA-06",
      fullName: "Daniel Díaz",
      avatarId: "owl",
      groupIds: ["preview-regularizacion"],
      status: "Inactive",
    }),
  ];
  /** @type {[string, string, string, string, number, number][]} */
  const samples = [
    ["preview-ana", "preview-algebra", "16:00", "P", 100, 8],
    ["preview-luis", "preview-algebra", "16:00", "P", 50, 7],
    ["preview-sofia", "preview-calculo", "17:00", "P", 100, 9],
    ["preview-mateo", "preview-calculo", "17:00", "A", 100, 6],
    ["preview-ana", "preview-geometria", "18:00", "A", 100, 5],
    ["preview-elena", "preview-geometria", "18:00", "P", 50, 10],
    ["preview-daniel", "preview-regularizacion", "10:00", "P", 100, 9],
  ];
  state.classLog = samples.map(([studentId, groupId, startTime, attendance, paid], index) =>
    createClassLogRow({
      id: "preview-log-" + index,
      classDate: today,
      studentId,
      groupId,
      startTime,
      classTitle: "Clase de ejemplo",
      classStatus: "Completed",
      attendance,
      hours: 1,
      appliedHourlyRate: 100,
      appliedCharge: 100,
      amountPaid: paid,
      paymentState: paid === 100 ? "Paid" : "Pending",
      paymentDate: today,
      paymentMethod: "Cash",
    }),
  );
  state.grades = samples.map(([studentId, groupId, startTime, _attendance, _paid, score], index) =>
    createGrade({
      id: "preview-grade-" + index,
      date: today,
      studentId,
      assessment: "Ejercicio de ejemplo",
      category: "Quiz",
      score,
      maxScore: 10,
      workStatus: "On time",
      classSessionKey: today + "|g:" + groupId + "|" + startTime,
    }),
  );
  return state;
}
