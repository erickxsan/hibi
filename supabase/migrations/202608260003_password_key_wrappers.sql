-- Replace new WebAuthn PRF wrappers with password-derived AMK wrappers.
-- Incomplete passkey migrations are safe to reset because finalization has not removed readable source rows.

delete from public.workspace_e2ee_migration_snapshots
where owner_id in (
  select owner_id from public.workspace_encryption_profiles where migration_status = 'migration_started'
);
delete from public.workspace_e2ee_migration_import_receipts
where owner_id in (
  select owner_id from public.workspace_encryption_profiles where migration_status = 'migration_started'
);
delete from public.workspace_e2ee_migration_entities
where owner_id in (
  select owner_id from public.workspace_encryption_profiles where migration_status = 'migration_started'
);
delete from public.workspace_key_wrappers
where owner_id in (
  select owner_id from public.workspace_encryption_profiles where migration_status = 'migration_started'
);
delete from public.workspace_encryption_profiles where migration_status = 'migration_started';

alter table public.workspace_key_wrappers
  add column kdf_algorithm text,
  add column kdf_iterations integer,
  add column kdf_salt text;

alter table public.workspace_key_wrappers
  drop constraint if exists workspace_key_wrappers_wrapper_type_check,
  drop constraint if exists workspace_key_wrappers_check;

alter table public.workspace_key_wrappers
  add constraint workspace_key_wrappers_wrapper_type_check
    check (wrapper_type in ('passkey', 'password', 'recovery')),
  add constraint workspace_key_wrappers_material_check check (
    (
      wrapper_type = 'passkey'
      and credential_id is not null
      and prf_salt is not null
      and recovery_fingerprint is null
      and kdf_algorithm is null
      and kdf_iterations is null
      and kdf_salt is null
    )
    or (
      wrapper_type = 'password'
      and credential_id is null
      and prf_salt is null
      and recovery_fingerprint is null
      and kdf_algorithm = 'pbkdf2-sha256'
      and kdf_iterations between 600000 and 5000000
      and kdf_salt ~ '^[A-Za-z0-9_-]{43}$'
    )
    or (
      wrapper_type = 'recovery'
      and credential_id is null
      and prf_salt is null
      and recovery_fingerprint is not null
      and kdf_algorithm is null
      and kdf_iterations is null
      and kdf_salt is null
    )
  );

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
  if jsonb_typeof(p_wrapper) <> 'object'
    or not (wrapper_type = any(p_allowed_types))
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
        p_wrapper ->> 'kdfAlgorithm' <> 'pbkdf2-sha256'
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
      and coalesce(p_wrapper ->> 'recoveryFingerprint', '') !~ '^[A-Za-z0-9_-]{43}$'
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

create or replace function private.insert_workspace_key_wrapper(
  p_owner_id uuid,
  p_wrapper jsonb,
  p_created_at timestamptz default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_id uuid := (p_wrapper ->> 'wrapperId')::uuid;
begin
  insert into public.workspace_key_wrappers (
    owner_id, wrapper_id, wrapper_type, label, credential_id, prf_salt, transports,
    recovery_fingerprint, kdf_algorithm, kdf_iterations, kdf_salt,
    wrapper_version, key_version, nonce, wrapped_key, created_at
  ) values (
    p_owner_id,
    new_id,
    p_wrapper ->> 'type',
    left(coalesce(p_wrapper ->> 'label', ''), 120),
    p_wrapper ->> 'credentialId',
    p_wrapper ->> 'prfSalt',
    coalesce(p_wrapper -> 'transports', '[]'::jsonb),
    p_wrapper ->> 'recoveryFingerprint',
    p_wrapper ->> 'kdfAlgorithm',
    nullif(p_wrapper ->> 'kdfIterations', '')::integer,
    p_wrapper ->> 'kdfSalt',
    (p_wrapper ->> 'wrapperVersion')::smallint,
    (p_wrapper ->> 'keyVersion')::integer,
    p_wrapper ->> 'nonce',
    p_wrapper ->> 'wrappedKey',
    coalesce(p_created_at, nullif(p_wrapper ->> 'createdAt', '')::timestamptz, clock_timestamp())
  );
  return new_id;
end;
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
  perform private.assert_workspace_key_wrapper(p_wrapper, 1, array['password']);

  insert into public.workspace_encryption_profiles (
    owner_id, workspace_crypto_id, protocol_version, schema_version, migration_status
  ) values (caller_id, p_workspace_crypto_id, p_protocol_version, p_schema_version, 'migration_started')
  on conflict (owner_id) do update set updated_at = now();

  perform private.insert_workspace_key_wrapper(caller_id, p_wrapper);
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
  active_version integer;
begin
  select profile.active_key_version into active_version
  from public.workspace_encryption_profiles as profile
  where profile.owner_id = caller_id and profile.migration_status = 'active';
  if not found then
    raise exception using errcode = '22023', message = 'invalid_workspace_key_wrapper';
  end if;
  perform private.assert_workspace_key_wrapper(p_wrapper, active_version, array['password', 'recovery']);
  return private.insert_workspace_key_wrapper(caller_id, p_wrapper);
end;
$$;

create or replace function public.replace_workspace_password_wrapper(
  p_expected_owner_id uuid,
  p_current_wrapper_id uuid,
  p_wrapper jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
  active_version integer;
  new_id uuid;
begin
  select profile.active_key_version into active_version
  from public.workspace_encryption_profiles as profile
  where profile.owner_id = caller_id and profile.migration_status = 'active';
  if not found or not exists (
    select 1 from public.workspace_key_wrappers as wrapper
    where wrapper.owner_id = caller_id
      and wrapper.wrapper_id = p_current_wrapper_id
      and wrapper.wrapper_type = 'password'
      and wrapper.revoked_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'workspace_password_wrapper_not_found';
  end if;
  perform private.assert_workspace_key_wrapper(p_wrapper, active_version, array['password']);
  new_id := private.insert_workspace_key_wrapper(caller_id, p_wrapper);
  update public.workspace_key_wrappers set revoked_at = clock_timestamp()
  where owner_id = caller_id and wrapper_id = p_current_wrapper_id and revoked_at is null;
  return new_id;
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
    perform private.assert_workspace_key_wrapper(wrapper, staging.next_key_version, array['password']);
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
    perform private.assert_workspace_key_wrapper(wrapper_row.wrapper, staging.next_key_version, array['password']);
    perform private.insert_workspace_key_wrapper(caller_id, wrapper_row.wrapper, changed_at);
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

alter function private.assert_workspace_key_wrapper(jsonb, integer, text[]) owner to postgres;
alter function private.insert_workspace_key_wrapper(uuid, jsonb, timestamptz) owner to postgres;
revoke all on function private.assert_workspace_key_wrapper(jsonb, integer, text[]) from public, anon, authenticated;
revoke all on function private.insert_workspace_key_wrapper(uuid, jsonb, timestamptz) from public, anon, authenticated;
alter function public.replace_workspace_password_wrapper(uuid, uuid, jsonb) owner to postgres;
revoke all on function public.replace_workspace_password_wrapper(uuid, uuid, jsonb) from public, anon;
grant execute on function public.replace_workspace_password_wrapper(uuid, uuid, jsonb) to authenticated;
