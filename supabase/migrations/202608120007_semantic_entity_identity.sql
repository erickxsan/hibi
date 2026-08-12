-- Prevent distinct UUIDs from representing the same class or session grade.
-- Semantic columns remain projections of the stable JSON export shape.

alter table public.class_records
  add column start_time time without time zone;

alter table public.grades
  add column class_session_key text;

create or replace function private.normalized_class_session_key(
  p_value text,
  p_student_id text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  owner_key text;
begin
  if nullif(btrim(p_value), '') is null then return null; end if;
  parts := string_to_array(btrim(p_value), '|');
  if cardinality(parts) <> 3 then return btrim(p_value); end if;

  owner_key := btrim(parts[2]);
  if owner_key = '__individual__' then
    parts[2] := 's:' || btrim(coalesce(p_student_id, ''));
  elsif owner_key <> '' and left(owner_key, 2) not in ('g:', 's:') then
    parts[2] := 'g:' || owner_key;
  else
    parts[2] := owner_key;
  end if;
  return btrim(parts[1]) || '|' || parts[2] || '|' || btrim(parts[3]);
end;
$$;

create or replace function private.populate_normalized_search_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'grades' then
    new.student_id := new.data ->> 'studentId';
    new.grade_date := nullif(new.data ->> 'date', '')::date;
    new.class_session_key := private.normalized_class_session_key(
      new.data ->> 'classSessionKey',
      new.data ->> 'studentId'
    );
  elsif tg_table_name = 'class_schedules' then
    new.group_id := nullif(new.data ->> 'groupId', '');
    new.student_id := nullif(new.data ->> 'studentId', '');
    new.start_date := nullif(new.data ->> 'startDate', '')::date;
    new.end_date := nullif(new.data ->> 'endDate', '')::date;
  elsif tg_table_name = 'schedule_exceptions' then
    new.class_schedule_id := nullif(new.data ->> 'classScheduleId', '');
    new.group_id := nullif(new.data ->> 'groupId', '');
    new.student_id := nullif(new.data ->> 'studentId', '');
    new.occurrence_date := nullif(new.data ->> 'occurrenceDate', '')::date;
    new.class_date := nullif(new.data ->> 'classDate', '')::date;
  elsif tg_table_name = 'schedule_changes' then
    new.group_id := new.data ->> 'groupId';
    new.effective_from := nullif(new.data ->> 'effectiveFrom', '')::date;
  elsif tg_table_name = 'class_records' then
    new.student_id := new.data ->> 'studentId';
    new.group_id := nullif(new.data ->> 'groupId', '');
    new.class_date := nullif(new.data ->> 'classDate', '')::date;
    new.start_time := nullif(new.data ->> 'startTime', '')::time;
  elsif tg_table_name = 'payments' then
    new.amount := coalesce((new.data ->> 'amountPaid')::numeric, 0);
    new.payment_date := nullif(new.data ->> 'paymentDate', '')::date;
  end if;
  return new;
end;
$$;

revoke all on function private.normalized_class_session_key(text, text)
  from public, anon, authenticated;

-- Populate the new typed projections through the same trigger used by writes.
update public.grades
set data = data
where class_session_key is distinct from private.normalized_class_session_key(data ->> 'classSessionKey', data ->> 'studentId');

update public.class_records
set data = data
where start_time is distinct from nullif(data ->> 'startTime', '')::time;

-- Preserve one recovery point before removing any duplicate already stored.
alter table public.workspace_recovery_snapshots
  drop constraint if exists workspace_recovery_snapshots_reason_check;
alter table public.workspace_recovery_snapshots
  add constraint workspace_recovery_snapshots_reason_check
  check (reason in ('save', 'reset', 'restore', 'replace', 'import', 'deduplicate'));

create temporary table semantic_duplicate_owners (
  owner_id uuid primary key
) on commit drop;

insert into semantic_duplicate_owners (owner_id)
select owner_id
from public.class_records
where start_time is not null
group by owner_id, student_id, class_date, start_time
having count(*) > 1
on conflict (owner_id) do nothing;

insert into semantic_duplicate_owners (owner_id)
select owner_id
from public.grades
where class_session_key is not null
group by owner_id, student_id, class_session_key
having count(*) > 1
on conflict (owner_id) do nothing;

do $$
declare
  duplicate_owner record;
  source_revision bigint;
begin
  for duplicate_owner in select owner_id from semantic_duplicate_owners order by owner_id loop
    select revision into source_revision
    from public.workspace_sync_cursors
    where owner_id = duplicate_owner.owner_id;
    perform private.archive_workspace_snapshot(
      duplicate_owner.owner_id,
      private.normalized_workspace_state(duplicate_owner.owner_id),
      coalesce(source_revision, 0),
      'deduplicate'
    );
  end loop;
end;
$$;

with ranked as (
  select
    record.owner_id,
    record.id,
    row_number() over (
      partition by record.owner_id, record.student_id, record.class_date, record.start_time
      order by payment.amount desc nulls last,
               (record.data ->> 'classStatus' = 'Completed') desc,
               record.updated_at desc,
               record.revision desc,
               record.id
    ) as duplicate_rank
  from public.class_records as record
  left join public.payments as payment
    on payment.owner_id = record.owner_id and payment.class_record_id = record.id
  where record.start_time is not null
)
delete from public.class_records as record
using ranked
where ranked.duplicate_rank > 1
  and record.owner_id = ranked.owner_id
  and record.id = ranked.id;

with ranked as (
  select
    grade.owner_id,
    grade.id,
    row_number() over (
      partition by grade.owner_id, grade.student_id, grade.class_session_key
      order by coalesce(jsonb_typeof(grade.data -> 'score') = 'number', false) desc,
               grade.updated_at desc,
               grade.revision desc,
               grade.id
    ) as duplicate_rank
  from public.grades as grade
  where grade.class_session_key is not null
)
delete from public.grades as grade
using ranked
where ranked.duplicate_rank > 1
  and grade.owner_id = ranked.owner_id
  and grade.id = ranked.id;

create unique index class_records_owner_student_session_unique
  on public.class_records (owner_id, student_id, class_date, start_time)
  where start_time is not null;

create unique index grades_owner_student_session_unique
  on public.grades (owner_id, student_id, class_session_key)
  where class_session_key is not null;

-- Updates can also move an existing UUID onto another entity's semantic key.
-- Expose those unique-index collisions through the conflict path clients
-- already recover from by loading the winning cloud state.
create or replace function private.upsert_normalized_entity(
  p_table text,
  p_owner_id uuid,
  p_id text,
  p_data jsonb,
  p_sort_order integer,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_revision bigint;
  violated_constraint text;
begin
  execute format(
    'update public.%I set data = $1, sort_order = $2, revision = revision + 1, updated_at = clock_timestamp() where owner_id = $3 and id = $4 and revision = $5 returning revision',
    p_table
  ) into next_revision using p_data, p_sort_order, p_owner_id, p_id, p_expected_revision;

  if next_revision is not null then return next_revision; end if;

  if p_expected_revision = 0 then
    execute format(
      'insert into public.%I (owner_id, id, data, sort_order) values ($1, $2, $3, $4) on conflict do nothing returning revision',
      p_table
    ) into next_revision using p_owner_id, p_id, p_data, p_sort_order;
    if next_revision is not null then return next_revision; end if;
  end if;

  raise exception using
    errcode = '40001',
    message = 'workspace_entity_conflict',
    detail = format('%s:%s', p_table, p_id);
exception when unique_violation then
  get stacked diagnostics violated_constraint = constraint_name;
  raise exception using
    errcode = '40001',
    message = 'workspace_entity_conflict',
    detail = format('%s:%s:%s', p_table, p_id, coalesce(violated_constraint, 'semantic_identity'));
end;
$$;

alter function private.upsert_normalized_entity(text, uuid, text, jsonb, integer, bigint)
  owner to postgres;
revoke all on function private.upsert_normalized_entity(text, uuid, text, jsonb, integer, bigint)
  from public, anon, authenticated;

do $$
declare
  duplicate_owner record;
begin
  for duplicate_owner in select owner_id from semantic_duplicate_owners order by owner_id loop
    perform private.record_workspace_event(
      duplicate_owner.owner_id,
      jsonb_build_object('reload', true, 'reason', 'semantic-deduplicate')
    );
  end loop;
end;
$$;

comment on column public.class_records.start_time is
  'Typed projection used with owner, student, and class date as the semantic class identity.';
comment on column public.grades.class_session_key is
  'Canonical session-key projection used with owner and student as the semantic grade identity.';
