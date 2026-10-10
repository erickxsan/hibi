-- Phase one: keep encrypted recovery copies readable and defer new destructive
-- retention. The dashboard bundle preserves/reinstates pre-existing revoked
-- wrappers inside its transaction before committing this phase.
alter policy encrypted_workspace_snapshots_owner_select on public.encrypted_workspace_snapshots
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());

-- Keep the pre-existing legacy purge unchanged; encrypted copies wait for the
-- separately approved activation migration.
select cron.schedule('hibi-purge-expired-workspace-snapshots', '*/15 * * * *', $command$
  delete from public.workspace_recovery_snapshots where created_at < clock_timestamp() - interval '30 days';
$command$);

create or replace function private.purge_revoked_wrapper_material()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.revoked_at is not null then
    insert into public.workspace_key_wrapper_revocations
      (owner_id, wrapper_id, wrapper_type, label, key_version, created_at, revoked_at)
    values (new.owner_id, new.wrapper_id, new.wrapper_type, new.label, new.key_version, new.created_at, new.revoked_at)
    on conflict (owner_id, wrapper_id) do nothing;
    -- Revocation remains effective. Physical removal waits for phase two.
  end if;
  return new;
end;
$$;
revoke all on function private.purge_revoked_wrapper_material() from public, anon, authenticated;

-- Both phases expose the same application API. Retention activation changes
-- policy only and does not require publishing a second frontend build.
create or replace function public.get_hibi_backend_contract()
returns text language sql stable security definer set search_path = '' as $$
  select 'data-lifecycle-2026-10-09-staged-v1'::text
$$;
revoke all on function public.get_hibi_backend_contract() from public, anon, authenticated;
grant execute on function public.get_hibi_backend_contract() to service_role;

notify pgrst, 'reload schema';
