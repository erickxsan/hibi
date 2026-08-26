-- Supabase may install this postgres-owned event-trigger function outside the
-- project's migration history. Event triggers do not need client EXECUTE
-- privileges, and the default PUBLIC grant causes a Security Advisor warning.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
