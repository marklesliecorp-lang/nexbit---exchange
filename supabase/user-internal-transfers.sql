-- NEXBIT secure internal account transfers.
-- Run this entire script once in Supabase SQL Editor as the project owner.
-- This moves internal ledger balances only. It does not send cryptocurrency on-chain.

create table if not exists public.nexbit_internal_transfers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('NEX-TR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  asset_code text not null check (asset_code ~ '^[A-Z0-9]{2,12}$'),
  amount numeric(36,18) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint nexbit_internal_transfer_not_self check (sender_user_id <> recipient_user_id)
);

create index if not exists nexbit_internal_transfers_sender_idx
  on public.nexbit_internal_transfers(sender_user_id,created_at desc);
create index if not exists nexbit_internal_transfers_recipient_idx
  on public.nexbit_internal_transfers(recipient_user_id,created_at desc);

alter table public.nexbit_internal_transfers enable row level security;
revoke all on public.nexbit_internal_transfers from anon,authenticated;
grant select on public.nexbit_internal_transfers to authenticated;
drop policy if exists "Users view transfers they participated in" on public.nexbit_internal_transfers;
create policy "Users view transfers they participated in"
on public.nexbit_internal_transfers for select to authenticated
using (sender_user_id=auth.uid() or recipient_user_id=auth.uid());

create or replace function public.nexbit_send_internal_transfer(
  p_recipient_email text,
  p_asset_code text,
  p_amount numeric
)
returns table(transfer_id uuid,reference text,status text,sender_remaining_balance numeric)
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_sender uuid := auth.uid();
  v_recipient uuid;
  v_sender_verified boolean;
  v_recipient_verified boolean;
  v_asset text := upper(btrim(coalesce(p_asset_code,'')));
  v_email text := lower(btrim(coalesce(p_recipient_email,'')));
  v_sender_balance numeric(36,18);
  v_recipient_balance numeric(36,18);
  v_reserved numeric(36,18);
  v_id uuid;
  v_reference text;
begin
  if v_sender is null then raise exception 'Please sign in before transferring'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter the recipient’s registered email address'; end if;
  if v_asset !~ '^[A-Z0-9]{2,12}$' then raise exception 'Select a valid asset'; end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000000000000000 or p_amount<>round(p_amount,12) then
    raise exception 'Enter a positive amount with no more than 12 decimal places';
  end if;

  select (u.email_confirmed_at is not null) into v_sender_verified
  from auth.users u where u.id=v_sender;
  if coalesce(v_sender_verified,false)=false then raise exception 'Verify your email before making a transfer'; end if;

  select u.id,(u.email_confirmed_at is not null)
    into v_recipient,v_recipient_verified
  from auth.users u
  where lower(u.email)=v_email and u.id<>v_sender
  limit 1;
  if v_recipient is null then raise exception 'No other NEXBIT account was found with that email'; end if;
  if coalesce(v_recipient_verified,false)=false then raise exception 'The recipient must have a verified email address'; end if;

  if not exists(select 1 from public.nexbit_kyc_submissions k where k.user_id=v_sender and k.status='approved') then
    raise exception 'Your KYC must be approved before you can transfer';
  end if;
  if not exists(select 1 from public.nexbit_kyc_submissions k where k.user_id=v_recipient and k.status='approved') then
    raise exception 'The recipient must have approved KYC before receiving transfers';
  end if;

  insert into public.nexbit_account_asset_balances(user_id,asset_code,balance)
  values(v_sender,v_asset,0) on conflict(user_id,asset_code) do nothing;
  insert into public.nexbit_account_asset_balances(user_id,asset_code,balance)
  values(v_recipient,v_asset,0) on conflict(user_id,asset_code) do nothing;

  -- Lock both balance rows in a stable order to prevent concurrent overspending and deadlocks.
  perform b.user_id
  from public.nexbit_account_asset_balances b
  where b.asset_code=v_asset and b.user_id in (v_sender,v_recipient)
  order by b.user_id
  for update;

  select b.balance into v_sender_balance
  from public.nexbit_account_asset_balances b
  where b.user_id=v_sender and b.asset_code=v_asset;
  select b.balance into v_recipient_balance
  from public.nexbit_account_asset_balances b
  where b.user_id=v_recipient and b.asset_code=v_asset;

  select coalesce(sum(w.amount),0) into v_reserved
  from public.nexbit_withdrawal_requests w
  where w.user_id=v_sender and w.asset_code=v_asset and w.status in ('pending','approved');

  if p_amount>v_sender_balance-v_reserved then
    raise exception 'Insufficient available balance. Available: % %',greatest(v_sender_balance-v_reserved,0),v_asset;
  end if;

  update public.nexbit_account_asset_balances
  set balance=v_sender_balance-p_amount,updated_at=now()
  where user_id=v_sender and asset_code=v_asset;
  update public.nexbit_account_asset_balances
  set balance=v_recipient_balance+p_amount,updated_at=now()
  where user_id=v_recipient and asset_code=v_asset;

  insert into public.nexbit_internal_transfers(sender_user_id,recipient_user_id,asset_code,amount)
  values(v_sender,v_recipient,v_asset,p_amount)
  returning id,nexbit_internal_transfers.reference into v_id,v_reference;

  insert into public.nexbit_transactions
    (user_id,transaction_type,asset_code,amount,reference,status,notes,metadata)
  values
    (v_sender,'transfer',v_asset,p_amount,v_reference,'completed',
     'Internal NEXBIT account transfer',
     jsonb_build_object('recipient_user_id',v_recipient,'transfer_id',v_id));

  return query select v_id,v_reference,'completed'::text,v_sender_balance-p_amount;
end;
$$;

create or replace function public.nexbit_list_my_internal_transfers(p_limit integer default 50)
returns table(
  id uuid,reference text,direction text,counterparty_email text,
  asset_code text,amount numeric,created_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in to view transfers'; end if;
  return query
  select t.id,t.reference,
    case when t.sender_user_id=auth.uid() then 'sent' else 'received' end,
    case when t.sender_user_id=auth.uid() then recipient.email::text else sender.email::text end,
    t.asset_code,t.amount,t.created_at
  from public.nexbit_internal_transfers t
  left join auth.users sender on sender.id=t.sender_user_id
  left join auth.users recipient on recipient.id=t.recipient_user_id
  where t.sender_user_id=auth.uid() or t.recipient_user_id=auth.uid()
  order by t.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;

revoke all on function public.nexbit_send_internal_transfer(text,text,numeric) from public,anon;
revoke all on function public.nexbit_list_my_internal_transfers(integer) from public,anon;
grant execute on function public.nexbit_send_internal_transfer(text,text,numeric) to authenticated;
grant execute on function public.nexbit_list_my_internal_transfers(integer) to authenticated;
