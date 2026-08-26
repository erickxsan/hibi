-- Mandatory end-to-end encrypted workspace protocol.
-- Supabase stores only authenticated envelopes and synchronization metadata after activation.

create table public.workspace_encryption_profiles (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  workspace_crypto_id text not null unique check (workspace_crypto_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  protocol_version smallint not null check (protocol_version between 1 and 16),
  schema_version integer not null check (schema_version between 1 and 1024),
  active_key_version integer not null default 1 check (active_key_version between 1 and 1024),
  workspace_revision bigint not null default 0 check (workspace_revision >= 0),
  migration_status text not null check (migration_status in ('migration_started', 'active')),
  manifest jsonb,
  manifest_root text,
  manifest_mac text,
  migration_started_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.workspace_e2ee_rollout_config (
  singleton smallint primary key default 1 check (singleton = 1),
  mode text not null check (mode in ('disabled', 'canary', 'required')),
  updated_at timestamptz not null default now()
);

insert into public.workspace_e2ee_rollout_config (singleton, mode) values (1, 'canary');

create table public.workspace_e2ee_rollout_allowlist (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_key_wrappers (
  owner_id uuid not null references auth.users(id) on delete restrict,
  wrapper_id uuid not null,
  wrapper_type text not null check (wrapper_type in ('passkey', 'recovery')),
  label text not null default '' check (length(label) <= 120),
  credential_id text,
  prf_salt text,
  transports jsonb not null default '[]'::jsonb check (jsonb_typeof(transports) = 'array'),
  recovery_fingerprint text,
  wrapper_version smallint not null check (wrapper_version between 1 and 16),
  key_version integer not null check (key_version between 1 and 1024),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  wrapped_key text not null check (wrapped_key ~ '^[A-Za-z0-9_-]{48,128}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  primary key (owner_id, wrapper_id),
  check (
    (wrapper_type = 'passkey' and credential_id is not null and prf_salt is not null and recovery_fingerprint is null)
    or (wrapper_type = 'recovery' and credential_id is null and prf_salt is null and recovery_fingerprint is not null)
  )
);

create unique index workspace_key_wrappers_active_credential
  on public.workspace_key_wrappers (owner_id, credential_id)
  where credential_id is not null and revoked_at is null;

create table public.encrypted_workspace_entities (
  owner_id uuid not null references auth.users(id) on delete restrict,
  collection text not null check (
    collection in ('settings', 'groups', 'students', 'grades', 'classLog', 'classSchedules', 'scheduleExceptions', 'scheduleChanges')
  ),
  entity_id text not null check (length(entity_id) between 1 and 200),
  entity_revision bigint not null check (entity_revision > 0),
  schema_version integer not null check (schema_version between 1 and 1024),
  key_version integer not null check (key_version between 1 and 1024),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  ciphertext text not null check (ciphertext ~ '^[A-Za-z0-9_-]+$' and length(ciphertext) <= 8388608),
  updated_at timestamptz not null default now(),
  primary key (owner_id, collection, entity_id)
);

create table public.encrypted_workspace_change_events (
  owner_id uuid not null references auth.users(id) on delete restrict,
  workspace_revision bigint not null check (workspace_revision > 0),
  operation_id uuid not null,
  upserts jsonb not null default '[]'::jsonb check (jsonb_typeof(upserts) = 'array'),
  deleted_entities jsonb not null default '[]'::jsonb check (jsonb_typeof(deleted_entities) = 'array'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_id, workspace_revision),
  unique (owner_id, operation_id)
);

create table public.encrypted_workspace_snapshots (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  source_revision bigint not null check (source_revision >= 0),
  reason text not null check (reason in ('migration', 'replace', 'import', 'restore', 'reset', 'rotation')),
  envelopes jsonb not null check (jsonb_typeof(envelopes) = 'array' and pg_catalog.pg_column_size(envelopes) <= 26214400),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  original_created_at timestamptz,
  created_at timestamptz not null default now()
);

create index encrypted_workspace_snapshots_owner_created
  on public.encrypted_workspace_snapshots (owner_id, created_at desc);

create table public.workspace_e2ee_migration_entities (
  owner_id uuid not null references auth.users(id) on delete restrict,
  collection text not null,
  entity_id text not null,
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
  primary key (owner_id, collection, entity_id)
);

create table public.workspace_e2ee_migration_snapshots (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  original_created_at timestamptz
);

create table public.encrypted_workspace_mutation_receipts (
  owner_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  result_revision bigint not null check (result_revision > 0),
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

create table public.encrypted_workspace_import_receipts (
  owner_id uuid not null references auth.users(id) on delete restrict,
  import_fingerprint text not null check (import_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  result_revision bigint not null check (result_revision >= 0),
  key_version integer not null check (key_version between 1 and 1024),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,32}$'),
  ciphertext text not null check (ciphertext ~ '^[A-Za-z0-9_-]+$' and length(ciphertext) <= 65536),
  original_created_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id, import_fingerprint)
);

create table public.workspace_e2ee_migration_import_receipts (
  owner_id uuid not null references auth.users(id) on delete restrict,
  import_fingerprint text not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  original_created_at timestamptz,
  primary key (owner_id, import_fingerprint)
);

create table public.workspace_e2ee_rotation_staging (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  operation_id uuid not null unique,
  expected_revision bigint not null check (expected_revision >= 0),
  next_key_version integer not null check (next_key_version between 2 and 1024),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default now()
);

create table public.workspace_e2ee_rotation_entities (
  owner_id uuid not null references public.workspace_e2ee_rotation_staging(owner_id) on delete cascade,
  collection text not null,
  entity_id text not null,
  envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
  primary key (owner_id, collection, entity_id)
);

create table public.workspace_e2ee_rotation_snapshots (
  id uuid not null,
  owner_id uuid not null references public.workspace_e2ee_rotation_staging(owner_id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  primary key (owner_id, id)
);

create table public.workspace_e2ee_rotation_import_receipts (
  owner_id uuid not null references public.workspace_e2ee_rotation_staging(owner_id) on delete cascade,
  import_fingerprint text not null,
  item jsonb not null check (jsonb_typeof(item) = 'object'),
  primary key (owner_id, import_fingerprint)
);

create table public.workspace_e2ee_rotation_wrappers (
  owner_id uuid not null references public.workspace_e2ee_rotation_staging(owner_id) on delete cascade,
  wrapper_id uuid not null,
  wrapper jsonb not null check (jsonb_typeof(wrapper) = 'object'),
  primary key (owner_id, wrapper_id)
);

alter table public.workspace_encryption_profiles enable row level security;
alter table public.workspace_e2ee_rollout_config enable row level security;
alter table public.workspace_e2ee_rollout_allowlist enable row level security;
alter table public.workspace_key_wrappers enable row level security;
alter table public.encrypted_workspace_entities enable row level security;
alter table public.encrypted_workspace_change_events enable row level security;
alter table public.encrypted_workspace_snapshots enable row level security;
alter table public.workspace_e2ee_migration_entities enable row level security;
alter table public.workspace_e2ee_migration_snapshots enable row level security;
alter table public.encrypted_workspace_mutation_receipts enable row level security;
alter table public.encrypted_workspace_import_receipts enable row level security;
alter table public.workspace_e2ee_migration_import_receipts enable row level security;
alter table public.workspace_e2ee_rotation_staging enable row level security;
alter table public.workspace_e2ee_rotation_entities enable row level security;
alter table public.workspace_e2ee_rotation_snapshots enable row level security;
alter table public.workspace_e2ee_rotation_import_receipts enable row level security;
alter table public.workspace_e2ee_rotation_wrappers enable row level security;

alter table public.workspace_encryption_profiles force row level security;
alter table public.workspace_e2ee_rollout_config force row level security;
alter table public.workspace_e2ee_rollout_allowlist force row level security;
alter table public.workspace_key_wrappers force row level security;
alter table public.encrypted_workspace_entities force row level security;
alter table public.encrypted_workspace_change_events force row level security;
alter table public.encrypted_workspace_snapshots force row level security;
alter table public.workspace_e2ee_migration_entities force row level security;
alter table public.workspace_e2ee_migration_snapshots force row level security;
alter table public.encrypted_workspace_mutation_receipts force row level security;
alter table public.encrypted_workspace_import_receipts force row level security;
alter table public.workspace_e2ee_migration_import_receipts force row level security;
alter table public.workspace_e2ee_rotation_staging force row level security;
alter table public.workspace_e2ee_rotation_entities force row level security;
alter table public.workspace_e2ee_rotation_snapshots force row level security;
alter table public.workspace_e2ee_rotation_import_receipts force row level security;
alter table public.workspace_e2ee_rotation_wrappers force row level security;

create policy workspace_encryption_profiles_owner_select on public.workspace_encryption_profiles
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy workspace_key_wrappers_owner_select on public.workspace_key_wrappers
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy encrypted_workspace_entities_owner_select on public.encrypted_workspace_entities
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy encrypted_workspace_change_events_owner_select on public.encrypted_workspace_change_events
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy encrypted_workspace_snapshots_owner_select on public.encrypted_workspace_snapshots
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy encrypted_workspace_import_receipts_owner_select on public.encrypted_workspace_import_receipts
  for select to authenticated using ((select auth.uid()) = owner_id);

revoke all on table public.workspace_encryption_profiles from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rollout_config from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rollout_allowlist from public, anon, authenticated;
revoke all on table public.workspace_key_wrappers from public, anon, authenticated;
revoke all on table public.encrypted_workspace_entities from public, anon, authenticated;
revoke all on table public.encrypted_workspace_change_events from public, anon, authenticated;
revoke all on table public.encrypted_workspace_snapshots from public, anon, authenticated;
revoke all on table public.workspace_e2ee_migration_entities from public, anon, authenticated;
revoke all on table public.workspace_e2ee_migration_snapshots from public, anon, authenticated;
revoke all on table public.encrypted_workspace_mutation_receipts from public, anon, authenticated;
revoke all on table public.encrypted_workspace_import_receipts from public, anon, authenticated;
revoke all on table public.workspace_e2ee_migration_import_receipts from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rotation_staging from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rotation_entities from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rotation_snapshots from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rotation_import_receipts from public, anon, authenticated;
revoke all on table public.workspace_e2ee_rotation_wrappers from public, anon, authenticated;

grant select on table public.workspace_encryption_profiles to authenticated;
grant select on table public.workspace_key_wrappers to authenticated;
grant select on table public.encrypted_workspace_entities to authenticated;
grant select on table public.encrypted_workspace_change_events to authenticated;
grant select on table public.encrypted_workspace_snapshots to authenticated;
grant select on table public.encrypted_workspace_import_receipts to authenticated;

create or replace function private.require_e2ee_owner(p_expected_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then
    raise exception using errcode = '42501', message = 'account_changed';
  end if;
  if exists (
    select 1 from public.account_deletion_requests as request
    where request.owner_id = caller_id and request.status in ('pending', 'data_erased')
  ) then
    raise exception using errcode = '55000', message = 'account_deletion_pending';
  end if;
  return caller_id;
end;
$$;

create or replace function public.workspace_e2ee_rollout_status(p_expected_owner_id uuid)
returns table(enabled boolean, rollout_mode text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  configured_mode text;
begin
  select config.mode into configured_mode
  from public.workspace_e2ee_rollout_config as config
  where config.singleton = 1;
  return query select
    exists (
      select 1 from public.workspace_encryption_profiles as profile where profile.owner_id = caller_id
    )
    or configured_mode = 'required'
    or (
      configured_mode = 'canary' and exists (
        select 1 from public.workspace_e2ee_rollout_allowlist as allowed where allowed.owner_id = caller_id
      )
    ),
    coalesce(configured_mode, 'disabled');
end;
$$;

create or replace function private.assert_e2ee_envelope(p_envelope jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_envelope) <> 'object'
    or (p_envelope - array[
      'collection', 'entityId', 'entityRevision', 'schemaVersion', 'keyVersion', 'nonce', 'ciphertext'
    ]) <> '{}'::jsonb
    or p_envelope ->> 'collection' not in (
      'settings', 'groups', 'students', 'grades', 'classLog', 'classSchedules', 'scheduleExceptions', 'scheduleChanges'
    )
    or length(coalesce(p_envelope ->> 'entityId', '')) not between 1 and 200
    or coalesce(p_envelope ->> 'entityRevision', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_envelope ->> 'schemaVersion', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_envelope ->> 'keyVersion', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_envelope ->> 'nonce', '') !~ '^[A-Za-z0-9_-]{16,32}$'
    or coalesce(p_envelope ->> 'ciphertext', '') !~ '^[A-Za-z0-9_-]+$'
    or length(p_envelope ->> 'ciphertext') > 8388608
  then
    raise exception using errcode = '22023', message = 'invalid_encrypted_entity_envelope';
  end if;
  if p_envelope ->> 'collection' = 'settings' and p_envelope ->> 'entityId' <> '__settings__' then
    raise exception using errcode = '22023', message = 'invalid_settings_envelope';
  end if;
end;
$$;

create or replace function private.assert_e2ee_manifest(
  p_manifest jsonb,
  p_workspace_crypto_id text,
  p_revision bigint,
  p_previous_root text,
  p_entity_count bigint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_manifest) <> 'object'
    or (p_manifest - array[
      'protocolVersion', 'workspaceCryptoId', 'workspaceRevision', 'root', 'previousRoot',
      'entityCount', 'schemaVersion', 'keyVersion', 'operationId', 'mac'
    ]) <> '{}'::jsonb
    or p_manifest ->> 'workspaceCryptoId' <> p_workspace_crypto_id
    or (p_manifest ->> 'workspaceRevision')::bigint <> p_revision
    or coalesce(p_manifest ->> 'root', '') !~ '^[A-Za-z0-9_-]{40,64}$'
    or coalesce(p_manifest ->> 'mac', '') !~ '^[A-Za-z0-9_-]{40,64}$'
    or (p_manifest ->> 'entityCount')::bigint <> p_entity_count
    or (p_manifest ->> 'protocolVersion')::integer not between 1 and 16
    or (p_manifest ->> 'schemaVersion')::integer not between 1 and 1024
    or (p_manifest ->> 'keyVersion')::integer not between 1 and 1024
    or coalesce(p_manifest ->> 'operationId', '') !~
      '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
    or (p_manifest ->> 'previousRoot') is distinct from p_previous_root
  then
    raise exception using errcode = '22023', message = 'invalid_workspace_manifest';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_workspace_manifest';
end;
$$;

create or replace function private.assert_e2ee_snapshot(
  p_snapshot jsonb,
  p_workspace_crypto_id text,
  p_expected_key_version integer,
  p_rotation boolean default false
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  envelope jsonb;
  allowed_keys text[] := case when p_rotation then
    array['id', 'sourceRevision', 'originalCreatedAt', 'keyVersion', 'envelopes', 'manifest']
  else
    array['id', 'sourceRevision', 'envelopes', 'manifest']
  end;
begin
  if jsonb_typeof(p_snapshot) <> 'object'
    or (p_snapshot - allowed_keys) <> '{}'::jsonb
    or coalesce(p_snapshot ->> 'sourceRevision', '') !~ '^(0|[1-9][0-9]*)$'
    or jsonb_typeof(p_snapshot -> 'envelopes') <> 'array'
    or jsonb_array_length(p_snapshot -> 'envelopes') < 1
    or jsonb_typeof(p_snapshot -> 'manifest') <> 'object'
    or pg_catalog.pg_column_size(p_snapshot) > 26214400
    or (p_snapshot ? 'id' and coalesce(p_snapshot ->> 'id', '') !~
      '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$')
    or (p_rotation and coalesce(p_snapshot ->> 'keyVersion', '') !~ '^[1-9][0-9]*$')
    or (p_rotation and (p_snapshot ->> 'keyVersion')::integer <> p_expected_key_version)
  then
    raise exception using errcode = '22023', message = 'invalid_encrypted_snapshot';
  end if;

  perform private.assert_e2ee_manifest(
    p_snapshot -> 'manifest',
    p_workspace_crypto_id,
    (p_snapshot ->> 'sourceRevision')::bigint,
    null,
    jsonb_array_length(p_snapshot -> 'envelopes')
  );
  if (p_snapshot -> 'manifest' ->> 'keyVersion')::integer <> p_expected_key_version then
    raise exception using errcode = '22023', message = 'snapshot_key_version_mismatch';
  end if;

  for envelope in select value from jsonb_array_elements(p_snapshot -> 'envelopes') loop
    perform private.assert_e2ee_envelope(envelope);
    if (envelope ->> 'keyVersion')::integer <> p_expected_key_version then
      raise exception using errcode = '22023', message = 'snapshot_key_version_mismatch';
    end if;
  end loop;
  if (
    select count(*) <> count(distinct (value ->> 'collection', value ->> 'entityId'))
    from jsonb_array_elements(p_snapshot -> 'envelopes')
  ) then
    raise exception using errcode = '22023', message = 'duplicate_encrypted_snapshot_entity';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_snapshot -> 'envelopes')
    where value ->> 'collection' = 'settings' and value ->> 'entityId' = '__settings__'
  ) then
    raise exception using errcode = '22023', message = 'encrypted_snapshot_settings_missing';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_encrypted_snapshot';
end;
$$;

create or replace function private.assert_e2ee_import_receipt(
  p_receipt jsonb,
  p_expected_key_version integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_receipt) <> 'object'
    or (p_receipt - array['fingerprint', 'resultRevision', 'keyVersion', 'nonce', 'ciphertext']) <> '{}'::jsonb
    or coalesce(p_receipt ->> 'fingerprint', '') !~ '^[A-Za-z0-9_-]{43}$'
    or coalesce(p_receipt ->> 'resultRevision', '') !~ '^(0|[1-9][0-9]*)$'
    or coalesce(p_receipt ->> 'keyVersion', '') !~ '^[1-9][0-9]*$'
    or (p_receipt ->> 'keyVersion')::integer <> p_expected_key_version
    or coalesce(p_receipt ->> 'nonce', '') !~ '^[A-Za-z0-9_-]{16,32}$'
    or coalesce(p_receipt ->> 'ciphertext', '') !~ '^[A-Za-z0-9_-]+$'
    or length(p_receipt ->> 'ciphertext') > 65536
  then
    raise exception using errcode = '22023', message = 'invalid_encrypted_import_receipt';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_encrypted_import_receipt';
end;
$$;

create or replace function private.insert_e2ee_envelope(p_owner_id uuid, p_envelope jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_e2ee_envelope(p_envelope);
  insert into public.encrypted_workspace_entities (
    owner_id, collection, entity_id, entity_revision, schema_version, key_version, nonce, ciphertext
  ) values (
    p_owner_id,
    p_envelope ->> 'collection',
    p_envelope ->> 'entityId',
    (p_envelope ->> 'entityRevision')::bigint,
    (p_envelope ->> 'schemaVersion')::integer,
    (p_envelope ->> 'keyVersion')::integer,
    p_envelope ->> 'nonce',
    p_envelope ->> 'ciphertext'
  );
end;
$$;

create or replace function private.current_e2ee_envelopes(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'collection', entity.collection,
        'entityId', entity.entity_id,
        'entityRevision', entity.entity_revision,
        'schemaVersion', entity.schema_version,
        'keyVersion', entity.key_version,
        'nonce', entity.nonce,
        'ciphertext', entity.ciphertext
      ) order by entity.collection, entity.entity_id
    ),
    '[]'::jsonb
  )
  from public.encrypted_workspace_entities as entity
  where entity.owner_id = p_owner_id
$$;

create or replace function public.begin_workspace_e2ee_migration(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_protocol_version smallint,
  p_schema_version integer,
  p_wrapper jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  existing public.workspace_encryption_profiles%rowtype;
begin
  select * into existing from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if found and existing.migration_status = 'active' then
    raise exception using errcode = '55000', message = 'encryption_already_active';
  end if;
  if found and existing.workspace_crypto_id <> p_workspace_crypto_id then
    raise exception using errcode = '55000', message = 'different_migration_in_progress';
  end if;
  if p_wrapper ->> 'type' <> 'passkey' then
    raise exception using errcode = '22023', message = 'migration_requires_passkey_wrapper';
  end if;

  insert into public.workspace_encryption_profiles (
    owner_id, workspace_crypto_id, protocol_version, schema_version, migration_status
  ) values (caller_id, p_workspace_crypto_id, p_protocol_version, p_schema_version, 'migration_started')
  on conflict (owner_id) do update set updated_at = now();

  insert into public.workspace_key_wrappers (
    owner_id, wrapper_id, wrapper_type, label, credential_id, prf_salt, transports,
    wrapper_version, key_version, nonce, wrapped_key
  ) values (
    caller_id,
    (p_wrapper ->> 'wrapperId')::uuid,
    'passkey',
    left(coalesce(p_wrapper ->> 'label', 'Passkey'), 120),
    p_wrapper ->> 'credentialId',
    p_wrapper ->> 'prfSalt',
    coalesce(p_wrapper -> 'transports', '[]'::jsonb),
    (p_wrapper ->> 'wrapperVersion')::smallint,
    (p_wrapper ->> 'keyVersion')::integer,
    p_wrapper ->> 'nonce',
    p_wrapper ->> 'wrappedKey'
  ) on conflict (owner_id, wrapper_id) do nothing;
end;
$$;

create or replace function public.stage_workspace_e2ee_entities(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_envelopes jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  envelope jsonb;
  staged integer := 0;
begin
  if jsonb_typeof(p_envelopes) <> 'array' or jsonb_array_length(p_envelopes) > 250 then
    raise exception using errcode = '22023', message = 'invalid_migration_batch';
  end if;
  if not exists (
    select 1 from public.workspace_encryption_profiles as profile
    where profile.owner_id = caller_id and profile.workspace_crypto_id = p_workspace_crypto_id
      and profile.migration_status = 'migration_started'
  ) then
    raise exception using errcode = '55000', message = 'migration_not_started';
  end if;
  for envelope in select value from jsonb_array_elements(p_envelopes) loop
    perform private.assert_e2ee_envelope(envelope);
    insert into public.workspace_e2ee_migration_entities (owner_id, collection, entity_id, envelope)
    values (caller_id, envelope ->> 'collection', envelope ->> 'entityId', envelope)
    on conflict (owner_id, collection, entity_id) do update set envelope = excluded.envelope;
    staged := staged + 1;
  end loop;
  return staged;
end;
$$;

create or replace function public.stage_workspace_e2ee_snapshot(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_snapshot jsonb,
  p_original_created_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  snapshot_id uuid;
begin
  select * into profile from public.workspace_encryption_profiles
  where owner_id = caller_id and workspace_crypto_id = p_workspace_crypto_id
    and migration_status = 'migration_started';
  if not found then
    raise exception using errcode = '22023', message = 'invalid_encrypted_migration_snapshot';
  end if;
  perform private.assert_e2ee_snapshot(p_snapshot, p_workspace_crypto_id, profile.active_key_version, false);
  snapshot_id := coalesce((p_snapshot ->> 'id')::uuid, gen_random_uuid());
  insert into public.workspace_e2ee_migration_snapshots (id, owner_id, snapshot, original_created_at)
  values (snapshot_id, caller_id, p_snapshot, p_original_created_at)
  on conflict (id) do update set snapshot = excluded.snapshot, original_created_at = excluded.original_created_at;
  return snapshot_id;
end;
$$;

create or replace function public.stage_workspace_e2ee_import_receipt(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_receipt jsonb,
  p_original_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
begin
  select * into profile from public.workspace_encryption_profiles
  where owner_id = caller_id and workspace_crypto_id = p_workspace_crypto_id
    and migration_status = 'migration_started';
  if not found then
    raise exception using errcode = '55000', message = 'migration_not_started';
  end if;
  perform private.assert_e2ee_import_receipt(p_receipt, profile.active_key_version);
  insert into public.workspace_e2ee_migration_import_receipts (
    owner_id, import_fingerprint, receipt, original_created_at
  ) values (
    caller_id, p_receipt ->> 'fingerprint', p_receipt, p_original_created_at
  ) on conflict (owner_id, import_fingerprint) do update
    set receipt = excluded.receipt, original_created_at = excluded.original_created_at;
end;
$$;

create or replace function public.load_workspace_e2ee_migration_staging(p_expected_owner_id uuid)
returns table(envelopes jsonb, snapshots jsonb, import_receipts jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  return query
  select
    coalesce((select jsonb_agg(entity.envelope order by entity.collection, entity.entity_id)
      from public.workspace_e2ee_migration_entities as entity where entity.owner_id = caller_id), '[]'::jsonb),
    coalesce((select jsonb_agg(
      snapshot.snapshot || jsonb_build_object('originalCreatedAt', snapshot.original_created_at)
      order by snapshot.original_created_at
    )
      from public.workspace_e2ee_migration_snapshots as snapshot where snapshot.owner_id = caller_id), '[]'::jsonb),
    coalesce((select jsonb_agg(
      receipt.receipt || jsonb_build_object('originalCreatedAt', receipt.original_created_at)
      order by receipt.original_created_at
    ) from public.workspace_e2ee_migration_import_receipts as receipt
      where receipt.owner_id = caller_id), '[]'::jsonb);
end;
$$;

create or replace function public.abort_workspace_e2ee_migration(p_expected_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  if exists (
    select 1 from public.workspace_encryption_profiles as profile
    where profile.owner_id = caller_id and profile.migration_status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'active_encryption_cannot_be_aborted';
  end if;
  delete from public.workspace_e2ee_migration_snapshots where owner_id = caller_id;
  delete from public.workspace_e2ee_migration_import_receipts where owner_id = caller_id;
  delete from public.workspace_e2ee_migration_entities where owner_id = caller_id;
  delete from public.workspace_key_wrappers where owner_id = caller_id;
  delete from public.workspace_encryption_profiles where owner_id = caller_id;
end;
$$;

create or replace function public.finalize_workspace_e2ee_migration(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_expected_entity_count integer,
  p_manifest jsonb
)
returns table(workspace_revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  staged_count bigint;
  operation_id uuid := (p_manifest ->> 'operationId')::uuid;
begin
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if not found or profile.workspace_crypto_id <> p_workspace_crypto_id then
    raise exception using errcode = '55000', message = 'migration_not_started';
  end if;
  if profile.migration_status = 'active' then
    return query select profile.workspace_revision, profile.updated_at;
    return;
  end if;
  select count(*) into staged_count from public.workspace_e2ee_migration_entities where owner_id = caller_id;
  if staged_count <> p_expected_entity_count or staged_count < 1 then
    raise exception using errcode = '22023', message = 'migration_entity_count_mismatch';
  end if;
  perform private.assert_e2ee_manifest(p_manifest, p_workspace_crypto_id, 1, null, staged_count);
  if not exists (
    select 1 from public.workspace_e2ee_migration_entities as entity
    where entity.owner_id = caller_id and entity.collection = 'settings' and entity.entity_id = '__settings__'
  ) then
    raise exception using errcode = '22023', message = 'migration_settings_missing';
  end if;

  delete from public.encrypted_workspace_entities where owner_id = caller_id;
  insert into public.encrypted_workspace_entities (
    owner_id, collection, entity_id, entity_revision, schema_version, key_version, nonce, ciphertext
  )
  select
    caller_id,
    staged.collection,
    staged.entity_id,
    (staged.envelope ->> 'entityRevision')::bigint,
    (staged.envelope ->> 'schemaVersion')::integer,
    (staged.envelope ->> 'keyVersion')::integer,
    staged.envelope ->> 'nonce',
    staged.envelope ->> 'ciphertext'
  from public.workspace_e2ee_migration_entities as staged
  where staged.owner_id = caller_id;

  insert into public.encrypted_workspace_snapshots (
    id, owner_id, source_revision, reason, envelopes, manifest, original_created_at
  )
  select
    staged.id,
    caller_id,
    coalesce((staged.snapshot ->> 'sourceRevision')::bigint, 0),
    'migration',
    staged.snapshot -> 'envelopes',
    staged.snapshot -> 'manifest',
    staged.original_created_at
  from public.workspace_e2ee_migration_snapshots as staged
  where staged.owner_id = caller_id;

  insert into public.encrypted_workspace_import_receipts (
    owner_id, import_fingerprint, result_revision, key_version, nonce, ciphertext, original_created_at
  )
  select
    caller_id,
    staged.import_fingerprint,
    (staged.receipt ->> 'resultRevision')::bigint,
    (staged.receipt ->> 'keyVersion')::integer,
    staged.receipt ->> 'nonce',
    staged.receipt ->> 'ciphertext',
    staged.original_created_at
  from public.workspace_e2ee_migration_import_receipts as staged
  where staged.owner_id = caller_id;

  perform pg_catalog.set_config('hibi.e2ee_internal', 'on', true);
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);
  delete from public.schedule_exceptions where owner_id = caller_id;
  delete from public.schedule_changes where owner_id = caller_id;
  delete from public.class_schedules where owner_id = caller_id;
  delete from public.payments where owner_id = caller_id;
  delete from public.class_records where owner_id = caller_id;
  delete from public.grades where owner_id = caller_id;
  delete from public.student_groups where owner_id = caller_id;
  delete from public.students where owner_id = caller_id;
  delete from public.groups where owner_id = caller_id;
  delete from public.workspace_change_events where owner_id = caller_id;
  delete from public.workspace_mutation_receipts where owner_id = caller_id;
  delete from public.workspace_settings where owner_id = caller_id;
  delete from public.workspace_sync_cursors where owner_id = caller_id;
  delete from public.workspace_sync_signals where owner_id = caller_id;
  delete from public.workspace_import_jobs where owner_id = caller_id;
  delete from public.workspace_recovery_snapshots where owner_id = caller_id;
  delete from public.workspaces where owner_id = caller_id;
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
  perform pg_catalog.set_config('hibi.e2ee_internal', '', true);

  update public.workspace_encryption_profiles
  set migration_status = 'active', workspace_revision = 1,
      active_key_version = (p_manifest ->> 'keyVersion')::integer,
      manifest = p_manifest, manifest_root = p_manifest ->> 'root', manifest_mac = p_manifest ->> 'mac',
      activated_at = now(), updated_at = now()
  where owner_id = caller_id
  returning * into profile;

  insert into public.encrypted_workspace_change_events (
    owner_id, workspace_revision, operation_id, upserts, deleted_entities, manifest
  ) values (
    caller_id, 1, operation_id, private.current_e2ee_envelopes(caller_id), '[]'::jsonb, p_manifest
  );
  delete from public.workspace_e2ee_migration_snapshots where owner_id = caller_id;
  delete from public.workspace_e2ee_migration_import_receipts where owner_id = caller_id;
  delete from public.workspace_e2ee_migration_entities where owner_id = caller_id;
  return query select profile.workspace_revision, profile.updated_at;
end;
$$;

create or replace function public.load_encrypted_workspace(p_expected_owner_id uuid)
returns table(
  workspace_crypto_id text,
  protocol_version smallint,
  schema_version integer,
  active_key_version integer,
  workspace_revision bigint,
  migration_status text,
  manifest jsonb,
  envelopes jsonb,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  return query
  select profile.workspace_crypto_id, profile.protocol_version, profile.schema_version,
    profile.active_key_version, profile.workspace_revision, profile.migration_status,
    profile.manifest, private.current_e2ee_envelopes(caller_id), profile.updated_at
  from public.workspace_encryption_profiles as profile
  where profile.owner_id = caller_id;
end;
$$;

create or replace function public.apply_encrypted_workspace_mutation(
  p_expected_owner_id uuid,
  p_expected_workspace_revision bigint,
  p_operation_id uuid,
  p_upserts jsonb,
  p_deletes jsonb,
  p_manifest jsonb
)
returns table(result_revision bigint, updated_at timestamptz, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  envelope jsonb;
  deletion jsonb;
  current_revision bigint;
  next_revision bigint := p_expected_workspace_revision + 1;
  entity_count bigint;
  changed_at timestamptz := clock_timestamp();
begin
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if not found or profile.migration_status <> 'active' then
    raise exception using errcode = '55000', message = 'encryption_required';
  end if;
  if exists (
    select 1 from public.encrypted_workspace_mutation_receipts as receipt
    where receipt.owner_id = caller_id and receipt.operation_id = p_operation_id
  ) then
    return query select receipt.result_revision, profile.updated_at, true
      from public.encrypted_workspace_mutation_receipts as receipt
      where receipt.owner_id = caller_id and receipt.operation_id = p_operation_id;
    return;
  end if;
  if profile.workspace_revision <> p_expected_workspace_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;
  if jsonb_typeof(p_upserts) <> 'array' or jsonb_typeof(p_deletes) <> 'array'
    or jsonb_array_length(p_upserts) + jsonb_array_length(p_deletes) > 500
    or pg_catalog.pg_column_size(p_upserts) > 5242880
  then
    raise exception using errcode = '22023', message = 'invalid_encrypted_mutation';
  end if;

  for deletion in select value from jsonb_array_elements(p_deletes) loop
    if jsonb_typeof(deletion) <> 'object'
      or (deletion - array['collection', 'entityId', 'expectedRevision']) <> '{}'::jsonb
      or deletion ->> 'collection' not in (
      'groups', 'students', 'grades', 'classLog', 'classSchedules', 'scheduleExceptions', 'scheduleChanges'
    ) or length(coalesce(deletion ->> 'entityId', '')) not between 1 and 200
      or coalesce(deletion ->> 'expectedRevision', '') !~ '^[1-9][0-9]*$'
    then
      raise exception using errcode = '22023', message = 'invalid_encrypted_deletion';
    end if;
    select entity.entity_revision into current_revision
    from public.encrypted_workspace_entities as entity
    where entity.owner_id = caller_id and entity.collection = deletion ->> 'collection'
      and entity.entity_id = deletion ->> 'entityId'
    for update;
    if not found or current_revision <> (deletion ->> 'expectedRevision')::bigint then
      raise exception using errcode = '40001', message = 'workspace_entity_conflict';
    end if;
    delete from public.encrypted_workspace_entities as entity
    where entity.owner_id = caller_id and entity.collection = deletion ->> 'collection'
      and entity.entity_id = deletion ->> 'entityId';
  end loop;

  for envelope in select value from jsonb_array_elements(p_upserts) loop
    perform private.assert_e2ee_envelope(envelope);
    select entity.entity_revision into current_revision
    from public.encrypted_workspace_entities as entity
    where entity.owner_id = caller_id and entity.collection = envelope ->> 'collection'
      and entity.entity_id = envelope ->> 'entityId'
    for update;
    if found and current_revision + 1 <> (envelope ->> 'entityRevision')::bigint then
      raise exception using errcode = '40001', message = 'workspace_entity_conflict';
    elsif not found and (envelope ->> 'entityRevision')::bigint <> 1 then
      raise exception using errcode = '40001', message = 'workspace_entity_conflict';
    end if;
    insert into public.encrypted_workspace_entities (
      owner_id, collection, entity_id, entity_revision, schema_version, key_version, nonce, ciphertext, updated_at
    ) values (
      caller_id, envelope ->> 'collection', envelope ->> 'entityId',
      (envelope ->> 'entityRevision')::bigint, (envelope ->> 'schemaVersion')::integer,
      (envelope ->> 'keyVersion')::integer, envelope ->> 'nonce', envelope ->> 'ciphertext', changed_at
    ) on conflict (owner_id, collection, entity_id) do update set
      entity_revision = excluded.entity_revision, schema_version = excluded.schema_version,
      key_version = excluded.key_version, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
      updated_at = excluded.updated_at;
  end loop;

  select count(*) into entity_count from public.encrypted_workspace_entities where owner_id = caller_id;
  perform private.assert_e2ee_manifest(
    p_manifest, profile.workspace_crypto_id, next_revision, profile.manifest_root, entity_count
  );
  if (p_manifest ->> 'operationId')::uuid <> p_operation_id then
    raise exception using errcode = '22023', message = 'manifest_operation_mismatch';
  end if;
  update public.workspace_encryption_profiles
  set workspace_revision = next_revision,
      active_key_version = (p_manifest ->> 'keyVersion')::integer,
      manifest = p_manifest, manifest_root = p_manifest ->> 'root', manifest_mac = p_manifest ->> 'mac',
      updated_at = changed_at
  where owner_id = caller_id;
  insert into public.encrypted_workspace_change_events (
    owner_id, workspace_revision, operation_id, upserts, deleted_entities, manifest, created_at
  ) values (caller_id, next_revision, p_operation_id, p_upserts, p_deletes, p_manifest, changed_at);
  insert into public.encrypted_workspace_mutation_receipts (owner_id, operation_id, result_revision)
  values (caller_id, p_operation_id, next_revision);
  delete from public.encrypted_workspace_change_events as event
  where event.owner_id = caller_id and event.workspace_revision <= next_revision - 100;
  delete from public.encrypted_workspace_mutation_receipts as receipt
  where receipt.owner_id = caller_id and receipt.created_at < now() - interval '30 days';
  return query select next_revision, changed_at, false;
end;
$$;

create or replace function public.replace_encrypted_workspace(
  p_expected_owner_id uuid,
  p_expected_workspace_revision bigint,
  p_operation_id uuid,
  p_reason text,
  p_envelopes jsonb,
  p_manifest jsonb,
  p_import_receipt jsonb
)
returns table(result_revision bigint, updated_at timestamptz, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  envelope jsonb;
  next_revision bigint := p_expected_workspace_revision + 1;
  changed_at timestamptz := clock_timestamp();
begin
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if not found or profile.migration_status <> 'active' then
    raise exception using errcode = '55000', message = 'encryption_required';
  end if;
  if p_import_receipt is not null then
    perform private.assert_e2ee_import_receipt(p_import_receipt, profile.active_key_version);
    if exists (
      select 1 from public.encrypted_workspace_import_receipts as receipt
      where receipt.owner_id = caller_id
        and receipt.import_fingerprint = p_import_receipt ->> 'fingerprint'
    ) then
      return query select receipt.result_revision, profile.updated_at, true
      from public.encrypted_workspace_import_receipts as receipt
      where receipt.owner_id = caller_id
        and receipt.import_fingerprint = p_import_receipt ->> 'fingerprint';
      return;
    end if;
  end if;
  if profile.workspace_revision <> p_expected_workspace_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;
  if p_reason not in ('replace', 'import', 'restore', 'reset', 'rotation')
    or ((p_reason = 'import') is distinct from (p_import_receipt is not null))
    or jsonb_typeof(p_envelopes) <> 'array' or jsonb_array_length(p_envelopes) < 1
    or pg_catalog.pg_column_size(p_envelopes) > 26214400
  then
    raise exception using errcode = '22023', message = 'invalid_encrypted_replacement';
  end if;
  perform private.assert_e2ee_manifest(
    p_manifest, profile.workspace_crypto_id, next_revision, profile.manifest_root, jsonb_array_length(p_envelopes)
  );
  if (p_manifest ->> 'operationId')::uuid <> p_operation_id then
    raise exception using errcode = '22023', message = 'manifest_operation_mismatch';
  end if;
  for envelope in select value from jsonb_array_elements(p_envelopes) loop
    perform private.assert_e2ee_envelope(envelope);
  end loop;

  insert into public.encrypted_workspace_snapshots (
    id, owner_id, source_revision, reason, envelopes, manifest
  ) values (
    gen_random_uuid(), caller_id, profile.workspace_revision, p_reason,
    private.current_e2ee_envelopes(caller_id), profile.manifest
  );
  delete from public.encrypted_workspace_entities where owner_id = caller_id;
  for envelope in select value from jsonb_array_elements(p_envelopes) loop
    perform private.insert_e2ee_envelope(caller_id, envelope);
  end loop;
  update public.workspace_encryption_profiles
  set workspace_revision = next_revision,
      active_key_version = (p_manifest ->> 'keyVersion')::integer,
      manifest = p_manifest, manifest_root = p_manifest ->> 'root', manifest_mac = p_manifest ->> 'mac',
      updated_at = changed_at
  where owner_id = caller_id;
  insert into public.encrypted_workspace_change_events (
    owner_id, workspace_revision, operation_id, upserts, deleted_entities, manifest, created_at
  ) values (caller_id, next_revision, p_operation_id, p_envelopes, '[]'::jsonb, p_manifest, changed_at);
  if p_import_receipt is not null then
    insert into public.encrypted_workspace_import_receipts (
      owner_id, import_fingerprint, result_revision, key_version, nonce, ciphertext, original_created_at
    ) values (
      caller_id,
      p_import_receipt ->> 'fingerprint',
      next_revision,
      (p_import_receipt ->> 'keyVersion')::integer,
      p_import_receipt ->> 'nonce',
      p_import_receipt ->> 'ciphertext',
      changed_at
    );
  end if;
  delete from public.encrypted_workspace_snapshots as snapshot
  where snapshot.owner_id = caller_id and snapshot.id not in (
    select recent.id from public.encrypted_workspace_snapshots as recent
    where recent.owner_id = caller_id order by recent.created_at desc limit 20
  );
  return query select next_revision, changed_at, false;
end;
$$;

create or replace function public.add_workspace_key_wrapper(
  p_expected_owner_id uuid,
  p_wrapper jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  new_id uuid := (p_wrapper ->> 'wrapperId')::uuid;
  wrapper_type text := p_wrapper ->> 'type';
begin
  if wrapper_type not in ('passkey', 'recovery') or not exists (
    select 1 from public.workspace_encryption_profiles as profile
    where profile.owner_id = caller_id and profile.migration_status = 'active'
      and profile.active_key_version = (p_wrapper ->> 'keyVersion')::integer
  ) then
    raise exception using errcode = '22023', message = 'invalid_workspace_key_wrapper';
  end if;
  insert into public.workspace_key_wrappers (
    owner_id, wrapper_id, wrapper_type, label, credential_id, prf_salt, transports,
    recovery_fingerprint, wrapper_version, key_version, nonce, wrapped_key
  ) values (
    caller_id, new_id, wrapper_type, left(coalesce(p_wrapper ->> 'label', ''), 120),
    p_wrapper ->> 'credentialId', p_wrapper ->> 'prfSalt', coalesce(p_wrapper -> 'transports', '[]'::jsonb),
    p_wrapper ->> 'recoveryFingerprint', (p_wrapper ->> 'wrapperVersion')::smallint,
    (p_wrapper ->> 'keyVersion')::integer, p_wrapper ->> 'nonce', p_wrapper ->> 'wrappedKey'
  );
  return new_id;
end;
$$;

create or replace function public.begin_staged_workspace_key_rotation(
  p_expected_owner_id uuid,
  p_expected_workspace_revision bigint,
  p_operation_id uuid,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  next_key_version integer;
begin
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if not found or profile.migration_status <> 'active' then
    raise exception using errcode = '55000', message = 'encryption_required';
  end if;
  if profile.workspace_revision <> p_expected_workspace_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;
  next_key_version := profile.active_key_version + 1;
  perform private.assert_e2ee_manifest(
    p_manifest,
    profile.workspace_crypto_id,
    p_expected_workspace_revision + 1,
    profile.manifest_root,
    (p_manifest ->> 'entityCount')::integer
  );
  if (p_manifest ->> 'operationId')::uuid <> p_operation_id
    or (p_manifest ->> 'keyVersion')::integer <> next_key_version
  then
    raise exception using errcode = '22023', message = 'invalid_rotation_manifest';
  end if;
  delete from public.workspace_e2ee_rotation_staging where owner_id = caller_id;
  insert into public.workspace_e2ee_rotation_staging (
    owner_id, operation_id, expected_revision, next_key_version, manifest
  ) values (caller_id, p_operation_id, p_expected_workspace_revision, next_key_version, p_manifest);
end;
$$;

create or replace function public.stage_workspace_key_rotation_entities(
  p_expected_owner_id uuid,
  p_operation_id uuid,
  p_envelopes jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  staging public.workspace_e2ee_rotation_staging%rowtype;
  envelope jsonb;
  staged integer := 0;
begin
  select * into staging from public.workspace_e2ee_rotation_staging
  where owner_id = caller_id and operation_id = p_operation_id;
  if not found then raise exception using errcode = '55000', message = 'rotation_not_started'; end if;
  if jsonb_typeof(p_envelopes) <> 'array' or jsonb_array_length(p_envelopes) > 250
    or pg_catalog.pg_column_size(p_envelopes) > 5242880
  then
    raise exception using errcode = '22023', message = 'invalid_rotation_batch';
  end if;
  for envelope in select value from jsonb_array_elements(p_envelopes) loop
    perform private.assert_e2ee_envelope(envelope);
    if (envelope ->> 'keyVersion')::integer <> staging.next_key_version then
      raise exception using errcode = '22023', message = 'rotation_key_version_mismatch';
    end if;
    insert into public.workspace_e2ee_rotation_entities (owner_id, collection, entity_id, envelope)
    values (caller_id, envelope ->> 'collection', envelope ->> 'entityId', envelope)
    on conflict (owner_id, collection, entity_id) do update set envelope = excluded.envelope;
    staged := staged + 1;
  end loop;
  return staged;
end;
$$;

create or replace function public.stage_workspace_key_rotation_snapshot(
  p_expected_owner_id uuid,
  p_operation_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  staging public.workspace_e2ee_rotation_staging%rowtype;
begin
  select * into staging from public.workspace_e2ee_rotation_staging
  where owner_id = caller_id and operation_id = p_operation_id;
  if not found then raise exception using errcode = '55000', message = 'rotation_not_started'; end if;
  perform private.assert_e2ee_snapshot(p_snapshot, (
    select profile.workspace_crypto_id from public.workspace_encryption_profiles as profile where profile.owner_id = caller_id
  ), staging.next_key_version, true);
  if (select count(*) from public.workspace_e2ee_rotation_snapshots where owner_id = caller_id) >= 21
    and not exists (
      select 1 from public.workspace_e2ee_rotation_snapshots
      where owner_id = caller_id and id = (p_snapshot ->> 'id')::uuid
    )
  then
    raise exception using errcode = '22023', message = 'rotation_snapshot_limit';
  end if;
  insert into public.workspace_e2ee_rotation_snapshots (id, owner_id, snapshot)
  values ((p_snapshot ->> 'id')::uuid, caller_id, p_snapshot)
  on conflict (owner_id, id) do update set snapshot = excluded.snapshot;
end;
$$;

create or replace function public.stage_workspace_key_rotation_import_receipts(
  p_expected_owner_id uuid,
  p_operation_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  staging public.workspace_e2ee_rotation_staging%rowtype;
  import_item jsonb;
  staged integer := 0;
begin
  select * into staging from public.workspace_e2ee_rotation_staging
  where owner_id = caller_id and operation_id = p_operation_id;
  if not found then raise exception using errcode = '55000', message = 'rotation_not_started'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100
    or pg_catalog.pg_column_size(p_items) > 5242880
  then raise exception using errcode = '22023', message = 'invalid_rotation_import_batch'; end if;
  for import_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(import_item) <> 'object'
      or (import_item - array['receipt', 'originalCreatedAt']) <> '{}'::jsonb
      or jsonb_typeof(import_item -> 'receipt') <> 'object'
    then raise exception using errcode = '22023', message = 'invalid_rotation_import_receipt'; end if;
    perform private.assert_e2ee_import_receipt(import_item -> 'receipt', staging.next_key_version);
    insert into public.workspace_e2ee_rotation_import_receipts (owner_id, import_fingerprint, item)
    values (caller_id, import_item -> 'receipt' ->> 'fingerprint', import_item)
    on conflict (owner_id, import_fingerprint) do update set item = excluded.item;
    staged := staged + 1;
  end loop;
  return staged;
end;
$$;

create or replace function public.stage_workspace_key_rotation_wrappers(
  p_expected_owner_id uuid,
  p_operation_id uuid,
  p_wrappers jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  staging public.workspace_e2ee_rotation_staging%rowtype;
  wrapper jsonb;
  staged integer := 0;
begin
  select * into staging from public.workspace_e2ee_rotation_staging
  where owner_id = caller_id and operation_id = p_operation_id;
  if not found then raise exception using errcode = '55000', message = 'rotation_not_started'; end if;
  if jsonb_typeof(p_wrappers) <> 'array' or jsonb_array_length(p_wrappers) not between 1 and 20
  then raise exception using errcode = '22023', message = 'invalid_rotation_wrappers'; end if;
  for wrapper in select value from jsonb_array_elements(p_wrappers) loop
    if wrapper ->> 'type' <> 'passkey'
      or (wrapper ->> 'keyVersion')::integer <> staging.next_key_version
      or coalesce(wrapper ->> 'credentialId', '') = ''
      or coalesce(wrapper ->> 'prfSalt', '') = ''
      or coalesce(wrapper ->> 'nonce', '') !~ '^[A-Za-z0-9_-]{16,32}$'
      or coalesce(wrapper ->> 'wrappedKey', '') !~ '^[A-Za-z0-9_-]{48,128}$'
    then raise exception using errcode = '22023', message = 'invalid_rotation_wrapper'; end if;
    insert into public.workspace_e2ee_rotation_wrappers (owner_id, wrapper_id, wrapper)
    values (caller_id, (wrapper ->> 'wrapperId')::uuid, wrapper)
    on conflict (owner_id, wrapper_id) do update set wrapper = excluded.wrapper;
    staged := staged + 1;
  end loop;
  return staged;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'invalid_rotation_wrapper';
end;
$$;

create or replace function public.abort_staged_workspace_key_rotation(
  p_expected_owner_id uuid,
  p_operation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  delete from public.workspace_e2ee_rotation_staging
  where owner_id = caller_id and operation_id = p_operation_id;
end;
$$;

create or replace function public.finalize_staged_workspace_key_rotation(
  p_expected_owner_id uuid,
  p_operation_id uuid
)
returns table(result_revision bigint, updated_at timestamptz, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  staging public.workspace_e2ee_rotation_staging%rowtype;
  staged public.workspace_e2ee_rotation_entities%rowtype;
  snapshot public.workspace_e2ee_rotation_snapshots%rowtype;
  import_row public.workspace_e2ee_rotation_import_receipts%rowtype;
  wrapper_row public.workspace_e2ee_rotation_wrappers%rowtype;
  next_revision bigint;
  changed_at timestamptz := clock_timestamp();
begin
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if exists (
    select 1 from public.encrypted_workspace_change_events as event
    where event.owner_id = caller_id and event.operation_id = p_operation_id
  ) then
    return query select event.workspace_revision, profile.updated_at, true
    from public.encrypted_workspace_change_events as event
    where event.owner_id = caller_id and event.operation_id = p_operation_id;
    return;
  end if;
  select * into staging from public.workspace_e2ee_rotation_staging
  where owner_id = caller_id and operation_id = p_operation_id;
  if not found then raise exception using errcode = '55000', message = 'rotation_not_started'; end if;
  if profile.migration_status <> 'active' or profile.workspace_revision <> staging.expected_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;
  if profile.active_key_version + 1 <> staging.next_key_version
    or (select count(*) from public.workspace_e2ee_rotation_entities where owner_id = caller_id)
      <> (staging.manifest ->> 'entityCount')::bigint
    or not exists (
      select 1 from public.workspace_e2ee_rotation_entities as entity
      where entity.owner_id = caller_id and entity.collection = 'settings' and entity.entity_id = '__settings__'
    )
    or (select count(*) from public.workspace_e2ee_rotation_wrappers where owner_id = caller_id) < 1
  then raise exception using errcode = '22023', message = 'rotation_staging_incomplete'; end if;
  next_revision := staging.expected_revision + 1;

  delete from public.encrypted_workspace_snapshots where owner_id = caller_id;
  for snapshot in select * from public.workspace_e2ee_rotation_snapshots where owner_id = caller_id loop
    insert into public.encrypted_workspace_snapshots (
      id, owner_id, source_revision, reason, envelopes, manifest, original_created_at
    ) values (
      snapshot.id, caller_id, (snapshot.snapshot ->> 'sourceRevision')::bigint, 'rotation',
      snapshot.snapshot -> 'envelopes', snapshot.snapshot -> 'manifest',
      nullif(snapshot.snapshot ->> 'originalCreatedAt', '')::timestamptz
    );
  end loop;
  delete from public.encrypted_workspace_entities where owner_id = caller_id;
  for staged in select * from public.workspace_e2ee_rotation_entities where owner_id = caller_id loop
    perform private.insert_e2ee_envelope(caller_id, staged.envelope);
  end loop;
  delete from public.workspace_key_wrappers where owner_id = caller_id;
  for wrapper_row in select * from public.workspace_e2ee_rotation_wrappers where owner_id = caller_id loop
    insert into public.workspace_key_wrappers (
      owner_id, wrapper_id, wrapper_type, label, credential_id, prf_salt, transports,
      wrapper_version, key_version, nonce, wrapped_key, created_at
    ) values (
      caller_id, wrapper_row.wrapper_id, 'passkey', left(coalesce(wrapper_row.wrapper ->> 'label', 'Passkey'), 120),
      wrapper_row.wrapper ->> 'credentialId', wrapper_row.wrapper ->> 'prfSalt',
      coalesce(wrapper_row.wrapper -> 'transports', '[]'::jsonb),
      (wrapper_row.wrapper ->> 'wrapperVersion')::smallint, staging.next_key_version,
      wrapper_row.wrapper ->> 'nonce', wrapper_row.wrapper ->> 'wrappedKey',
      coalesce((wrapper_row.wrapper ->> 'createdAt')::timestamptz, changed_at)
    );
  end loop;
  delete from public.encrypted_workspace_import_receipts where owner_id = caller_id;
  for import_row in select * from public.workspace_e2ee_rotation_import_receipts where owner_id = caller_id loop
    insert into public.encrypted_workspace_import_receipts (
      owner_id, import_fingerprint, result_revision, key_version, nonce, ciphertext, original_created_at
    ) values (
      caller_id, import_row.import_fingerprint,
      (import_row.item -> 'receipt' ->> 'resultRevision')::bigint, staging.next_key_version,
      import_row.item -> 'receipt' ->> 'nonce', import_row.item -> 'receipt' ->> 'ciphertext',
      nullif(import_row.item ->> 'originalCreatedAt', '')::timestamptz
    );
  end loop;
  update public.workspace_encryption_profiles
  set workspace_revision = next_revision, active_key_version = staging.next_key_version,
      manifest = staging.manifest, manifest_root = staging.manifest ->> 'root',
      manifest_mac = staging.manifest ->> 'mac', updated_at = changed_at
  where owner_id = caller_id;
  insert into public.encrypted_workspace_change_events (
    owner_id, workspace_revision, operation_id, upserts, deleted_entities, manifest, created_at
  ) values (
    caller_id, next_revision, p_operation_id, private.current_e2ee_envelopes(caller_id),
    '[]'::jsonb, staging.manifest, changed_at
  );
  delete from public.workspace_e2ee_rotation_staging where owner_id = caller_id;
  return query select next_revision, changed_at, false;
end;
$$;

create or replace function public.rotate_encrypted_workspace_key(
  p_expected_owner_id uuid,
  p_expected_workspace_revision bigint,
  p_operation_id uuid,
  p_envelopes jsonb,
  p_snapshots jsonb,
  p_import_receipts jsonb,
  p_wrappers jsonb,
  p_manifest jsonb
)
returns table(result_revision bigint, updated_at timestamptz, already_applied boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  profile public.workspace_encryption_profiles%rowtype;
  envelope jsonb;
  snapshot jsonb;
  import_item jsonb;
  wrapper jsonb;
  next_revision bigint := p_expected_workspace_revision + 1;
  next_key_version integer;
  changed_at timestamptz := clock_timestamp();
begin
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if not found or profile.migration_status <> 'active' then
    raise exception using errcode = '55000', message = 'encryption_required';
  end if;
  if exists (
    select 1 from public.encrypted_workspace_change_events as event
    where event.owner_id = caller_id and event.operation_id = p_operation_id
  ) then
    return query select event.workspace_revision, profile.updated_at, true
      from public.encrypted_workspace_change_events as event
      where event.owner_id = caller_id and event.operation_id = p_operation_id;
    return;
  end if;
  if profile.workspace_revision <> p_expected_workspace_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;
  next_key_version := profile.active_key_version + 1;
  if jsonb_typeof(p_envelopes) <> 'array' or jsonb_array_length(p_envelopes) < 1
    or jsonb_typeof(p_snapshots) <> 'array' or jsonb_array_length(p_snapshots) > 21
    or jsonb_typeof(p_import_receipts) <> 'array' or jsonb_array_length(p_import_receipts) > 1000
    or jsonb_typeof(p_wrappers) <> 'array' or jsonb_array_length(p_wrappers) < 1
    or pg_catalog.pg_column_size(p_envelopes) + pg_catalog.pg_column_size(p_snapshots)
      + pg_catalog.pg_column_size(p_import_receipts) > 104857600
  then
    raise exception using errcode = '22023', message = 'invalid_encrypted_key_rotation';
  end if;
  perform private.assert_e2ee_manifest(
    p_manifest, profile.workspace_crypto_id, next_revision, profile.manifest_root, jsonb_array_length(p_envelopes)
  );
  if (p_manifest ->> 'operationId')::uuid <> p_operation_id
    or (p_manifest ->> 'keyVersion')::integer <> next_key_version
  then
    raise exception using errcode = '22023', message = 'invalid_rotation_manifest';
  end if;
  for envelope in select value from jsonb_array_elements(p_envelopes) loop
    perform private.assert_e2ee_envelope(envelope);
    if (envelope ->> 'keyVersion')::integer <> next_key_version then
      raise exception using errcode = '22023', message = 'rotation_key_version_mismatch';
    end if;
  end loop;
  for wrapper in select value from jsonb_array_elements(p_wrappers) loop
    if wrapper ->> 'type' <> 'passkey'
      or (wrapper ->> 'keyVersion')::integer <> next_key_version
      or coalesce(wrapper ->> 'credentialId', '') = ''
      or coalesce(wrapper ->> 'prfSalt', '') = ''
    then
      raise exception using errcode = '22023', message = 'invalid_rotation_wrapper';
    end if;
  end loop;
  for import_item in select value from jsonb_array_elements(p_import_receipts) loop
    if jsonb_typeof(import_item) <> 'object'
      or (import_item - array['receipt', 'originalCreatedAt']) <> '{}'::jsonb
      or jsonb_typeof(import_item -> 'receipt') <> 'object'
    then
      raise exception using errcode = '22023', message = 'invalid_rotation_import_receipt';
    end if;
    perform private.assert_e2ee_import_receipt(import_item -> 'receipt', next_key_version);
  end loop;

  delete from public.encrypted_workspace_snapshots where owner_id = caller_id;
  for snapshot in select value from jsonb_array_elements(p_snapshots) loop
    perform private.assert_e2ee_snapshot(snapshot, profile.workspace_crypto_id, next_key_version, true);
    insert into public.encrypted_workspace_snapshots (
      id, owner_id, source_revision, reason, envelopes, manifest, original_created_at
    ) values (
      (snapshot ->> 'id')::uuid,
      caller_id,
      (snapshot ->> 'sourceRevision')::bigint,
      'rotation',
      snapshot -> 'envelopes',
      snapshot -> 'manifest',
      nullif(snapshot ->> 'originalCreatedAt', '')::timestamptz
    );
  end loop;

  delete from public.encrypted_workspace_entities where owner_id = caller_id;
  for envelope in select value from jsonb_array_elements(p_envelopes) loop
    perform private.insert_e2ee_envelope(caller_id, envelope);
  end loop;
  delete from public.workspace_key_wrappers where owner_id = caller_id;
  for wrapper in select value from jsonb_array_elements(p_wrappers) loop
    insert into public.workspace_key_wrappers (
      owner_id, wrapper_id, wrapper_type, label, credential_id, prf_salt, transports,
      wrapper_version, key_version, nonce, wrapped_key, created_at
    ) values (
      caller_id, (wrapper ->> 'wrapperId')::uuid, 'passkey', left(coalesce(wrapper ->> 'label', 'Passkey'), 120),
      wrapper ->> 'credentialId', wrapper ->> 'prfSalt', coalesce(wrapper -> 'transports', '[]'::jsonb),
      (wrapper ->> 'wrapperVersion')::smallint, next_key_version,
      wrapper ->> 'nonce', wrapper ->> 'wrappedKey', coalesce((wrapper ->> 'createdAt')::timestamptz, changed_at)
    );
  end loop;
  delete from public.encrypted_workspace_import_receipts where owner_id = caller_id;
  for import_item in select value from jsonb_array_elements(p_import_receipts) loop
    insert into public.encrypted_workspace_import_receipts (
      owner_id, import_fingerprint, result_revision, key_version, nonce, ciphertext, original_created_at
    ) values (
      caller_id,
      import_item -> 'receipt' ->> 'fingerprint',
      (import_item -> 'receipt' ->> 'resultRevision')::bigint,
      next_key_version,
      import_item -> 'receipt' ->> 'nonce',
      import_item -> 'receipt' ->> 'ciphertext',
      nullif(import_item ->> 'originalCreatedAt', '')::timestamptz
    );
  end loop;
  update public.workspace_encryption_profiles
  set workspace_revision = next_revision, active_key_version = next_key_version,
      manifest = p_manifest, manifest_root = p_manifest ->> 'root', manifest_mac = p_manifest ->> 'mac',
      updated_at = changed_at
  where owner_id = caller_id;
  insert into public.encrypted_workspace_change_events (
    owner_id, workspace_revision, operation_id, upserts, deleted_entities, manifest, created_at
  ) values (caller_id, next_revision, p_operation_id, p_envelopes, '[]'::jsonb, p_manifest, changed_at);
  return query select next_revision, changed_at, false;
end;
$$;

create or replace function public.revoke_workspace_key_wrapper(
  p_expected_owner_id uuid,
  p_wrapper_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  if (select count(*) from public.workspace_key_wrappers as wrapper
      where wrapper.owner_id = caller_id and wrapper.revoked_at is null) <= 1 then
    raise exception using errcode = '55000', message = 'cannot_revoke_last_workspace_key';
  end if;
  update public.workspace_key_wrappers set revoked_at = now()
  where owner_id = caller_id and wrapper_id = p_wrapper_id and revoked_at is null;
  if not found then raise exception using errcode = 'P0002', message = 'workspace_key_wrapper_not_found'; end if;
end;
$$;

create or replace function public.touch_workspace_key_wrapper(
  p_expected_owner_id uuid,
  p_wrapper_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  update public.workspace_key_wrappers
  set last_used_at = clock_timestamp()
  where owner_id = caller_id and wrapper_id = p_wrapper_id and revoked_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_key_wrapper_not_found';
  end if;
end;
$$;

create or replace function private.reject_legacy_after_e2ee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_owner uuid := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
begin
  if current_setting('hibi.e2ee_internal', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' and exists (
    select 1 from public.account_deletion_requests as request
    where request.owner_id = row_owner and request.status in ('pending', 'data_erased')
  ) then
    return old;
  end if;
  if exists (
    select 1 from public.workspace_encryption_profiles as profile
    where profile.owner_id = row_owner and profile.migration_status in ('migration_started', 'active')
  ) then
    raise exception using errcode = '55000', message = 'encryption_required';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  target text;
begin
  foreach target in array array[
    'workspaces', 'workspace_settings', 'groups', 'students', 'student_groups', 'grades',
    'class_schedules', 'schedule_exceptions', 'schedule_changes', 'class_records', 'payments',
    'workspace_sync_cursors', 'workspace_change_events', 'workspace_mutation_receipts',
    'workspace_sync_signals', 'workspace_import_jobs', 'workspace_recovery_snapshots'
  ] loop
    execute format('drop trigger if exists reject_legacy_after_e2ee on public.%I', target);
    execute format(
      'create trigger reject_legacy_after_e2ee before insert or update or delete on public.%I for each row execute function private.reject_legacy_after_e2ee()',
      target
    );
  end loop;
end;
$$;

insert into private.account_erasure_targets (table_schema, table_name, delete_order)
values
  ('public', 'workspace_e2ee_rotation_wrappers', 161),
  ('public', 'workspace_e2ee_rotation_import_receipts', 162),
  ('public', 'workspace_e2ee_rotation_snapshots', 163),
  ('public', 'workspace_e2ee_rotation_entities', 164),
  ('public', 'workspace_e2ee_rotation_staging', 165),
  ('public', 'workspace_e2ee_rollout_allowlist', 166),
  ('public', 'workspace_e2ee_migration_import_receipts', 171),
  ('public', 'workspace_e2ee_migration_snapshots', 172),
  ('public', 'workspace_e2ee_migration_entities', 173),
  ('public', 'encrypted_workspace_change_events', 174),
  ('public', 'encrypted_workspace_mutation_receipts', 175),
  ('public', 'encrypted_workspace_import_receipts', 176),
  ('public', 'encrypted_workspace_snapshots', 177),
  ('public', 'encrypted_workspace_entities', 178),
  ('public', 'workspace_key_wrappers', 179),
  ('public', 'workspace_encryption_profiles', 180);

do $$
declare
  signature regprocedure;
begin
  foreach signature in array array[
    'public.workspace_e2ee_rollout_status(uuid)'::regprocedure,
    'public.begin_workspace_e2ee_migration(uuid,text,smallint,integer,jsonb)'::regprocedure,
    'public.stage_workspace_e2ee_entities(uuid,text,jsonb)'::regprocedure,
    'public.stage_workspace_e2ee_snapshot(uuid,text,jsonb,timestamptz)'::regprocedure,
    'public.stage_workspace_e2ee_import_receipt(uuid,text,jsonb,timestamptz)'::regprocedure,
    'public.load_workspace_e2ee_migration_staging(uuid)'::regprocedure,
    'public.abort_workspace_e2ee_migration(uuid)'::regprocedure,
    'public.finalize_workspace_e2ee_migration(uuid,text,integer,jsonb)'::regprocedure,
    'public.load_encrypted_workspace(uuid)'::regprocedure,
    'public.apply_encrypted_workspace_mutation(uuid,bigint,uuid,jsonb,jsonb,jsonb)'::regprocedure,
    'public.replace_encrypted_workspace(uuid,bigint,uuid,text,jsonb,jsonb,jsonb)'::regprocedure,
    'public.begin_staged_workspace_key_rotation(uuid,bigint,uuid,jsonb)'::regprocedure,
    'public.stage_workspace_key_rotation_entities(uuid,uuid,jsonb)'::regprocedure,
    'public.stage_workspace_key_rotation_snapshot(uuid,uuid,jsonb)'::regprocedure,
    'public.stage_workspace_key_rotation_import_receipts(uuid,uuid,jsonb)'::regprocedure,
    'public.stage_workspace_key_rotation_wrappers(uuid,uuid,jsonb)'::regprocedure,
    'public.abort_staged_workspace_key_rotation(uuid,uuid)'::regprocedure,
    'public.finalize_staged_workspace_key_rotation(uuid,uuid)'::regprocedure,
    'public.rotate_encrypted_workspace_key(uuid,bigint,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'public.add_workspace_key_wrapper(uuid,jsonb)'::regprocedure,
    'public.revoke_workspace_key_wrapper(uuid,uuid)'::regprocedure,
    'public.touch_workspace_key_wrapper(uuid,uuid)'::regprocedure
  ] loop
    execute format('alter function %s owner to postgres', signature);
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end;
$$;

alter publication supabase_realtime add table public.encrypted_workspace_change_events;

comment on table public.encrypted_workspace_entities is
  'E2EE v2 entity envelopes. No domain content or readable relationships may be added to this table.';
comment on function public.apply_encrypted_workspace_mutation(uuid,bigint,uuid,jsonb,jsonb,jsonb) is
  'Owner-bound, revision-checked and idempotent encrypted mutation. The server validates only envelope metadata.';
