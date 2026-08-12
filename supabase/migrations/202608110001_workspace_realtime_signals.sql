-- Keep Realtime payloads independent from the workspace document size.
--
-- The canonical JSONB document may be as large as 5 MB, while Postgres Changes
-- payloads are normally limited to 1 MB. Publish only this small, owner-scoped
-- invalidation row; subscribed clients reload the canonical workspace through
-- the Data API after observing a newer revision.

create table public.workspace_sync_signals (
  owner_id uuid primary key
    references public.workspaces(owner_id) on delete cascade,
  revision bigint not null,
  updated_at timestamptz not null,
  constraint workspace_sync_signals_revision_nonnegative_check
    check (revision >= 0)
);

comment on table public.workspace_sync_signals is
  'Small Realtime invalidation rows; canonical workspace state is fetched separately.';
comment on column public.workspace_sync_signals.revision is
  'Latest committed revision of the corresponding workspace.';

alter table public.workspace_sync_signals enable row level security;
alter table public.workspace_sync_signals force row level security;

create policy workspace_sync_signals_select_own
on public.workspace_sync_signals
for select
to authenticated
using (owner_id = (select auth.uid()));

revoke all on table public.workspace_sync_signals from public, anon, authenticated;
grant select on table public.workspace_sync_signals to authenticated;

create or replace function private.publish_workspace_sync_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_sync_signals (owner_id, revision, updated_at)
  values (new.owner_id, new.revision, new.updated_at)
  on conflict (owner_id) do update
  set revision = excluded.revision,
      updated_at = excluded.updated_at;

  return new;
end;
$$;

alter function private.publish_workspace_sync_signal() owner to postgres;
revoke all on function private.publish_workspace_sync_signal()
  from public, anon, authenticated;

create trigger publish_workspace_sync_signal
after insert or update of state, revision, updated_at on public.workspaces
for each row
execute function private.publish_workspace_sync_signal();

-- Install the trigger before backfilling so accounts created concurrently
-- cannot miss their signal row. The UPSERT makes the backfill race-safe.
insert into public.workspace_sync_signals (owner_id, revision, updated_at)
select workspace.owner_id, workspace.revision, workspace.updated_at
from public.workspaces as workspace
on conflict (owner_id) do update
set revision = excluded.revision,
    updated_at = excluded.updated_at;

-- Stop logical replication of the large JSONB row and publish only signals.
-- Local databases without Supabase Realtime safely skip this block.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workspaces'
    ) then
      execute 'alter publication supabase_realtime drop table public.workspaces';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'workspace_sync_signals'
    ) then
      execute 'alter publication supabase_realtime add table public.workspace_sync_signals';
    end if;
  end if;
end;
$$;
