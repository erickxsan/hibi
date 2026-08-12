-- Make the normalized database the final authority for canonical workspace data.
-- JSON remains only for flexible entity metadata; domain shape and relationships
-- are enforced before an authenticated client can commit a mutation.

create or replace function private.valid_date_text(p_value text, p_optional boolean default false)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_value, '') = '' then return p_optional; end if;
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
  perform make_date(substr(p_value, 1, 4)::integer, substr(p_value, 6, 2)::integer, substr(p_value, 9, 2)::integer);
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.json_string_fields_are_valid(p_data jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1 from unnest(p_keys) as key
    where p_data ? key and jsonb_typeof(p_data -> key) not in ('string', 'null')
  );
$$;

create or replace function private.json_array_is_unique(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'array' and not exists (
    select 1 from jsonb_array_elements(p_value) as item(value)
    group by item.value having count(*) > 1
  );
$$;

create or replace function private.workspace_entity_is_strictly_valid(p_collection text, p_data jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if not private.workspace_entity_is_valid(p_collection, p_data) then return false; end if;

  if p_collection = 'groups' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'name', 'grade', 'subject', 'schedule', 'assistantContact', 'notes'
    ]) or exists (
      select 1 from jsonb_array_elements(p_data -> 'weeklySchedule') as slot
      group by slot ->> 'id' having count(*) > 1
    ) then return false; end if;
    for item in select value from jsonb_array_elements(p_data -> 'weeklySchedule') loop
      if not private.json_string_fields_are_valid(item, array['id', 'startTime']) then return false; end if;
    end loop;
  elsif p_collection = 'students' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'code', 'fullName', 'avatarId', 'studentEmail', 'guardianPhone',
      'phone', 'guardianContact', 'notes', 'status'
    ]) or (coalesce(p_data ->> 'avatarId', '') <> '' and p_data ->> 'avatarId' not in (
      'cat', 'dog', 'penguin', 'fox', 'rabbit', 'bear', 'frog', 'owl'
    )) or (coalesce(p_data ->> 'studentEmail', '') <> '' and p_data ->> 'studentEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
      or (p_data ? 'groupIds' and (
        jsonb_typeof(p_data -> 'groupIds') <> 'array'
        or not private.json_array_is_unique(p_data -> 'groupIds')
        or exists (
          select 1 from jsonb_array_elements(p_data -> 'groupIds') as group_id
          where jsonb_typeof(group_id) <> 'string' or nullif(btrim(group_id #>> '{}'), '') is null
        )
      )) then return false; end if;
  elsif p_collection = 'grades' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'date', 'studentId', 'assessment', 'category', 'workStatus', 'feedback', 'classSessionKey'
    ]) then return false; end if;
  elsif p_collection = 'class_schedules' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'recurrence', 'format', 'groupId', 'studentId', 'startDate', 'endDate', 'startTime', 'participantMode'
    ]) or not private.json_array_is_unique(p_data -> 'daysOfWeek')
      or not private.json_array_is_unique(p_data -> 'participantIds')
      or (p_data ->> 'format' = 'group' and coalesce(p_data ->> 'studentId', '') <> '')
      or (p_data ->> 'format' = 'individual' and coalesce(p_data ->> 'groupId', '') <> '')
      or (coalesce(p_data ->> 'endDate', '') <> '' and (p_data ->> 'endDate')::date < (p_data ->> 'startDate')::date)
    then return false; end if;
  elsif p_collection = 'schedule_exceptions' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'classScheduleId', 'sourceGroupId', 'sourceScheduleSlotId', 'groupId', 'studentId',
      'format', 'scheduleSlotId', 'occurrenceDate', 'classDate', 'startTime', 'participantMode', 'status', 'kind'
    ]) or not private.json_array_is_unique(p_data -> 'participantIds')
      or (p_data ->> 'format' = 'group' and coalesce(p_data ->> 'studentId', '') <> '')
      or (p_data ->> 'format' = 'individual' and coalesce(p_data ->> 'groupId', '') <> '')
    then return false; end if;
  elsif p_collection = 'schedule_changes' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'groupId', 'scheduleSlotId', 'effectiveFrom', 'startTime', 'status'
    ]) then return false; end if;
  elsif p_collection = 'class_records' then
    if not private.json_string_fields_are_valid(p_data, array[
      'id', 'classDate', 'studentId', 'groupId', 'startTime', 'classTitle', 'scheduleSlotId',
      'scheduleOccurrenceDate', 'classStatus', 'attendance', 'notes'
    ]) or not private.valid_date_text(p_data ->> 'scheduleOccurrenceDate', true) then return false; end if;
  elsif p_collection = 'payments' then
    if not private.json_string_fields_are_valid(p_data, array[
      'paymentState', 'paymentDate', 'paymentMethod', 'paymentReference'
    ]) then return false; end if;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.workspace_settings_are_valid(p_data jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  projection_weeks numeric;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object'
    or not private.json_string_fields_are_valid(p_data, array['currency', 'selectedMonth', 'asOfDate'])
    or p_data ->> 'currency' <> 'MXN'
    or not private.json_number_at_least(p_data, 'hourlyRate', 0)
    or not private.json_number_at_least(p_data, 'defaultClassHours', 0)
    or not private.json_number_at_least(p_data, 'recentProjectionWeeks', 1)
    or not private.json_number_at_least(p_data, 'lowGradeThreshold', 0)
    or (p_data ->> 'lowGradeThreshold')::numeric > 1
    or not private.json_number_at_least(p_data, 'lowAttendanceThreshold', 0)
    or (p_data ->> 'lowAttendanceThreshold')::numeric > 1
    or not private.valid_date_text(p_data ->> 'selectedMonth')
    or substr(p_data ->> 'selectedMonth', 9, 2) <> '01'
    or not private.valid_date_text(p_data ->> 'asOfDate')
  then return false; end if;
  projection_weeks := (p_data ->> 'recentProjectionWeeks')::numeric;
  return projection_weeks = trunc(projection_weeks);
exception when others then
  return false;
end;
$$;

do $$
declare
  mapping record;
  constraint_name text;
begin
  for mapping in select * from (values
    ('groups', 'groups'), ('students', 'students'), ('grades', 'grades'),
    ('class_schedules', 'class_schedules'), ('schedule_exceptions', 'schedule_exceptions'),
    ('schedule_changes', 'schedule_changes'), ('class_records', 'class_records'), ('payments', 'payments')
  ) as entity(table_name, collection) loop
    constraint_name := mapping.table_name || '_domain_data_check';
    execute format('alter table public.%I drop constraint if exists %I', mapping.table_name, constraint_name);
    execute format(
      'alter table public.%I add constraint %I check (private.workspace_entity_is_strictly_valid(%L, data)) not valid',
      mapping.table_name, constraint_name, mapping.collection
    );
    execute format('alter table public.%I validate constraint %I', mapping.table_name, constraint_name);
  end loop;
end;
$$;

alter table public.workspace_settings
  add constraint workspace_settings_strict_domain_check
  check (private.workspace_settings_are_valid(data)) not valid;
alter table public.workspace_settings validate constraint workspace_settings_strict_domain_check;

create unique index groups_owner_name_ci_unique
  on public.groups (owner_id, lower(btrim(data ->> 'name')));
create unique index students_owner_code_ci_unique
  on public.students (owner_id, lower(btrim(data ->> 'code')));

create or replace function private.workspace_patch_shape_is_valid(p_patch jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  collection text;
  section jsonb;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key
    where key not in ('settings', 'groups', 'students', 'grades', 'classLog', 'classSchedules', 'scheduleExceptions', 'scheduleChanges')
  ) then return false; end if;
  if p_patch ? 'settings' and jsonb_typeof(p_patch -> 'settings') <> 'object' then return false; end if;

  foreach collection in array array[
    'groups', 'students', 'grades', 'classLog', 'classSchedules', 'scheduleExceptions', 'scheduleChanges'
  ] loop
    if not (p_patch ? collection) then continue; end if;
    section := p_patch -> collection;
    if jsonb_typeof(section) <> 'object'
      or exists (select 1 from jsonb_object_keys(section) as key where key not in ('upserts', 'deletes'))
      or jsonb_typeof(section -> 'upserts') <> 'array'
      or jsonb_typeof(section -> 'deletes') <> 'array'
      or exists (
        select 1 from jsonb_array_elements(section -> 'upserts') as item
        where jsonb_typeof(item) <> 'object'
          or jsonb_typeof(item -> 'data') <> 'object'
          or nullif(btrim(item -> 'data' ->> 'id'), '') is null
          or jsonb_typeof(item -> 'position') <> 'number'
          or (item ->> 'position') !~ '^[0-9]+$'
      ) or exists (
        select 1 from jsonb_array_elements(section -> 'deletes') as item
        where jsonb_typeof(item) <> 'string' or nullif(btrim(item #>> '{}'), '') is null
      ) or exists (
        select item -> 'data' ->> 'id' from jsonb_array_elements(section -> 'upserts') as item
        group by item -> 'data' ->> 'id' having count(*) > 1
      ) or exists (
        select item #>> '{}' from jsonb_array_elements(section -> 'deletes') as item
        group by item #>> '{}' having count(*) > 1
      ) or exists (
        select 1
        from jsonb_array_elements(section -> 'upserts') as upsert_item
        join jsonb_array_elements_text(section -> 'deletes') as deleted_id
          on deleted_id = upsert_item -> 'data' ->> 'id'
      )
    then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.apply_workspace_patch_idempotent(
  p_expected_owner_id uuid,
  p_operation_id uuid,
  p_patch jsonb,
  p_expected_versions jsonb
)
returns table (event_id bigint, updated_at timestamptz, already_applied boolean)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  caller_id uuid := (select auth.uid());
  request_hash text := md5(coalesce(p_patch::text, '') || chr(31) || coalesce(p_expected_versions::text, ''));
  receipt record;
  applied record;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if p_operation_id is null then raise exception using errcode = '22023', message = 'operation_id_required'; end if;
  if not private.workspace_patch_shape_is_valid(p_patch) then raise exception using errcode = '22023', message = 'invalid_workspace_patch'; end if;

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || p_operation_id::text, 0));
  select * into receipt from public.workspace_mutation_receipts
  where owner_id = caller_id and operation_id = p_operation_id;
  if found then
    if receipt.request_hash <> request_hash then raise exception using errcode = '22023', message = 'operation_id_reused'; end if;
    return query select receipt.event_id, receipt.updated_at, true;
    return;
  end if;

  select * into applied from public.apply_workspace_patch(caller_id, p_patch, p_expected_versions);
  perform private.assert_normalized_workspace_integrity(caller_id);
  insert into public.workspace_mutation_receipts (owner_id, operation_id, request_hash, event_id, updated_at)
  values (caller_id, p_operation_id, request_hash, applied.event_id, applied.updated_at);
  delete from public.workspace_mutation_receipts as older
  where older.owner_id = caller_id and older.operation_id in (
    select operation_id from public.workspace_mutation_receipts
    where owner_id = caller_id order by created_at desc offset 1000
  );
  return query select applied.event_id, applied.updated_at, false;
end;
$$;

alter function public.apply_workspace_patch_idempotent(uuid,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.apply_workspace_patch(uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.apply_workspace_patch_idempotent(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_workspace_patch_idempotent(uuid,uuid,jsonb,jsonb) to authenticated;

revoke all on function private.valid_date_text(text,boolean) from public, anon, authenticated;
revoke all on function private.json_string_fields_are_valid(jsonb,text[]) from public, anon, authenticated;
revoke all on function private.json_array_is_unique(jsonb) from public, anon, authenticated;
revoke all on function private.workspace_entity_is_strictly_valid(text,jsonb) from public, anon, authenticated;
revoke all on function private.workspace_settings_are_valid(jsonb) from public, anon, authenticated;
revoke all on function private.workspace_patch_shape_is_valid(jsonb) from public, anon, authenticated;
