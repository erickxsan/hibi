-- Keep schema lint warning-free so CI can fail on warnings as well as errors.

alter function private.workspace_entity_is_strictly_valid(text, jsonb) stable;

create or replace function private.assert_normalized_workspace_integrity(p_owner_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  broken record;
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

alter function private.assert_normalized_workspace_integrity(uuid) owner to postgres;
revoke all on function private.assert_normalized_workspace_integrity(uuid) from public, anon, authenticated;
