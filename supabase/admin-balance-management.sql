-- NEXBIT protected internal USD balances and immutable adjustment history
-- Run this entire script in Supabase SQL Editor as project owner.
-- This is an internal account ledger, not a cryptocurrency transfer or custody service.

create table if not exists public.nexbit_account_balances (
 user_id uuid primary key references auth.users(id) on delete restrict,
 balance numeric(30,12) not null default 0 check(balance >= 0),
 updated_at timestamptz not null default now()
);
create table if not exists public.nexbit_balance_ledger (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 admin_user_id uuid not null references auth.users(id) on delete restrict,
 adjustment numeric(30,12) not null check(adjustment <> 0),
 previous_balance numeric(30,12) not null check(previous_balance >= 0),
 new_balance numeric(30,12) not null check(new_balance >= 0),
 reason text not null check(length(btrim(reason)) >= 3),
 created_at timestamptz not null default now()
);
create index if not exists nexbit_balance_ledger_user_idx on public.nexbit_balance_ledger(user_id,created_at desc);
create index if not exists nexbit_balance_ledger_created_idx on public.nexbit_balance_ledger(created_at desc);
alter table public.nexbit_account_balances enable row level security;
alter table public.nexbit_balance_ledger enable row level security;
revoke all on public.nexbit_account_balances from anon,authenticated;
revoke all on public.nexbit_balance_ledger from anon,authenticated;
grant select on public.nexbit_account_balances to authenticated;
grant select on public.nexbit_balance_ledger to authenticated;
drop policy if exists "Users can view their own account balance" on public.nexbit_account_balances;
create policy "Users can view their own account balance" on public.nexbit_account_balances for select to authenticated using(user_id=auth.uid());
drop policy if exists "Users can view their own balance history" on public.nexbit_balance_ledger;
create policy "Users can view their own balance history" on public.nexbit_balance_ledger for select to authenticated using(user_id=auth.uid());

create or replace function public.admin_list_balances(p_search text default null,p_limit integer default 100)
returns table(user_id uuid,user_email text,balance numeric,updated_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com' or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Administrator access required'; end if;
 return query select u.id,u.email::text,coalesce(b.balance,0)::numeric,b.updated_at
 from auth.users u left join public.nexbit_account_balances b on b.user_id=u.id
 where nullif(btrim(p_search),'') is null or coalesce(u.email,'') ilike '%'||btrim(p_search)||'%' or u.id::text ilike '%'||btrim(p_search)||'%'
 order by u.created_at desc limit greatest(1,least(coalesce(p_limit,100),200));
end $$;

create or replace function public.admin_adjust_balance(p_user_id uuid,p_adjustment numeric,p_reason text)
returns table(previous_balance numeric,new_balance numeric)
language plpgsql security definer set search_path=pg_catalog as $$
declare v_previous numeric(30,12); v_new numeric(30,12);
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com' or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Administrator access required'; end if;
 if p_user_id is null then raise exception 'Select a user account'; end if;
 if p_adjustment is null or p_adjustment=0 or abs(p_adjustment)>1000000000000 then raise exception 'Enter a valid non-zero adjustment within the allowed limit'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Enter a reason of at least 3 characters'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'User account not found'; end if;
 insert into public.nexbit_account_balances(user_id,balance) values(p_user_id,0) on conflict(user_id) do nothing;
 select b.balance into v_previous from public.nexbit_account_balances b where b.user_id=p_user_id for update;
 v_new:=v_previous+p_adjustment;
 if v_new<0 then raise exception 'This adjustment would make the balance negative'; end if;
 update public.nexbit_account_balances set balance=v_new,updated_at=now() where user_id=p_user_id;
 insert into public.nexbit_balance_ledger(user_id,admin_user_id,adjustment,previous_balance,new_balance,reason)
 values(p_user_id,auth.uid(),p_adjustment,v_previous,v_new,btrim(p_reason));
 return query select v_previous,v_new;
end $$;

create or replace function public.admin_list_balance_history(p_search text default null,p_limit integer default 100)
returns table(id uuid,user_id uuid,user_email text,admin_user_id uuid,adjustment numeric,previous_balance numeric,new_balance numeric,reason text,created_at timestamptz)
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com' or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then raise exception 'Administrator access required'; end if;
 return query select l.id,l.user_id,u.email::text,l.admin_user_id,l.adjustment,l.previous_balance,l.new_balance,l.reason,l.created_at
 from public.nexbit_balance_ledger l left join auth.users u on u.id=l.user_id
 where nullif(btrim(p_search),'') is null or coalesce(u.email,'') ilike '%'||btrim(p_search)||'%' or l.user_id::text ilike '%'||btrim(p_search)||'%' or l.reason ilike '%'||btrim(p_search)||'%'
 order by l.created_at desc limit greatest(1,least(coalesce(p_limit,100),200));
end $$;

revoke all on function public.admin_list_balances(text,integer) from public,anon;
revoke all on function public.admin_adjust_balance(uuid,numeric,text) from public,anon;
revoke all on function public.admin_list_balance_history(text,integer) from public,anon;
grant execute on function public.admin_list_balances(text,integer) to authenticated;
grant execute on function public.admin_adjust_balance(uuid,numeric,text) to authenticated;
grant execute on function public.admin_list_balance_history(text,integer) to authenticated;
