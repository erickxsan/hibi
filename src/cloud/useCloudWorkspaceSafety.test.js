import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./useCloudWorkspace.js", import.meta.url), "utf8");

describe("cloud workspace device recovery", () => {
  it("captures the previous workspace before ordinary saves and replacements", () => {
    expect(source).toContain('captureDeviceCopy(previous.state, previous.revision, "before-save"');
    expect(source).toContain('captureDeviceCopy(previous.state, previous.revision, "before-replace"');
    expect(source).not.toContain('captureDeviceCopy(state, revisionRef.current, "pending-save"');
  });
});
