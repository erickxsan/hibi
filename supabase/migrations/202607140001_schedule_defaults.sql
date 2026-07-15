-- Additive defaults for recurring schedules and one-off schedule exceptions.
-- Existing workspace documents remain untouched; the application normalizer
-- supplies these empty collections for legacy accounts before their next save.

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
    'classLog', '[]'::jsonb,
    'scheduleExceptions', '[]'::jsonb,
    'scheduleChanges', '[]'::jsonb
  )
  from local_dates;
$$;

revoke all on function private.initial_workspace_state() from public, anon, authenticated;
