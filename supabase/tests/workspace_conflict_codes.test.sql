begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is((
  select count(*) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prokind = 'f'
    and p.prosrc ~ $pattern$errcode[[:space:]]*=[[:space:]]*'40001'$pattern$
), 0::bigint, 'no Hibi function manually raises retryable serialization failures');

select ok((select bool_and(p.prosrc like '%PT409%') from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'apply_encrypted_workspace_mutation', 'replace_encrypted_workspace',
    'begin_workspace_e2ee_migration', 'finalize_workspace_e2ee_migration'
  )), 'E2EE writes and migration barriers return non-retryable HTTP conflicts');

select ok(exists(select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.prosrc like '%PT409%'
), 'private legacy entity helpers are also protected from infinite retries');

select * from finish();
rollback;
