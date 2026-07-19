import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202607190002_data_integrity_hardening.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("data-integrity migration", () => {
  it("separates ordinary saves from archived replacements", () => {
    expect(migration).toContain("workspace_collection_delete_blocked");
    expect(migration).toContain("workspace_large_delete_blocked");
    expect(migration).toContain("function public.replace_workspace_state");
    expect(migration).toContain("workspace_replacement_not_confirmed");
    expect(migration).toContain("'replace'");
  });

  it("revokes the destructive reset RPC from browser accounts", () => {
    expect(migration).toContain("revoke all on function public.reset_workspace_state(uuid)");
    expect(migration).not.toContain("grant execute on function public.reset_workspace_state(uuid)");
  });

  it("bounds snapshot history and rejects populated-to-empty replacement", () => {
    expect(migration).toContain("offset 20");
    expect(migration).toContain("empty_workspace_replacement_blocked");
  });

  it("blocks accidental Auth-user cascade deletion", () => {
    expect(migration).toContain("references auth.users(id) on delete restrict");
    expect(migration).toContain("workspaces_owner_id_fkey");
    expect(migration).toContain("workspace_recovery_snapshots_owner_id_fkey");
  });

  it("blocks direct table mutations even for privileged maintenance clients", () => {
    expect(migration).toContain("function private.guard_workspace_update");
    expect(migration).toContain("direct_workspace_update_blocked");
    expect(migration).toContain("hibi.workspace_write_authorized");
  });
});
