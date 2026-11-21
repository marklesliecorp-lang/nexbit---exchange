-- NEXBIT Admin: transaction monitoring
-- Run this entire file in Supabase SQL Editor as the project owner.
-- This creates a protected transaction register for records written by trusted server-side services.
-- It does not create deposits, withdrawals, trades, balances, or move funds.

create table if not exists public.nexbit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  transaction_type text not null check (transaction_type in ('deposit','withdrawal','transfer','trade','investment','refund','adjustment')),
  asset_code text not null,
  amount numeric(30,12) not null check (amount > 0),
  network text,
  reference text unique,
  tx_hash text,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nexbit_transactions_created_idx
  on public.nexbit_transactions(created_at desc);
create index if not exists nexbit_transactions_user_idx
  on public.nexbit_transactions(user_id, created_at desc);
create index if not exists nexbit_transactions_status_idx
  on public.nexbit_transactions(status, created_at desc);

alter table public.nexbit_transactions enable row level security;
revoke all on public.nexbit_transactions from anon, authenticated;

create or replace function public.admin_list_transactions(
  p_search text default null,
  p_status text default null,
  p_type text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  transaction_type text,
  asset_code text,
  amount numeric,
  network text,
  reference text,
  tx_hash text,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
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

  if p_status is not null and p_status not in ('pending','processing','completed','failed','cancelled') then
    raise exception 'Invalid transaction status filter';
  end if;
  if p_type is not null and p_type not in ('deposit','withdrawal','transfer','trade','investment','refund','adjustment') then
    raise exception 'Invalid transaction type filter';
  end if;

  return query
  select t.id, t.user_id, u.email::text, t.transaction_type, t.asset_code,
         t.amount, t.network, t.reference, t.tx_hash, t.status, t.notes,
         t.created_at, t.updated_at
  from public.nexbit_transactions t
  left join auth.users u on u.id = t.user_id
  where (p_status is null or t.status = p_status)
    and (p_type is null or t.transaction_type = p_type)
    and (
      nullif(btrim(p_search),'') is null
      or coalesce(u.email,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(t.reference,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(t.tx_hash,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(t.asset_code,'') ilike '%' || btrim(p_search) || '%'
      or t.user_id::text ilike '%' || btrim(p_search) || '%'
    )
  order by t.created_at desc
  limit greatest(1, least(coalesce(p_limit,100),200))
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

revoke all on function public.admin_list_transactions(text,text,text,integer,integer) from public, anon;
grant execute on function public.admin_list_transactions(text,text,text,integer,integer) to authenticated;
