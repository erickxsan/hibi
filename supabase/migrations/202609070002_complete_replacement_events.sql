-- Keep replacement events applicable to existing incremental clients.
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
  removed_entities jsonb;
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
  -- Capture all removals while the profile lock serializes workspace writes.
  select coalesce(jsonb_agg(jsonb_build_object(
    'collection', entity.collection, 'entityId', entity.entity_id
  )), '[]'::jsonb) into removed_entities
  from public.encrypted_workspace_entities as entity
  where entity.owner_id = caller_id and not exists (
    select 1 from jsonb_array_elements(p_envelopes) as replacement(value)
    where replacement.value ->> 'collection' = entity.collection
      and replacement.value ->> 'entityId' = entity.entity_id
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
  ) values (caller_id, next_revision, p_operation_id, p_envelopes, removed_entities, p_manifest, changed_at);
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
