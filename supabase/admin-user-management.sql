-- NEXBIT Admin: read-only user management
-- Run this entire file in Supabase SQL Editor as the project owner.
-- Access is checked inside PostgreSQL; never expose the service_role key in browser code.

create or replace function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select
    u.id,
    u.email::text,
    coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name', '')::text,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at
  from auth.users as u
  left join public.profiles as p on p.id = u.id
  where
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower(auth.jwt() ->> 'email') = 'markleslie.corp@gmail.com'
    and (
      nullif(btrim(p_search), '') is null
      or coalesce(u.email, '') ilike '%' || btrim(p_search) || '%'
      or coalesce(p.full_name, u.raw_user_meta_data ->> 'full_name', '') ilike '%' || btrim(p_search) || '%'
    )
  order by u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.admin_user_stats()
returns table (
  total_users bigint,
  verified_users bigint,
  new_users_30d bigint
)
language sql
security definer
set search_path = pg_catalog
as $$
  select
    count(*)::bigint,
    count(*) filter (where u.email_confirmed_at is not null)::bigint,
    count(*) filter (where u.created_at >= now() - interval '30 days')::bigint
  from auth.users as u
  where
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and lower(auth.jwt() ->> 'email') = 'markleslie.corp@gmail.com';
$$;

revoke all on function public.admin_list_users(text, integer, integer) from public, anon;
revoke all on function public.admin_user_stats() from public, anon;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_user_stats() to authenticated;
