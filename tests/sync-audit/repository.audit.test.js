// Regression tests for the 2026-10-03 synchronization audit (S01, S02, S03,
// S05, S06, S09). Real encryption and repositories against the synthetic RPC.
import { describe, expect, it } from "vitest";
import { createStarterState, createClassLogRow } from "../../src/domain/index.js";
import { decryptEntity } from "../../src/crypto/index.js";
import { WorkspaceConflictError } from "../../src/cloud/workspaceRepository.js";
import { encryptedSyncFailure } from "../../src/cloud/encryptedSyncErrors.js";
import { describeOperation } from "../../src/cloud/workspaceMerge.js";
import { twoDevices, student } from "./fixture.js";

const withStudents = (...ids) => ({ ...createStarterState(), students: (ids.length ? ids : ["a", "b"]).map(student) });
const editStudent = (state, id, changes) => ({
  ...state,
  students: state.students.map((s) => (s.id === id ? { ...s, ...changes } : s)),
});
const prepare = (d, repo, workspace, state) => repo.prepareMutation({ state, workspace, session: d.session });
const submit = (d, repo, mutation) => repo.applyMutation(mutation, d.session, "owner");
const optimistic = (d, repo, workspace, mutation) => repo.optimisticWorkspace(workspace, mutation, d.session);

