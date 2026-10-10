// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AccountDeletionRecovery } from "./AccountDeletionRecovery.jsx";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), purge: vi.fn(), clear: vi.fn(), signOut: vi.fn() }));
vi.mock("./accountDeletion.js", () => ({
  accountDeletionService: { reconcile: mocks.reconcile, clearPending: mocks.clear },
  purgeLocalAccountData: mocks.purge,
}));
vi.mock("./client.js", () => ({ cloudAuth: { signOut: mocks.signOut } }));
vi.mock("./CloudStates.jsx", () => ({ AccountDeletionPending: ({ error }) => <div>{error}</div> }));
const receipt = {
  ownerId: "deleted-owner",
  requestId: "receipt",
  receiptSecret: "secret",
  status: "completed",
  verified: true,
};
beforeEach(() => {
  mocks.reconcile.mockReset().mockResolvedValue(receipt);
  mocks.purge.mockReset().mockResolvedValue(undefined);
  mocks.clear.mockReset();
  mocks.signOut.mockReset().mockResolvedValue(undefined);
});

describe("deletion recovery before workspace bootstrap", () => {
  it("reconciles and purges the durable owner's copies without an Auth or encryption session", async () => {
    const completed = vi.fn();
    render(<AccountDeletionRecovery onDeletionCompleted={completed} />);
    await waitFor(() => expect(completed).toHaveBeenCalledWith({ ...receipt, localPurgeComplete: true }));
    expect(mocks.purge).toHaveBeenCalledWith("deleted-owner");
    expect(mocks.clear).toHaveBeenCalledWith(receipt);
    expect(mocks.purge.mock.invocationCallOrder[0]).toBeLessThan(mocks.clear.mock.invocationCallOrder[0]);
  });
  it("retains the receipt after local cleanup fails so another reload can retry it", async () => {
    mocks.purge.mockRejectedValue(new Error("IndexedDB blocked"));
    const completed = vi.fn();
    render(<AccountDeletionRecovery onDeletionCompleted={completed} />);
    await waitFor(() => expect(completed).toHaveBeenCalledWith({ ...receipt, localPurgeComplete: false }));
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
