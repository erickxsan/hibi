import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOAD_WORKSPACE_RPC,
  SAVE_WORKSPACE_RPC,
  WORKSPACE_CHANGE_EVENTS_TABLE,
} from "./workspaceRepository.js";

const migration = readFileSync(
  new URL("../../supabase/migrations/202608120001_normalized_workspace_entities.sql", import.meta.url),
  "utf8",
).toLowerCase();
const outboxMigration = readFileSync(
  new URL("../../supabase/migrations/202608120002_offline_outbox_integrity.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("normalized Supabase schema contract", () => {
  it("matches the RPCs and event table used by the browser client", () => {
    expect(LOAD_WORKSPACE_RPC).toBe("load_normalized_workspace");
    expect(SAVE_WORKSPACE_RPC).toBe("apply_workspace_patch_idempotent");
    expect(WORKSPACE_CHANGE_EVENTS_TABLE).toBe("workspace_change_events");
    expect(migration).toContain("function public.load_normalized_workspace");
    expect(migration).toContain("function public.apply_workspace_patch");
    expect(outboxMigration).toContain("function public.apply_workspace_patch_idempotent");
    expect(outboxMigration).toContain("p_operation_id uuid");
    expect(migration).toContain("p_expected_versions jsonb");
  });

  it("stores each domain entity independently with owner-bound keys", () => {
    for (const table of [
      "workspace_settings", "groups", "students", "student_groups", "grades",
      "class_schedules", "schedule_exceptions", "schedule_changes", "class_records", "payments",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
    }
    expect(migration).toContain("primary key (owner_id, id)");
    expect(migration).toContain("references public.students(owner_id, id)");
    expect(migration).toContain("references public.groups(owner_id, id)");
    expect(migration).toContain("references public.class_records(owner_id, id)");
  });

  it("indexes owner plus the date, student, and group access paths", () => {
    expect(migration).toContain("grades_student_date_idx");
    expect(migration).toContain("class_records_student_date_idx");
    expect(migration).toContain("class_records_group_date_idx");
    expect(migration).toContain("payments_date_idx");
    expect(migration).toContain("schedule_exceptions_schedule_date_idx");
  });

  it("checks revisions only for changed entities and keeps transactions short", () => {
    expect(migration).toContain("workspace_entity_conflict");
    expect(migration).toContain("private.expected_entity_revision");
    expect(migration).toContain("private.upsert_normalized_entity");
    expect(migration).toContain("pg_advisory_xact_lock_shared");
    expect(migration).toContain("set statement_timeout = '5s'");
  });

  it("publishes bounded small patches and never the legacy workspace document", () => {
    expect(migration).toContain("create table public.workspace_change_events");
    expect(migration).toContain("event.revision <= event_id - 100");
    expect(migration).toContain("alter publication supabase_realtime drop table public.workspace_sync_signals");
    expect(migration).toContain("alter publication supabase_realtime add table public.workspace_change_events");
    expect(migration).toContain("octet_length(p_patch::text) > 1048576");
  });

  it("enforces owner RLS, RPC-only writes, and fails old clients closed", () => {
    expect(migration).toContain("owner_id = (select auth.uid())");
    expect(migration).toContain("force row level security");
    expect(migration).toContain("grant select on table public.%i to authenticated");
    expect(migration).toContain("revoke execute on function public.save_workspace_state");
    expect(migration).not.toContain("grant update on table public.groups to authenticated");
  });
});
