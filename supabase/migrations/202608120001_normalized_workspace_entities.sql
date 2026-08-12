-- Normalize the workspace document into independently versioned entities.
-- The JSON export shape remains an application boundary, not a storage unit.

create table public.workspace_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (
    jsonb_typeof(data) = 'object'
    and data ->> 'currency' = 'MXN'
    and jsonb_typeof(data -> 'hourlyRate') = 'number'
    and (data ->> 'hourlyRate')::numeric >= 0
    and jsonb_typeof(data -> 'defaultClassHours') = 'number'
    and (data ->> 'defaultClassHours')::numeric >= 0
    and jsonb_typeof(data -> 'recentProjectionWeeks') = 'number'
    and (data ->> 'recentProjectionWeeks')::numeric >= 1
    and jsonb_typeof(data -> 'lowGradeThreshold') = 'number'
    and (data ->> 'lowGradeThreshold')::numeric between 0 and 1
    and jsonb_typeof(data -> 'lowAttendanceThreshold') = 'number'
    and (data ->> 'lowAttendanceThreshold')::numeric between 0 and 1
    and data ->> 'selectedMonth' ~ '^[0-9]{4}-[0-9]{2}-01$'
    and data ->> 'asOfDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table public.groups (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table public.students (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table public.student_groups (
  owner_id uuid not null,
  student_id text not null,
  group_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, student_id, group_id),
  foreign key (owner_id, student_id) references public.students(owner_id, id) on delete cascade,
  foreign key (owner_id, group_id) references public.groups(owner_id, id) on delete cascade
);

create table public.grades (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  student_id text not null,
  grade_date date not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, student_id) references public.students(owner_id, id) on delete restrict
);

create table public.class_schedules (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  group_id text,
  student_id text,
  start_date date not null,
  end_date date,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, group_id) references public.groups(owner_id, id) on delete restrict,
  foreign key (owner_id, student_id) references public.students(owner_id, id) on delete restrict
);

create table public.schedule_exceptions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  class_schedule_id text,
  group_id text,
  student_id text,
  occurrence_date date not null,
  class_date date not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, class_schedule_id) references public.class_schedules(owner_id, id) on delete cascade,
  foreign key (owner_id, group_id) references public.groups(owner_id, id) on delete restrict,
  foreign key (owner_id, student_id) references public.students(owner_id, id) on delete restrict
);

create table public.schedule_changes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  group_id text not null,
  effective_from date not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, group_id) references public.groups(owner_id, id) on delete cascade
);

create table public.class_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ->> 'id' = id),
  student_id text not null,
  group_id text,
  class_date date not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, student_id) references public.students(owner_id, id) on delete restrict,
  foreign key (owner_id, group_id) references public.groups(owner_id, id) on delete restrict
);

create table public.payments (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  class_record_id text not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  amount numeric(14, 2) not null default 0,
  payment_date date,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, class_record_id),
  foreign key (owner_id, class_record_id) references public.class_records(owner_id, id) on delete cascade
);

