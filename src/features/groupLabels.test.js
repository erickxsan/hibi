import { describe, expect, it } from "vitest";
import { archivedOnlyGroups } from "./groupLabels";

const groups = new Map([
  ["a", { id: "a", name: "Activo", status: "Active" }],
  ["x", { id: "x", name: "Archivado", status: "Inactive" }],
  ["y", { id: "y", name: "Archivado 2", status: "Inactive" }],
]);

describe("archivedOnlyGroups", () => {
  it("returns the archived groups of a student whose groups are all archived", () => {
    expect(archivedOnlyGroups({ groupIds: ["x", "y"] }, groups).map((group) => group.id)).toEqual(["x", "y"]);
    expect(archivedOnlyGroups({ groupId: "x" }, groups).map((group) => group.id)).toEqual(["x"]);
  });

  it("is empty when one group is active, the student is individual or has no known group", () => {
    expect(archivedOnlyGroups({ groupIds: ["x", "a"] }, groups)).toEqual([]);
    expect(archivedOnlyGroups({ groupIds: ["x"], isIndividual: true }, groups)).toEqual([]);
    expect(archivedOnlyGroups({ groupIds: [] }, groups)).toEqual([]);
    expect(archivedOnlyGroups({ groupIds: ["gone"] }, groups)).toEqual([]);
    expect(archivedOnlyGroups(null, groups)).toEqual([]);
  });
});
