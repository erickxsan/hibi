import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAVE_WORKSPACE_RPC, WORKSPACES_TABLE } from "./workspaceRepository.js";

const migration = readFileSync(
  new URL("../../supabase/migrations/202607110001_initial_multi_account_workspaces.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("Supabase schema contract", () => {
  it("matches the table and revision RPC used by the browser client", () => {
    expect(WORKSPACES_TABLE).toBe("workspaces");
    expect(SAVE_WORKSPACE_RPC).toBe("save_workspace_state");
    expect(migration).toContain("create table public.workspaces");
    expect(migration).toContain("function public.save_workspace_state");
    expect(migration).toContain("p_expected_owner_id uuid");
    expect(migration).toContain("p_expected_revision bigint");
    expect(migration).toContain("p_state jsonb");
    expect(migration).toContain("function public.reset_workspace_state");
    expect(migration).toContain("state ->> 'version' = '1'");
    expect(migration).toContain("jsonb_typeof(state -> 'settings' -> 'currency') = 'string'");
    expect(migration).toContain("jsonb_typeof(state -> 'settings' -> 'selectedmonth') = 'string'");
    expect(migration).toContain("jsonb_typeof(state -> 'settings' -> 'asofdate') = 'string'");
    expect(migration).toContain("octet_length(state::text) <= 5242880");
  });

  it("enforces authenticated owner isolation and denies direct browser writes", () => {
    expect(migration).toContain("alter table public.workspaces enable row level security");
    expect(migration).toContain("alter table public.workspaces force row level security");
    expect(migration).toContain("owner_id = (select auth.uid())");
    expect(migration).toContain("revoke all on table public.workspaces from public, anon, authenticated");
    expect(migration).toContain("grant select on table public.workspaces to authenticated");
    expect(migration).not.toContain("grant insert on table public.workspaces to authenticated");
    expect(migration).not.toContain("grant update on table public.workspaces to authenticated");
  });

  it("keeps saves account-bound, revision-aware, and unavailable to anonymous clients", () => {
    expect(migration).toContain("v_owner_id uuid := (select auth.uid())");
    expect(migration).toContain("p_expected_owner_id <> v_owner_id");
    expect(migration).toContain("workspace.owner_id = v_owner_id");
    expect(migration).toContain("workspace.revision = p_expected_revision");
    expect(migration).toContain("errcode = '40001'");
    expect(migration).toContain("revoke all on function public.save_workspace_state(uuid, bigint, jsonb)");
    expect(migration).toContain("grant execute on function public.save_workspace_state(uuid, bigint, jsonb)");
    expect(migration).toContain("grant execute on function public.reset_workspace_state(uuid)");
    expect(migration).toContain("to authenticated");
  });
});
