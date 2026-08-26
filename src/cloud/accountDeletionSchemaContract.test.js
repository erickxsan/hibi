import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/202608120006_account_deletion_workflow.sql"),
  "utf8",
);
const edgeFunction = fs.readFileSync(path.join(root, "supabase/functions/delete-account/index.ts"), "utf8");
const browserClient = fs.readFileSync(path.join(root, "src/cloud/accountDeletion.js"), "utf8");
const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");

describe("account deletion schema contract", () => {
  it("keeps erasure and audit RPCs service-role only", () => {
    expect(migration).toContain("grant execute on function public.erase_account_data(uuid, uuid) to service_role");
    expect(migration).toContain("grant execute on function public.complete_account_deletion(uuid, uuid)");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("current_account_is_deletion_pending");
    expect(migration).toContain("hibi_block_pending_account_storage");
    expect(migration).toContain("unregistered_account_data_table");
    expect(migration).toContain("alter table private.account_erasure_targets enable row level security");
    expect(migration).toContain("legacy_normalized_workspace_parity_failed");
    expect(migration).toContain("legacy_only_entity");
    expect(migration).toContain("hibi-purge-expired-workspace-snapshots");
    expect(migration).toContain("hibi-purge-expired-account-deletion-receipts");
    expect(migration).toContain("interval '90 days'");
    expect(migration).not.toMatch(/grant execute on function public\.erase_account_data\([^;]+to authenticated/i);
  });

  it("hard-deletes Auth only in the Edge Function after explicit data erasure", () => {
    expect(edgeFunction).toContain('rpc("list_account_storage_objects"');
    expect(edgeFunction).toContain("storage.from(bucketId).remove(paths)");
    expect(edgeFunction).toContain('rpc("erase_account_data"');
    expect(edgeFunction).toContain("auth.admin.deleteUser(ownerId, false)");
    expect(edgeFunction.lastIndexOf('rpc("erase_account_data"')).toBeLessThan(
      edgeFunction.lastIndexOf("await hardDeleteAuthUser(ownerId)"),
    );
    expect(edgeFunction.lastIndexOf("await purgeOwnedStorageObjects(ownerId)")).toBeLessThan(
      edgeFunction.lastIndexOf('rpc("erase_account_data"'),
    );
    expect(edgeFunction).toContain("await purgeOwnedStorageObjects(receipt.owner_id)");
    expect(edgeFunction).toContain("latestAuthenticationTime");
    expect(edgeFunction).toContain("HIBI_ALLOWED_ORIGINS");
    expect(edgeFunction).toContain("SUPABASE_PUBLISHABLE_KEYS");
    expect(edgeFunction).toContain("SUPABASE_SECRET_KEYS");
    expect(config).toContain("[functions.delete-account]");
    expect(config).toContain("verify_jwt = false");
  });

  it("never exposes the service role in browser code", () => {
    expect(browserClient).not.toContain("SERVICE_ROLE");
    expect(browserClient).not.toContain("service_role");
    expect(browserClient).toContain('functions.invoke("delete-account"');
  });
});