describe("sync audit regressions: repository", () => {
  it("S01: deleting one class does not rewrite the others, so a parallel payment survives", async () => {
    const state = {
      ...withStudents(),
      classLog: [
        createClassLogRow({ id: "c-a", studentId: "a", classDate: "2026-10-01", hours: 1, appliedCharge: 100 }),
        createClassLogRow({ id: "c-b", studentId: "b", classDate: "2026-10-01", hours: 1, appliedCharge: 100 }),
      ],
    };
    for (const paymentFirst of [true, false]) {
      const d = await twoDevices(state);
      const deletion = await prepare(d, d.first, d.firstBase, { ...state, classLog: [state.classLog[1]] });
      expect(deletion.deletes.map((i) => i.entityId)).toEqual(["c-a"]);
      expect(deletion.upserts).toEqual([]);
      const payment = await prepare(d, d.second, d.secondBase, {
        ...state,
        classLog: [state.classLog[0], { ...state.classLog[1], amountPaid: 100, paymentState: "Paid" }],
      });
      if (paymentFirst) await submit(d, d.second, payment);
      await submit(d, d.first, deletion);
      if (!paymentFirst) await submit(d, d.second, payment);
      const result = await d.first.loadWorkspace(d.session, "owner");
      expect(result.state.classLog.map((row) => [row.id, row.amountPaid, row.paymentState])).toEqual([
        ["c-b", 100, "Paid"],
      ]);
      expect(d.violations).toEqual([]);
    }
  });

  it("S02: edits of different fields of one record combine without review", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const local = await prepare(d, d.first, d.firstBase, editStudent(state, "a", { notes: "Local note" }));
    const remote = await prepare(d, d.second, d.secondBase, editStudent(state, "a", { phone: "5551234567" }));
    await submit(d, d.second, remote);
    const result = await submit(d, d.first, local);
    expect(result.state.students[0]).toMatchObject({ notes: "Local note", phone: "5551234567" });
    expect(result.revision).toBe(3);
  });

  it("S02: keeping a local value over a contradicting cloud value shows it first and overwrites only that field", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const local = await prepare(
      d,
      d.first,
      d.firstBase,
      editStudent(state, "a", { notes: "Local note", guardianContact: "Local guardian" }),
    );
    await submit(
      d,
      d.second,
      await prepare(d, d.second, d.secondBase, editStudent(state, "a", { notes: "Cloud note", phone: "5550000000" })),
    );
    await expect(submit(d, d.first, local)).rejects.toBeInstanceOf(WorkspaceConflictError);
    const latest = await d.first.loadWorkspace(d.session, "owner");
    const review = describeOperation(local, latest.state);
    const notes = review.changes[0].fields.find((field) => field.field === "notes");
    expect(notes).toMatchObject({ before: "", local: "Local note", cloud: "Cloud note", conflict: true });
    const guardian = review.changes[0].fields.find((field) => field.field === "guardianContact");
    expect(guardian.conflict).toBe(false);
    const result = await submit(d, d.first, await d.first.resolveMutation(local, latest, d.session));
    expect(result.state.students[0]).toMatchObject({
      notes: "Local note",
      guardianContact: "Local guardian",
      phone: "5550000000",
    });
  });

  it("S02b: an identical value saved on both devices is already satisfied", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const next = editStudent(state, "a", { notes: "Same value" });
    const first = await prepare(d, d.first, d.firstBase, next);
    const second = await prepare(d, d.second, d.secondBase, next);
    await submit(d, d.first, first);
    const result = await submit(d, d.second, second);
    expect(result.state.students[0].notes).toBe("Same value");
    expect(result.revision).toBe(2);
  });

  it("S03: one keep-local decision resolves the compatible chain of later offline edits", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const localOne = editStudent(state, "a", { notes: "First local" });
    const first = await prepare(d, d.first, d.firstBase, localOne);
    const second = await prepare(
      d,
      d.first,
      optimistic(d, d.first, d.firstBase, first),
      editStudent(localOne, "a", { notes: "Second local" }),
    );
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, editStudent(state, "a", { notes: "Remote" })));
    await expect(submit(d, d.first, first)).rejects.toBeInstanceOf(WorkspaceConflictError);
    const latest = await d.first.loadWorkspace(d.session, "owner");
    await submit(d, d.first, await d.first.resolveMutation(first, latest, d.session));
    const result = await submit(d, d.first, second);
    expect(result.state.students[0].notes).toBe("Second local");
  });

  it("S03b: discarding an earlier operation never resurrects its value through a later edit", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const localOne = editStudent(state, "a", { phone: "LOCAL-DISCARDED" });
    const first = await prepare(d, d.first, d.firstBase, localOne);
    const second = await prepare(
      d,
      d.first,
      optimistic(d, d.first, d.firstBase, first),
      editStudent(localOne, "a", { notes: "Later note" }),
    );
    await submit(
      d,
      d.second,
      await prepare(d, d.second, d.secondBase, editStudent(state, "a", { phone: "REMOTE-KEPT" })),
    );
    const remoteBase = await d.second.loadWorkspace(d.session, "owner");
    await submit(
      d,
      d.second,
      await prepare(d, d.second, remoteBase, editStudent(remoteBase.state, "b", { notes: "Independent later edit" })),
    );
    // The person discards `first`; `second` is submitted with only its own field.
    const result = await submit(d, d.first, second);
    expect(result.state.students[0]).toMatchObject({ notes: "Later note", phone: "REMOTE-KEPT" });
    expect(result.state.students[1].notes).toBe("Independent later edit");
  });

  it("S09: an equal revision number with another root asks for a content decision, not a manifest error", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const localOne = editStudent(state, "a", { notes: "First local" });
    const first = await prepare(d, d.first, d.firstBase, localOne);
    const second = await prepare(
      d,
      d.first,
      optimistic(d, d.first, d.firstBase, first),
      editStudent(localOne, "a", { notes: "Second local" }),
    );
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, editStudent(state, "a", { notes: "Remote" })));
    const latest = await d.first.loadWorkspace(d.session, "owner");
    expect(second.baseRevision).toBe(latest.revision);
    expect(second.baseRoot).not.toBe(latest.manifest.root);
    const error = await submit(d, d.first, second).catch((caught) => caught);
    expect(error).toBeInstanceOf(WorkspaceConflictError);
    expect(encryptedSyncFailure(error).status).toBe("conflict");
  });

  it("S09: the same stale root merges automatically when the fields do not contradict", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const localOne = editStudent(state, "a", { notes: "First local" });
    const first = await prepare(d, d.first, d.firstBase, localOne);
    const second = await prepare(
      d,
      d.first,
      optimistic(d, d.first, d.firstBase, first),
      editStudent(localOne, "a", { guardianContact: "Second local" }),
    );
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, editStudent(state, "a", { phone: "Remote" })));
    await d.first.loadWorkspace(d.session, "owner");
    const result = await submit(d, d.first, second);
    expect(result.state.students[0]).toMatchObject({ phone: "Remote", guardianContact: "Second local", notes: "" });
  });

  it("S09: an altered manifest on a matching base remains a blocking error", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const mutation = await prepare(d, d.first, d.firstBase, editStudent(state, "a", { notes: "Edit" }));
    const tampered = {
      ...mutation,
      manifest: { ...mutation.manifest, entityCount: mutation.manifest.entityCount + 1 },
    };
    const error = await submit(d, d.first, tampered).catch((caught) => caught);
    expect(error).not.toBeInstanceOf(WorkspaceConflictError);
    expect(error.message).toContain("invalid_workspace_manifest");
    expect(encryptedSyncFailure(error).status).toBe("error");
  });

  it("S05: independent edits from three devices save automatically despite repeated revision collisions", async () => {
    const state = withStudents("a", "b", "c");
    const d = await twoDevices(state);
    const third = d.device();
    const first = await prepare(d, d.first, d.firstBase, editStudent(state, "a", { notes: "A" }));
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, editStudent(state, "b", { notes: "B" })));
    const realRpc = d.client.rpc.getMockImplementation();
    let applyCalls = 0;
    d.client.rpc.mockImplementation(async (name, args) => {
      if (
        name === "apply_encrypted_workspace_mutation" &&
        args.p_operation_id === first.operationId &&
        ++applyCalls === 2
      ) {
        const latest = await third.loadWorkspace(d.session, "owner");
        await submit(d, third, await prepare(d, third, latest, editStudent(latest.state, "c", { notes: "C" })));
      }
      return realRpc(name, args);
    });
    const result = await submit(d, d.first, first);
    expect(applyCalls).toBe(3);
    expect(result.state.students.map((s) => s.notes)).toEqual(["A", "B", "C"]);
    expect(d.violations).toEqual([]);
  });

  it("S05: endless contention is reported as an automatic retry, never as a decision", async () => {
    const state = withStudents("a", "b");
    const d = await twoDevices(state);
    const third = d.device();
    const first = await prepare(d, d.first, d.firstBase, editStudent(state, "a", { notes: "A" }));
    const realRpc = d.client.rpc.getMockImplementation();
    let writes = 0;
    d.client.rpc.mockImplementation(async (name, args) => {
      if (name === "apply_encrypted_workspace_mutation" && args.p_operation_id === first.operationId) {
        const latest = await third.loadWorkspace(d.session, "owner");
        writes += 1;
        await submit(
          d,
          third,
          await prepare(d, third, latest, editStudent(latest.state, "b", { notes: `B${writes}` })),
        );
      }
      return realRpc(name, args);
    });
    const error = await submit(d, d.first, first).catch((caught) => caught);
    expect(error.code).toBe("workspace_contention");
    expect(error).not.toBeInstanceOf(WorkspaceConflictError);
    expect(encryptedSyncFailure(error).status).toBe("pending");
  });

  it("S06: deleting the first of 501 records is one change and syncs", async () => {
    const state = { ...createStarterState(), students: Array.from({ length: 501 }, (_, i) => student(`s-${i}`)) };
    const d = await twoDevices(state);
    const deletion = await prepare(d, d.first, d.firstBase, { ...state, students: state.students.slice(1) });
    expect(deletion.upserts).toHaveLength(0);
    expect(deletion.deletes).toHaveLength(1);
    const result = await submit(d, d.first, deletion);
    expect(result.state.students).toHaveLength(500);
    // Gaps are valid sort keys: a reload keeps the order without repairs.
    const reloaded = await d.second.loadWorkspace(d.session, "owner");
    expect(reloaded.state.students.map((s) => s.id)).toEqual(state.students.slice(1).map((s) => s.id));
    expect(reloaded.orderingRepairs).toEqual([]);
    // An append after the gap gets a key after the last record.
    const appended = await prepare(d, d.second, reloaded, {
      ...reloaded.state,
      students: [...reloaded.state.students, student("new")],
    });
    expect(appended.upserts).toHaveLength(1);
    const { position } = await decryptEntity({ ...d.session, envelope: appended.upserts[0] });
    expect(position).toBe(501);
  });

  it("S06: a change over the server limit is refused before it is queued", async () => {
    const state = { ...createStarterState(), students: Array.from({ length: 501 }, (_, i) => student(`s-${i}`)) };
    const d = await twoDevices(state);
    const error = await prepare(d, d.first, d.firstBase, {
      ...state,
      students: state.students.map((s) => ({ ...s, notes: "Bulk" })),
    }).catch((caught) => caught);
    expect(error.code).toBe("mutation_too_large");
    expect(d.client.rpc.mock.calls.filter(([name]) => name === "apply_encrypted_workspace_mutation")).toHaveLength(0);
  });

  it("keeps the restore barrier: edits prepared before a restore still need a decision", async () => {
    const state = withStudents();
    const d = await twoDevices(state);
    const local = await prepare(d, d.first, d.firstBase, editStudent(state, "a", { notes: "Offline note" }));
    await d.second.replaceWorkspace(editStudent(state, "b", { notes: "Restored" }), d.session, "owner", "restore");
    const error = await submit(d, d.first, local).catch((caught) => caught);
    expect(error).toBeInstanceOf(WorkspaceConflictError);
    expect(error.reason).toBe("replacement");
  });
});
