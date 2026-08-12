-- Durable idempotency for the encrypted client outbox, plus domain validation
-- for the JSON fields that remain inside normalized entity rows.

create or replace function private.json_number_at_least(
  p_data jsonb,
  p_key text,
  p_min numeric,
  p_optional boolean default false
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when not (p_data ? p_key) or jsonb_typeof(p_data -> p_key) = 'null' then p_optional
    when jsonb_typeof(p_data -> p_key) <> 'number' then false
    else (p_data ->> p_key)::numeric >= p_min
  end;
$$;

create or replace function private.valid_date_text(p_value text, p_optional boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_value, '') = '' then p_optional
    else p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' end;
$$;

create or replace function private.valid_time_text(p_value text, p_optional boolean default false)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_value, '') = '' then p_optional
    else p_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' end;
$$;

create or replace function private.workspace_entity_is_valid(p_collection text, p_data jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return false; end if;
  if p_collection <> 'payments' and nullif(btrim(p_data ->> 'id'), '') is null then return false; end if;

  if p_collection = 'groups' then
    if nullif(btrim(p_data ->> 'name'), '') is null
      or coalesce(p_data ->> 'plannedSessionsPerMonth', '') !~ '^[0-9]+$'
      or not private.json_number_at_least(p_data, 'hourlyRate', 0, true)
      or jsonb_typeof(p_data -> 'weeklySchedule') <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(p_data -> 'weeklySchedule') loop
      if jsonb_typeof(item) <> 'object'
        or nullif(btrim(item ->> 'id'), '') is null
        or coalesce(item ->> 'dayOfWeek', '') !~ '^[1-7]$'
        or not private.valid_time_text(item ->> 'startTime')
        or not private.json_number_at_least(item, 'durationHours', 0) then return false; end if;
    end loop;
  elsif p_collection = 'students' then
    if nullif(btrim(p_data ->> 'code'), '') is null
      or nullif(btrim(p_data ->> 'fullName'), '') is null
      or p_data ->> 'status' not in ('Active', 'Inactive')
      or jsonb_typeof(p_data -> 'isIndividual') <> 'boolean'
      or not private.json_number_at_least(p_data, 'customHourlyRate', 0, true) then return false; end if;
  elsif p_collection = 'grades' then
    if not private.valid_date_text(p_data ->> 'date')
      or nullif(btrim(p_data ->> 'studentId'), '') is null
      or nullif(btrim(p_data ->> 'assessment'), '') is null
      or p_data ->> 'category' not in ('Quiz', 'Exam', 'Project', 'Homework', 'Participation', 'Other')
      or p_data ->> 'workStatus' not in ('On time', 'Late', 'Missing', 'Excused')
      or not private.json_number_at_least(p_data, 'score', 0, true)
      or not private.json_number_at_least(p_data, 'maxScore', 0) or (p_data ->> 'maxScore')::numeric = 0 then return false; end if;
  elsif p_collection = 'class_schedules' then
    if p_data ->> 'recurrence' not in ('once', 'weekly')
      or p_data ->> 'format' not in ('group', 'individual')
      or (p_data ->> 'format' = 'group' and nullif(btrim(p_data ->> 'groupId'), '') is null)
      or (p_data ->> 'format' = 'individual' and nullif(btrim(p_data ->> 'studentId'), '') is null)
      or not private.valid_date_text(p_data ->> 'startDate')
      or not private.valid_date_text(p_data ->> 'endDate', true)
      or not private.valid_time_text(p_data ->> 'startTime')
      or not private.json_number_at_least(p_data, 'durationHours', 0.25)
      or coalesce(p_data ->> 'intervalWeeks', '') !~ '^[1-9][0-9]*$'
      or jsonb_typeof(p_data -> 'daysOfWeek') <> 'array'
      or (p_data ->> 'recurrence' = 'weekly' and jsonb_array_length(p_data -> 'daysOfWeek') = 0)
      or p_data ->> 'participantMode' not in ('default', 'custom')
      or jsonb_typeof(p_data -> 'participantIds') <> 'array' then return false; end if;
    for item in select value from jsonb_array_elements(p_data -> 'daysOfWeek') loop
      if jsonb_typeof(item) <> 'number' or item #>> '{}' !~ '^[1-7]$' then return false; end if;
    end loop;
    for item in select value from jsonb_array_elements(p_data -> 'participantIds') loop
      if jsonb_typeof(item) <> 'string' or nullif(btrim(item #>> '{}'), '') is null then return false; end if;
    end loop;
  elsif p_collection = 'schedule_exceptions' then
    if p_data ->> 'format' not in ('group', 'individual')
      or (p_data ->> 'format' = 'group' and nullif(btrim(p_data ->> 'groupId'), '') is null)
      or (p_data ->> 'format' = 'individual' and nullif(btrim(p_data ->> 'studentId'), '') is null)
      or not private.valid_date_text(p_data ->> 'occurrenceDate')
      or not private.valid_date_text(p_data ->> 'classDate')
      or not private.valid_time_text(p_data ->> 'startTime')
      or not private.json_number_at_least(p_data, 'durationHours', 0)
      or p_data ->> 'participantMode' not in ('default', 'custom')
      or jsonb_typeof(p_data -> 'participantIds') <> 'array'
      or p_data ->> 'status' not in ('Scheduled', 'Completed', 'Cancelled')
      or p_data ->> 'kind' not in ('override', 'added') then return false; end if;
    for item in select value from jsonb_array_elements(p_data -> 'participantIds') loop
      if jsonb_typeof(item) <> 'string' or nullif(btrim(item #>> '{}'), '') is null then return false; end if;
    end loop;
  elsif p_collection = 'schedule_changes' then
    if nullif(btrim(p_data ->> 'groupId'), '') is null
      or nullif(btrim(p_data ->> 'scheduleSlotId'), '') is null
      or not private.valid_date_text(p_data ->> 'effectiveFrom')
      or coalesce(p_data ->> 'dayOfWeek', '') !~ '^[1-7]$'
      or not private.valid_time_text(p_data ->> 'startTime')
      or not private.json_number_at_least(p_data, 'durationHours', 0)
      or p_data ->> 'status' not in ('Scheduled', 'Cancelled') then return false; end if;
  elsif p_collection = 'class_records' then
    if nullif(btrim(p_data ->> 'studentId'), '') is null
      or not private.valid_date_text(p_data ->> 'classDate')
      or not private.valid_time_text(p_data ->> 'startTime', true)
      or p_data ->> 'classStatus' not in ('Scheduled', 'Completed', 'Cancelled')
      or (coalesce(p_data ->> 'attendance', '') <> '' and p_data ->> 'attendance' not in ('P', 'A', 'L', 'E'))
      or not private.json_number_at_least(p_data, 'hours', 0, true)
      or not private.json_number_at_least(p_data, 'appliedHourlyRate', 0, true)
      or not private.json_number_at_least(p_data, 'appliedCharge', 0, true) then return false; end if;
  elsif p_collection = 'payments' then
    if not private.json_number_at_least(p_data, 'amountPaid', 0, true)
      or (coalesce(p_data ->> 'paymentState', '') <> '' and p_data ->> 'paymentState' not in ('Paid', 'Pending', 'Unpaid'))
      or not private.valid_date_text(p_data ->> 'paymentDate', true)
      or (coalesce(p_data ->> 'paymentMethod', '') <> '' and p_data ->> 'paymentMethod' not in ('Cash', 'Transfer', 'Card', 'Other')) then return false; end if;
  else
    return false;
  end if;
  return true;
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
    if not exists (
      select 1 from pg_constraint
      where conname = constraint_name and conrelid = format('public.%I', mapping.table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (private.workspace_entity_is_valid(%L, data)) not valid',
        mapping.table_name, constraint_name, mapping.collection
      );
      execute format('alter table public.%I validate constraint %I', mapping.table_name, constraint_name);
    end if;
  end loop;
end;
$$;

create or replace function private.group_schedule_slot_exists(p_owner_id uuid, p_group_id text, p_slot_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups as group_row
    cross join lateral jsonb_array_elements(group_row.data -> 'weeklySchedule') as slot
    where group_row.owner_id = p_owner_id
      and group_row.id = p_group_id
      and slot ->> 'id' = p_slot_id
  );
$$;

create or replace function private.assert_normalized_workspace_integrity(p_owner_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  broken record;
  owner_key text;
begin
  select schedule.id, participant.value into broken
  from public.class_schedules as schedule
  cross join lateral jsonb_array_elements_text(schedule.data -> 'participantIds') as participant
  left join public.students as student on student.owner_id = schedule.owner_id and student.id = participant.value
  where schedule.owner_id = p_owner_id and student.id is null limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('classSchedules:%s:participantIds:%s', broken.id, broken.value); end if;

  select exception.id, participant.value into broken
  from public.schedule_exceptions as exception
  cross join lateral jsonb_array_elements_text(exception.data -> 'participantIds') as participant
  left join public.students as student on student.owner_id = exception.owner_id and student.id = participant.value
  where exception.owner_id = p_owner_id and student.id is null limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('scheduleExceptions:%s:participantIds:%s', broken.id, broken.value); end if;

  select exception.id, exception.data ->> 'sourceGroupId' as value into broken
  from public.schedule_exceptions as exception
  left join public.groups as group_row on group_row.owner_id = exception.owner_id and group_row.id = exception.data ->> 'sourceGroupId'
  where exception.owner_id = p_owner_id and coalesce(exception.data ->> 'sourceGroupId', '') <> '' and group_row.id is null limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('scheduleExceptions:%s:sourceGroupId:%s', broken.id, broken.value); end if;

  select exception.id into broken
  from public.schedule_exceptions as exception
  where exception.owner_id = p_owner_id and (
    (coalesce(exception.data ->> 'classScheduleId', '') <> '' and (
      (coalesce(exception.data ->> 'sourceScheduleSlotId', '') <> '' and exception.data ->> 'sourceScheduleSlotId' <> exception.data ->> 'classScheduleId')
      or (coalesce(exception.data ->> 'scheduleSlotId', '') <> '' and exception.data ->> 'scheduleSlotId' <> exception.data ->> 'classScheduleId')
    ))
    or (coalesce(exception.data ->> 'classScheduleId', '') = '' and (
      (coalesce(exception.data ->> 'sourceScheduleSlotId', '') <> '' and not private.group_schedule_slot_exists(
        p_owner_id, coalesce(nullif(exception.data ->> 'sourceGroupId', ''), exception.data ->> 'groupId'), exception.data ->> 'sourceScheduleSlotId'))
      or (coalesce(exception.data ->> 'scheduleSlotId', '') <> '' and not private.group_schedule_slot_exists(
        p_owner_id, coalesce(nullif(exception.data ->> 'sourceGroupId', ''), exception.data ->> 'groupId'), exception.data ->> 'scheduleSlotId'))
    ))
  ) limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('scheduleExceptions:%s:scheduleSlotId', broken.id); end if;

  select change.id into broken from public.schedule_changes as change
  where change.owner_id = p_owner_id
    and not private.group_schedule_slot_exists(p_owner_id, change.group_id, change.data ->> 'scheduleSlotId') limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('scheduleChanges:%s:scheduleSlotId', broken.id); end if;

  select class_row.id into broken from public.class_records as class_row
  where class_row.owner_id = p_owner_id and coalesce(class_row.data ->> 'scheduleSlotId', '') <> ''
    and not private.group_schedule_slot_exists(p_owner_id, class_row.group_id, class_row.data ->> 'scheduleSlotId')
    and not exists (select 1 from public.class_schedules as schedule where schedule.owner_id = p_owner_id and schedule.id = class_row.data ->> 'scheduleSlotId') limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('classLog:%s:scheduleSlotId', broken.id); end if;

  select grade.id, split_part(grade.data ->> 'classSessionKey', '|', 2) as value into broken
  from public.grades as grade
  where grade.owner_id = p_owner_id and coalesce(grade.data ->> 'classSessionKey', '') <> '' and (
    (split_part(grade.data ->> 'classSessionKey', '|', 2) like 'g:%' and not exists (
      select 1 from public.groups where owner_id = p_owner_id and id = substr(split_part(grade.data ->> 'classSessionKey', '|', 2), 3)))
    or (split_part(grade.data ->> 'classSessionKey', '|', 2) like 's:%' and not exists (
      select 1 from public.students where owner_id = p_owner_id and id = substr(split_part(grade.data ->> 'classSessionKey', '|', 2), 3)))
    or (split_part(grade.data ->> 'classSessionKey', '|', 2) not like 'g:%'
      and split_part(grade.data ->> 'classSessionKey', '|', 2) not like 's:%'
      and split_part(grade.data ->> 'classSessionKey', '|', 2) <> '__individual__'
      and not exists (select 1 from public.groups where owner_id = p_owner_id and id = split_part(grade.data ->> 'classSessionKey', '|', 2)))
  ) limit 1;
  if found then raise exception using errcode = '23503', message = 'invalid_workspace_reference', detail = format('grades:%s:classSessionKey:%s', broken.id, broken.value); end if;
end;
$$;

create or replace function private.validate_normalized_workspace_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := coalesce(new.owner_id, old.owner_id);
begin
  if current_setting('hibi.integrity_checked_owner', true) is distinct from owner_id::text then
    perform set_config('hibi.integrity_checked_owner', owner_id::text, true);
    perform private.assert_normalized_workspace_integrity(owner_id);
  end if;
  return null;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'groups', 'students', 'grades', 'class_schedules', 'schedule_exceptions',
    'schedule_changes', 'class_records'
  ] loop
    execute format('drop trigger if exists validate_%I_workspace_integrity on public.%I', table_name, table_name);
    execute format(
      'create constraint trigger validate_%I_workspace_integrity after insert or update or delete on public.%I deferrable initially deferred for each row execute function private.validate_normalized_workspace_after_change()',
      table_name, table_name
    );
  end loop;
end;
$$;

create table public.workspace_mutation_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{32}$'),
  event_id bigint not null check (event_id > 0),
  updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

create index workspace_mutation_receipts_created_idx
  on public.workspace_mutation_receipts (owner_id, created_at desc);

alter table public.workspace_mutation_receipts enable row level security;
alter table public.workspace_mutation_receipts force row level security;
revoke all on table public.workspace_mutation_receipts from public, anon, authenticated;

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

  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || p_operation_id::text, 0));
  select * into receipt from public.workspace_mutation_receipts
  where owner_id = caller_id and operation_id = p_operation_id;
  if found then
    if receipt.request_hash <> request_hash then raise exception using errcode = '22023', message = 'operation_id_reused'; end if;
    return query select receipt.event_id, receipt.updated_at, true;
    return;
  end if;

  select * into applied from public.apply_workspace_patch(caller_id, p_patch, p_expected_versions);
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
revoke all on function public.apply_workspace_patch_idempotent(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.apply_workspace_patch_idempotent(uuid,uuid,jsonb,jsonb) to authenticated;

revoke all on function private.json_number_at_least(jsonb,text,numeric,boolean) from public, anon, authenticated;
revoke all on function private.valid_date_text(text,boolean) from public, anon, authenticated;
revoke all on function private.valid_time_text(text,boolean) from public, anon, authenticated;
revoke all on function private.workspace_entity_is_valid(text,jsonb) from public, anon, authenticated;
revoke all on function private.group_schedule_slot_exists(uuid,text,text) from public, anon, authenticated;
revoke all on function private.assert_normalized_workspace_integrity(uuid) from public, anon, authenticated;
revoke all on function private.validate_normalized_workspace_after_change() from public, anon, authenticated;
