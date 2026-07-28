import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/migrations/202607270001_additive_workspace_imports.sql", import.meta.url),
  "utf8",
);

describe("additive workspace import schema", () => {
  it("keeps an owner-bound, idempotent audit history", () => {
    expect(migration).toContain("create table if not exists public.workspace_import_jobs");
    expect(migration).toContain("workspace_import_jobs_owner_file_hash_unique");
    expect(migration).toContain("workspace_import_jobs_select_own");
    expect(migration).toContain("foreign key (owner_id) references auth.users(id) on delete restrict");
    expect(migration).toContain("grant select on table public.workspace_import_jobs to authenticated");
    expect(migration).not.toContain("grant insert on table public.workspace_import_jobs to authenticated");
    expect(migration).not.toContain("grant update on table public.workspace_import_jobs to authenticated");
    expect(migration).not.toContain("grant delete on table public.workspace_import_jobs to authenticated");
  });

  it("requires revision, confirmation, snapshots, and stable-ID preservation", () => {
    expect(migration).toContain("create or replace function public.apply_workspace_import");
    expect(migration).toContain("workspace_revision_conflict");
    expect(migration).toContain("workspace_import_not_confirmed");
    expect(migration).toContain("workspace_import_would_remove_records");
    expect(migration).toContain("private.archive_workspace_snapshot(v_owner_id, v_current_state, v_current_revision, 'import')");
    expect(migration).toContain("for update");
    expect(migration).toContain("set statement_timeout = '5s'");
  });
});
