-- A stale application revision is not a PostgreSQL serialization failure.
-- PostgREST 14 retries SQLSTATE 40001 indefinitely with the same stale arguments.
-- Patch only Hibi's explicit business conflicts, preserving each installed
-- function body, signature, owner, grants, search_path and security mode.
-- This also works on installations that have not yet applied the September 7
-- migrations; run it again after those migrations if applying them manually.
do $migration$
declare
  target record;
  conflict_pattern constant text := $pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'([[:space:]]*,[[:space:]]*message[[:space:]]*=[[:space:]]*'(workspace_revision_conflict|workspace_entity_conflict|legacy_revision_conflict)')$pattern$;
begin
  for target in
    select p.oid, pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and l.lanname = 'plpgsql'
      and p.prosrc ~ conflict_pattern
    order by p.oid
  loop
    execute pg_catalog.regexp_replace(
      target.definition, conflict_pattern, $replacement$\1'PT409'\2$replacement$, 'g'
    );
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
