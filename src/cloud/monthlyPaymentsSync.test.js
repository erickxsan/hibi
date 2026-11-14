// Audit B3 (2026-11-13, F4): two devices record a student's monthly fees before either syncs. Real
// encryption and repositories against the synthetic RPC, as in tests/sync-audit.
import { describe, expect, it, vi } from "vitest";
import { createStarterState, normalizeState } from "../domain/index.js";
import { monthlyPaymentsBetween, recordMonthlyPayment } from "../domain/monthlyBilling.js";
import { twoDevices } from "../test/encryptedSyncServer.js";
import { WorkspaceConflictError } from "./workspaceRepository.js";
import { describeOperation } from "./workspaceMerge.js";

const AS_OF = "2026-11-13";
const start = normalizeState({
  ...createStarterState({ settings: { asOfDate: AS_OF, hourlyRate: 100 } }),
  groups: [
    {
      id: "g",
      name: "Grupo",
      hourlyRate: 100,
      billing: { mode: "monthly", monthlyFee: 1000, due: { type: "dayOfMonth", day: 5 }, effectiveFrom: "2026-09" },
    },
  ],
  students: [{ id: "ana", code: "A", fullName: "Ana", status: "Active", groupIds: ["g"] }],
});

let tick = 0;
function pay(state, period, id, paidAt = AS_OF) {
  tick += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, tick)));
  return recordMonthlyPayment(state, { studentId: "ana", groupId: "g", period, paidAt, id });
}
const prepare = (d, repo, workspace, state) => repo.prepareMutation({ state, workspace, session: d.session });
const submit = (d, repo, mutation) => repo.applyMutation(mutation, d.session, "owner");
const receiptIds = (state) => (state.students[0].monthlyPayments || []).map(({ id }) => id);

describe("monthly fees recorded on two devices before either syncs", () => {
  it("F4: keeps both months without a review", async () => {
    const d = await twoDevices(start);
    const phone = await prepare(d, d.first, d.firstBase, pay(start, "2026-10", "phone-oct"));
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, pay(start, "2026-09", "tablet-sep")));
    const result = await submit(d, d.first, phone);
    expect(receiptIds(result.state)).toEqual(["tablet-sep", "phone-oct"]);
    expect(receiptIds((await d.second.loadWorkspace(d.session, "owner")).state)).toEqual(["tablet-sep", "phone-oct"]);
    expect(d.violations).toEqual([]);
  });

  it("asks once about a month paid on both, and keeping this device's receipt keeps the other device's month", async () => {
    const d = await twoDevices(start);
    const tablet = await prepare(d, d.first, d.firstBase, pay(start, "2026-10", "tablet-oct"));
    const phoneState = pay(pay(start, "2026-09", "phone-sep"), "2026-10", "phone-oct", "2026-11-12");
    await submit(d, d.second, await prepare(d, d.second, d.secondBase, phoneState));

    const refused = await submit(d, d.first, tablet).catch((error) => error);
    expect(refused).toBeInstanceOf(WorkspaceConflictError);
    expect(refused.conflicts).toEqual([
      {
        collection: "students",
        entityId: "ana",
        kind: "field",
        fields: ["monthlyPayments"],
        items: { monthlyPayments: ["g|2026-10"] },
      },
    ]);

    // While it waits, this device shows its October and the phone's September, never both Octobers.
    const latest = await d.first.loadWorkspace(d.session, "owner");
    const projection = await d.first.projectPendingWorkspace(
      latest,
      [{ id: tablet.operationId, mutation: tablet, status: "conflict" }],
      d.session,
    );
    expect(projection.entries[0].needsReview).toBe(true);
    expect(receiptIds(projection.workspace.state)).toEqual(["phone-sep", "tablet-oct"]);
    const row = describeOperation(tablet, latest.state).changes[0].fields.find(
      ({ field }) => field === "monthlyPayments",
    );
    expect([row.local.map(({ id }) => id), row.cloud.map(({ id }) => id), row.conflict]).toEqual([
      ["tablet-oct"],
      ["phone-oct"],
      true,
    ]);

    await submit(d, d.first, await d.first.resolveMutation(tablet, latest, d.session));
    const cloud = (await d.second.loadWorkspace(d.session, "owner")).state;
    expect(receiptIds(cloud)).toEqual(["phone-sep", "tablet-oct"]);
    expect(monthlyPaymentsBetween(cloud, "2026-11-01", "2026-11-30").reduce((sum, { amount }) => sum + amount, 0)).toBe(
      2000,
    );
    expect(d.violations).toEqual([]);
  });
});