create table public.workspace_sync_cursors (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table public.workspace_change_events (
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  patch jsonb not null check (jsonb_typeof(patch) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (owner_id, revision)
);

create or replace function private.populate_normalized_search_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'grades' then
    new.student_id := new.data ->> 'studentId';
    new.grade_date := nullif(new.data ->> 'date', '')::date;
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
  elsif tg_table_name = 'payments' then
    new.amount := coalesce((new.data ->> 'amountPaid')::numeric, 0);
    new.payment_date := nullif(new.data ->> 'paymentDate', '')::date;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'grades', 'class_schedules', 'schedule_exceptions', 'schedule_changes', 'class_records', 'payments'
  ] loop
    execute format(
      'create trigger populate_%I_search_columns before insert or update of data on public.%I for each row execute function private.populate_normalized_search_columns()',
      table_name, table_name
    );
  end loop;
end;
$$;

-- Primary keys cover owner-first RLS access. These indexes cover the actual
-- date, student, group, and foreign-key access patterns.
create index student_groups_group_idx on public.student_groups (owner_id, group_id, student_id);
create index grades_student_date_idx on public.grades (owner_id, student_id, grade_date desc);
create index class_records_student_date_idx on public.class_records (owner_id, student_id, class_date desc);
create index class_records_group_date_idx on public.class_records (owner_id, group_id, class_date desc);
create index payments_date_idx on public.payments (owner_id, payment_date desc) where payment_date is not null;
create index class_schedules_group_date_idx on public.class_schedules (owner_id, group_id, start_date);
create index class_schedules_student_date_idx on public.class_schedules (owner_id, student_id, start_date);
create index schedule_exceptions_schedule_date_idx on public.schedule_exceptions (owner_id, class_schedule_id, occurrence_date);
create index schedule_exceptions_group_date_idx on public.schedule_exceptions (owner_id, group_id, class_date);
create index schedule_exceptions_student_date_idx on public.schedule_exceptions (owner_id, student_id, class_date);
create index schedule_changes_group_date_idx on public.schedule_changes (owner_id, group_id, effective_from desc);
create index workspace_change_events_updated_idx on public.workspace_change_events (owner_id, updated_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_settings', 'groups', 'students', 'student_groups', 'grades',
    'class_schedules', 'schedule_exceptions', 'schedule_changes',
    'class_records', 'payments', 'workspace_sync_cursors', 'workspace_change_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',
      table_name || '_select_own', table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end;
$$;

create or replace function private.expected_entity_revision(
  p_expected jsonb,
  p_collection text,
  p_id text
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  value text := p_expected -> p_collection ->> p_id;
begin
  if value is null or value !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'invalid_entity_revision';
  end if;
  return value::bigint;
end;
$$;

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
end;
$$;

create or replace function private.delete_normalized_entity(
  p_table text,
  p_owner_id uuid,
  p_id text,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id text;
begin
  execute format(
    'delete from public.%I where owner_id = $1 and id = $2 and revision = $3 returning id',
    p_table
  ) into deleted_id using p_owner_id, p_id, p_expected_revision;
  if deleted_id is null then
    raise exception using
      errcode = '40001',
      message = 'workspace_entity_conflict',
      detail = format('%s:%s', p_table, p_id);
  end if;
end;
$$;

create or replace function private.record_workspace_event(p_owner_id uuid, p_patch jsonb)
returns table (event_id bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspace_sync_cursors as cursor
  set revision = cursor.revision + 1,
      updated_at = clock_timestamp()
  where cursor.owner_id = p_owner_id
  returning cursor.revision, cursor.updated_at into event_id, updated_at;

  if event_id is null then raise exception using errcode = 'P0002', message = 'workspace_not_found'; end if;

  insert into public.workspace_change_events (owner_id, revision, patch, updated_at)
  values (p_owner_id, event_id, p_patch, updated_at);

  delete from public.workspace_change_events as event
  where event.owner_id = p_owner_id
    and event.revision <= event_id - 100;

  return next;
end;
$$;

create or replace function private.normalized_workspace_state(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'settings', coalesce(
      (select settings.data from public.workspace_settings as settings where settings.owner_id = p_owner_id),
      private.initial_workspace_state() -> 'settings'
    ),
    'groups', coalesce((select jsonb_agg(item.data order by item.sort_order, item.id) from public.groups as item where item.owner_id = p_owner_id), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(
        student.data || jsonb_build_object(
          'groupIds', coalesce((
            select jsonb_agg(membership.group_id order by membership.group_id)
            from public.student_groups as membership
            where membership.owner_id = student.owner_id and membership.student_id = student.id
          ), '[]'::jsonb)
        ) order by student.sort_order, student.id
      )
      from public.students as student where student.owner_id = p_owner_id
    ), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(item.data order by item.sort_order, item.id) from public.grades as item where item.owner_id = p_owner_id), '[]'::jsonb),
    'classLog', coalesce((
      select jsonb_agg(record.data || coalesce(payment.data, '{}'::jsonb) order by record.sort_order, record.id)
      from public.class_records as record
      left join public.payments as payment
        on payment.owner_id = record.owner_id and payment.class_record_id = record.id
      where record.owner_id = p_owner_id
    ), '[]'::jsonb),
    'classSchedules', coalesce((select jsonb_agg(item.data order by item.sort_order, item.id) from public.class_schedules as item where item.owner_id = p_owner_id), '[]'::jsonb),
    'scheduleExceptions', coalesce((select jsonb_agg(item.data order by item.sort_order, item.id) from public.schedule_exceptions as item where item.owner_id = p_owner_id), '[]'::jsonb),
    'scheduleChanges', coalesce((select jsonb_agg(item.data order by item.sort_order, item.id) from public.schedule_changes as item where item.owner_id = p_owner_id), '[]'::jsonb)
  );
$$;

create or replace function private.normalized_workspace_versions(p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', jsonb_build_object('__settings__', coalesce((select revision from public.workspace_settings where owner_id = p_owner_id), 0)),
    'groups', coalesce((select jsonb_object_agg(id, revision) from public.groups where owner_id = p_owner_id), '{}'::jsonb),
    'students', coalesce((select jsonb_object_agg(id, revision) from public.students where owner_id = p_owner_id), '{}'::jsonb),
    'grades', coalesce((select jsonb_object_agg(id, revision) from public.grades where owner_id = p_owner_id), '{}'::jsonb),
    'classLog', coalesce((select jsonb_object_agg(id, revision) from public.class_records where owner_id = p_owner_id), '{}'::jsonb),
    'classSchedules', coalesce((select jsonb_object_agg(id, revision) from public.class_schedules where owner_id = p_owner_id), '{}'::jsonb),
    'scheduleExceptions', coalesce((select jsonb_object_agg(id, revision) from public.schedule_exceptions where owner_id = p_owner_id), '{}'::jsonb),
    'scheduleChanges', coalesce((select jsonb_object_agg(id, revision) from public.schedule_changes where owner_id = p_owner_id), '{}'::jsonb)
  );
$$;

create or replace function private.replace_normalized_data(p_owner_id uuid, p_state jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  payment_data jsonb;
begin
  delete from public.schedule_exceptions where owner_id = p_owner_id;
  delete from public.schedule_changes where owner_id = p_owner_id;
  delete from public.class_schedules where owner_id = p_owner_id;
  delete from public.payments where owner_id = p_owner_id;
  delete from public.class_records where owner_id = p_owner_id;
  delete from public.grades where owner_id = p_owner_id;
  delete from public.student_groups where owner_id = p_owner_id;
  delete from public.students where owner_id = p_owner_id;
  delete from public.groups where owner_id = p_owner_id;

  insert into public.workspace_settings (owner_id, data, revision, updated_at)
  values (p_owner_id, p_state -> 'settings', 1, clock_timestamp())
  on conflict (owner_id) do update
  set data = excluded.data, revision = 1, updated_at = excluded.updated_at;

  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'groups', '[]'::jsonb)) with ordinality loop
    insert into public.groups (owner_id, id, data, sort_order) values (p_owner_id, item.data ->> 'id', item.data, item.position);
  end loop;
  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'students', '[]'::jsonb)) with ordinality loop
    insert into public.students (owner_id, id, data, sort_order) values (p_owner_id, item.data ->> 'id', item.data - 'groupIds', item.position);
    insert into public.student_groups (owner_id, student_id, group_id)
    select p_owner_id, item.data ->> 'id', group_id.value
    from jsonb_array_elements_text(coalesce(item.data -> 'groupIds', '[]'::jsonb)) as group_id;
  end loop;
  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'grades', '[]'::jsonb)) with ordinality loop
    insert into public.grades (owner_id, id, data, sort_order) values (p_owner_id, item.data ->> 'id', item.data, item.position);
  end loop;
  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'classLog', '[]'::jsonb)) with ordinality loop
    insert into public.class_records (owner_id, id, data, sort_order)
    values (
      p_owner_id, item.data ->> 'id',
      item.data - array['amountPaid', 'paymentState', 'paymentDate', 'paymentMethod', 'paymentReference'],
      item.position
    );
    payment_data := jsonb_build_object(
      'amountPaid', coalesce(item.data -> 'amountPaid', '0'::jsonb),
      'paymentState', coalesce(item.data -> 'paymentState', '""'::jsonb),
      'paymentDate', coalesce(item.data -> 'paymentDate', 'null'::jsonb),
      'paymentMethod', coalesce(item.data -> 'paymentMethod', '""'::jsonb),
      'paymentReference', coalesce(item.data -> 'paymentReference', '""'::jsonb)
    );
    insert into public.payments (owner_id, id, class_record_id, data)
    values (p_owner_id, item.data ->> 'id', item.data ->> 'id', payment_data);
  end loop;
  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'classSchedules', '[]'::jsonb)) with ordinality loop
    insert into public.class_schedules (owner_id, id, data, sort_order) values (p_owner_id, item.data ->> 'id', item.data, item.position);
  end loop;
  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'scheduleExceptions', '[]'::jsonb)) with ordinality loop
    insert into public.schedule_exceptions (owner_id, id, data, sort_order) values (p_owner_id, item.data ->> 'id', item.data, item.position);
  end loop;
  for item in select value as data, ordinality - 1 as position from jsonb_array_elements(coalesce(p_state -> 'scheduleChanges', '[]'::jsonb)) with ordinality loop
    insert into public.schedule_changes (owner_id, id, data, sort_order) values (p_owner_id, item.data ->> 'id', item.data, item.position);
  end loop;
