// Audit B2 (2026-11-13): two devices save the same class before either syncs. Real encryption and
// repositories against the synthetic RPC, as in tests/sync-audit.
import { describe, expect, it } from "vitest";
import { createClassLogRow, createGroup, createStarterState, createStudent, normalizeState } from "../domain/index.js";
import { twoDevices } from "../test/encryptedSyncServer.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";
import { describeOperation } from "./workspaceMerge.js";

const DATE = "2026-11-12";
const start = normalizeState({
  ...createStarterState({ settings: { asOfDate: "2026-11-13", hourlyRate: 100 } }),
  groups: [createGroup({ id: "g", name: "Grupo", hourlyRate: 100 })],
  students: ["ana", "beto"].map((id) => createStudent({ id, code: id, fullName: id, groupIds: ["g"] })),
});
const present = { attendance: "P", appliedCharge: 200, amountPaid: 0, paymentState: "Pending" };
const paid = { ...present, amountPaid: 200, paymentState: "Paid", paymentDate: DATE, paymentMethod: "Cash" };
const absent = { attendance: "A", appliedCharge: 0, amountPaid: 0, paymentState: "" };
const row = (id, studentId, marks) =>
  createClassLogRow({
    id,
    studentId,
    groupId: "g",
    classDate: DATE,
    startTime: "16:00",
    classTitle: "Grupo",
    hours: 2,
    appliedHourlyRate: 100,
    ...marks,
  });
const recorded = (state, prefix, marks) => ({
  ...state,
  classLog: [...state.classLog, row(`${prefix}-ana`, "ana", marks.ana), row(`${prefix}-beto`, "beto", marks.beto)],
});
const prepare = (d, repo, workspace, state, previousState) =>
  repo.prepareMutation({ state, previousState, workspace, session: d.session });
const submit = (d, repo, mutation) => repo.applyMutation(mutation, d.session, "owner");
const storedClassIds = (d) =>
  d
    .current()
    .envelopes.filter((item) => item.collection === "classLog")
    .map((item) => item.entityId)
    .sort();

describe("the same class saved on two devices before either syncs", () => {
  it("asks for a decision instead of storing a hidden second row, and keeping the tablet's marks updates the cloud's rows", async () => {
    const d = await twoDevices(start);
    const tablet = await prepare(d, d.first, d.firstBase, recorded(start, "tab", { ana: paid, beto: present }));
    const phone = await prepare(d, d.second, d.secondBase, recorded(start, "pho", { ana: present, beto: absent }));
    await submit(d, d.second, phone);

    const refused = await submit(d, d.first, tablet).catch((error) => error);
    expect(refused).toBeInstanceOf(WorkspaceConflictError);
    expect(refused.conflicts.map(({ entityId, kind, twinId }) => [entityId, kind, twinId])).toEqual([
      ["tab-ana", "duplicate", "pho-ana"],
      ["tab-beto", "duplicate", "pho-beto"],
    ]);
    expect(storedClassIds(d)).toEqual(["pho-ana", "pho-beto"]);

    // While it waits, the device shows its own marks on one row per student.
    const latest = await d.first.loadWorkspace(d.session, "owner");
    const projection = await d.first.projectPendingWorkspace(
      latest,
      [{ id: tablet.operationId, mutation: tablet, status: "conflict" }],
      d.session,
    );
    expect(projection.entries[0].needsReview).toBe(true);
    expect(projection.workspace.state.classLog.map(({ id, amountPaid }) => [id, amountPaid])).toEqual([
      ["pho-ana", 200],
      ["pho-beto", 0],
    ]);
    const review = describeOperation(tablet, latest.state);
    expect(review.changes.map(({ entityId, conflict, cloud }) => [entityId, conflict, cloud.id])).toEqual([
      ["tab-ana", "duplicate", "pho-ana"],
      ["tab-beto", "duplicate", "pho-beto"],
    ]);

    await submit(d, d.first, await d.first.resolveMutation(tablet, latest, d.session));
    const result = await d.second.loadWorkspace(d.session, "owner");
    expect(result.state.classLog).toEqual([
      expect.objectContaining({ id: "pho-ana", ...paid }),
      expect.objectContaining({ id: "pho-beto", ...present }),
    ]);
    expect(storedClassIds(d)).toEqual(["pho-ana", "pho-beto"]);
    expect(d.violations).toEqual([]);
  });

  it("syncs the same marks saved on both devices without review and without a second row", async () => {
    const d = await twoDevices(start);
    const marks = { ana: paid, beto: absent };
    const tablet = await prepare(d, d.first, d.firstBase, recorded(start, "tab", marks));
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, recorded(start, "pho", marks)));
    const result = await submit(d, d.first, tablet);
    expect(result.state.classLog.map(({ id }) => id)).toEqual(["pho-ana", "pho-beto"]);
    expect(storedClassIds(d)).toEqual(["pho-ana", "pho-beto"]);
  });

  it("does the same for a second tab of one device saving over a view that missed the first tab's save", async () => {
    const d = await twoDevices(start);
    const first = await submit(
      d,
      d.first,
      await prepare(d, d.first, d.firstBase, recorded(start, "a", { ana: paid, beto: present })),
    );
    // Same marks: the edit is already there.
    const same = await prepare(d, d.first, first, recorded(start, "b", { ana: paid, beto: present }), start);
    expect(same.empty).toBe(true);
    // Different marks: refused before it is queued, so the tab reloads and asks the person.
    await expect(
      prepare(d, d.first, first, recorded(start, "b", { ana: present, beto: absent }), start),
    ).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(storedClassIds(d)).toEqual(["a-ana", "a-beto"]);
  });
});
