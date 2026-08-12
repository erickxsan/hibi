begin;

create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com', 'x', now(), '{"provider":"email","providers":["email"]}', '{}');

select is((select count(*) from public.workspaces where owner_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2::bigint, 'signup keeps legacy rows for recovery compatibility');
select is((select count(*) from public.workspace_settings where owner_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2::bigint, 'signup creates normalized settings');
select is((select count(*) from public.workspace_sync_cursors where owner_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2::bigint, 'signup creates sync cursors');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claim.role = 'authenticated';

select is((select count(*) from public.workspace_settings), 1::bigint, 'account A sees only its settings');
select is((select owner_id::text from public.workspace_settings), '11111111-1111-4111-8111-111111111111', 'account A owns the visible settings');
select is((select count(*) from public.workspace_change_events), 1::bigint, 'account A sees only its signup event');
select lives_ok($$select * from public.load_normalized_workspace('11111111-1111-4111-8111-111111111111')$$, 'account A loads the reconstructed workspace');
select throws_ok($$update public.workspace_settings set revision = 99$$, '42501', 'permission denied for table workspace_settings', 'direct normalized writes are denied');
select throws_ok($$select * from public.save_workspace_state('11111111-1111-4111-8111-111111111111', 0, '{}'::jsonb)$$, '42501', 'permission denied for function save_workspace_state', 'old full-document writers fail closed');

select lives_ok($$
  select * from public.apply_workspace_patch(
    '11111111-1111-4111-8111-111111111111',
    jsonb_build_object('settings', (select data from public.workspace_settings) || '{"hourlyRate":60}'::jsonb),
    '{"settings":{"__settings__":1}}'::jsonb
  )
$$, 'settings can be patched independently');
select is((select revision from public.workspace_settings), 2::bigint, 'settings have their own revision');
select is((select revision from public.workspace_sync_cursors), 2::bigint, 'the small sync cursor advances without becoming a write token');

select lives_ok($$
  select * from public.apply_workspace_patch(
    '11111111-1111-4111-8111-111111111111',
    '{
      "groups":{"upserts":[{"position":0,"data":{"id":"g1","name":"Math"}}],"deletes":[]},
      "students":{"upserts":[{"position":0,"data":{"id":"s1","code":"A-1","fullName":"Ana","groupIds":["g1"]}}],"deletes":[]}
    }'::jsonb,
    '{"groups":{"g1":0},"students":{"s1":0}}'::jsonb
  )
$$, 'a transaction can add a group, student, and membership');
select is((select count(*) from public.groups), 1::bigint, 'one group was written');
select is((select count(*) from public.students), 1::bigint, 'one student was written');
select is((select count(*) from public.student_groups), 1::bigint, 'membership is normalized');
select is((select revision from public.groups where id = 'g1'), 1::bigint, 'new group starts at entity revision one');

select lives_ok($$
  select * from public.apply_workspace_patch(
    '11111111-1111-4111-8111-111111111111',
    '{"groups":{"upserts":[{"position":0,"data":{"id":"g1","name":"Advanced Math"}}],"deletes":[]}}'::jsonb,
    '{"groups":{"g1":1}}'::jsonb
  )
$$, 'one entity can advance without checking unrelated revisions');
select is((select revision from public.groups where id = 'g1'), 2::bigint, 'only the changed group revision advances');
select is((select revision from public.students where id = 's1'), 1::bigint, 'the unrelated student revision does not advance');
select throws_ok($$
  select * from public.apply_workspace_patch(
    '11111111-1111-4111-8111-111111111111',
    '{"groups":{"upserts":[{"position":0,"data":{"id":"g1","name":"Stale"}}],"deletes":[]}}'::jsonb,
    '{"groups":{"g1":1}}'::jsonb
  )
$$, '40001', 'workspace_entity_conflict', 'a stale write conflicts only on the same entity');

select lives_ok($$
  select * from public.apply_workspace_patch(
    '11111111-1111-4111-8111-111111111111',
    '{
      "grades":{"upserts":[{"position":0,"data":{"id":"gr1","studentId":"s1","date":"2026-08-10","score":8,"maxScore":10}}],"deletes":[]},
      "classLog":{"upserts":[{"position":0,"data":{"id":"c1","studentId":"s1","groupId":"g1","classDate":"2026-08-10","classStatus":"Completed","amountPaid":120,"paymentDate":"2026-08-10","paymentState":"Paid","paymentMethod":"Transfer","paymentReference":"R1"}}],"deletes":[]}
    }'::jsonb,
    '{"grades":{"gr1":0},"classLog":{"c1":0}}'::jsonb
  )
$$, 'grade, class record, and payment can be saved atomically');
select is((select count(*) from public.grades), 1::bigint, 'grade is normalized');
select is((select count(*) from public.class_records), 1::bigint, 'class record is normalized');
select is((select count(*) from public.payments), 1::bigint, 'payment is normalized separately');
select is((select amount from public.payments where id = 'c1'), 120.00::numeric, 'payment amount is typed and indexed');
select is((select state -> 'classLog' -> 0 ->> 'paymentReference' from public.load_normalized_workspace('11111111-1111-4111-8111-111111111111')), 'R1', 'load reconstructs the stable export shape');
select is((select count(*) from public.workspace_recovery_snapshots), 0::bigint, 'ordinary entity edits do not create full snapshots');

select lives_ok($$
  select * from public.replace_normalized_workspace_state(
    '11111111-1111-4111-8111-111111111111',
    5,
    (select state from public.load_normalized_workspace('11111111-1111-4111-8111-111111111111')),
    'replace:5'
  )
$$, 'explicit full replacement remains available');
select is((select count(*) from public.workspace_recovery_snapshots), 1::bigint, 'full replacement archives exactly one recovery snapshot');
select is((select count(*) from public.workspace_change_events), 6::bigint, 'small ordered events are retained for replay');

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select is((select count(*) from public.workspace_settings), 1::bigint, 'account B sees exactly its settings');
select is((select count(*) from public.groups), 0::bigint, 'account B cannot see account A groups');
select throws_ok($$select * from public.load_normalized_workspace('11111111-1111-4111-8111-111111111111')$$, '42501', 'account_changed', 'an RPC cannot be rebound to another owner');

set local role anon;
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'anon';
select throws_ok($$select * from public.workspace_settings$$, '42501', 'permission denied for table workspace_settings', 'anonymous clients cannot read settings');
select throws_ok($$select * from public.apply_workspace_patch('11111111-1111-4111-8111-111111111111', '{}'::jsonb, '{}'::jsonb)$$, '42501', 'permission denied for function apply_workspace_patch', 'anonymous clients cannot write patches');

reset role;
select ok(has_function_privilege('authenticated', 'public.apply_workspace_patch(uuid,jsonb,jsonb)', 'EXECUTE'), 'authenticated clients can execute the patch RPC');
select ok(not has_function_privilege('anon', 'public.apply_workspace_patch(uuid,jsonb,jsonb)', 'EXECUTE'), 'anonymous clients cannot execute the patch RPC');
select ok(not has_table_privilege('authenticated', 'public.groups', 'UPDATE'), 'authenticated clients have no direct group update privilege');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_change_events'), 'Realtime publishes small change events');
select ok(not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_sync_signals'), 'Realtime no longer publishes legacy sync signals');
select ok(not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspaces'), 'Realtime never publishes the legacy JSON document');

select * from finish();
rollback;