end;
$$;

-- Backfill before switching clients. The existing JSON row is read once.
insert into public.workspace_sync_cursors (owner_id, revision)
select users.id, 0 from auth.users as users on conflict (owner_id) do nothing;

do $$
declare
  workspace record;
begin
  for workspace in select owner_id, state from public.workspaces order by owner_id loop
    perform private.replace_normalized_data(workspace.owner_id, workspace.state);
    perform private.record_workspace_event(workspace.owner_id, jsonb_build_object('reload', true, 'reason', 'migration'));
  end loop;
end;
$$;

create or replace function private.create_workspace_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_state jsonb := private.initial_workspace_state();
begin
  insert into public.workspaces (owner_id) values (new.id) on conflict (owner_id) do nothing;
  insert into public.workspace_settings (owner_id, data) values (new.id, initial_state -> 'settings') on conflict (owner_id) do nothing;
  insert into public.workspace_sync_cursors (owner_id) values (new.id) on conflict (owner_id) do nothing;
  perform private.record_workspace_event(new.id, jsonb_build_object('reload', true, 'reason', 'signup'));
  return new;
end;
$$;

create or replace function public.load_normalized_workspace(p_expected_owner_id uuid)
returns table (owner_id uuid, state jsonb, versions jsonb, revision bigint, updated_at timestamptz)
language plpgsql
security definer
stable
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  return query
  select caller_id, private.normalized_workspace_state(caller_id), private.normalized_workspace_versions(caller_id), cursor.revision, cursor.updated_at
  from public.workspace_sync_cursors as cursor where cursor.owner_id = caller_id;
