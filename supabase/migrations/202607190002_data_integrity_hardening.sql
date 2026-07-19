-- Defense in depth for cloud workspace persistence.
-- This migration is additive and preserves every existing workspace and
-- recovery snapshot. It removes the browser-callable reset permission,
-- separates ordinary edits from intentional backup replacement, and rejects
-- suspicious collection loss on the ordinary save path.

alter table public.workspace_recovery_snapshots
  drop constraint if exists workspace_recovery_snapshots_reason_check;
alter table public.workspace_recovery_snapshots
  add constraint workspace_recovery_snapshots_reason_check
  check (reason in ('save', 'reset', 'restore', 'replace'));

-- Do not let an accidental Auth-dashboard deletion cascade into permanent loss
-- of both the canonical workspace and every recovery copy. Intentional account
-- erasure must use a separate, audited maintenance workflow.
alter table public.workspace_recovery_snapshots
  drop constraint if exists workspace_recovery_snapshots_owner_id_fkey;
alter table public.workspace_recovery_snapshots
  add constraint workspace_recovery_snapshots_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete restrict;

alter table public.workspaces
  drop constraint if exists workspaces_owner_id_fkey;
alter table public.workspaces
  add constraint workspaces_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete restrict;

create or replace function private.workspace_collection_count(
  p_state jsonb,
  p_key text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_state -> p_key) = 'array'
      then pg_catalog.jsonb_array_length(p_state -> p_key)
    else null
  end;
$$;

revoke all on function private.workspace_collection_count(jsonb, text)
  from public, anon, authenticated;

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

  -- Bound per-account storage growth. Twenty complete revisions are enough for
  -- ordinary recovery while avoiding an unbounded JSONB history.
  delete from public.workspace_recovery_snapshots as snapshot
  where snapshot.owner_id = p_owner_id
    and snapshot.id in (
      select older.id
      from public.workspace_recovery_snapshots as older
      where older.owner_id = p_owner_id
      order by older.created_at desc, older.id desc
      offset 20
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
  v_key text;
  v_current_count integer;
  v_next_count integer;
  v_current_total integer := 0;
  v_next_total integer := 0;
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
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;

  foreach v_key in array array[
    'groups', 'students', 'grades', 'classLog',
    'scheduleExceptions', 'scheduleChanges'
  ] loop
    v_current_count := coalesce(private.workspace_collection_count(v_current_state, v_key), 0);
    v_next_count := private.workspace_collection_count(p_state, v_key);
    if v_next_count is null then
      -- The two schedule collections were optional in legacy state, but every
      -- new client save is canonical and must include arrays for all six.
      if v_key in ('scheduleExceptions', 'scheduleChanges') then
        v_next_count := 0;
      else
        raise exception using errcode = '22023', message = 'invalid_workspace_state';
      end if;
    end if;

    v_current_total := v_current_total + v_current_count;
    v_next_total := v_next_total + v_next_count;

    if v_current_count >= 3 and v_next_count = 0 then
      raise exception using
        errcode = '22023',
        message = 'workspace_collection_delete_blocked',
        detail = pg_catalog.format('Ordinary save would remove every %s record.', v_key),
        hint = 'Use the explicit, archived backup replacement workflow.';
    end if;

    if v_current_count >= 10
      and v_current_count - v_next_count >= 5
      and v_next_count * 2 < v_current_count then
      raise exception using
        errcode = '22023',
        message = 'workspace_large_delete_blocked',
        detail = pg_catalog.format(
          'Ordinary save would reduce %s from %s records to %s.',
          v_key,
          v_current_count,
          v_next_count
        ),
        hint = 'Use the explicit, archived backup replacement workflow.';
    end if;
  end loop;

  if v_current_total > 0 and v_next_total = 0 then
    raise exception using
      errcode = '22023',
      message = 'workspace_mass_delete_blocked',
      hint = 'A populated workspace cannot be emptied through an ordinary save.';
  end if;

  if p_state = v_current_state then
    return query
    select v_current_state, v_current_revision, workspace.updated_at
    from public.workspaces as workspace
    where workspace.owner_id = v_owner_id;
    return;
  end if;

  perform private.archive_workspace_snapshot(v_owner_id, v_current_state, v_current_revision, 'save');
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);

  return query
  update public.workspaces as workspace
  set state = p_state, revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
