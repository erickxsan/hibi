-- Authenticated workspace reset and fail-closed account erasure.
--
-- Account deletion deliberately keeps the restrictive Auth foreign keys. The
-- only authorized path first erases every registered owner-scoped table in one
-- transaction and only then allows the Edge Function to delete the Auth user.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create table public.account_deletion_requests (
  request_id uuid primary key,
  owner_id uuid,
  subject_hash text not null unique check (subject_hash ~ '^[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'data_erased', 'completed')),
  requested_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  data_erased_at timestamptz,
  completed_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,80}$'
  ),
  constraint account_deletion_requests_owner_status_check check (
    (status in ('pending', 'data_erased') and owner_id is not null)
    or (status = 'completed' and owner_id is null)
  )
);

comment on table public.account_deletion_requests is
  'Minimal pseudonymous audit receipts for retryable account erasure. Completed rows retain only hashes and timestamps for 90 days.';

create unique index account_deletion_requests_active_owner_idx
  on public.account_deletion_requests (owner_id)
  where owner_id is not null;

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;

create table private.account_erasure_targets (
  table_schema text not null,
  table_name text not null,
  delete_order integer not null unique,
  primary key (table_schema, table_name)
);

comment on table private.account_erasure_targets is
  'Mandatory registry for owner_id tables erased before Auth deletion. New owner-scoped tables must be registered.';

insert into private.account_erasure_targets (table_schema, table_name, delete_order)
values
  ('public', 'schedule_exceptions', 10),
  ('public', 'schedule_changes', 20),
  ('public', 'class_schedules', 30),
  ('public', 'payments', 40),
  ('public', 'class_records', 50),
  ('public', 'grades', 60),
  ('public', 'student_groups', 70),
  ('public', 'students', 80),
  ('public', 'groups', 90),
  ('public', 'workspace_change_events', 100),
  ('public', 'workspace_mutation_receipts', 110),
  ('public', 'workspace_settings', 120),
  ('public', 'workspace_sync_cursors', 130),
  ('public', 'workspace_sync_signals', 140),
  ('public', 'workspace_import_jobs', 150),
  ('public', 'workspace_recovery_snapshots', 160),
  ('public', 'workspaces', 170);

revoke all on table private.account_erasure_targets from public, anon, authenticated;

create or replace function private.account_hash(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

create or replace function public.current_account_is_deletion_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_deletion_requests as request
    where request.owner_id = (select auth.uid())
      and request.status in ('pending', 'data_erased')
  )
$$;

alter function public.current_account_is_deletion_pending() owner to postgres;
revoke all on function public.current_account_is_deletion_pending()
  from public, anon, authenticated;
grant execute on function public.current_account_is_deletion_pending()
  to authenticated;

drop policy if exists hibi_block_pending_account_storage on storage.objects;
create policy hibi_block_pending_account_storage
on storage.objects
as restrictive
for all
to authenticated
using (not (select public.current_account_is_deletion_pending()))
with check (not (select public.current_account_is_deletion_pending()));

create or replace function private.reject_pending_account_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_owner uuid;
begin
  -- Administrative erasure is authorized with service_role. User JWTs,
  -- including still-valid stale tokens, fail closed after the tombstone exists.
  if (select auth.role()) is distinct from 'authenticated' then
    if tg_op = 'DELETE' then return old;
    else return new;
    end if;
  end if;

  if tg_op = 'DELETE' then target_owner := old.owner_id;
  else target_owner := new.owner_id;
  end if;

  if exists (
    select 1 from public.account_deletion_requests as request
    where request.owner_id = target_owner
      and request.status in ('pending', 'data_erased')
  ) then
    raise exception using errcode = '42501', message = 'account_deletion_pending';
  end if;

  if tg_op = 'DELETE' then return old;
  else return new;
  end if;
end;
$$;

alter function private.reject_pending_account_mutation() owner to postgres;
revoke all on function private.reject_pending_account_mutation()
  from public, anon, authenticated;

do $$
declare
  target record;
begin
  for target in select table_schema, table_name from private.account_erasure_targets loop
    execute format(
      'create trigger reject_pending_account_mutation before insert or update or delete on %I.%I for each row execute function private.reject_pending_account_mutation()',
      target.table_schema,
      target.table_name
    );
  end loop;
end;
$$;