end;
$$;

create or replace function public.apply_workspace_patch(
  p_expected_owner_id uuid,
  p_patch jsonb,
  p_expected_versions jsonb
)
returns table (event_id bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  caller_id uuid := (select auth.uid());
  item record;
  item_id text;
  expected_revision bigint;
  collection text;
  table_name text;
  record_data jsonb;
  payment_data jsonb;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text) > 1048576 then
    raise exception using errcode = '22023', message = 'invalid_workspace_patch';
  end if;
  if p_expected_versions is null or jsonb_typeof(p_expected_versions) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_expected_versions';
  end if;

  -- Ordinary patches share this owner lock; only destructive full replacements
  -- take the exclusive form, so unrelated entity edits can run concurrently.
  perform pg_advisory_xact_lock_shared(hashtextextended(caller_id::text, 0));

  if p_patch ? 'settings' then
    expected_revision := private.expected_entity_revision(p_expected_versions, 'settings', '__settings__');
    update public.workspace_settings
    set data = p_patch -> 'settings', revision = revision + 1, updated_at = clock_timestamp()
    where owner_id = caller_id and revision = expected_revision;
    if not found then raise exception using errcode = '40001', message = 'workspace_entity_conflict', detail = 'settings'; end if;
  end if;

  for collection, table_name in
    select * from (values
      ('groups', 'groups'), ('students', 'students'), ('grades', 'grades'),
      ('classLog', 'class_records'), ('classSchedules', 'class_schedules'),
      ('scheduleExceptions', 'schedule_exceptions'), ('scheduleChanges', 'schedule_changes')
    ) as mapping(collection, table_name)
  loop
    for item in
      select value -> 'data' as data, coalesce((value ->> 'position')::integer, 0) as position
      from jsonb_array_elements(coalesce(p_patch -> collection -> 'upserts', '[]'::jsonb))
      order by value -> 'data' ->> 'id'
    loop
      item_id := item.data ->> 'id';
      if item_id is null or item_id = '' or jsonb_typeof(item.data) <> 'object' then
        raise exception using errcode = '22023', message = 'invalid_workspace_entity';
      end if;
      expected_revision := private.expected_entity_revision(p_expected_versions, collection, item_id);
      record_data := case when collection = 'students' then item.data - 'groupIds'
                          when collection = 'classLog' then item.data - array['amountPaid', 'paymentState', 'paymentDate', 'paymentMethod', 'paymentReference']
                          else item.data end;
      perform private.upsert_normalized_entity(table_name, caller_id, item_id, record_data, item.position, expected_revision);

      if collection = 'students' then
        delete from public.student_groups where owner_id = caller_id and student_id = item_id;
        insert into public.student_groups (owner_id, student_id, group_id)
        select caller_id, item_id, group_id.value
        from jsonb_array_elements_text(coalesce(item.data -> 'groupIds', '[]'::jsonb)) as group_id;
      elsif collection = 'classLog' then
        payment_data := jsonb_build_object(
          'amountPaid', coalesce(item.data -> 'amountPaid', '0'::jsonb),
          'paymentState', coalesce(item.data -> 'paymentState', '""'::jsonb),
          'paymentDate', coalesce(item.data -> 'paymentDate', 'null'::jsonb),
          'paymentMethod', coalesce(item.data -> 'paymentMethod', '""'::jsonb),
          'paymentReference', coalesce(item.data -> 'paymentReference', '""'::jsonb)
        );
        insert into public.payments (owner_id, id, class_record_id, data, updated_at)
        values (caller_id, item_id, item_id, payment_data, clock_timestamp())
        on conflict (owner_id, id) do update set data = excluded.data, updated_at = excluded.updated_at;
      end if;
    end loop;
  end loop;

  -- Delete dependants before parents, always in stable ID order.
  for collection, table_name in
    select * from (values
      ('scheduleExceptions', 'schedule_exceptions'), ('scheduleChanges', 'schedule_changes'),
      ('classSchedules', 'class_schedules'), ('classLog', 'class_records'),
      ('grades', 'grades'), ('students', 'students'), ('groups', 'groups')
    ) as mapping(collection, table_name)
  loop
    for item_id in
      select value #>> '{}' from jsonb_array_elements(coalesce(p_patch -> collection -> 'deletes', '[]'::jsonb)) order by 1
    loop
      expected_revision := private.expected_entity_revision(p_expected_versions, collection, item_id);
      perform private.delete_normalized_entity(table_name, caller_id, item_id, expected_revision);
    end loop;
  end loop;

  return query select event.event_id, event.updated_at from private.record_workspace_event(caller_id, p_patch) as event;
