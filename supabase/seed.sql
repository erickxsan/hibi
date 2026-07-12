-- Intentionally contains no personal or demo records.
-- It is safe to run repeatedly and only repairs missing workspace rows for
-- Supabase Auth accounts that already exist.

insert into public.workspaces (owner_id)
select users.id
from auth.users as users
on conflict (owner_id) do nothing;
