-- NEXBIT multi-asset internal account balances.
-- Run this entire migration in Supabase SQL Editor as project owner.
-- This is an internal ledger only; it does not custody, transfer, or verify blockchain assets.

create table if not exists public.nexbit_account_asset_balances (
 user_id uuid not null references auth.users(id) on delete restrict,
 asset_code text not null check(asset_code ~ '^[A-Z0-9]{2,12}$'),
 balance numeric(36,18) not null default 0 check(balance >= 0),
 updated_at timestamptz not null default now(),
 primary key(user_id,asset_code)
);
create table if not exists public.nexbit_asset_balance_ledger (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 admin_user_id uuid not null references auth.users(id) on delete restrict,
 asset_code text not null check(asset_code ~ '^[A-Z0-9]{2,12}$'),
 adjustment numeric(36,18) not null check(adjustment <> 0),
 previous_balance numeric(36,18) not null check(previous_balance >= 0),
 new_balance numeric(36,18) not null check(new_balance >= 0),
 reason text not null check(length(btrim(reason)) >= 3),
 created_at timestamptz not null default now()
);
create index if not exists nexbit_asset_balance_ledger_user_idx on public.nexbit_asset_balance_ledger(user_id,asset_code,created_at desc);
create index if not exists nexbit_asset_balance_ledger_created_idx on public.nexbit_asset_balance_ledger(created_at desc);

-- Preserve all existing USD balances without overwriting a newer multi-asset value.
insert into public.nexbit_account_asset_balances(user_id,asset_code,balance,updated_at)
select user_id,'USD',balance,updated_at from public.nexbit_account_balances
on conflict(user_id,asset_code) do nothing;

alter table public.nexbit_account_asset_balances enable row level security;
alter table public.nexbit_asset_balance_ledger enable row level security;
revoke all on public.nexbit_account_asset_balances from anon,authenticated;
revoke all on public.nexbit_asset_balance_ledger from anon,authenticated;
grant select on public.nexbit_account_asset_balances to authenticated;
grant select on public.nexbit_asset_balance_ledger to authenticated;
drop policy if exists "Users view own multi asset balances" on public.nexbit_account_asset_balances;
create policy "Users view own multi asset balances" on public.nexbit_account_asset_balances for select to authenticated using(user_id=auth.uid());
drop policy if exists "Users view own multi asset balance history" on public.nexbit_asset_balance_ledger;
create policy "Users view own multi asset balance history" on public.nexbit_asset_balance_ledger for select to authenticated using(user_id=auth.uid());

create or replace function public.admin_list_asset_balances(p_search text default null,p_limit integer default 200)
returns table(user_id uuid,user_email text,asset_code text,balance numeric,updated_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com' or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Administrator access required'; end if;
 return query
 with matched_users as (
  select u.id,u.email,u.created_at from auth.users u
  where nullif(btrim(p_search),'') is null or coalesce(u.email,'') ilike '%'||btrim(p_search)||'%' or u.id::text ilike '%'||btrim(p_search)||'%'
  order by u.created_at desc limit greatest(1,least(coalesce(p_limit,200),500))
 )
 select m.id,m.email::text,b.asset_code,b.balance,b.updated_at
 from matched_users m
 left join public.nexbit_account_asset_balances b on b.user_id=m.id
 where b.asset_code is not null
 union all
 select m.id,m.email::text,'USD'::text,0::numeric,null::timestamptz
 from matched_users m
 where not exists(select 1 from public.nexbit_account_asset_balances b where b.user_id=m.id)
 order by 2,3;
end $$;

create or replace function public.admin_adjust_asset_balance(p_user_id uuid,p_asset_code text,p_adjustment numeric,p_reason text)
returns table(previous_balance numeric,new_balance numeric,asset_code text)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_previous numeric(36,18); v_new numeric(36,18); v_asset text;
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com' or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Administrator access required'; end if;
 if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Select a valid user account'; end if;
 v_asset:=upper(btrim(coalesce(p_asset_code,'')));
 if v_asset !~ '^[A-Z0-9]{2,12}$' then raise exception 'Enter a valid asset code, for example BTC, ETH or USDT'; end if;
 if p_adjustment is null or p_adjustment=0 or abs(p_adjustment)>1000000000000000000 then raise exception 'Enter a valid non-zero adjustment within the allowed limit'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Enter a reason of at least 3 characters'; end if;
 insert into public.nexbit_account_asset_balances(user_id,asset_code,balance) values(p_user_id,v_asset,0) on conflict(user_id,asset_code) do nothing;
 select b.balance into v_previous from public.nexbit_account_asset_balances b where b.user_id=p_user_id and b.asset_code=v_asset for update;
 v_new:=v_previous+p_adjustment;
 if v_new<0 then raise exception 'This adjustment would make the asset balance negative'; end if;
 update public.nexbit_account_asset_balances set balance=v_new,updated_at=now() where user_id=p_user_id and asset_code=v_asset;
 insert into public.nexbit_asset_balance_ledger(user_id,admin_user_id,asset_code,adjustment,previous_balance,new_balance,reason)
 values(p_user_id,auth.uid(),v_asset,p_adjustment,v_previous,v_new,btrim(p_reason));
 return query select v_previous,v_new,v_asset;
end $$;

create or replace function public.admin_list_asset_balance_history(p_search text default null,p_limit integer default 100)
returns table(id uuid,user_id uuid,user_email text,admin_user_id uuid,asset_code text,adjustment numeric,previous_balance numeric,new_balance numeric,reason text,created_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com' or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Administrator access required'; end if;
 return query select l.id,l.user_id,u.email::text,l.admin_user_id,l.asset_code,l.adjustment,l.previous_balance,l.new_balance,l.reason,l.created_at
 from public.nexbit_asset_balance_ledger l left join auth.users u on u.id=l.user_id
 where nullif(btrim(p_search),'') is null or coalesce(u.email,'') ilike '%'||btrim(p_search)||'%' or l.user_id::text ilike '%'||btrim(p_search)||'%' or l.reason ilike '%'||btrim(p_search)||'%' or l.asset_code ilike '%'||btrim(p_search)||'%'
 order by l.created_at desc limit greatest(1,least(coalesce(p_limit,100),500));
end $$;

revoke all on function public.admin_list_asset_balances(text,integer) from public,anon;
revoke all on function public.admin_adjust_asset_balance(uuid,text,numeric,text) from public,anon;
revoke all on function public.admin_list_asset_balance_history(text,integer) from public,anon;
grant execute on function public.admin_list_asset_balances(text,integer) to authenticated;
grant execute on function public.admin_adjust_asset_balance(uuid,text,numeric,text) to authenticated;
grant execute on function public.admin_list_asset_balance_history(text,integer) to authenticated;