end;
$$;

create or replace function public.replace_normalized_workspace_state(
  p_expected_owner_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_confirmation text
)
returns table (event_id bigint, updated_at timestamptz, versions jsonb)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_state jsonb;
  event record;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if p_confirmation is distinct from format('replace:%s', p_expected_revision) then raise exception using errcode = '22023', message = 'workspace_replacement_not_confirmed'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 5242880 then raise exception using errcode = '22023', message = 'invalid_workspace_state'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
  select revision into current_revision from public.workspace_sync_cursors where owner_id = caller_id for update;
  if current_revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'workspace_entity_conflict', detail = 'full-workspace'; end if;
  current_state := private.normalized_workspace_state(caller_id);
  perform private.archive_workspace_snapshot(caller_id, current_state, current_revision, 'replace');
  perform private.replace_normalized_data(caller_id, p_state);
  select * into event from private.record_workspace_event(caller_id, jsonb_build_object('reload', true, 'reason', 'replace'));
  return query select event.event_id, event.updated_at, private.normalized_workspace_versions(caller_id);
end;
$$;

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
  select revision into current_revision from public.workspace_sync_cursors where owner_id = caller_id for update;
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

create or replace function public.apply_normalized_workspace_import(
  p_expected_owner_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_file_hash text,
  p_source_name text,
  p_summary jsonb,
  p_confirmation text
)
returns table (event_id bigint, updated_at timestamptz, versions jsonb, already_imported boolean)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
  current_state jsonb;
  existing_job public.workspace_import_jobs%rowtype;
  event record;
  collection text;
