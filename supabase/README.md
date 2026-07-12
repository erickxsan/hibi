# Supabase backend

This schema stores one revisioned JSON state per authenticated user. Signup creates the workspace automatically; deleting the Auth user through an admin/service operation safely removes it through `ON DELETE CASCADE`. Browser clients can read their own row and can write only through `save_workspace_state`, so they cannot bypass optimistic concurrency. The `anon` role has no table or RPC access. The migration also enables the table for Supabase Realtime when that publication is available.

## Apply it

CLI (recommended):

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

If this repository has not been initialized for the CLI yet, run `supabase init` once first. For a new local stack, `supabase start` followed by `supabase db reset` applies the migration and `seed.sql`.

Dashboard alternative: open **SQL Editor**, paste and run `migrations/202607110001_initial_multi_account_workspaces.sql`. Do not paste `seed.sql` before the migration.

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

`tests/workspaces_rls.test.sql` creates two temporary Auth accounts inside a rolled-back transaction and verifies trigger creation, A/B isolation, denied direct writes, denied anonymous reads, revision conflicts, owner binding, and account-deletion cascade.
