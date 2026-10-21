import { describe, expect, it } from "vitest";
import {
  createClassLogRow,
  createClassSchedule,
  deriveAll,
  generateScheduledOccurrences,
  serializeState,
  importState,
} from "./index.js";
import { statisticsStateForGroups, setGroupArchived } from "./groupArchiving.js";
import { createGroupArchiveFixture } from "../test/groupArchiveFixture.js";
import { buildMetric } from "../features/homeDashboardModel.js";
import { trackingKpis, trackingRange, trackingSessions, trackingStudents } from "../features/trackingModel.js";
import { buildClassWorkspaceSessionsForRange } from "../features/classesWorkspaceModel.js";
import { mergeWorkspaceStates } from "../cloud/workspaceMerge.js";
import {
  decryptWorkspace,
  encryptWorkspace,
  generateAccountMasterKey,
  generateWorkspaceCryptoId,
} from "../crypto/workspaceCrypto.js";

const DATE = "2026-10-09";
const fixture = () => createGroupArchiveFixture(DATE);

describe("group archive preserves data and scopes all reports", () => {
  it("keeps an archive operation when another device edits a student", () => {
    const base = fixture();
    const local = setGroupArchived(base, "preview-algebra", true, DATE);
    const remote = structuredClone(base);
    remote.students[0].notes = "Edited on another device";
    const merged = mergeWorkspaceStates({ base, local, remote });
    expect(merged.state.groups[0].status).toBe("Inactive");
    expect(merged.state.students[0].notes).toBe("Edited on another device");
    expect(merged.state.classLog).toEqual(base.classLog);
  });
  it("includes inactive and former members in archived group statistics without reactivating them", () => {
    const original = fixture();
    original.students.find((student) => student.id === "preview-ana").groupIds = ["preview-algebra"];
    original.students.find((student) => student.id === "preview-elena").status = "Inactive";
    const derived = deriveAll(statisticsStateForGroups(original, true), DATE);
    const group = derived.groups.find((item) => item.id === "preview-geometria");
    expect(group.activeStudents).toBe(0);
    expect(group.studentCount).toBe(2);
    expect(group.attendance).toBe(0.5);
    expect(group.averageGrade).toBe(0.75);
    expect(derived.groups.find((item) => item.id === "preview-regularizacion").attendance).toBe(1);
    expect(original.students.find((student) => student.id === "preview-elena").status).toBe("Inactive");
  });
  it("loads existing encrypted groups as active and preserves new archive metadata after encryption", async () => {
    const legacy = fixture();
    legacy.groups.forEach((group) => {
      delete group.status;
      delete group.archivedAt;
      delete group.scheduleResumeDate;
    });
    const masterKey = generateAccountMasterKey();
    const workspaceCryptoId = generateWorkspaceCryptoId();
    const legacyEnvelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state: legacy });
    const decoded = await decryptWorkspace({ masterKey, workspaceCryptoId, envelopes: legacyEnvelopes });
    const normalized = importState(JSON.stringify(decoded.state));
    expect(normalized.groups.every((group) => group.status === "Active")).toBe(true);
    const archived = setGroupArchived(normalized, "preview-geometria", true, DATE);
    const envelopes = await encryptWorkspace({ masterKey, workspaceCryptoId, state: archived });
    const roundTrip = await decryptWorkspace({ masterKey, workspaceCryptoId, envelopes });
    expect(
      importState(JSON.stringify(roundTrip.state)).groups.find((group) => group.id === "preview-geometria"),
    ).toMatchObject({ status: "Inactive", archivedAt: DATE });
    expect(roundTrip.state.students).toEqual(legacy.students);
  });
  it("round-trips archival metadata and preserves every record and membership", () => {
    const original = fixture();
    const archived = setGroupArchived(original, "preview-algebra", true, DATE);
    expect(archived.students).toBe(original.students);
    expect(archived.classLog).toBe(original.classLog);
    expect(archived.grades).toBe(original.grades);
    const restoredBackup = importState(serializeState(archived));
    expect(restoredBackup.groups.find((group) => group.id === "preview-algebra")).toMatchObject({
      status: "Inactive",
      archivedAt: DATE,
    });
    const reactivated = setGroupArchived(restoredBackup, "preview-algebra", false, "2026-10-12");
    expect(reactivated.groups[0]).toMatchObject({ status: "Active", scheduleResumeDate: "2026-10-12" });
    expect(reactivated.students.find((student) => student.id === "preview-daniel").status).toBe("Inactive");
    expect(restoredBackup.classLog).toHaveLength(original.classLog.length);
  });

  it("filters by record owner while retaining a shared student's active-group history", () => {
    const original = fixture();
    const report = statisticsStateForGroups(original);
    expect(report.groups.map((group) => group.id)).toEqual(["preview-algebra", "preview-calculo"]);
    expect(report.classLog).toHaveLength(4);
    expect(report.grades).toHaveLength(4);
    expect(report.students.find((student) => student.id === "preview-ana").groupIds).toEqual(["preview-algebra"]);
    expect(report.students.some((student) => student.id === "preview-elena")).toBe(false);
    expect(original.students[0].groupIds).toEqual(["preview-algebra", "preview-geometria"]);
    expect(statisticsStateForGroups(original, true)).toBe(original);
  });

  it("retains independent classes even when the student's only group is archived", () => {
    const original = fixture();
    original.classLog.push(
      createClassLogRow({
        id: "independent",
        studentId: "preview-elena",
        classDate: DATE,
        startTime: "12:00",
        groupId: "",
        hours: 1,
        classStatus: "Completed",
        attendance: "P",
        amountPaid: 75,
        paymentDate: DATE,
        paymentMethod: "Cash",
      }),
    );
    const report = statisticsStateForGroups(original);
    expect(report.classLog.find((row) => row.id === "independent")).toBeDefined();
    expect(report.students.find((student) => student.id === "preview-elena").groupIds).toEqual([]);
  });

  it("recalculates Home, payments and attendance consistently when inclusion changes", () => {
    const original = fixture();
    const excluded = statisticsStateForGroups(original);
    const included = statisticsStateForGroups(original, true);
    const excludedDerived = deriveAll(excluded, DATE);
    const includedDerived = deriveAll(included, DATE);
    const collections = buildMetric(excluded, excludedDerived, DATE, "collections", "monthly");
    const collectionsIncluded = buildMetric(included, includedDerived, DATE, "collections", "monthly");
    expect(collections.value).toBe(350);
    expect(collectionsIncluded.value).toBe(600);
    const grade = buildMetric(excluded, excludedDerived, DATE, "grade", "monthly");
    const gradeIncluded = buildMetric(included, includedDerived, DATE, "grade", "monthly");
    expect(grade.value).toBeCloseTo(7.5);
    expect(gradeIncluded.value).toBeCloseTo(540 / 70);
    const range = trackingRange(DATE, "month");
    const kpis = trackingKpis(
      excluded,
      excludedDerived,
      range,
      "all",
      trackingStudents(excluded, excludedDerived, range),
    );
    const kpisIncluded = trackingKpis(
      included,
      includedDerived,
      range,
      "all",
      trackingStudents(included, includedDerived, range),
    );
    expect(kpis.payments.collected).toBe(350);
    expect(kpisIncluded.payments.collected).toBe(600);
    expect(trackingSessions(excluded, range).map((item) => item.groupId)).not.toContain("preview-geometria");
    expect(includedDerived.groups.find((group) => group.id === "preview-geometria").idealRevenue).toBe(0);
  });

  it("keeps archived schedules out of the agenda even when their statistics are included", () => {
    const original = fixture();
    original.classSchedules.push(
      createClassSchedule({
        id: "archived-one-off",
        format: "group",
        groupId: "preview-geometria",
        startDate: "2026-10-10",
        startTime: "18:00",
        recurrence: "once",
        durationHours: 1,
      }),
    );
    original.classLog.push(
      createClassLogRow({
        id: "future-paid",
        studentId: "preview-elena",
        groupId: "preview-geometria",
        classDate: "2026-10-10",
        startTime: "18:00",
        classStatus: "Scheduled",
        hours: 1,
        amountPaid: 100,
        paymentDate: DATE,
        paymentMethod: "Cash",
      }),
    );
    original.classLog.push(
      createClassLogRow({
        id: "future-completed",
        studentId: "preview-elena",
        groupId: "preview-geometria",
        classDate: "2026-10-10",
        startTime: "20:00",
        classStatus: "Completed",
        attendance: "P",
        hours: 1,
        amountPaid: 100,
        paymentDate: DATE,
        paymentMethod: "Cash",
      }),
    );
    const schedule = generateScheduledOccurrences(statisticsStateForGroups(original, true), DATE, "2026-10-20");
    expect(schedule.some((row) => row.groupId === "preview-geometria")).toBe(false);
    const agenda = buildClassWorkspaceSessionsForRange(original, DATE, "2026-10-20", DATE);
    expect(agenda.some((row) => row.groupId === "preview-geometria" && row.classDate > DATE)).toBe(false);
    expect(original.classLog.find((row) => row.id === "future-paid")).toBeDefined();
  });

  it("reactivates schedules from the chosen date without regenerating the archived interval", () => {
    const original = fixture();
    const reactivated = setGroupArchived(original, "preview-geometria", false, "2026-10-16");
    const schedule = generateScheduledOccurrences(reactivated, DATE, "2026-10-23").filter(
      (row) => row.groupId === "preview-geometria",
    );
    expect(schedule.map((row) => row.classDate)).toEqual(["2026-10-16", "2026-10-23"]);
  });
});