begin
  if caller_id is null then raise exception using errcode = '42501', message = 'authentication_required'; end if;
  if p_expected_owner_id is null or p_expected_owner_id <> caller_id then raise exception using errcode = '42501', message = 'account_changed'; end if;
  if p_file_hash !~ '^[0-9a-f]{64}$' or p_confirmation is distinct from format('import:%s:%s', p_expected_revision, p_file_hash) then raise exception using errcode = '22023', message = 'workspace_import_not_confirmed'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 5242880 then raise exception using errcode = '22023', message = 'invalid_workspace_state'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text, 0));
  select * into existing_job from public.workspace_import_jobs where owner_id = caller_id and file_hash = p_file_hash;
  if found then
    return query select existing_job.result_revision, existing_job.created_at, private.normalized_workspace_versions(caller_id), true;
    return;
  end if;
  select revision into current_revision from public.workspace_sync_cursors where owner_id = caller_id for update;
  if current_revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'workspace_entity_conflict', detail = 'import'; end if;
  current_state := private.normalized_workspace_state(caller_id);
  foreach collection in array array['groups', 'students', 'grades', 'classLog', 'classSchedules', 'scheduleExceptions', 'scheduleChanges'] loop
    if exists (
      select 1 from jsonb_array_elements(coalesce(current_state -> collection, '[]'::jsonb)) as old_item
      where not exists (
        select 1 from jsonb_array_elements(coalesce(p_state -> collection, '[]'::jsonb)) as new_item
        where new_item ->> 'id' = old_item ->> 'id'
      )
    ) then raise exception using errcode = '22023', message = 'workspace_import_would_remove_records', detail = collection; end if;
  end loop;
  perform private.archive_workspace_snapshot(caller_id, current_state, current_revision, 'import');
  perform private.replace_normalized_data(caller_id, p_state);
  select * into event from private.record_workspace_event(caller_id, jsonb_build_object('reload', true, 'reason', 'import'));
  insert into public.workspace_import_jobs (owner_id, file_hash, source_name, base_revision, result_revision, summary)
  values (caller_id, p_file_hash, left(coalesce(p_source_name, ''), 255), current_revision, event.event_id, coalesce(p_summary, '{}'::jsonb));
  return query select event.event_id, event.updated_at, private.normalized_workspace_versions(caller_id), false;
end;
$$;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.load_normalized_workspace(uuid)',
    'public.apply_workspace_patch(uuid,jsonb,jsonb)',
    'public.replace_normalized_workspace_state(uuid,bigint,jsonb,text)',
    'public.restore_normalized_workspace_snapshot(uuid,uuid,bigint)',
    'public.apply_normalized_workspace_import(uuid,bigint,jsonb,text,text,jsonb,text)'
  ] loop
    execute format('alter function %s owner to postgres', signature);
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end;
$$;

-- Old clients must fail closed instead of writing a now non-canonical JSON row.
revoke execute on function public.save_workspace_state(uuid, bigint, jsonb) from authenticated;
revoke execute on function public.replace_workspace_state(uuid, bigint, jsonb, text) from authenticated;
revoke execute on function public.restore_workspace_snapshot(uuid, uuid, bigint) from authenticated;
revoke execute on function public.apply_workspace_import(uuid, bigint, jsonb, text, text, jsonb, text) from authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_sync_signals'
    ) then execute 'alter publication supabase_realtime drop table public.workspace_sync_signals'; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_change_events'
    ) then execute 'alter publication supabase_realtime add table public.workspace_change_events'; end if;
  end if;
end;
$$;

comment on table public.workspace_change_events is
  'Last 100 small entity patches per owner for ordered Realtime delivery and reconnect replay.';
comment on function public.apply_workspace_patch(uuid, jsonb, jsonb) is
  'Atomically writes only changed entities and checks revisions only for those entities.';
