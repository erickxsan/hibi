-- Fingerprint v1 = truncated SHA-256; v2 = full SHA-256. Accept both for compatibility.
create or replace function private.assert_workspace_key_wrapper(
  p_wrapper jsonb,
  p_expected_key_version integer,
  p_allowed_types text[]
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  wrapper_type text := p_wrapper ->> 'type';
begin
  if jsonb_typeof(p_wrapper) is distinct from 'object'
    or not (coalesce(wrapper_type, '') = any(p_allowed_types))
    or coalesce(p_wrapper ->> 'wrapperId', '') !~
      '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
    or coalesce(p_wrapper ->> 'wrapperVersion', '') !~ '^[1-9][0-9]*$'
    or (p_wrapper ->> 'wrapperVersion')::integer not between 1 and 16
    or coalesce(p_wrapper ->> 'keyVersion', '') !~ '^[1-9][0-9]*$'
    or (p_wrapper ->> 'keyVersion')::integer <> p_expected_key_version
    or coalesce(p_wrapper ->> 'nonce', '') !~ '^[A-Za-z0-9_-]{16,32}$'
    or coalesce(p_wrapper ->> 'wrappedKey', '') !~ '^[A-Za-z0-9_-]{48,128}$'
    or (
      wrapper_type = 'password'
      and (
        (p_wrapper ->> 'kdfAlgorithm') is distinct from 'pbkdf2-sha256'
        or coalesce(p_wrapper ->> 'kdfIterations', '') !~ '^[1-9][0-9]*$'
        or (p_wrapper ->> 'kdfIterations')::integer not between 600000 and 5000000
        or coalesce(p_wrapper ->> 'kdfSalt', '') !~ '^[A-Za-z0-9_-]{43}$'
        or coalesce(p_wrapper ->> 'credentialId', '') <> ''
        or coalesce(p_wrapper ->> 'prfSalt', '') <> ''
        or coalesce(p_wrapper ->> 'recoveryFingerprint', '') <> ''
      )
    )
    or (
      wrapper_type = 'recovery'
      and coalesce(p_wrapper ->> 'recoveryFingerprint', '') !~ '^([A-Za-z0-9_-]{14}|[A-Za-z0-9_-]{43})$'
    )
    or (
      wrapper_type = 'passkey'
      and (coalesce(p_wrapper ->> 'credentialId', '') = '' or coalesce(p_wrapper ->> 'prfSalt', '') = '')
    )
  then
    raise exception using errcode = '22023', message = 'invalid_workspace_key_wrapper';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_workspace_key_wrapper';
end;
$$;

-- Revocation must remove cryptographic material. Keep only audit metadata.
create table public.workspace_key_wrapper_revocations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  wrapper_id uuid not null,
  wrapper_type text not null,
  label text,
  key_version integer not null,
  created_at timestamptz not null,
  revoked_at timestamptz not null,
  primary key (owner_id, wrapper_id)
);
alter table public.workspace_key_wrapper_revocations enable row level security;
alter table public.workspace_key_wrapper_revocations force row level security;
revoke all on public.workspace_key_wrapper_revocations from public, anon, authenticated;
grant select on public.workspace_key_wrapper_revocations to authenticated;
create policy wrapper_revocations_owner_select on public.workspace_key_wrapper_revocations
  for select to authenticated using ((select auth.uid()) = owner_id);

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
create trigger purge_revoked_wrapper_material after insert or update of revoked_at on public.workspace_key_wrappers
  for each row execute function private.purge_revoked_wrapper_material();

insert into public.workspace_key_wrapper_revocations
  (owner_id, wrapper_id, wrapper_type, label, key_version, created_at, revoked_at)
select owner_id, wrapper_id, wrapper_type, label, key_version, created_at, revoked_at
from public.workspace_key_wrappers where revoked_at is not null;
delete from public.workspace_key_wrappers where revoked_at is not null;

insert into private.account_erasure_targets (table_schema, table_name, delete_order)
values ('public', 'workspace_key_wrapper_revocations', 169);
