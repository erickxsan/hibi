-- REVIEW BEFORE APPLYING. Target: Hibi / bqrmsxlbiotpdgrjjgkz.
-- PHASE 2: irreversible retention activation; BLOCKED pending tested restore. Prepared locally; never executed remotely by this script.
-- Apply the entire transaction once. Do not run migration fragments separately.
begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';
-- Replace this marker only after documenting a successful restore in
-- RESPALDO-Y-RESTAURACION.md and obtaining the user's action-time approval.
select set_config('hibi.restore_test_reference', '__PENDING_RESTORE_TEST__', true);
do $restore_required$
begin
  if coalesce(current_setting('hibi.restore_test_reference', true), '') in ('', '__PENDING_RESTORE_TEST__') then
    raise exception 'Phase two is blocked: a tested restore and explicit approval are required';
  end if;
end;
$restore_required$;
do $preflight$
begin
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations)
    is distinct from array['202607110001','202607140001','202607190001','202607190002','202607270001','202608110001','202608120001','202608120002','202608120003','202608120004','202608120005','202608120006','202608120007','202608250001','202608260001','202608260002','202608260003','202609070001','202609070002','202609210001','202610020001','202610070001','202610070002','202610090001']::text[] then
    raise exception 'Migration history changed; recheck this reviewed phase before applying';
  end if;
end;
$preflight$;

-- Migration 202610090002_activate_recovery_retention.sql
-- Phase two: apply only after a tested restore and explicit destructive-action
-- approval. The reviewed dashboard bundle enforces the operator's restore-test
-- reference before reaching this migration. Fresh disposable test databases
-- may apply it normally to verify the fully activated policy.
alter policy encrypted_workspace_snapshots_owner_select on public.encrypted_workspace_snapshots
using ((select auth.uid()) = owner_id and expires_at > now()
  and not public.current_account_is_deletion_pending());

select cron.schedule('hibi-purge-expired-workspace-snapshots', '*/15 * * * *', $command$
  delete from public.workspace_recovery_snapshots where created_at <= clock_timestamp() - interval '30 days';
  delete from public.encrypted_workspace_snapshots where expires_at <= clock_timestamp();
$command$);

create or replace function private.purge_revoked_wrapper_material()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null then
    insert into public.workspace_key_wrapper_revocations
      (owner_id, wrapper_id, wrapper_type, label, key_version, created_at, revoked_at)
    values (new.owner_id, new.wrapper_id, new.wrapper_type, new.label, new.key_version, new.created_at, new.revoked_at)
    on conflict (owner_id, wrapper_id) do nothing;
    delete from public.workspace_key_wrappers where owner_id = new.owner_id and wrapper_id = new.wrapper_id;
  end if;
  return new;
end;
$$;
revoke all on function private.purge_revoked_wrapper_material() from public, anon, authenticated;

insert into public.workspace_key_wrapper_revocations
  (owner_id, wrapper_id, wrapper_type, label, key_version, created_at, revoked_at)
select owner_id, wrapper_id, wrapper_type, label, key_version, created_at, revoked_at
from public.workspace_key_wrappers where revoked_at is not null
on conflict (owner_id, wrapper_id) do nothing;
delete from public.workspace_key_wrappers where revoked_at is not null;

notify pgrst, 'reload schema';

insert into supabase_migrations.schema_migrations(version,name) values('202610090002','activate_recovery_retention');

commit;
select version,name from supabase_migrations.schema_migrations order by version;
select jobname,schedule,active,command from cron.job where jobname like 'hibi-%';
