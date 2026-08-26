import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPLY_E2EE_MUTATION_RPC,
  E2EE_ENTITIES_TABLE,
  E2EE_EVENTS_TABLE,
  E2EE_PROFILE_TABLE,
  E2EE_SNAPSHOTS_TABLE,
  E2EE_WRAPPERS_TABLE,
  LOAD_E2EE_WORKSPACE_RPC,
  REPLACE_E2EE_WORKSPACE_RPC,
} from "./encryptedWorkspaceRepository.js";

const migration = readFileSync(
  new URL("../../supabase/migrations/202608250001_end_to_end_encryption_v2.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("mandatory E2EE v2 schema contract", () => {
  it("matches the encrypted tables and RPCs used by the browser", () => {
    expect(E2EE_PROFILE_TABLE).toBe("workspace_encryption_profiles");
    expect(E2EE_WRAPPERS_TABLE).toBe("workspace_key_wrappers");
    expect(E2EE_ENTITIES_TABLE).toBe("encrypted_workspace_entities");
    expect(E2EE_EVENTS_TABLE).toBe("encrypted_workspace_change_events");
    expect(E2EE_SNAPSHOTS_TABLE).toBe("encrypted_workspace_snapshots");
    for (const rpc of [LOAD_E2EE_WORKSPACE_RPC, APPLY_E2EE_MUTATION_RPC, REPLACE_E2EE_WORKSPACE_RPC]) {
      expect(migration).toContain(`function public.${rpc}`);
    }
  });

  it("stores only outer envelope metadata in the active entity table", () => {
    const entityTable = migration.match(/create table public\.encrypted_workspace_entities \(([\s\S]*?)\n\);/u)?.[1];
    expect(entityTable).toBeTruthy();
    for (const column of [
      "owner_id",
      "collection",
      "entity_id",
      "entity_revision",
      "schema_version",
      "key_version",
      "nonce",
      "ciphertext",
    ]) {
      expect(entityTable).toContain(column);
    }
    for (const forbidden of ["student_id", "class_date", "payment_date", "amount", "email", "phone", "name"]) {
      expect(entityTable).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "u"));
    }
  });

  it("keeps direct writes denied and owner-scoped reads under forced RLS", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("workspace_encryption_profiles_owner_select");
    expect(migration).toContain("encrypted_workspace_entities_owner_select");
    expect(migration).toContain("revoke all on table public.encrypted_workspace_entities");
    expect(migration).not.toContain("grant insert on table public.encrypted_workspace_entities to authenticated");
  });

  it("makes migration staged, verified, transactional, and reversible before activation", () => {
    expect(migration).toContain("begin_workspace_e2ee_migration");
    expect(migration).toContain("stage_workspace_e2ee_entities");
    expect(migration).toContain("load_workspace_e2ee_migration_staging");
    expect(migration).toContain("finalize_workspace_e2ee_migration");
    expect(migration).toContain("abort_workspace_e2ee_migration");
    expect(migration).toContain("migration_entity_count_mismatch");
    expect(migration).toContain("migration_settings_missing");
  });

  it("blocks old clients and registers every encrypted owner table for verified erasure", () => {
    expect(migration).toContain("function private.reject_legacy_after_e2ee");
    expect(migration).toContain("message = 'encryption_required'");
    for (const table of [
      "workspace_e2ee_migration_snapshots",
      "workspace_e2ee_migration_entities",
      "encrypted_workspace_change_events",
      "encrypted_workspace_mutation_receipts",
      "encrypted_workspace_snapshots",
      "encrypted_workspace_entities",
      "workspace_key_wrappers",
      "workspace_encryption_profiles",
    ]) {
      expect(migration).toContain(`('public', '${table}'`);
    }
  });
});
