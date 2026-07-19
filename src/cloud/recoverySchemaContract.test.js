import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202607190001_workspace_recovery_snapshots.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("workspace recovery schema", () => {
  it("archives owner-bound workspace revisions before save, reset, and restore", () => {
    expect(migration).toContain("create table public.workspace_recovery_snapshots");
    expect(migration).toContain("workspace_recovery_snapshots_select_own");
    expect(migration).toContain("perform private.archive_workspace_snapshot");
    expect(migration).toContain("workspace_mass_delete_blocked");
    expect(migration).toContain("function public.restore_workspace_snapshot");
  });

  it("does not grant authenticated clients direct snapshot writes", () => {
    expect(migration).toContain("revoke all on table public.workspace_recovery_snapshots");
    expect(migration).toContain("grant select on table public.workspace_recovery_snapshots to authenticated");
    expect(migration).not.toContain("grant insert on table public.workspace_recovery_snapshots to authenticated");
    expect(migration).not.toContain("grant update on table public.workspace_recovery_snapshots to authenticated");
    expect(migration).not.toContain("grant delete on table public.workspace_recovery_snapshots to authenticated");
  });
});
