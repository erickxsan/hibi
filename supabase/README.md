# Supabase backend

## Encrypted workspace v2

`202608250001_end_to_end_encryption_v2.sql` is the active content model for migrated accounts. Supabase stores
owner-scoped AES-GCM envelopes, passkey/recovery wrappers, authenticated manifests, encrypted change events, encrypted
snapshots, and idempotency receipts. It does not store readable names, contact details, academic values, class/payment
dates, notes, relationships, or amounts.

`202608260002_require_end_to_end_encryption.sql` completes the rollout. After it is applied, every authenticated legacy
workspace is gated on passkey activation and verified migration; the application no longer selects the legacy
repository as a usable fallback.

The normalized model described below remains only as a transactional migration source for accounts whose owners have
not returned. `migration_started` blocks its writes, staging is downloaded and verified by the browser, and the final
RPC removes readable normalized rows only after exact canonical parity. Active E2EE profiles make legacy clients fail
with `encryption_required`. See [`docs/E2EE_ARCHITECTURE.md`](../docs/E2EE_ARCHITECTURE.md).

Before E2EE activation, the migration source is normalized. Settings, groups, students, memberships, grades, schedules, exceptions, class records, and payments live in owner-scoped tables with foreign keys, typed search columns, and indexes. JSON remains a legacy import/export boundary, not the active encrypted storage model.

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

### Staged data lifecycle remediation (2026-10-09)

Production deployment is split into two reviewed dashboard transactions in `supabase/deployments/`.
The local audit report and restore-evidence form remain under `outputs/auditoria-datos-2026-10-07` in the parent workspace. Do not apply all migration files directly to this production
project: that would include retention activation. The old combined package is retired and deliberately raises an error.

**Phase one**, [`deployments/2026-10-09-phase-1.sql`](deployments/2026-10-09-phase-1.sql), applies the three missing historical migrations, both
October 7 corrections, and `202610090001_defer_recovery_retention.sql` in one transaction. Its exact-history preflight
expects the 18 versions observed in the dashboard and refuses duplicate active password wrappers. The existing
September conflict correction is restored after older definitions. Do not execute fragments individually.

The transaction preserves every pre-existing revoked wrapper in a session-local temporary table, installs the final
non-deleting revocation trigger, restores the full rows, and verifies their equality before committing. Thus the older
purge migration cannot permanently remove that material in phase one. Any preservation failure rolls back the entire
transaction. Revoked credentials remain inactive; their physical removal waits for phase two.

Phase one records stable snapshot clocks but leaves old encrypted copies readable to their owner. The frontend relies
on the server's policy instead of hiding copies by their date. The existing legacy snapshot purge, normal snapshot-count
limits and local-device cleanup remain in place. Key changes share the profile lock; staged rotation blocks competing
changes, the last current key is protected, and stale password replacement returns HTTP 409.

**Phase two**, [`deployments/2026-10-09-phase-2-BLOCKED.sql`](deployments/2026-10-09-phase-2-BLOCKED.sql), applies
`202610090002_activate_recovery_retention.sql`. It activates expiry-based RLS and the encrypted-copy purge in the
15-minute cron, and removes revoked cryptographic wrapper material. The delivered transaction raises an error while its
restore-test reference remains the placeholder. Document a tested restore in `RESPALDO-Y-RESTAURACION.md`, verify fresh
remote counts and obtain explicit action-time approval before replacing that marker. A local synthetic SQL test is not
evidence of a production backup. A backup of the current workspace alone does not preserve its historical recovery copies.

Deploy the corrected `delete-account/index.ts` through the dashboard editor after phase one is applied. Keep its exact
origin allowlist and the configured JWT-middleware exemption: new deletion still validates Auth and recent login,
while a durable receipt resumes every previously authorized deletion phase without an Auth or encryption session.
The browser stores only the owner ID, request ID and receipt secret before its first request; treat the secret as a
reconciliation credential. Keep it until verified completion and successful local cleanup. Clearing browser storage
before reconciliation removes this device's ability to resume with that receipt.

Before publishing the matching frontend, run the **Published backend contract** workflow (or
`node scripts/check-backend-contract.mjs` with `HIBI_BACKEND_URL`, `HIBI_PUBLIC_KEY`, and `HIBI_APP_ORIGIN`). It performs
only OPTIONS and GET, checks the deployed function and its matching database contract, and never sends deletion requests.
The existing Database gate also runs actual concurrent key operations in its disposable local database.
Both phases expose `data-lifecycle-2026-10-09-staged-v1`; that handshake proves application compatibility, not retention
activation. Check the cron and RLS directly for the latter. Disposable database gates apply all 25 migrations and test
the final activated schema. `phase-tests/deferred_retention.test.sql` is a separate 14-assertion preservation check for
the exact phase-one bundle and its historical-copy fixture.

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
