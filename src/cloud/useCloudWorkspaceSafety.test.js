import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./useCloudWorkspace.js", import.meta.url), "utf8");

describe("cloud workspace device recovery", () => {
  it("reserves full device copies for explicit recovery boundaries", () => {
    expect(source).not.toContain('captureDeviceCopy(previous.state, previous.revision, "before-save"');
    expect(source).not.toContain('captureDeviceCopy(saved.state, saved.revision, "cloud-save"');
    expect(source).toContain('captureDeviceCopy(previous.state, previous.revision, "before-replace"');
  });
});
