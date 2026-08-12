begin;

create extension if not exists pgtap with schema extensions;
select plan(52);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delete-a@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'keep-b@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}');

select is(
  (select count(*) from public.workspaces where owner_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  2::bigint,
  'both test accounts receive isolated workspaces'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';

select lives_ok($$
  select * from public.apply_workspace_patch_idempotent(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a0000000-0000-4000-8000-000000000001',
    '{
      "groups":{"upserts":[{"position":0,"data":{"id":"g-a","name":"Delete me","grade":"","subject":"","schedule":"","hourlyRate":null,"weeklySchedule":[],"plannedSessionsPerMonth":8,"assistantContact":"","notes":""}}],"deletes":[]},
      "students":{"upserts":[{"position":0,"data":{"id":"s-a","code":"A-1","fullName":"Account A","avatarId":"cat","groupIds":["g-a"],"isIndividual":false,"customHourlyRate":null,"status":"Active"}}],"deletes":[]}
    }'::jsonb,
    '{"groups":{"g-a":0},"students":{"s-a":0}}'::jsonb
  )
$$, 'account A can create active records before reset');

reset role;
do $$
begin
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);
  update public.workspaces
  set state = private.normalized_workspace_state('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
end;
$$;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';

select lives_ok($$
  select * from public.reset_normalized_workspace_records(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2, 'reset:2'
  )
$$, 'authenticated reset succeeds with revision-bound confirmation');
select is((select count(*) from public.groups), 0::bigint, 'reset clears active groups');
select is((select count(*) from public.students), 0::bigint, 'reset clears active students');
select is((select count(*) from public.workspace_recovery_snapshots), 1::bigint, 'reset retains a recovery snapshot');
select is(
  (select jsonb_array_length(state -> 'groups') from public.workspaces),
  0,
  'reset also scrubs the deprecated workspace JSON copy'
);
select is(
  (select jsonb_array_length(state -> 'groups') from public.workspace_recovery_snapshots),
  1,
  'the bounded reset snapshot retains the recoverable records'
);
select is((select revision from public.workspace_sync_cursors), 3::bigint, 'reset advances the sync cursor');
select is((select count(*) from public.workspace_settings), 1::bigint, 'reset preserves account settings');

select lives_ok($$
  select * from public.restore_normalized_workspace_snapshot(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    (select id from public.workspace_recovery_snapshots order by created_at limit 1),
    3
  )
$$, 'the reset recovery snapshot can restore the active records');
select is((select count(*) from public.groups), 1::bigint, 'restore repopulates account A only');

set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select lives_ok($$
  select * from public.apply_workspace_patch_idempotent(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'b0000000-0000-4000-8000-000000000001',
    '{"groups":{"upserts":[{"position":0,"data":{"id":"g-b","name":"Keep me","grade":"","subject":"","schedule":"","hourlyRate":null,"weeklySchedule":[],"plannedSessionsPerMonth":8,"assistantContact":"","notes":""}}],"deletes":[]}}'::jsonb,
    '{"groups":{"g-b":0}}'::jsonb
  )
$$, 'account B has independent active data');
select is((select count(*) from public.groups), 1::bigint, 'account B sees its own group');

reset role;
insert into public.workspace_import_jobs (
  owner_id, file_hash, source_name, base_revision, result_revision, summary
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64), 'account-a-backup.json', 3, 4, '{}'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';
select ok((select count(*) >= 2 from public.workspace_recovery_snapshots), 'A has reset and restore snapshots before deletion');
select is((select count(*) from public.workspace_import_jobs), 1::bigint, 'A has import history before deletion');

reset role;
select ok(
  (select count(*) >= 1 from public.workspace_mutation_receipts where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'A has an idempotent mutation receipt before deletion'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';
select lives_ok($$
  select * from public.begin_account_deletion(
    'd0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'DELETE MY ACCOUNT',
    'e0000000-0000-4000-8000-000000000001'
  )
$$, 'authenticated account can create a deletion tombstone');
select ok(public.current_account_is_deletion_pending(), 'the account reports a pending tombstone');

select is(
  (select request_id::text from public.begin_account_deletion(
    'd0000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'DELETE MY ACCOUNT',
    'e0000000-0000-4000-8000-000000000002'
  )),
  'd0000000-0000-4000-8000-000000000001',
  'a retry reuses the original deletion request'
);

reset role;
select is(
  (select count(*) from public.account_deletion_requests where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1::bigint,
  'idempotent begin creates one audit request'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'authenticated';
select throws_ok($$
  select * from public.apply_workspace_patch_idempotent(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a0000000-0000-4000-8000-000000000099',
    '{"settings":{"currency":"MXN","hourlyRate":90,"defaultClassHours":2,"recentProjectionWeeks":4,"lowGradeThreshold":0.7,"lowAttendanceThreshold":0.8,"selectedMonth":"2026-08-01","asOfDate":"2026-08-12"}}'::jsonb,
    '{"settings":{"__settings__":1}}'::jsonb
  )
$$, '42501', 'account_deletion_pending', 'an old outbox/JWT cannot recreate data');
select throws_ok($$
  select * from public.load_normalized_workspace('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
$$, '42501', 'account_deletion_pending', 'the tombstoned account cannot reload data');
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('avatars', 'stale-upload.txt', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
$$, '42501', 'new row violates row-level security policy for table "objects"', 'a stale JWT cannot create a Storage object');
select is((select count(*) from public.groups), 0::bigint, 'RLS hides rows as soon as deletion is pending');

reset role;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local request.jwt.claim.role = 'service_role';
set local role service_role;
select is(
  (select count(*) from public.list_account_storage_objects('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1000)),
  0::bigint,
  'storage discovery is service-only and empty when the account owns no files'
);
select lives_ok($$
  select * from public.erase_account_data(
    'd0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$$, 'service role erases every registered table transactionally');
select lives_ok($$
  select * from public.erase_account_data(
    'd0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$$, 'data erasure is idempotent');

reset role;
select is((
  select sum(row_count)::bigint from (
    select count(*) as row_count from public.schedule_exceptions where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.schedule_changes where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.class_schedules where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.payments where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.class_records where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.grades where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.student_groups where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.students where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.groups where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_change_events where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_mutation_receipts where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_settings where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_sync_cursors where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_sync_signals where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_import_jobs where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspace_recovery_snapshots where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    union all select count(*) from public.workspaces where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) as erased
), 0::bigint, 'zero rows remain for A in every registered account table');
select is((select count(*) from public.workspace_recovery_snapshots where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'all A snapshots are deleted');
select is((select count(*) from public.workspace_import_jobs where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'all A imports are deleted');
select is((select count(*) from public.workspace_mutation_receipts where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'all A mutation receipts are deleted');
select is((select count(*) from public.groups where owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint, 'account B data is unaffected');
select is((select count(*) from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1::bigint, 'account B Auth is unaffected');
select is((select status from public.account_deletion_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), 'data_erased', 'audit reaches data_erased before Auth deletion');

set local request.jwt.claim.role = 'service_role';
set local role service_role;
select lives_ok($$
  select public.record_account_deletion_failure(
    'd0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'auth_deletion_failed'
  )
$$, 'a partial Auth failure is recorded without restoring data');
reset role;
select is((select status from public.account_deletion_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), 'data_erased', 'partial failure remains retryable at data_erased');
select is((select last_error_code from public.account_deletion_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), 'auth_deletion_failed', 'audit stores only a compact failure code');

select lives_ok($$
  delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
$$, 'Auth hard-delete succeeds only after explicit RESTRICT rows are gone');
select is((select count(*) from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0::bigint, 'account A Auth is hard-deleted');

set local request.jwt.claim.role = 'service_role';
set local role service_role;
select lives_ok($$
  select * from public.complete_account_deletion(
    'd0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$$, 'service role completes the deletion receipt after Auth removal');
select lives_ok($$
  select * from public.complete_account_deletion(
    'd0000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
$$, 'receipt completion is idempotent');
reset role;

select is((select status from public.account_deletion_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), 'completed', 'audit reaches completed');
select is((select owner_id from public.account_deletion_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), null::uuid, 'completed audit removes the raw owner UUID');

set local request.jwt.claim.role = 'service_role';
set local role service_role;
select is((
  select status from public.get_account_deletion_receipt(
    'd0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000002'
  )
), 'completed', 'the latest receipt secret verifies completion');
select is((
  select count(*) from public.get_account_deletion_receipt(
    'd0000000-0000-4000-8000-000000000001',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  )
), 0::bigint, 'a wrong receipt secret reveals nothing');
reset role;

select is((select length(subject_hash) from public.account_deletion_requests where request_id = 'd0000000-0000-4000-8000-000000000001'), 64, 'completed audit retains only a SHA-256 subject hash');
select is((
  select count(*)
  from information_schema.columns as columns
  where columns.table_schema = 'public'
    and columns.column_name = 'owner_id'
    and columns.table_name <> 'account_deletion_requests'
    and not exists (
      select 1 from private.account_erasure_targets as target
      where target.table_schema = columns.table_schema
        and target.table_name = columns.table_name
    )
), 0::bigint, 'every current public owner table is registered for erasure');
select is((select confdeltype::text from pg_constraint where conname = 'workspaces_owner_id_fkey'), 'r', 'workspace Auth FK remains RESTRICT');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_recovery_snapshots_owner_id_fkey'), 'r', 'snapshot Auth FK remains RESTRICT');
select is((select confdeltype::text from pg_constraint where conname = 'workspace_import_jobs_owner_id_fkey'), 'r', 'import Auth FK remains RESTRICT');
select ok(
  exists (
    select 1 from cron.job
    where jobname = 'hibi-purge-expired-account-deletion-receipts'
      and command like '%90 days%'
  ),
  'completed pseudonymous receipts have an enforced 90-day retention limit'
);

select * from finish();
rollback;
