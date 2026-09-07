-- Freeze all legacy sources before encryption. Old RPC signatures are removed
-- so older clients cannot promote ciphertext read before the barrier.
alter table public.workspace_encryption_profiles
  add column legacy_source_revision bigint check (legacy_source_revision >= 0);

drop function public.begin_workspace_e2ee_migration(uuid,text,smallint,integer,jsonb);
drop function public.finalize_workspace_e2ee_migration(uuid,text,integer,jsonb);

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
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(row_owner::text, 0));
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

create or replace function public.begin_workspace_e2ee_migration(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_protocol_version smallint,
  p_schema_version integer,
  p_wrapper jsonb,
  p_expected_legacy_revision bigint
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
  -- Same owner lock used by normalized writes. Drain every legacy transaction
  -- before reading the revision and publishing the persistent write barrier.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  if p_expected_legacy_revision is null or p_expected_legacy_revision < 0 or
     p_expected_legacy_revision is distinct from (
       select revision from public.workspace_sync_cursors where owner_id = caller_id
     ) then
    raise exception using errcode = '40001', message = 'legacy_revision_conflict';
  end if;
  select * into existing from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if found and existing.migration_status = 'active' then
    raise exception using errcode = '55000', message = 'encryption_already_active';
  end if;
  if found then
    raise exception using errcode = '55000', message = 'different_migration_in_progress';
  end if;
  perform private.assert_workspace_key_wrapper(p_wrapper, 1, array['password']);

  insert into public.workspace_encryption_profiles (
    owner_id, workspace_crypto_id, protocol_version, schema_version, migration_status, legacy_source_revision
  ) values (caller_id, p_workspace_crypto_id, p_protocol_version, p_schema_version, 'migration_started', p_expected_legacy_revision);

  perform private.insert_workspace_key_wrapper(caller_id, p_wrapper);
end;
$$;

create or replace function public.finalize_workspace_e2ee_migration(
  p_expected_owner_id uuid,
  p_workspace_crypto_id text,
  p_expected_entity_count integer,
  p_manifest jsonb,
  p_expected_legacy_revision bigint
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
  select * into profile from public.workspace_encryption_profiles where owner_id = caller_id for update;
  if not found or profile.workspace_crypto_id <> p_workspace_crypto_id then
    raise exception using errcode = '55000', message = 'migration_not_started';
  end if;
  if profile.migration_status = 'active' then
    return query select profile.workspace_revision, profile.updated_at;
    return;
  end if;
  if p_expected_legacy_revision is null or
     profile.legacy_source_revision is distinct from p_expected_legacy_revision or
     p_expected_legacy_revision is distinct from (
       select revision from public.workspace_sync_cursors where owner_id = caller_id
     ) then
    raise exception using errcode = '40001', message = 'legacy_revision_conflict';
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

create or replace function public.abort_workspace_e2ee_migration(p_expected_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := private.require_e2ee_owner(p_expected_owner_id);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller_id::text, 0));
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

revoke all on function public.begin_workspace_e2ee_migration(uuid,text,smallint,integer,jsonb,bigint) from public, anon;
grant execute on function public.begin_workspace_e2ee_migration(uuid,text,smallint,integer,jsonb,bigint) to authenticated;
revoke all on function public.finalize_workspace_e2ee_migration(uuid,text,integer,jsonb,bigint) from public, anon;
grant execute on function public.finalize_workspace_e2ee_migration(uuid,text,integer,jsonb,bigint) to authenticated;
