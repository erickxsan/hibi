-- Audited, idempotent, additive JSON imports. This migration does not alter
-- existing workspace state. The RPC refuses any candidate that omits a stable
-- ID already present in the account.

alter table public.workspace_recovery_snapshots
  drop constraint if exists workspace_recovery_snapshots_reason_check;
alter table public.workspace_recovery_snapshots
  add constraint workspace_recovery_snapshots_reason_check
  check (reason in ('save', 'reset', 'restore', 'replace', 'import'));

create table if not exists public.workspace_import_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  file_hash text not null,
  source_name text not null default '',
  base_revision bigint not null check (base_revision >= 0),
  result_revision bigint not null check (result_revision >= base_revision),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  constraint workspace_import_jobs_file_hash_check check (file_hash ~ '^[0-9a-f]{64}$'),
  constraint workspace_import_jobs_owner_file_hash_unique unique (owner_id, file_hash),
  constraint workspace_import_jobs_owner_id_fkey
    foreign key (owner_id) references auth.users(id) on delete restrict
);

create index if not exists workspace_import_jobs_owner_created_idx
  on public.workspace_import_jobs (owner_id, created_at desc);

alter table public.workspace_import_jobs enable row level security;
alter table public.workspace_import_jobs force row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_import_jobs'
      and policyname = 'workspace_import_jobs_select_own'
  ) then
    create policy workspace_import_jobs_select_own
      on public.workspace_import_jobs
      for select
      to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
end $$;

revoke all on table public.workspace_import_jobs from public, anon, authenticated;
grant select on table public.workspace_import_jobs to authenticated;

create or replace function public.apply_workspace_import(
  p_expected_owner_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_file_hash text,
  p_source_name text,
  p_summary jsonb,
  p_confirmation text
)
returns table (
  state jsonb,
  revision bigint,
  updated_at timestamptz,
  already_imported boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_current_state jsonb;
  v_current_revision bigint;
  v_key text;
  v_missing_id text;
  v_result_revision bigint;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_expected_owner_id is null or p_expected_owner_id <> v_owner_id then
    raise exception using errcode = '42501', message = 'account_changed';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_expected_revision';
  end if;
  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_workspace_state';
  end if;
  if p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_import_hash';
  end if;
  if p_summary is null or pg_catalog.jsonb_typeof(p_summary) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_import_summary';
  end if;
  if p_confirmation is distinct from ('import:' || p_expected_revision::text || ':' || p_file_hash) then
    raise exception using errcode = '22023', message = 'workspace_import_not_confirmed';
  end if;

  select workspace.state, workspace.revision
  into v_current_state, v_current_revision
  from public.workspaces as workspace
  where workspace.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  -- Re-uploading the same bytes is a no-op, even after later edits.
  if exists (
    select 1 from public.workspace_import_jobs as job
    where job.owner_id = v_owner_id and job.file_hash = p_file_hash
  ) then
    return query
    select v_current_state, v_current_revision, workspace.updated_at, true
    from public.workspaces as workspace
    where workspace.owner_id = v_owner_id;
    return;
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;

  foreach v_key in array array[
    'groups', 'students', 'grades', 'classLog', 'classSchedules',
    'scheduleExceptions', 'scheduleChanges'
  ] loop
    if pg_catalog.jsonb_typeof(p_state -> v_key) <> 'array' then
      raise exception using errcode = '22023', message = 'invalid_workspace_state';
    end if;

    select old_record ->> 'id'
    into v_missing_id
    from pg_catalog.jsonb_array_elements(coalesce(v_current_state -> v_key, '[]'::jsonb)) as old_record
    where nullif(old_record ->> 'id', '') is not null
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_state -> v_key) as next_record
        where next_record ->> 'id' = old_record ->> 'id'
      )
    limit 1;

    if v_missing_id is not null then
      raise exception using
        errcode = '22023',
        message = 'workspace_import_would_remove_records',
        detail = pg_catalog.format('Import omitted existing %s ID %s.', v_key, v_missing_id),
        hint = 'Rebuild the import preview from the latest cloud workspace.';
    end if;
    v_missing_id := null;
  end loop;

  if p_state = v_current_state then
    insert into public.workspace_import_jobs (
      owner_id, file_hash, source_name, base_revision, result_revision, summary
    ) values (
      v_owner_id, p_file_hash, left(coalesce(p_source_name, ''), 255),
      v_current_revision, v_current_revision, p_summary
    );
    return query
    select v_current_state, v_current_revision, workspace.updated_at, false
    from public.workspaces as workspace
    where workspace.owner_id = v_owner_id;
    return;
  end if;

  perform private.archive_workspace_snapshot(v_owner_id, v_current_state, v_current_revision, 'import');
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);

  update public.workspaces as workspace
  set state = p_state, revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.revision into v_result_revision;

  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);

  insert into public.workspace_import_jobs (
    owner_id, file_hash, source_name, base_revision, result_revision, summary
  ) values (
    v_owner_id, p_file_hash, left(coalesce(p_source_name, ''), 255),
    v_current_revision, v_result_revision, p_summary
  );

  return query
  select workspace.state, workspace.revision, workspace.updated_at, false
  from public.workspaces as workspace
  where workspace.owner_id = v_owner_id;
end;
$$;

alter function public.apply_workspace_import(uuid, bigint, jsonb, text, text, jsonb, text) owner to postgres;
revoke all on function public.apply_workspace_import(uuid, bigint, jsonb, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_workspace_import(uuid, bigint, jsonb, text, text, jsonb, text)
  to authenticated;

