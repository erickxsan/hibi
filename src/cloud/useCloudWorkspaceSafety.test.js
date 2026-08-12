import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./useCloudWorkspace.js", import.meta.url), "utf8");

describe("cloud workspace device recovery", () => {
  it("stages ordinary edits durably before applying their optimistic state", () => {
    const staged = source.indexOf("await deviceRecoveryStore.stageMutation");
    const applied = source.indexOf("applyWorkspace(optimistic)");
    expect(staged).toBeGreaterThan(0);
    expect(applied).toBeGreaterThan(staged);
    expect(source).toContain('captureDeviceCopy(previous.state, previous.revision, "before-replace"');
  });
});
