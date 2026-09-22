import { describe, expect, it } from "vitest";
import { WorkspaceCryptoError } from "../crypto/index.js";
import { encryptedSyncFailure } from "./encryptedSyncErrors.js";
describe("encrypted sync failures", () => {
  it.each(["PT409", "40001"])("does not retry an application conflict as a network failure: %s", (code) => {
    expect(encryptedSyncFailure({ cause: { code, message: "workspace_revision_conflict" } }).status).toBe("conflict");
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
