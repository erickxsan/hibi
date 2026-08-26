-- Complete the rollout: every authenticated workspace must activate E2EE
-- before the application can read or write domain content.
insert into public.workspace_e2ee_rollout_config (singleton, mode, updated_at)
values (1, 'required', now())
on conflict (singleton) do update
set mode = excluded.mode,
    updated_at = excluded.updated_at;

do $$
begin
  if not exists (
    select 1
    from public.workspace_e2ee_rollout_config
    where singleton = 1 and mode = 'required'
  ) then
    raise exception using errcode = '55000', message = 'e2ee_rollout_not_required';
  end if;
end;
$$;
