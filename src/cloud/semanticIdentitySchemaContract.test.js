import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202608120007_semantic_entity_identity.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("semantic entity identity migration", () => {
  it("projects class time and grade session identity into typed columns", () => {
    expect(migration).toContain("add column start_time time without time zone");
    expect(migration).toContain("add column class_session_key text");
    expect(migration).toContain("new.start_time := nullif(new.data ->> 'starttime', '')::time");
    expect(migration).toContain("new.class_session_key := private.normalized_class_session_key");
  });

  it("enforces one class and one session grade per semantic identity", () => {
    expect(migration).toContain("set constraints all immediate");
    expect(migration).toContain("class_records_owner_student_session_unique");
    expect(migration).toContain("(owner_id, student_id, class_date, start_time)");
    expect(migration).toContain("grades_owner_student_session_unique");
    expect(migration).toContain("(owner_id, student_id, class_session_key)");
  });

  it("archives and removes legacy duplicates before enabling uniqueness", () => {
    expect(migration).toContain("semantic_duplicate_owners");
    expect(migration).toContain("private.archive_workspace_snapshot");
    expect(migration).toContain("duplicate_rank > 1");
    expect(migration.indexOf("duplicate_rank > 1")).toBeLessThan(
      migration.indexOf("create unique index class_records_owner_student_session_unique"),
    );
  });

  it("maps semantic unique collisions to the existing recoverable conflict", () => {
    expect(migration).toContain("exception when unique_violation");
    expect(migration).toContain("message = 'workspace_entity_conflict'");
    expect(migration).toContain("errcode = '40001'");
  });
});
