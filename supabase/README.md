# Supabase backend

The canonical cloud model is normalized. Settings, groups, students, memberships, grades, schedules, exceptions, class records, and payments live in owner-scoped tables with foreign keys, typed search columns, and indexes. JSON remains the stable import/export and recovery format; it is reconstructed only when the app first loads or when an explicit full backup operation needs it.

Ordinary edits call `apply_workspace_patch` with only the changed entities and their expected entity revisions. Two devices changing different records do not conflict. A stale update to the same record fails with `workspace_entity_conflict` (`SQLSTATE 40001`) and the client reloads and reapplies the edit.

Direct browser writes are denied. Authenticated clients can select only their own rows through RLS and write through owner-bound RPCs. The `anon` role has no table or RPC access.

## Realtime and recovery

`workspace_change_events` retains the latest 100 small, ordered patches per owner. Realtime publishes this table only; it never publishes the legacy `workspaces.state` document. Reconnecting clients replay missed patches and perform a full read only if the replay window was exceeded or an explicit import/replace/restore emitted a `reload` event.

Routine edits do not create complete server or IndexedDB snapshots. Full snapshots are created only before explicit replacement, import, or restore operations, and the existing 20-snapshot server bound remains in force.

The legacy `workspaces` table is retained as a one-time migration source and for compatibility with existing recovery history. Legacy full-document write RPCs are revoked from authenticated users after the normalization migration so an old open tab fails closed instead of creating a split-brain write.

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

Use the Supabase service key only on a trusted server or Edge Function—never in the web bundle. Backups and database rows contain student, guardian, grade, attendance, and payment information and must be handled as sensitive personal data.
