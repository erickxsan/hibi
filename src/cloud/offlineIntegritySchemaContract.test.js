import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202608120002_offline_outbox_integrity.sql", import.meta.url),
  "utf8",
).toLowerCase();
const strictValidationMigration = readFileSync(
  new URL("../../supabase/migrations/202608120003_strict_server_domain_validation.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("offline sync and database integrity schema", () => {
  it("deduplicates retries by owner and operation UUID in one transaction", () => {
    expect(migration).toContain("primary key (owner_id, operation_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("operation_id_reused");
    expect(migration).toContain("already_applied boolean");
  });

  it("keeps mutation receipts private and bounded", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("revoke all on table public.workspace_mutation_receipts");
    expect(migration).toContain("offset 1000");
  });

  it("validates domain fields and the remaining JSON relationships", () => {
    expect(migration).toContain("workspace_entity_is_valid");
    expect(migration).toContain("invalid_workspace_reference");
    expect(migration).toContain("participantids");
    expect(migration).toContain("group_schedule_slot_exists");
    expect(migration).toContain("deferrable initially deferred");
  });

  it("makes the idempotent RPC the only authenticated patch writer", () => {
    expect(strictValidationMigration).toContain("workspace_patch_shape_is_valid");
    expect(strictValidationMigration).toContain("perform private.assert_normalized_workspace_integrity(caller_id)");
    expect(strictValidationMigration).toContain(
      "revoke all on function public.apply_workspace_patch(uuid,jsonb,jsonb)",
    );
  });

  it("enforces canonical nested metadata and per-owner natural keys", () => {
    expect(strictValidationMigration).toContain("workspace_entity_is_strictly_valid");
    expect(strictValidationMigration).toContain("workspace_settings_are_valid");
    expect(strictValidationMigration).toContain("groups_owner_name_ci_unique");
    expect(strictValidationMigration).toContain("students_owner_code_ci_unique");
  });
});
