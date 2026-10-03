import { describe, expect, it } from "vitest";
import { WorkspaceCryptoError } from "../crypto/index.js";
import { encryptedSyncFailure } from "./encryptedSyncErrors.js";
describe("encrypted sync failures", () => {
  it.each(["PT409", "40001"])("retries revision contention instead of asking for a decision: %s", (code) => {
    expect(encryptedSyncFailure({ cause: { code, message: "workspace_revision_conflict" } })).toMatchObject({
      status: "pending",
      message: expect.stringContaining("retry automatically"),
    });
    expect(encryptedSyncFailure(Object.assign(new Error("Busy"), { code: "workspace_contention" })).status).toBe(
      "pending",
    );
  });
  it("reserves review for content conflicts and refuses oversized changes clearly", () => {
    expect(encryptedSyncFailure({ latestState: {} }).status).toBe("conflict");
    expect(encryptedSyncFailure(Object.assign(new Error("Too many"), { code: "mutation_too_large" })).status).toBe(
      "error",
    );
  });
  it("distinguishes transient network failures from crypto and limits", () => {
    expect(encryptedSyncFailure(new TypeError("Failed to fetch")).status).toBe("pending");
    expect(encryptedSyncFailure(new WorkspaceCryptoError("Bad MAC"))).toMatchObject({
      status: "error",
      message: expect.stringContaining("verified"),
    });
    expect(encryptedSyncFailure(Object.assign(new Error("Full"), { code: "outbox_limit" }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("limit"),
    });
  });
});
