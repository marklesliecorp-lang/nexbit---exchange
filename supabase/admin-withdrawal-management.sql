-- NEXBIT Admin: Withdrawal Request Management
-- Run this entire file in Supabase SQL Editor as the project owner.
-- This creates a protected review queue only. Approval does NOT send funds or mark a payout as paid.
-- Actual withdrawal submission must later be connected to a trusted balance-checking backend.

create table if not exists public.nexbit_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  asset_code text not null check (asset_code ~ '^[A-Z0-9]{2,12}$'),
  amount numeric(30,12) not null check (amount > 0),
  network text not null check (length(btrim(network)) between 2 and 40),
  destination_address text not null check (length(btrim(destination_address)) between 8 and 256),
  reference text not null unique default ('NEX-WD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  user_note text,
  admin_comment text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nexbit_withdrawal_created_idx
  on public.nexbit_withdrawal_requests(created_at desc);
create index if not exists nexbit_withdrawal_user_idx
  on public.nexbit_withdrawal_requests(user_id, created_at desc);
create index if not exists nexbit_withdrawal_status_idx
  on public.nexbit_withdrawal_requests(status, created_at desc);

alter table public.nexbit_withdrawal_requests enable row level security;
revoke all on public.nexbit_withdrawal_requests from anon, authenticated;

create or replace function public.admin_list_withdrawal_requests(
  p_search text default null,
  p_status text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  asset_code text,
  amount numeric,
  network text,
  destination_address text,
  reference text,
  status text,
  user_note text,
  admin_comment text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if lower(coalesce(auth.jwt() ->> 'email','')) <> 'markleslie.corp@gmail.com'
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') <> 'admin' then
    raise exception 'Administrator access required';
  end if;

  if p_status is not null and p_status not in ('pending','approved','rejected','cancelled') then
    raise exception 'Invalid withdrawal status filter';
  end if;

  return query
  select w.id, w.user_id, u.email::text, w.asset_code, w.amount, w.network,
         w.destination_address, w.reference, w.status, w.user_note, w.admin_comment,
         w.created_at, w.reviewed_at
  from public.nexbit_withdrawal_requests w
  left join auth.users u on u.id = w.user_id
  where (p_status is null or w.status = p_status)
    and (
      nullif(btrim(p_search),'') is null
      or coalesce(u.email,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(w.reference,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(w.destination_address,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(w.asset_code,'') ilike '%' || btrim(p_search) || '%'
      or w.user_id::text ilike '%' || btrim(p_search) || '%'
    )
  order by w.created_at desc
  limit greatest(1, least(coalesce(p_limit,100),200))
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

create or replace function public.admin_review_withdrawal_request(
  p_id uuid,
  p_status text,
  p_comment text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_old jsonb;
begin
  if lower(coalesce(auth.jwt() ->> 'email','')) <> 'markleslie.corp@gmail.com'
     or coalesce(auth.jwt() -> 'app_metadata' ->> 'role','') <> 'admin' then
    raise exception 'Administrator access required';
  end if;

  if p_status not in ('approved','rejected') then
    raise exception 'Choose approve or reject';
  end if;
  if p_status = 'rejected' and length(btrim(coalesce(p_comment,''))) < 3 then
    raise exception 'A comment is required when rejecting a withdrawal';
  end if;

  select to_jsonb(w) into v_old
  from public.nexbit_withdrawal_requests w
  where w.id = p_id
  for update;

  if v_old is null then raise exception 'Withdrawal request not found'; end if;
  if v_old ->> 'status' <> 'pending' then
    raise exception 'Only pending withdrawal requests can be reviewed';
  end if;

  update public.nexbit_withdrawal_requests
  set status = p_status,
      admin_comment = nullif(btrim(coalesce(p_comment,'')),''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_id;

  insert into public.nexbit_admin_audit_logs
    (actor_user_id, action, entity_type, entity_id, details)
  values
    (auth.uid(), 'withdrawal_' || p_status, 'withdrawal_request', p_id::text,
     jsonb_build_object(
       'before', v_old,
       'after', jsonb_build_object('status',p_status,'admin_comment',nullif(btrim(coalesce(p_comment,'')),''))
     ));

  return true;
end;
$$;

revoke all on function public.admin_list_withdrawal_requests(text,text,integer,integer) from public, anon;
revoke all on function public.admin_review_withdrawal_request(uuid,text,text) from public, anon;
grant execute on function public.admin_list_withdrawal_requests(text,text,integer,integer) to authenticated;
grant execute on function public.admin_review_withdrawal_request(uuid,text,text) to authenticated;