-- Direct reads also stop as soon as deletion is pending. Normal data access is
-- through RPCs, but these policies cover Realtime and recovery/import lists.
do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('workspaces', 'workspaces_select_own'),
      ('workspace_recovery_snapshots', 'workspace_recovery_snapshots_select_own'),
      ('workspace_import_jobs', 'workspace_import_jobs_select_own'),
      ('workspace_sync_signals', 'workspace_sync_signals_select_own'),
      ('workspace_settings', 'workspace_settings_select_own'),
      ('groups', 'groups_select_own'),
      ('students', 'students_select_own'),
      ('student_groups', 'student_groups_select_own'),
      ('grades', 'grades_select_own'),
      ('class_schedules', 'class_schedules_select_own'),
      ('schedule_exceptions', 'schedule_exceptions_select_own'),
      ('schedule_changes', 'schedule_changes_select_own'),
      ('class_records', 'class_records_select_own'),
      ('payments', 'payments_select_own'),
      ('workspace_sync_cursors', 'workspace_sync_cursors_select_own'),
      ('workspace_change_events', 'workspace_change_events_select_own')
    ) as policies(table_name, policy_name)
  loop
    execute format('drop policy if exists %I on public.%I', target.policy_name, target.table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()) and not (select public.current_account_is_deletion_pending()))',
      target.policy_name,
      target.table_name
    );
  end loop;
end;
$$;

create or replace function private.archive_workspace_snapshot(
  p_owner_id uuid,
  p_state jsonb,
  p_source_revision bigint,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_recovery_snapshots (
    owner_id, state, source_revision, reason
  ) values (
    p_owner_id, p_state, p_source_revision, p_reason
  );

  delete from public.workspace_recovery_snapshots as snapshot
  where snapshot.owner_id = p_owner_id
    and (
      snapshot.created_at < clock_timestamp() - interval '30 days'
      or snapshot.id in (
        select older.id
        from public.workspace_recovery_snapshots as older
        where older.owner_id = p_owner_id
        order by older.created_at desc, older.id desc
        offset 20
      )
    );
end;
$$;

alter function private.archive_workspace_snapshot(uuid, jsonb, bigint, text)
  owner to postgres;
revoke all on function private.archive_workspace_snapshot(uuid, jsonb, bigint, text)
  from public, anon, authenticated;

-- The normalized tables are canonical. Remove the obsolete JSON document that
-- was retained only to migrate older installations, so it cannot become an
-- undeclared, indefinitely retained copy of class records.
do $$
begin
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);
  update public.workspaces as workspace
  set state = private.initial_workspace_state()
  where workspace.state is distinct from private.initial_workspace_state();
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
end;
$$;

create or replace function public.reset_normalized_workspace_records(
  p_expected_owner_id uuid,
  p_expected_revision bigint,
  p_confirmation text
)
returns table (
  owner_id uuid,
  state jsonb,
  versions jsonb,
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_state jsonb;
  reset_state jsonb;
  event record;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if (select public.current_account_is_deletion_pending()) then raise exception using errcode = '42501', message = 'account_deletion_pending'; end if;
  if p_confirmation is distinct from format('reset:%s', p_expected_revision) then raise exception using errcode = '22023', message = 'workspace_reset_not_confirmed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
  select cursor.revision into current_revision
  from public.workspace_sync_cursors as cursor
  where cursor.owner_id = caller_id
  for update;

  if current_revision is null then raise exception using errcode = 'P0002', message = 'workspace_not_found'; end if;
  if current_revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'workspace_entity_conflict', detail = 'reset'; end if;

  current_state := private.normalized_workspace_state(caller_id);
  reset_state := jsonb_build_object(
    'version', 1,
    'settings', current_state -> 'settings',
    'groups', '[]'::jsonb,
    'students', '[]'::jsonb,
    'grades', '[]'::jsonb,
    'classLog', '[]'::jsonb,
    'classSchedules', '[]'::jsonb,
    'scheduleExceptions', '[]'::jsonb,
    'scheduleChanges', '[]'::jsonb
  );

  perform private.archive_workspace_snapshot(caller_id, current_state, current_revision, 'reset');
  perform private.replace_normalized_data(caller_id, reset_state);
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);
  update public.workspaces as workspace
  set state = reset_state
  where workspace.owner_id = caller_id;
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
  select * into event
  from private.record_workspace_event(caller_id, jsonb_build_object('reload', true, 'reason', 'reset'));

  return query
  select caller_id, reset_state, private.normalized_workspace_versions(caller_id), event.event_id, event.updated_at;
end;
$$;

