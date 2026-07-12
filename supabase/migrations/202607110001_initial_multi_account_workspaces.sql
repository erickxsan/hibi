-- Multi-account persistence for Class Manager.
-- Each Supabase Auth user owns exactly one opaque, canonical application state.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.initial_workspace_state()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with local_dates as (
    select (current_timestamp at time zone 'America/Mexico_City')::date as today
  )
  select pg_catalog.jsonb_build_object(
    'version', 1,
    'settings', pg_catalog.jsonb_build_object(
      'currency', 'MXN',
      'hourlyRate', 50,
      'defaultClassHours', 2,
      'recentProjectionWeeks', 4,
      'lowGradeThreshold', 0.7,
      'lowAttendanceThreshold', 0.8,
      'selectedMonth', pg_catalog.to_char(
        pg_catalog.date_trunc('month', today::timestamp)::date,
        'YYYY-MM-DD'
      ),
      'asOfDate', pg_catalog.to_char(today, 'YYYY-MM-DD')
    ),
    'groups', '[]'::jsonb,
    'students', '[]'::jsonb,
    'grades', '[]'::jsonb,
    'classLog', '[]'::jsonb
  )
  from local_dates;
$$;

revoke all on function private.initial_workspace_state() from public, anon, authenticated;

create table public.workspaces (
  owner_id uuid primary key
    references auth.users(id) on delete cascade,
  state jsonb not null default private.initial_workspace_state(),
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_revision_nonnegative_check
    check (revision >= 0),
  constraint workspaces_timestamp_order_check
    check (updated_at >= created_at),
  constraint workspaces_state_shape_check
    check (
      pg_catalog.jsonb_typeof(state) = 'object'
      and state ?& array['version', 'settings', 'groups', 'students', 'grades', 'classLog']::text[]
      and pg_catalog.jsonb_typeof(state -> 'version') = 'number'
      and state ->> 'version' = '1'
      and pg_catalog.jsonb_typeof(state -> 'settings') = 'object'
      and (state -> 'settings') ?& array[
        'currency',
        'hourlyRate',
        'defaultClassHours',
        'recentProjectionWeeks',
        'lowGradeThreshold',
        'lowAttendanceThreshold',
        'selectedMonth',
        'asOfDate'
      ]::text[]
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'currency') = 'string'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'selectedMonth') = 'string'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'asOfDate') = 'string'
      and state -> 'settings' ->> 'currency' = 'MXN'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'hourlyRate') = 'number'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'defaultClassHours') = 'number'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'recentProjectionWeeks') = 'number'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'lowGradeThreshold') = 'number'
      and pg_catalog.jsonb_typeof(state -> 'settings' -> 'lowAttendanceThreshold') = 'number'
      and (state -> 'settings' ->> 'hourlyRate')::numeric >= 0
      and (state -> 'settings' ->> 'defaultClassHours')::numeric >= 0
      and (state -> 'settings' ->> 'recentProjectionWeeks')::numeric >= 1
      and (state -> 'settings' ->> 'recentProjectionWeeks')::numeric = pg_catalog.trunc((state -> 'settings' ->> 'recentProjectionWeeks')::numeric)
      and (state -> 'settings' ->> 'lowGradeThreshold')::numeric between 0 and 1
      and (state -> 'settings' ->> 'lowAttendanceThreshold')::numeric between 0 and 1
      and (state -> 'settings' ->> 'selectedMonth') ~ '^[0-9]{4}-[0-9]{2}-01$'
      and (state -> 'settings' ->> 'asOfDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and pg_catalog.to_char(pg_catalog.to_date(state -> 'settings' ->> 'selectedMonth', 'YYYY-MM-DD'), 'YYYY-MM-DD') = state -> 'settings' ->> 'selectedMonth'
      and pg_catalog.to_char(pg_catalog.to_date(state -> 'settings' ->> 'asOfDate', 'YYYY-MM-DD'), 'YYYY-MM-DD') = state -> 'settings' ->> 'asOfDate'
      and pg_catalog.jsonb_typeof(state -> 'groups') = 'array'
      and pg_catalog.jsonb_typeof(state -> 'students') = 'array'
      and pg_catalog.jsonb_typeof(state -> 'grades') = 'array'
      and pg_catalog.jsonb_typeof(state -> 'classLog') = 'array'
    ),
  constraint workspaces_state_size_check
    check (pg_catalog.octet_length(state::text) <= 5242880)
);

