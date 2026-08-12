# Supabase backend

The canonical cloud model is normalized. Settings, groups, students, memberships, grades, schedules, exceptions, class records, and payments live in owner-scoped tables with foreign keys, typed search columns, and indexes. JSON remains the stable import/export and recovery format; it is reconstructed only when the app first loads or when an explicit full backup operation needs it.

Ordinary edits call `apply_workspace_patch` with only the changed entities and their expected entity revisions. Two devices changing different records do not conflict. A stale update to the same record fails with `workspace_entity_conflict` (`SQLSTATE 40001`) and the client reloads and reapplies the edit.

Direct browser writes are denied. Authenticated clients can select only their own rows through RLS and write through owner-bound RPCs. The `anon` role has no table or RPC access.

## Realtime and recovery

`workspace_change_events` retains the latest 100 small, ordered patches per owner. Realtime publishes this table only; it never publishes the legacy `workspaces.state` document. Reconnecting clients replay missed patches and perform a full read only if the replay window was exceeded or an explicit import/replace/restore emitted a `reload` event.

Routine edits do not create complete server or IndexedDB snapshots. Full snapshots are created only before explicit
replacement, import, restore, or workspace reset operations. Server recovery is bounded to 20 snapshots and 30 days;
encrypted copies on one device are bounded to 8 copies and use the same recovery window. Because browser code cannot
run while a device is closed, expired device copies are removed the next time Hibi opens there.

The legacy `workspaces` row is retained as a stable account anchor, but its obsolete JSON document is scrubbed after
normalization and on workspace reset. Legacy full-document write RPCs are revoked from authenticated users, so an old
open tab fails closed instead of creating a split-brain write or another unbounded copy of personal data.

## Apply and verify

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Apply every migration in filename order. The normalization migration backfills existing accounts transactionally, so deploy the database migration before the matching frontend build. Old open clients must refresh before they can save again.

For a clean local verification:

```sh
pnpm install
supabase start
pnpm test:db
```

The Supabase CLI is a pinned development dependency, so no global CLI installation is required. Docker Desktop (or another compatible Docker daemon) must be running. `pnpm test:db` resets the local database to apply every migration in filename order, runs `supabase db lint`, and then executes every pgTAP file.

`tests/workspaces_rls.test.sql` creates two temporary Auth accounts inside a rolled-back transaction and verifies signup provisioning, A/B isolation, denied direct and anonymous access, per-entity conflicts, normalized memberships/payments, ordered change events, full-state reconstruction, and explicit snapshot recovery. `tests/workspace_imports.test.sql` adds coverage for normalized import confirmation, idempotency, non-destructive behavior, domain constraints, snapshots, and cross-account isolation.

`tests/account_deletion.test.sql` verifies recoverable reset, the deletion tombstone, stale JWT/outbox blocking,
transactional erasure, Storage discovery, retry idempotency, partial Auth-failure recovery, zero owner rows, account-B
isolation, preserved `RESTRICT` constraints, and a 90-day pseudonymous completion receipt.

## Account deletion operations

Deploy `functions/delete-account` with `verify_jwt = false` as configured in `config.toml`. The function still verifies
the bearer token with Auth for a new deletion; JWT middleware is disabled only so a high-entropy receipt can reconcile
a response lost after Auth was already deleted. Set the exact browser origins as a function secret:

```sh
supabase secrets set HIBI_ALLOWED_ORIGINS=https://usehibi.pages.dev
supabase functions deploy delete-account --no-verify-jwt
```

The deletion order is registered in `private.account_erasure_targets`. `erase_account_data` refuses to run if a new
public `owner_id` table is not registered, preventing a future database table from being silently omitted. Owned files
in any current or future Supabase Storage bucket are discovered by `owner_id` and removed through the Storage API before
database erasure; a restrictive Storage RLS policy blocks stale authenticated JWTs once deletion is pending. Files
created by future server-side features must set the end user's Storage `owner_id`, rather than leaving them unowned.
Keep the Auth foreign keys on legacy workspaces, snapshots, and import jobs as `RESTRICT`; never substitute a dashboard
Auth deletion for the versioned procedure.

The account-deletion migration also enables Supabase Cron (`pg_cron`), schedules an expired snapshot purge every 15
minutes, and removes completed pseudonymous deletion receipts after 90 days. Verify both `hibi-purge-expired-*` jobs
after deployment. Device copies cannot run background code while a browser/device is closed, so Hibi removes expired
copies the next time the app opens on that device.

Use a Supabase secret key only on a trusted server or Edge Function—never in the web bundle. The function supports the
current publishable/secret key environment variables and the legacy anon/service-role variables during Supabase's key
migration. Backups and database rows contain student, guardian, grade, attendance, and payment information and must be
handled as sensitive personal data.
