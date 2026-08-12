# Supabase backend

This schema stores one revisioned JSON state per authenticated user. Signup creates the workspace automatically. Browser clients can read their own row and can write only through revision-aware RPCs, so they cannot bypass optimistic concurrency. Ordinary saves reject suspicious collection loss, intentional backup replacement is a separate archived operation, and additive imports verify that every existing stable ID remains present. Imports are audited by SHA-256 hash, are idempotent, and archive a recovery snapshot before changing state. Recent pre-write states are retained in an owner-isolated recovery table. The legacy reset RPC is not executable by browser accounts. Auth-user deletion is restricted while workspace data exists, preventing an accidental dashboard deletion from cascading through the canonical row and its recovery history. The `anon` role has no table or RPC access.

## Realtime synchronization

The `workspaces.state` document is never published through Realtime. A transactional trigger mirrors only `owner_id`, `revision`, and `updated_at` into the RLS-protected `workspace_sync_signals` table. Clients subscribe to their small signal row and fetch the full canonical document through the Data API when the revision advances. This keeps synchronization compatible with the 5 MB workspace limit despite the smaller Postgres Changes payload limit. Reconnects always perform a fresh read because Realtime delivery is not guaranteed.

## Apply it

CLI (recommended):

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

If this repository has not been initialized for the CLI yet, run `supabase init` once first. For a new local stack, `supabase start` followed by `supabase db reset` applies the migration and `seed.sql`.

Dashboard alternative: open **SQL Editor** and apply every file in `migrations/` in filename order. Do not paste `seed.sql` into a production project.

## Verify isolation with two accounts

1. Create and confirm two users through Supabase Auth, then copy their UUIDs from **Authentication → Users**. Each should have exactly one workspace:

   ```sql
   select owner_id, revision from public.workspaces order by owner_id;
   ```

2. In SQL Editor, impersonate account A inside a transaction (replace the UUID). It must return only A's row, and the RPC must advance only A from revision `0` to `1`:

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claim.sub', 'ACCOUNT_A_UUID', true);
   select owner_id, revision from public.workspaces;
   select *
   from public.save_workspace_state(
     'ACCOUNT_A_UUID',
     0,
     (select state from public.workspaces)
   );
   rollback;
   ```

3. Repeat with account B and confirm only B is visible. To test a collision, save once with expected revision `0`, then call the RPC again with `0`; the second call must fail with `workspace_revision_conflict` (`SQLSTATE 40001`).

4. Confirm direct writes and anonymous access are denied (permission errors are expected):

   ```sql
   begin;
   set local role authenticated;
   select set_config('request.jwt.claim.sub', 'ACCOUNT_A_UUID', true);
   update public.workspaces set revision = 99;
   rollback;

   begin;
   set local role anon;
   select * from public.workspaces;
   select * from public.save_workspace_state('ACCOUNT_A_UUID', 0, '{}'::jsonb);
   rollback;
   ```

Use the Supabase service key only on a trusted server or Edge Function—never in the web bundle. Backups and the JSON state contain student, guardian, grade, and payment data and must be treated as sensitive personal information.

## Automated database security test

With Docker Desktop running and the Supabase CLI installed:

```sh
supabase start
supabase db reset
supabase test db
```

`tests/workspaces_rls.test.sql` creates two temporary Auth accounts inside a rolled-back transaction and verifies trigger creation, A/B isolation, denied direct writes, denied anonymous reads, revision conflicts, mass-deletion guards, archived replacement, disabled reset access, owner binding, and protection against accidental Auth-user deletion.
