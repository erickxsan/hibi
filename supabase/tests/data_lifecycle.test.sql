begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data)
values('77777777-7777-4777-8777-777777777777','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle@example.test','x','{}','{}');
insert into public.workspace_encryption_profiles(owner_id,workspace_crypto_id,protocol_version,schema_version,migration_status)
values('77777777-7777-4777-8777-777777777777','lifecycle_crypto',1,2,'active');
insert into public.encrypted_workspace_snapshots(id,owner_id,source_revision,reason,envelopes,manifest,created_at,original_created_at)
values
('70000000-0000-4000-8000-000000000001','77777777-7777-4777-8777-777777777777',1,'reset','[]','{}',now()-interval '31 days',null),
('70000000-0000-4000-8000-000000000002','77777777-7777-4777-8777-777777777777',2,'rotation','[]','{}',now(),now()-interval '29 days'),
('70000000-0000-4000-8000-000000000003','77777777-7777-4777-8777-777777777777',3,'migration','[]','{}',now(),now()-interval '31 days');
select is((select expires_at from public.encrypted_workspace_snapshots where id='70000000-0000-4000-8000-000000000002'),now()+interval '1 day','rotation retains the original 29-day age');
select is((select expires_at from public.encrypted_workspace_snapshots where id='70000000-0000-4000-8000-000000000003'),now()-interval '1 day','migration retains an expired original date');
update public.encrypted_workspace_snapshots set original_created_at=now(),created_at=now()
where id='70000000-0000-4000-8000-000000000002';
select is((select expires_at from public.encrypted_workspace_snapshots where id='70000000-0000-4000-8000-000000000002'),now()+interval '1 day','an update cannot extend the deadline');
-- Restore the original clock for the rotation-staging assertion.
update public.encrypted_workspace_snapshots set original_created_at=now()-interval '29 days'
where id='70000000-0000-4000-8000-000000000002';
insert into public.workspace_e2ee_rotation_staging(owner_id,operation_id,expected_revision,next_key_version,manifest)
values('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000099',0,2,'{}');
insert into public.workspace_e2ee_rotation_snapshots(id,owner_id,snapshot)
values('70000000-0000-4000-8000-000000000002','77777777-7777-4777-8777-777777777777',jsonb_build_object('originalCreatedAt',now()));
select is((select (snapshot->>'originalCreatedAt')::timestamptz from public.workspace_e2ee_rotation_snapshots),now()-interval '29 days','rotation staging replaces a forged new date with the stored clock');
set local role authenticated;
set local request.jwt.claim.sub='77777777-7777-4777-8777-777777777777';
set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.encrypted_workspace_snapshots),1::bigint,'RLS hides both expired copies before cron');
select throws_ok($$select public.add_workspace_key_wrapper(auth.uid(),'{}')$$,'55000','workspace_key_rotation_pending','addition is blocked during rotation');
select throws_ok($$select public.revoke_workspace_key_wrapper(auth.uid(),'70000000-0000-4000-8000-000000000001')$$,'55000','workspace_key_rotation_pending','revocation is blocked during rotation');
select throws_ok($$select public.replace_workspace_password_wrapper(auth.uid(),'70000000-0000-4000-8000-000000000001','{}')$$,'55000','workspace_key_rotation_pending','password replacement is blocked during rotation');
reset role;
do $$ declare command_text text; begin
  select command into command_text from cron.job where jobname='hibi-purge-expired-workspace-snapshots'; execute command_text;
end $$;
select is((select count(*) from public.encrypted_workspace_snapshots where owner_id='77777777-7777-4777-8777-777777777777'),1::bigint,'real cron removes expired copies and preserves 29-day copy');
delete from public.workspace_e2ee_rotation_staging where owner_id='77777777-7777-4777-8777-777777777777';
insert into public.workspace_key_wrappers(owner_id,wrapper_id,wrapper_type,recovery_fingerprint,wrapper_version,key_version,nonce,wrapped_key)
values('77777777-7777-4777-8777-777777777777','70000000-0000-4000-8000-000000000001','recovery',repeat('F',43),1,1,repeat('N',16),repeat('W',64));
set local role authenticated;
select throws_ok($$select public.revoke_workspace_key_wrapper(auth.uid(),'70000000-0000-4000-8000-000000000001')$$,'55000','cannot_revoke_last_workspace_key','last current-version key remains available');
select * from public.begin_account_deletion('70000000-0000-4000-8000-000000000091',auth.uid(),'DELETE MY ACCOUNT','70000000-0000-4000-8000-000000000092');
select is((select count(*) from public.workspace_key_wrappers),0::bigint,'tombstone denies direct key reads');
select is((select count(*) from public.encrypted_workspace_snapshots),0::bigint,'tombstone denies direct snapshot reads');
select is((select count(*) from public.workspace_encryption_profiles),0::bigint,'tombstone denies profile reads');
select throws_ok($$select * from public.get_account_deletion_receipt('70000000-0000-4000-8000-000000000091','70000000-0000-4000-8000-000000000092')$$,'42501','permission denied for function get_account_deletion_receipt','browser cannot invoke receipt SQL directly');
set local role service_role;
select is((select request_id from public.get_account_deletion_receipt('70000000-0000-4000-8000-000000000093','70000000-0000-4000-8000-000000000092')),'70000000-0000-4000-8000-000000000091'::uuid,'lost effective ID is reconciled using the high-entropy secret');
select is((select count(*) from public.get_account_deletion_receipt('70000000-0000-4000-8000-000000000091','70000000-0000-4000-8000-000000000094')),0::bigint,'wrong secret reveals no receipt');
reset role;
select ok(not has_function_privilege('anon','private.preserve_rotated_snapshot_clock()','execute'),'anonymous role has no private helper permission');
select ok(not has_function_privilege('authenticated','private.preserve_rotated_snapshot_clock()','execute'),'authenticated role has no private helper permission');
select ok(not has_function_privilege('authenticated','public.get_hibi_backend_contract()','execute'),'browser has no administrative backend handshake permission');
select ok(has_function_privilege('service_role','public.get_hibi_backend_contract()','execute'),'Edge Function can verify its database version');
select * from finish();
rollback;