comment on table public.workspaces is
  'One revisioned Class Manager state document per Supabase Auth user.';
comment on column public.workspaces.owner_id is
  'The primary key is also the indexed RLS tenant key.';
comment on column public.workspaces.revision is
  'Optimistic-concurrency token; writes must use save_workspace_state.';

-- The primary key already indexes the RLS lookup. This second index supports
-- operational queries such as finding recently changed workspaces.
create index workspaces_updated_at_idx
  on public.workspaces (updated_at desc);

create or replace function private.set_workspace_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

revoke all on function private.set_workspace_updated_at() from public, anon, authenticated;

create trigger set_workspaces_updated_at
before update on public.workspaces
for each row
execute function private.set_workspace_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;

create policy workspaces_select_own
on public.workspaces
for select
to authenticated
using (owner_id = (select auth.uid()));

-- Authenticated clients can read only their RLS-filtered row. They cannot
-- insert, update, or delete directly, which prevents bypassing revision checks.
revoke all on table public.workspaces from public, anon, authenticated;
grant select on table public.workspaces to authenticated;

create or replace function private.create_workspace_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspaces (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

alter function private.create_workspace_for_auth_user() owner to postgres;
revoke all on function private.create_workspace_for_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created_class_manager_workspace
after insert on auth.users
for each row
execute function private.create_workspace_for_auth_user();

-- Cover accounts that existed before this migration. The signup trigger is
-- already active, so accounts created concurrently cannot be missed.
insert into public.workspaces (owner_id)
select users.id
from auth.users as users
on conflict (owner_id) do nothing;

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
  v_current_revision bigint;
begin
  if v_owner_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication_required';
  end if;

  if p_expected_owner_id is null or p_expected_owner_id <> v_owner_id then
    raise exception using
      errcode = '42501',
      message = 'account_changed';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid_expected_revision';
  end if;

  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'invalid_workspace_state';
  end if;

  -- This single conditional UPDATE is the compare-and-swap operation. A
  -- concurrent writer either advances the revision or receives 40001.
  return query
  update public.workspaces as workspace
  set
    state = p_state,
    revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
    and workspace.revision = p_expected_revision
  returning workspace.state, workspace.revision, workspace.updated_at;

  if found then
    return;
  end if;

  select workspace.revision
  into v_current_revision
  from public.workspaces as workspace
  where workspace.owner_id = v_owner_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'workspace_not_found';
  end if;

  raise exception using
    errcode = '40001',
    message = 'workspace_revision_conflict',
    detail = pg_catalog.format(
      'Expected revision %s, current revision is %s.',
      p_expected_revision,
      v_current_revision
    );
end;
$$;

alter function public.save_workspace_state(uuid, bigint, jsonb) owner to postgres;

comment on function public.save_workspace_state(uuid, bigint, jsonb) is
  'Atomically saves the caller''s workspace when the expected revision matches.';

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
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_expected_owner_id is null or p_expected_owner_id <> v_owner_id then
    raise exception using errcode = '42501', message = 'account_changed';
  end if;

  return query
  update public.workspaces as workspace
  set
    state = private.initial_workspace_state(),
    revision = workspace.revision + 1
  where workspace.owner_id = v_owner_id
  returning workspace.state, workspace.revision, workspace.updated_at;

  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
end;
$$;

alter function public.reset_workspace_state(uuid) owner to postgres;
comment on function public.reset_workspace_state(uuid) is
  'Owner-bound recovery that replaces an unreadable workspace with an empty canonical state.';
revoke all on function public.reset_workspace_state(uuid)
  from public, anon, authenticated;
grant execute on function public.reset_workspace_state(uuid)
  to authenticated;

-- Realtime subscriptions still pass through SELECT privileges and RLS. Local
-- projects without the Supabase Realtime publication safely skip this block.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspaces'
  ) then
    execute 'alter publication supabase_realtime add table public.workspaces';
  end if;
end;
$$;
