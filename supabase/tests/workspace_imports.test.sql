begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'importer@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}');

select ok(
  has_function_privilege('authenticated', 'public.apply_normalized_workspace_import(uuid,bigint,jsonb,text,text,jsonb,text)', 'EXECUTE'),
  'authenticated clients can execute normalized imports'
);
select ok(
  not has_function_privilege('authenticated', 'public.apply_workspace_import(uuid,bigint,jsonb,text,text,jsonb,text)', 'EXECUTE'),
  'legacy document imports remain disabled'
);

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claim.role = 'authenticated';

select throws_ok($$
  select * from public.apply_normalized_workspace_import(
    '33333333-3333-4333-8333-333333333333',
    1,
    (select state from public.load_normalized_workspace('33333333-3333-4333-8333-333333333333')),
    repeat('a', 64),
    'students.json',
    '{}'::jsonb,
    'wrong-confirmation'
  )
$$, '22023', 'workspace_import_not_confirmed', 'imports require a revision-bound confirmation');

select lives_ok($$
  select * from public.apply_normalized_workspace_import(
    '33333333-3333-4333-8333-333333333333',
    1,
    jsonb_set(
      (select state from public.load_normalized_workspace('33333333-3333-4333-8333-333333333333')),
      '{groups}',
      '[{"id":"g-import","name":"Imported Math","grade":"","subject":"","schedule":"","hourlyRate":null,"weeklySchedule":[],"plannedSessionsPerMonth":8,"assistantContact":"","notes":""}]'::jsonb
    ),
    repeat('a', 64),
    'students.json',
    '{"groups":{"new":1}}'::jsonb,
    'import:1:' || repeat('a', 64)
  )
$$, 'a confirmed additive import succeeds');

select is((select count(*) from public.groups where id = 'g-import'), 1::bigint, 'the imported group is normalized');
select is((select count(*) from public.workspace_recovery_snapshots where reason = 'import'), 1::bigint, 'the import archives one recovery snapshot');
select is((select count(*) from public.workspace_import_jobs), 1::bigint, 'the import records one idempotency job');
select is((select revision from public.workspace_sync_cursors), 2::bigint, 'the import advances the sync cursor once');

select is((
  select already_imported from public.apply_normalized_workspace_import(
    '33333333-3333-4333-8333-333333333333',
    1,
    (select state from public.load_normalized_workspace('33333333-3333-4333-8333-333333333333')),
    repeat('a', 64),
    'renamed.json',
    '{}'::jsonb,
    'import:1:' || repeat('a', 64)
  )
), true, 'retrying the same file hash is an idempotent success');
select is((select count(*) from public.workspace_import_jobs), 1::bigint, 'an idempotent retry does not create another job');

select throws_ok($$
  select * from public.apply_normalized_workspace_import(
    '33333333-3333-4333-8333-333333333333',
    2,
    jsonb_set(
      (select state from public.load_normalized_workspace('33333333-3333-4333-8333-333333333333')),
      '{groups}',
      '[]'::jsonb
    ),
    repeat('b', 64),
    'destructive.json',
    '{}'::jsonb,
    'import:2:' || repeat('b', 64)
  )
$$, '22023', 'workspace_import_would_remove_records', 'imports cannot omit existing records');
select is((select count(*) from public.groups where id = 'g-import'), 1::bigint, 'a rejected destructive import leaves data intact');

select throws_ok($$
  select * from public.apply_normalized_workspace_import(
    '33333333-3333-4333-8333-333333333333',
    2,
    jsonb_set(
      (select state from public.load_normalized_workspace('33333333-3333-4333-8333-333333333333')),
      '{groups,0,name}',
      '""'::jsonb
    ),
    repeat('c', 64),
    'invalid.json',
    '{}'::jsonb,
    'import:2:' || repeat('c', 64)
  )
$$, '23514', 'new row for relation "groups" violates check constraint "groups_domain_data_check"', 'strict domain checks also protect full imports');

select throws_ok($$
  select * from public.apply_normalized_workspace_import(
    '44444444-4444-4444-8444-444444444444',
    2,
    (select state from public.load_normalized_workspace('33333333-3333-4333-8333-333333333333')),
    repeat('d', 64),
    'other-account.json',
    '{}'::jsonb,
    'import:2:' || repeat('d', 64)
  )
$$, '42501', 'account_changed', 'an import cannot be rebound to another account');

reset role;
select ok(not has_table_privilege('authenticated', 'public.workspace_import_jobs', 'INSERT'), 'clients cannot bypass the import RPC with direct job inserts');
select ok(not has_function_privilege('anon', 'public.apply_normalized_workspace_import(uuid,bigint,jsonb,text,text,jsonb,text)', 'EXECUTE'), 'anonymous clients cannot import');

select * from finish();
rollback;
