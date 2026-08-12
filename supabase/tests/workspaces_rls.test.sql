begin;

select plan(34);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'teacher-a@example.test',
    '',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'teacher-b@example.test',
    '',
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb
  );

select is(
  (select count(*) from public.workspaces where owner_id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2::bigint,
  'signup trigger creates one workspace per account'
);
select is(
  (select count(*) from public.workspace_sync_signals where owner_id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2::bigint,
  'signup creates one lightweight sync signal per workspace'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is((select count(*) from public.workspaces), 1::bigint, 'account A sees exactly one workspace');
select is((select owner_id::text from public.workspaces), '11111111-1111-4111-8111-111111111111', 'account A sees only its own workspace');
select is((select count(*) from public.workspace_sync_signals), 1::bigint, 'account A sees exactly one sync signal');
select is(
  (select owner_id::text from public.workspace_sync_signals),
  '11111111-1111-4111-8111-111111111111',
  'account A sees only its own sync signal'
);
select throws_ok(
  $$update public.workspaces set revision = 99$$,
  '42501',
  null,
  'authenticated clients cannot update the table directly'
);
select throws_ok(
  $$insert into public.workspaces (owner_id) values ('33333333-3333-4333-8333-333333333333')$$,
  '42501',
  null,
  'authenticated clients cannot insert into the table directly'
);
select throws_ok(
  $$delete from public.workspaces where owner_id = '11111111-1111-4111-8111-111111111111'$$,
  '42501',
  null,
  'authenticated clients cannot delete from the table directly'
);
select throws_ok(
  $$update public.workspace_sync_signals set revision = 99$$,
  '42501',
  null,
  'authenticated clients cannot forge sync signals'
);
select lives_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    0,
    (select state from public.workspaces)
  )$$,
  'account A can save through the revision RPC'
);
select is((select revision from public.workspaces), 1::bigint, 'successful save advances the revision');
select is(
  (select revision from public.workspace_sync_signals),
  1::bigint,
  'successful save transactionally advances the sync signal'
);
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    1,
    pg_catalog.jsonb_set((select state from public.workspaces), '{settings,currency}', 'null'::jsonb)
  )$$,
  '23514',
  null,
  'JSON null currency is rejected by the canonical state constraint'
);
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    1,
    pg_catalog.jsonb_set((select state from public.workspaces), '{settings,selectedMonth}', 'null'::jsonb)
  )$$,
  '23514',
  null,
  'JSON null selected month is rejected by the canonical state constraint'
);
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    1,
    pg_catalog.jsonb_set((select state from public.workspaces), '{settings,asOfDate}', 'null'::jsonb)
  )$$,
  '23514',
  null,
  'JSON null as-of date is rejected by the canonical state constraint'
);
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    0,
    (select state from public.workspaces)
  )$$,
  '40001',
  'workspace_revision_conflict',
  'stale revisions are rejected'
);
select lives_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    1,
    pg_catalog.jsonb_set(
      (select state from public.workspaces),
      '{students}',
      '[{"id":"one"},{"id":"two"},{"id":"three"}]'::jsonb
    )
  )$$,
  'ordinary save can add records before loss-guard testing'
);
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    2,
    pg_catalog.jsonb_set((select state from public.workspaces), '{students}', '[]'::jsonb)
  )$$,
  '22023',
  'workspace_collection_delete_blocked',
  'ordinary save cannot wipe an existing collection'
);
select lives_ok(
  $$select * from public.replace_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    2,
    pg_catalog.jsonb_set(
      (select state from public.workspaces),
      '{students}',
      '[{"id":"one"}]'::jsonb
    ),
    'replace:2'
  )$$,
  'explicit replacement can intentionally reduce a collection after archiving'
);
select throws_ok(
  $$select * from public.reset_workspace_state(
    '11111111-1111-4111-8111-111111111111'
  )$$,
  '42501',
  null,
  'authenticated clients cannot execute the legacy reset RPC'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is((select count(*) from public.workspaces), 1::bigint, 'account B sees exactly one workspace');
select is((select owner_id::text from public.workspaces), '22222222-2222-4222-8222-222222222222', 'account B sees only its own workspace');
select is((select count(*) from public.workspace_sync_signals), 1::bigint, 'account B sees exactly one sync signal');
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    0,
    (select state from public.workspaces)
  )$$,
  '42501',
  'account_changed',
  'an operation bound to account A cannot run as account B'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.workspaces$$,
  '42501',
  null,
  'anonymous clients cannot read workspaces'
);
select throws_ok(
  $$select * from public.workspace_sync_signals$$,
  '42501',
  null,
  'anonymous clients cannot read sync signals'
);
select throws_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    0,
    '{}'::jsonb
  )$$,
  '42501',
  null,
  'anonymous clients cannot execute the save RPC'
);
select throws_ok(
  $$select * from public.reset_workspace_state(
    '11111111-1111-4111-8111-111111111111'
  )$$,
  '42501',
  null,
  'anonymous clients cannot execute the reset RPC'
);

reset role;
select ok(
  not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspaces'
  ),
  'Realtime does not publish the large workspace row'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_sync_signals'
  ),
  'Realtime publishes only lightweight workspace sync signals'
);
select throws_ok(
  $$update public.workspaces
    set revision = revision + 1
    where owner_id = '11111111-1111-4111-8111-111111111111'$$,
  '42501',
  'direct_workspace_update_blocked',
  'privileged direct workspace mutation is blocked outside guarded RPCs'
);
select throws_ok(
  $$delete from auth.users where id = '11111111-1111-4111-8111-111111111111'$$,
  '23503',
  null,
  'an accidental Auth-user deletion is blocked while workspace data exists'
);
select is(
  (select count(*) from public.workspaces where owner_id = '11111111-1111-4111-8111-111111111111'),
  1::bigint,
  'blocked Auth-user deletion leaves the workspace intact'
);

select * from finish();
rollback;
