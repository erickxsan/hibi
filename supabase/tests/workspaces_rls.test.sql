begin;

select plan(19);

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

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is((select count(*) from public.workspaces), 1::bigint, 'account A sees exactly one workspace');
select is((select owner_id::text from public.workspaces), '11111111-1111-4111-8111-111111111111', 'account A sees only its own workspace');
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
select lives_ok(
  $$select * from public.save_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    0,
    (select state from public.workspaces)
  )$$,
  'account A can save through the revision RPC'
);
select is((select revision from public.workspaces), 1::bigint, 'successful save advances the revision');
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

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is((select count(*) from public.workspaces), 1::bigint, 'account B sees exactly one workspace');
select is((select owner_id::text from public.workspaces), '22222222-2222-4222-8222-222222222222', 'account B sees only its own workspace');
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
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select count(*) from public.workspaces where owner_id = '11111111-1111-4111-8111-111111111111'),
  0::bigint,
  'deleting an Auth account cascades to its workspace'
);

select * from finish();
rollback;
