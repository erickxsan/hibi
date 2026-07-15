import { describe, expect, it } from "vitest";
import { studentMatchesFilters } from "./studentFilters.js";

const groupOnly = { groupIds: ["a"], isIndividual: false };
const individualOnly = { groupIds: [], isIndividual: true };
const both = { groupIds: ["a", "b"], isIndividual: true };

describe("student combinable filters", () => {
  it("combines one or many groups using any/all matching", () => {
    expect(studentMatchesFilters(both, { groupIds: ["a", "c"], groupMatch: "any" })).toBe(true);
    expect(studentMatchesFilters(both, { groupIds: ["a", "b"], groupMatch: "all" })).toBe(true);
    expect(studentMatchesFilters(groupOnly, { groupIds: ["a", "b"], groupMatch: "all" })).toBe(false);
  });

  it("distinguishes individual, group, and combined enrollment", () => {
    expect(studentMatchesFilters(individualOnly, { enrollment: ["individual"] })).toBe(true);
    expect(studentMatchesFilters(groupOnly, { enrollment: ["group"] })).toBe(true);
    expect(studentMatchesFilters(both, { enrollment: ["both"] })).toBe(true);
    expect(studentMatchesFilters(both, { enrollment: ["individual", "group"] })).toBe(false);
  });
});
