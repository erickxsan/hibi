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
