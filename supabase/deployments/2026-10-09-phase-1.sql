-- REVIEW BEFORE APPLYING. Target: Hibi / bqrmsxlbiotpdgrjjgkz.
-- PHASE 1: corrections; new destructive retention deferred. Prepared locally; never executed remotely by this script.
-- Apply the entire transaction once. Do not run migration fragments separately.
begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';
do $preflight$
begin
  if (select array_agg(version::text order by version) from supabase_migrations.schema_migrations)
    is distinct from array['202607110001','202607140001','202607190001','202607190002','202607270001','202608110001','202608120001','202608120002','202608120003','202608120004','202608120005','202608120006','202608120007','202608250001','202608260001','202608260002','202608260003','202609210001']::text[] then
    raise exception 'Migration history changed; recheck this reviewed phase before applying';
  end if;
end;
$preflight$;
do $passwords$
begin
  if exists (select 1 from public.workspace_key_wrappers where wrapper_type='password' and revoked_at is null
    group by owner_id having count(*)>1) then
    raise exception 'Multiple active passwords exist; resolve credentials before applying uniqueness';
  end if;
end;
$passwords$;
-- Preserve full revoked rows before the historical purge migration. Phase one
-- reinstates them after its non-destructive trigger is installed. A restore or
-- verification failure aborts the whole transaction; no intermediate deletion
-- becomes visible or permanent. No keys leave this database session.
create temporary table hibi_preserved_revoked_wrappers on commit drop as
select * from public.workspace_key_wrappers where revoked_at is not null;

-- Migration 202609070001_freeze_legacy_e2ee_source.sql
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

insert into supabase_migrations.schema_migrations(version,name) values('202609070001','freeze_legacy_e2ee_source');

-- Migration 202609070002_complete_replacement_events.sql
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

insert into supabase_migrations.schema_migrations(version,name) values('202609070002','complete_replacement_events');

-- Restore the already-installed idempotent conflict correction after older definitions.
-- A stale application revision is not a PostgreSQL serialization failure.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely with the same stale arguments.
-- Patch only Hibi's explicit business conflicts, preserving each installed
-- function body, signature, owner, grants, search_path and security mode.
-- This also works on installations that have not yet applied the September 7
-- migrations; run it again after those migrations if applying them manually.
do $migration$
declare
  target record;
  conflict_pattern constant text := $pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'([[:space:]]*,[[:space:]]*message[[:space:]]*=[[:space:]]*'(workspace_revision_conflict|workspace_entity_conflict|legacy_revision_conflict)')$pattern$;
begin
  for target in
    select p.oid, pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and l.lanname = 'plpgsql'
      and p.prosrc ~ conflict_pattern
    order by p.oid
  loop
    execute pg_catalog.regexp_replace(
      target.definition, conflict_pattern, $replacement$\1'PT409'\2$replacement$, 'g'
    );
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';


-- Migration 202610020001_recovery_contract_and_wrapper_purge.sql
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

insert into supabase_migrations.schema_migrations(version,name) values('202610020001','recovery_contract_and_wrapper_purge');

-- Migration 202610070001_data_lifecycle_remediation.sql
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

insert into supabase_migrations.schema_migrations(version,name) values('202610070001','data_lifecycle_remediation');

-- Migration 202610070002_preserve_snapshot_clocks.sql
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

insert into supabase_migrations.schema_migrations(version,name) values('202610070002','preserve_snapshot_clocks');

-- Migration 202610090001_defer_recovery_retention.sql
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

insert into supabase_migrations.schema_migrations(version,name) values('202610090001','defer_recovery_retention');

insert into public.workspace_key_wrappers select * from pg_temp.hibi_preserved_revoked_wrappers;
do $preservation$
begin
  if exists (
    select * from pg_temp.hibi_preserved_revoked_wrappers
    except select * from public.workspace_key_wrappers where revoked_at is not null
  ) then
    raise exception 'Revoked credential preservation failed; phase one must roll back';
  end if;
  if exists (select 1 from cron.job where jobname='hibi-purge-expired-workspace-snapshots'
    and command like '%encrypted_workspace_snapshots%') then
    raise exception 'Encrypted snapshot purge must remain deferred in phase one';
  end if;
end;
$preservation$;

commit;
select version,name from supabase_migrations.schema_migrations order by version;
select jobname,schedule,active,command from cron.job where jobname like 'hibi-%';
