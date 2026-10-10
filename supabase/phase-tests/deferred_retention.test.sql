-- Run only after the complete phase-one dashboard transaction and its synthetic
-- preservation fixture. This is intentionally outside tests/, where the normal
-- database gate validates the fully activated final schema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
select is((select count(*) from supabase_migrations.schema_migrations),24::bigint,'phase one records exactly its 24 versions');
select is((select to_jsonb(wrapper) from public.workspace_key_wrappers as wrapper where wrapper_id='80000000-0000-4000-8000-000000000002'),
  (select data from pg_temp.hibi_expected_revoked_wrapper),'historical revoked wrapper is preserved byte-for-byte');
select is((select count(*) from public.encrypted_workspace_snapshots where owner_id='88888888-8888-4888-8888-888888888888'),2::bigint,'phase one retains expired encrypted copies');
select ok((select command not like '%encrypted_workspace_snapshots%' from cron.job where jobname='hibi-purge-expired-workspace-snapshots'),'phase-one cron does not purge encrypted copies');
select is(public.get_hibi_backend_contract(),'data-lifecycle-2026-10-09-staged-v1','the staged application contract is available');
set local role authenticated;
set local request.jwt.claim.sub='88888888-8888-4888-8888-888888888888';
set local request.jwt.claim.role='authenticated';
select is((select count(*) from public.encrypted_workspace_snapshots),2::bigint,'the owner can still read both expired copies');
set local request.jwt.claim.sub='99999999-9999-4999-8999-999999999999';
select is((select count(*) from public.encrypted_workspace_snapshots),0::bigint,'preservation does not expose copies to another owner');
set local request.jwt.claim.sub='88888888-8888-4888-8888-888888888888';
select throws_ok($$select public.revoke_workspace_key_wrapper(auth.uid(),'80000000-0000-4000-8000-000000000001')$$,
  '55000','cannot_revoke_last_workspace_key','last active key remains protected');
reset role;
insert into public.workspace_key_wrappers(owner_id,wrapper_id,wrapper_type,recovery_fingerprint,wrapper_version,key_version,nonce,wrapped_key)
values('88888888-8888-4888-8888-888888888888','80000000-0000-4000-8000-000000000003','recovery',repeat('G',43),1,1,repeat('N',16),repeat('W',64));
set local role authenticated;
select lives_ok($$select public.revoke_workspace_key_wrapper(auth.uid(),'80000000-0000-4000-8000-000000000001')$$,'revocation still works when another key remains');
reset role;
select is((select count(*) from public.workspace_key_wrappers where owner_id='88888888-8888-4888-8888-888888888888' and revoked_at is not null),2::bigint,'newly revoked material is also retained until phase two');
select is((select count(*) from public.workspace_key_wrapper_revocations where owner_id='88888888-8888-4888-8888-888888888888'),2::bigint,'revocation audit metadata is recorded');
do $$ declare command_text text; begin
  select command into command_text from cron.job where jobname='hibi-purge-expired-workspace-snapshots'; execute command_text;
end $$;
select is((select count(*) from public.encrypted_workspace_snapshots where owner_id='88888888-8888-4888-8888-888888888888'),2::bigint,'executing phase-one cron preserves the encrypted copies');
set local role authenticated;
select * from public.begin_account_deletion('80000000-0000-4000-8000-000000000091',auth.uid(),'DELETE MY ACCOUNT','80000000-0000-4000-8000-000000000092');
select is((select count(*) from public.encrypted_workspace_snapshots),0::bigint,'a separately authorized account-deletion tombstone still hides its data');
set local role service_role;
select is((select request_id from public.get_account_deletion_receipt('80000000-0000-4000-8000-000000000093','80000000-0000-4000-8000-000000000092')),
  '80000000-0000-4000-8000-000000000091'::uuid,'durable receipt reconciliation works before retention activation');
reset role;
select * from finish();
rollback;
