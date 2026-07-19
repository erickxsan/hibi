-- Keep recoverable history before every cloud workspace write. This migration
-- is additive: the canonical workspaces table and all existing rows remain
-- unchanged.

create table if not exists public.workspace_recovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  source_revision bigint not null check (source_revision >= 0),
  reason text not null check (reason in ('save', 'reset', 'restore')),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists workspace_recovery_snapshots_owner_created_idx
  on public.workspace_recovery_snapshots (owner_id, created_at desc);

alter table public.workspace_recovery_snapshots enable row level security;
alter table public.workspace_recovery_snapshots force row level security;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_recovery_snapshots'
      and policyname = 'workspace_recovery_snapshots_select_own'
  ) then
    create policy workspace_recovery_snapshots_select_own
    on public.workspace_recovery_snapshots
    for select
    to authenticated
    using (owner_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on table public.workspace_recovery_snapshots from public, anon, authenticated;
grant select on table public.workspace_recovery_snapshots to authenticated;

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
    owner_id,
    state,
    source_revision,
    reason
  ) values (
    p_owner_id,
    p_state,
    p_source_revision,
    p_reason
  );

  -- Bound storage growth while retaining enough history for ordinary recovery.
  delete from public.workspace_recovery_snapshots as snapshot
  where snapshot.owner_id = p_owner_id
    and snapshot.id in (
      select older.id
      from public.workspace_recovery_snapshots as older
      where older.owner_id = p_owner_id
      order by older.created_at desc, older.id desc
      offset 50
    );
end;
$$;

alter function private.archive_workspace_snapshot(uuid, jsonb, bigint, text) owner to postgres;
revoke all on function private.archive_workspace_snapshot(uuid, jsonb, bigint, text)
  from public, anon, authenticated;

create or replace function public.save_workspace_state(
  p_expected_owner_id uuid,
  p_expected_revision bigint,
  p_state jsonb
)
returns table (
  state jsonb,
  revision bigint,
  updated_at timestamptz
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
  v_current_record_count integer;
  v_next_record_count integer;
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

  select workspace.state, workspace.revision
  into v_current_state, v_current_revision
  from public.workspaces as workspace
  where workspace.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'workspace_revision_conflict',
      detail = pg_catalog.format(
        'Expected revision %s, current revision is %s.',
        p_expected_revision,
        v_current_revision
      );
  end if;

  v_current_record_count :=
    pg_catalog.jsonb_array_length(v_current_state -> 'groups')
    + pg_catalog.jsonb_array_length(v_current_state -> 'students')
    + pg_catalog.jsonb_array_length(v_current_state -> 'grades')
    + pg_catalog.jsonb_array_length(v_current_state -> 'classLog');
  v_next_record_count :=
    pg_catalog.jsonb_array_length(p_state -> 'groups')
    + pg_catalog.jsonb_array_length(p_state -> 'students')
    + pg_catalog.jsonb_array_length(p_state -> 'grades')
    + pg_catalog.jsonb_array_length(p_state -> 'classLog');

  if v_current_record_count > 0 and v_next_record_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'workspace_mass_delete_blocked',
      hint = 'Use an explicit, archived reset workflow.';
  end if;

  perform private.archive_workspace_snapshot(
    v_owner_id,
    v_current_state,
    v_current_revision,
    'save'
  );

  return query
  update public.workspaces as workspace
  set
    state = p_state,
    revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;
end;
$$;

alter function public.save_workspace_state(uuid, bigint, jsonb) owner to postgres;
revoke all on function public.save_workspace_state(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_workspace_state(uuid, bigint, jsonb)
  to authenticated;

create or replace function public.reset_workspace_state(
  p_expected_owner_id uuid
)
returns table (
  state jsonb,
  revision bigint,
  updated_at timestamptz
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
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_expected_owner_id is null or p_expected_owner_id <> v_owner_id then
    raise exception using errcode = '42501', message = 'account_changed';
  end if;

  select workspace.state, workspace.revision
  into v_current_state, v_current_revision
  from public.workspaces as workspace
  where workspace.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  perform private.archive_workspace_snapshot(
    v_owner_id,
    v_current_state,
    v_current_revision,
    'reset'
  );

  return query
  update public.workspaces as workspace
  set
    state = private.initial_workspace_state(),
    revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;
end;
$$;

alter function public.reset_workspace_state(uuid) owner to postgres;
revoke all on function public.reset_workspace_state(uuid)
  from public, anon, authenticated;
grant execute on function public.reset_workspace_state(uuid)
  to authenticated;

create or replace function public.restore_workspace_snapshot(
  p_expected_owner_id uuid,
  p_snapshot_id uuid,
  p_expected_revision bigint
)
returns table (
  state jsonb,
  revision bigint,
  updated_at timestamptz
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
  v_snapshot_state jsonb;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_expected_owner_id is null or p_expected_owner_id <> v_owner_id then
    raise exception using errcode = '42501', message = 'account_changed';
  end if;

  select workspace.state, workspace.revision
  into v_current_state, v_current_revision
  from public.workspaces as workspace
  where workspace.owner_id = v_owner_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  if v_current_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;

  select snapshot.state
  into v_snapshot_state
  from public.workspace_recovery_snapshots as snapshot
  where snapshot.id = p_snapshot_id
    and snapshot.owner_id = v_owner_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_snapshot_not_found';
  end if;

  perform private.archive_workspace_snapshot(
    v_owner_id,
    v_current_state,
    v_current_revision,
    'restore'
  );

  return query
  update public.workspaces as workspace
  set
    state = v_snapshot_state,
    revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;
end;
$$;

alter function public.restore_workspace_snapshot(uuid, uuid, bigint) owner to postgres;
revoke all on function public.restore_workspace_snapshot(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.restore_workspace_snapshot(uuid, uuid, bigint)
  to authenticated;
