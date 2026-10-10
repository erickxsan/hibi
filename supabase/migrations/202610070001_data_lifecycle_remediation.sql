-- Keep recovery deadlines stable across migration, re-encryption and inactivity.
alter table public.encrypted_workspace_snapshots add column expires_at timestamptz;
update public.encrypted_workspace_snapshots
set expires_at = least(created_at, coalesce(original_created_at, created_at)) + interval '30 days';
alter table public.encrypted_workspace_snapshots alter column expires_at set not null;
create index encrypted_workspace_snapshots_expiry on public.encrypted_workspace_snapshots(expires_at);

create or replace function private.set_encrypted_snapshot_expiry()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.expires_at := least(new.created_at, coalesce(new.original_created_at, new.created_at)) + interval '30 days';
  if tg_op = 'UPDATE' then new.expires_at := least(new.expires_at, old.expires_at); end if;
  return new;
end;
$$;
revoke all on function private.set_encrypted_snapshot_expiry() from public, anon, authenticated;
create trigger set_encrypted_snapshot_expiry before insert or update on public.encrypted_workspace_snapshots
for each row execute function private.set_encrypted_snapshot_expiry();

alter policy encrypted_workspace_snapshots_owner_select on public.encrypted_workspace_snapshots
using ((select auth.uid()) = owner_id and expires_at > now()
  and not public.current_account_is_deletion_pending());

select cron.schedule('hibi-purge-expired-workspace-snapshots', '*/15 * * * *', $command$
  delete from public.workspace_recovery_snapshots where created_at <= clock_timestamp() - interval '30 days';
  delete from public.encrypted_workspace_snapshots where expires_at <= clock_timestamp();
$command$);

-- Fail rather than discard usable credentials if an old deployment contains duplicates.
create unique index workspace_key_wrappers_one_active_password on public.workspace_key_wrappers(owner_id)
where wrapper_type = 'password' and revoked_at is null;

create or replace function public.add_workspace_key_wrapper(p_expected_owner_id uuid, p_wrapper jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  active_version integer;
begin
  select profile.active_key_version into active_version
  from public.workspace_encryption_profiles as profile
  where profile.owner_id = caller_id and profile.migration_status = 'active' for update;
  if not found then raise exception using errcode = '22023', message = 'invalid_workspace_key_wrapper'; end if;
  perform private.require_e2ee_owner(p_expected_owner_id);
  if exists (select 1 from public.workspace_e2ee_rotation_staging where owner_id = caller_id) then
    raise exception using errcode = '55000', message = 'workspace_key_rotation_pending';
  end if;
  perform private.assert_workspace_key_wrapper(p_wrapper, active_version, array['password', 'recovery']);
  return private.insert_workspace_key_wrapper(caller_id, p_wrapper);
end;
$$;

create or replace function public.replace_workspace_password_wrapper(
  p_expected_owner_id uuid, p_current_wrapper_id uuid, p_wrapper jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  active_version integer;
  replaced integer;
begin
  select profile.active_key_version into active_version
  from public.workspace_encryption_profiles as profile
  where profile.owner_id = caller_id and profile.migration_status = 'active' for update;
  if not found then raise exception using errcode = '55000', message = 'encryption_required'; end if;
  perform private.require_e2ee_owner(p_expected_owner_id);
  if exists (select 1 from public.workspace_e2ee_rotation_staging where owner_id = caller_id) then
    raise exception using errcode = '55000', message = 'workspace_key_rotation_pending';
  end if;
  perform private.assert_workspace_key_wrapper(p_wrapper, active_version, array['password']);
  -- Revoke before inserting to satisfy uniqueness; any insertion failure rolls
  -- back both revocation and the purge trigger's audit metadata.
  update public.workspace_key_wrappers set revoked_at = clock_timestamp()
  where owner_id = caller_id and wrapper_id = p_current_wrapper_id
    and wrapper_type = 'password' and key_version = active_version and revoked_at is null;
  get diagnostics replaced = row_count;
  if replaced <> 1 then
    raise exception using errcode = 'PT409', message = 'workspace_password_wrapper_conflict';
  end if;
  return private.insert_workspace_key_wrapper(caller_id, p_wrapper);
end;
$$;

create or replace function public.revoke_workspace_key_wrapper(p_expected_owner_id uuid, p_wrapper_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  active_version integer;
begin
  select active_key_version into active_version from public.workspace_encryption_profiles
  where owner_id = caller_id and migration_status = 'active' for update;
  if not found then raise exception using errcode = '55000', message = 'encryption_required'; end if;
  perform private.require_e2ee_owner(p_expected_owner_id);
  if exists (select 1 from public.workspace_e2ee_rotation_staging where owner_id = caller_id) then
    raise exception using errcode = '55000', message = 'workspace_key_rotation_pending';
  end if;
  if (select count(*) from public.workspace_key_wrappers
      where owner_id = caller_id and key_version = active_version and revoked_at is null) <= 1 then
    raise exception using errcode = '55000', message = 'cannot_revoke_last_workspace_key';
  end if;
  update public.workspace_key_wrappers set revoked_at = clock_timestamp()
  where owner_id = caller_id and wrapper_id = p_wrapper_id and key_version = active_version and revoked_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'workspace_key_wrapper_not_found'; end if;
end;
$$;

-- The secret is the reconciliation credential. Authenticated retries can adopt
-- an existing request; a lost response must still locate the effective ID.
create or replace function public.get_account_deletion_receipt(p_request_id uuid, p_receipt_secret text)
returns table(request_id uuid, owner_id uuid, status text, requested_at timestamptz,
  data_erased_at timestamptz, completed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select request.request_id, request.owner_id, request.status, request.requested_at,
    request.data_erased_at, request.completed_at
  from public.account_deletion_requests as request
  where p_request_id is not null
    and p_receipt_secret ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and request.receipt_hash = private.account_hash(p_receipt_secret)
  order by (request.request_id = p_request_id) desc limit 1
$$;
revoke all on function public.get_account_deletion_receipt(uuid,text) from public, anon, authenticated;
grant execute on function public.get_account_deletion_receipt(uuid,text) to service_role;

-- Align E2EE reads with the tombstone already enforced by all write RPCs.
alter policy workspace_encryption_profiles_owner_select on public.workspace_encryption_profiles
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());
alter policy workspace_key_wrappers_owner_select on public.workspace_key_wrappers
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());
alter policy wrapper_revocations_owner_select on public.workspace_key_wrapper_revocations
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());
alter policy encrypted_workspace_entities_owner_select on public.encrypted_workspace_entities
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());
alter policy encrypted_workspace_change_events_owner_select on public.encrypted_workspace_change_events
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());
alter policy encrypted_workspace_import_receipts_owner_select on public.encrypted_workspace_import_receipts
using ((select auth.uid()) = owner_id and not public.current_account_is_deletion_pending());
