-- Re-encryption cannot trust a client's replacement timestamp to extend the
-- lifetime of an existing snapshot. Capture its authoritative date at staging.
create or replace function private.preserve_rotated_snapshot_clock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare captured_at timestamptz;
begin
  select expires_at - interval '30 days' into captured_at
  from public.encrypted_workspace_snapshots where owner_id = new.owner_id and id = new.id;
  if found then
    new.snapshot := jsonb_set(new.snapshot, '{originalCreatedAt}', to_jsonb(captured_at));
  elsif tg_op = 'UPDATE' then
    new.snapshot := jsonb_set(new.snapshot, '{originalCreatedAt}', to_jsonb(least(
      (old.snapshot ->> 'originalCreatedAt')::timestamptz,
      (new.snapshot ->> 'originalCreatedAt')::timestamptz)));
  end if;
  return new;
end;
$$;
create trigger preserve_rotated_snapshot_clock before insert or update on public.workspace_e2ee_rotation_snapshots
for each row execute function private.preserve_rotated_snapshot_clock();

create or replace function private.preserve_migrated_snapshot_clock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare captured_at timestamptz;
begin
  select created_at into captured_at from public.workspace_recovery_snapshots
  where owner_id = new.owner_id and id = new.id;
  if found then new.original_created_at := captured_at; end if;
  if tg_op = 'UPDATE' then
    new.original_created_at := least(old.original_created_at, new.original_created_at);
  end if;
  return new;
end;
$$;
create trigger preserve_migrated_snapshot_clock before insert or update on public.workspace_e2ee_migration_snapshots
for each row execute function private.preserve_migrated_snapshot_clock();

revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public;

-- The Edge Function uses this service-only, read-only handshake to prove that
-- its matching database migrations were published before the frontend.
create or replace function public.get_hibi_backend_contract()
returns text language sql stable security definer set search_path = '' as $$
  select 'data-lifecycle-2026-10-07-v1'::text
$$;
revoke all on function public.get_hibi_backend_contract() from public, anon, authenticated;
grant execute on function public.get_hibi_backend_contract() to service_role;
