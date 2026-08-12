-- Qualify the sync cursor revision inside the snapshot restore RPC.
-- The function also returns a column named revision, so an unqualified reference
-- is ambiguous to PL/pgSQL and fails when the restore path is executed.

create or replace function public.restore_normalized_workspace_snapshot(
  p_expected_owner_id uuid,
  p_snapshot_id uuid,
  p_expected_revision bigint
)
returns table (owner_id uuid, state jsonb, versions jsonb, revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_state jsonb;
  snapshot_state jsonb;
  event record;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
  select cursor.revision
  into current_revision
  from public.workspace_sync_cursors as cursor
  where cursor.owner_id = caller_id
  for update;
  if current_revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'workspace_entity_conflict', detail = 'restore'; end if;
  select snapshot.state into snapshot_state from public.workspace_recovery_snapshots as snapshot where snapshot.owner_id = caller_id and snapshot.id = p_snapshot_id;
  if snapshot_state is null then raise exception using errcode = 'P0002', message = 'workspace_snapshot_not_found'; end if;
  current_state := private.normalized_workspace_state(caller_id);
  perform private.archive_workspace_snapshot(caller_id, current_state, current_revision, 'restore');
  perform private.replace_normalized_data(caller_id, snapshot_state);
  select * into event from private.record_workspace_event(caller_id, jsonb_build_object('reload', true, 'reason', 'restore'));
  return query select caller_id, snapshot_state, private.normalized_workspace_versions(caller_id), event.event_id, event.updated_at;
end;
$$;

alter function public.restore_normalized_workspace_snapshot(uuid, uuid, bigint) owner to postgres;
revoke all on function public.restore_normalized_workspace_snapshot(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.restore_normalized_workspace_snapshot(uuid, uuid, bigint) to authenticated;