end;
$$;

alter function public.save_workspace_state(uuid, bigint, jsonb) owner to postgres;
revoke all on function public.save_workspace_state(uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_workspace_state(uuid, bigint, jsonb)
  to authenticated;

create or replace function public.replace_workspace_state(
  p_expected_owner_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_confirmation text
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
  v_current_total integer;
  v_next_total integer;
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
  if p_confirmation is distinct from ('replace:' || p_expected_revision::text) then
    raise exception using errcode = '22023', message = 'workspace_replacement_not_confirmed';
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
    raise exception using errcode = '40001', message = 'workspace_revision_conflict';
  end if;

  v_current_total :=
    coalesce(private.workspace_collection_count(v_current_state, 'groups'), 0)
    + coalesce(private.workspace_collection_count(v_current_state, 'students'), 0)
    + coalesce(private.workspace_collection_count(v_current_state, 'grades'), 0)
    + coalesce(private.workspace_collection_count(v_current_state, 'classLog'), 0);
  v_next_total :=
    coalesce(private.workspace_collection_count(p_state, 'groups'), 0)
    + coalesce(private.workspace_collection_count(p_state, 'students'), 0)
    + coalesce(private.workspace_collection_count(p_state, 'grades'), 0)
    + coalesce(private.workspace_collection_count(p_state, 'classLog'), 0);

  if v_current_total > 0 and v_next_total = 0 then
    raise exception using
      errcode = '22023',
      message = 'empty_workspace_replacement_blocked',
      hint = 'Hibi does not permit replacing a populated account with an empty backup.';
  end if;

  if p_state = v_current_state then
    return query
    select v_current_state, v_current_revision, workspace.updated_at
    from public.workspaces as workspace
    where workspace.owner_id = v_owner_id;
    return;
  end if;

  perform private.archive_workspace_snapshot(v_owner_id, v_current_state, v_current_revision, 'replace');
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);

  return query
  update public.workspaces as workspace
  set state = p_state, revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
end;
$$;

alter function public.replace_workspace_state(uuid, bigint, jsonb, text) owner to postgres;
revoke all on function public.replace_workspace_state(uuid, bigint, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.replace_workspace_state(uuid, bigint, jsonb, text)
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

  perform private.archive_workspace_snapshot(v_owner_id, v_current_state, v_current_revision, 'restore');
  perform pg_catalog.set_config('hibi.workspace_write_authorized', 'yes', true);

  return query
  update public.workspaces as workspace
  set state = v_snapshot_state, revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;
  perform pg_catalog.set_config('hibi.workspace_write_authorized', '', true);
end;
$$;

alter function public.restore_workspace_snapshot(uuid, uuid, bigint) owner to postgres;
revoke all on function public.restore_workspace_snapshot(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.restore_workspace_snapshot(uuid, uuid, bigint)
  to authenticated;

create or replace function private.guard_workspace_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.state is distinct from old.state or new.revision is distinct from old.revision)
    and coalesce(pg_catalog.current_setting('hibi.workspace_write_authorized', true), '') <> 'yes' then
    raise exception using
      errcode = '42501',
      message = 'direct_workspace_update_blocked',
      hint = 'Use a revision-aware Hibi persistence RPC.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_workspace_update() from public, anon, authenticated;
drop trigger if exists guard_workspace_update on public.workspaces;
create trigger guard_workspace_update
before update on public.workspaces
for each row execute function private.guard_workspace_update();

-- The incident-causing operation remains in migration history, but browsers can
-- no longer execute it. Existing production rows are untouched.
revoke all on function public.reset_workspace_state(uuid)
  from public, anon, authenticated;