alter function public.reset_normalized_workspace_records(uuid, bigint, text) owner to postgres;
revoke all on function public.reset_normalized_workspace_records(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.reset_normalized_workspace_records(uuid, bigint, text)
  to authenticated;

create or replace function public.begin_account_deletion(
  p_request_id uuid,
  p_expected_owner_id uuid,
  p_confirmation text,
  p_receipt_secret text
)
returns table (request_id uuid, status text, requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  caller_id uuid := (select auth.uid());
  subject_hash_value text;
  receipt_hash_value text;
  existing_request public.account_deletion_requests%rowtype;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if p_request_id is null then raise exception using errcode = '22023', message = 'deletion_request_id_required'; end if;
  if p_confirmation is distinct from 'DELETE MY ACCOUNT' then raise exception using errcode = '22023', message = 'account_deletion_not_confirmed'; end if;
  if p_receipt_secret is null or p_receipt_secret !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception using errcode = '22023', message = 'invalid_deletion_receipt'; end if;

  subject_hash_value := private.account_hash(caller_id::text);
  receipt_hash_value := private.account_hash(p_receipt_secret);
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));

  select * into existing_request
  from public.account_deletion_requests as request
  where request.subject_hash = subject_hash_value
  for update;

  if found then
    if existing_request.status = 'completed' then
      raise exception using errcode = '55000', message = 'account_deletion_already_completed';
    end if;
    update public.account_deletion_requests as request
    set receipt_hash = receipt_hash_value,
        last_error_code = null
    where request.request_id = existing_request.request_id
    returning * into existing_request;
  else
    insert into public.account_deletion_requests (
      request_id, owner_id, subject_hash, receipt_hash
    ) values (
      p_request_id, caller_id, subject_hash_value, receipt_hash_value
    )
    returning * into existing_request;
  end if;

  return query select existing_request.request_id, existing_request.status, existing_request.requested_at;
end;
$$;

alter function public.begin_account_deletion(uuid, uuid, text, text) owner to postgres;
revoke all on function public.begin_account_deletion(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid, uuid, text, text)
  to authenticated;

-- Storage metadata is read here, but objects are removed by the Edge Function
-- through the Storage API so the underlying files are not orphaned.
create or replace function public.list_account_storage_objects(
  p_owner_id uuid,
  p_limit integer default 1000
)
returns table (bucket_id text, object_name text)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_owner_id is null or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'invalid_storage_object_query';
  end if;

  return query
  select object.bucket_id, object.name
  from storage.objects as object
  where object.owner_id = p_owner_id::text
  order by object.bucket_id, object.name
  limit p_limit;
end;
$$;

alter function public.list_account_storage_objects(uuid, integer) owner to postgres;
revoke all on function public.list_account_storage_objects(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_account_storage_objects(uuid, integer)
  to service_role;

create or replace function public.erase_account_data(
  p_request_id uuid,
  p_owner_id uuid
)
returns table (request_id uuid, status text, data_erased_at timestamptz)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  request public.account_deletion_requests%rowtype;
  target record;
  unregistered_table text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_request_id is null or p_owner_id is null then
    raise exception using errcode = '22023', message = 'invalid_deletion_request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  select * into request
  from public.account_deletion_requests as deletion
  where deletion.request_id = p_request_id
  for update;

  if not found or request.owner_id is distinct from p_owner_id then
    raise exception using errcode = 'P0002', message = 'account_deletion_request_not_found';
  end if;
  if request.status = 'data_erased' then
    return query select request.request_id, request.status, request.data_erased_at;
    return;
  end if;
  if request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'invalid_account_deletion_status';
  end if;

  select format('%I.%I', columns.table_schema, columns.table_name)
  into unregistered_table
  from information_schema.columns as columns
  where columns.column_name = 'owner_id'
    and columns.table_schema = 'public'
    and columns.table_name <> 'account_deletion_requests'
    and not exists (
      select 1 from private.account_erasure_targets as registered
      where registered.table_schema = columns.table_schema
        and registered.table_name = columns.table_name
    )
  order by columns.table_name
  limit 1;

  if unregistered_table is not null then
    raise exception using errcode = '55000', message = 'unregistered_account_data_table', detail = unregistered_table;
  end if;

  update public.account_deletion_requests as deletion
  set last_attempt_at = clock_timestamp(),
      attempt_count = deletion.attempt_count + 1,
      last_error_code = null
  where deletion.request_id = p_request_id;

  for target in
    select table_schema, table_name
    from private.account_erasure_targets
    order by delete_order
  loop
    execute format('delete from %I.%I where owner_id = $1', target.table_schema, target.table_name)
      using p_owner_id;
  end loop;

  update public.account_deletion_requests as deletion
  set status = 'data_erased',
      data_erased_at = clock_timestamp()
  where deletion.request_id = p_request_id
  returning * into request;

  return query select request.request_id, request.status, request.data_erased_at;
end;
$$;

alter function public.erase_account_data(uuid, uuid) owner to postgres;
revoke all on function public.erase_account_data(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.erase_account_data(uuid, uuid) to service_role;

create or replace function public.record_account_deletion_failure(
  p_request_id uuid,
  p_owner_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,80}$' then
    raise exception using errcode = '22023', message = 'invalid_deletion_error_code';
  end if;

  update public.account_deletion_requests as deletion
  set last_attempt_at = clock_timestamp(),
      attempt_count = deletion.attempt_count + case when deletion.status = 'pending' then 1 else 0 end,
      last_error_code = p_error_code
  where deletion.request_id = p_request_id
    and deletion.owner_id = p_owner_id
    and deletion.status in ('pending', 'data_erased');

  if not found then raise exception using errcode = 'P0002', message = 'account_deletion_request_not_found'; end if;
end;
$$;

alter function public.record_account_deletion_failure(uuid, uuid, text) owner to postgres;
revoke all on function public.record_account_deletion_failure(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_account_deletion_failure(uuid, uuid, text)
  to service_role;

create or replace function public.complete_account_deletion(
  p_request_id uuid,
  p_owner_id uuid
)
returns table (request_id uuid, status text, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.account_deletion_requests%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;

  select * into request
  from public.account_deletion_requests as deletion
  where deletion.request_id = p_request_id
  for update;

  if not found then raise exception using errcode = 'P0002', message = 'account_deletion_request_not_found'; end if;
  if request.status = 'completed' then
    return query select request.request_id, request.status, request.completed_at;
    return;
  end if;
  if request.owner_id is distinct from p_owner_id or request.status <> 'data_erased' then
    raise exception using errcode = '55000', message = 'account_data_not_erased';
  end if;

  update public.account_deletion_requests as deletion
  set status = 'completed',
      owner_id = null,
      completed_at = clock_timestamp(),
      last_error_code = null
  where deletion.request_id = p_request_id
  returning * into request;

  return query select request.request_id, request.status, request.completed_at;
end;
$$;

alter function public.complete_account_deletion(uuid, uuid) owner to postgres;
revoke all on function public.complete_account_deletion(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_account_deletion(uuid, uuid)
  to service_role;

create or replace function public.get_account_deletion_receipt(
  p_request_id uuid,
  p_receipt_secret text
)
returns table (
  request_id uuid,
  owner_id uuid,
  status text,
  requested_at timestamptz,
  data_erased_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.request_id,
    request.owner_id,
    request.status,
    request.requested_at,
    request.data_erased_at,
    request.completed_at
  from public.account_deletion_requests as request
  where request.request_id = p_request_id
    and request.receipt_hash = private.account_hash(p_receipt_secret)
$$;

alter function public.get_account_deletion_receipt(uuid, text) owner to postgres;
revoke all on function public.get_account_deletion_receipt(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_account_deletion_receipt(uuid, text)
  to service_role;

-- Re-declare the loader so a tombstoned account gets a deterministic error
-- even after its sync cursor has already been erased.
create or replace function public.load_normalized_workspace(p_expected_owner_id uuid)
returns table (owner_id uuid, state jsonb, versions jsonb, revision bigint, updated_at timestamptz)
language plpgsql
security definer
stable
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if (select public.current_account_is_deletion_pending()) then raise exception using errcode = '42501', message = 'account_deletion_pending'; end if;

  return query
  select caller_id, private.normalized_workspace_state(caller_id), private.normalized_workspace_versions(caller_id), cursor.revision, cursor.updated_at
  from public.workspace_sync_cursors as cursor
  where cursor.owner_id = caller_id;
end;
$$;

alter function public.load_normalized_workspace(uuid) owner to postgres;
revoke all on function public.load_normalized_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.load_normalized_workspace(uuid)
  to authenticated;

comment on function public.reset_normalized_workspace_records(uuid, bigint, text) is
  'Clears active records while retaining recovery snapshots for at most 30 days and 20 revisions.';
comment on function public.erase_account_data(uuid, uuid) is
  'service_role-only transactional erasure. Fails closed if a new public owner_id table is not registered.';
comment on function public.list_account_storage_objects(uuid, integer) is
  'service_role-only bounded listing used to purge owned files through the Storage API before Auth deletion.';

-- Enforce the server-side recovery window even for dormant accounts. Device
-- IndexedDB copies are purged by the browser the next time Hibi opens there.
select cron.schedule(
  'hibi-purge-expired-workspace-snapshots',
  '*/15 * * * *',
  $command$
    delete from public.workspace_recovery_snapshots
    where created_at < clock_timestamp() - interval '30 days'
  $command$
);

select cron.schedule(
  'hibi-purge-expired-account-deletion-receipts',
  '17 3 * * *',
  $command$
    delete from public.account_deletion_requests
    where status = 'completed'
      and completed_at < clock_timestamp() - interval '90 days'
  $command$
);
