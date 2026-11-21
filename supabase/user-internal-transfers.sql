-- NEXBIT internal transfers with administrator approval.
-- Run this complete script in Supabase SQL Editor as project owner.
-- Transfers affect NEXBIT's internal ledger only; they do not move crypto on-chain.

create table if not exists public.nexbit_internal_transfers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('NEX-TR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  asset_code text not null check (asset_code ~ '^[A-Z0-9]{2,12}$'),
  amount numeric(36,18) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_comment text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint nexbit_internal_transfer_not_self check (sender_user_id <> recipient_user_id)
);

alter table public.nexbit_internal_transfers
  add column if not exists status text not null default 'pending',
  add column if not exists admin_comment text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.nexbit_internal_transfers'::regclass
      and conname='nexbit_internal_transfers_status_check'
  ) then
    alter table public.nexbit_internal_transfers
      add constraint nexbit_internal_transfers_status_check
      check (status in ('pending','approved','rejected'));
  end if;
end $$;

create index if not exists nexbit_internal_transfers_sender_idx
  on public.nexbit_internal_transfers(sender_user_id,created_at desc);
create index if not exists nexbit_internal_transfers_recipient_idx
  on public.nexbit_internal_transfers(recipient_user_id,created_at desc);
create index if not exists nexbit_internal_transfers_status_idx
  on public.nexbit_internal_transfers(status,created_at desc);

alter table public.nexbit_internal_transfers enable row level security;
revoke all on public.nexbit_internal_transfers from anon,authenticated;
grant select on public.nexbit_internal_transfers to authenticated;
drop policy if exists "Users view transfers they participated in" on public.nexbit_internal_transfers;
create policy "Users view transfers they participated in"
on public.nexbit_internal_transfers for select to authenticated
using (sender_user_id=auth.uid() or recipient_user_id=auth.uid());

-- Remove the earlier immediate-send endpoint so users cannot bypass admin review.
drop function if exists public.nexbit_send_internal_transfer(text,text,numeric);

-- Keep withdrawal submissions from spending funds reserved by pending internal transfers.
create or replace function public.nexbit_submit_withdrawal_request(
  p_asset_code text,
  p_amount numeric,
  p_network text,
  p_destination_address text,
  p_user_note text default null
)
returns table(request_id uuid, reference text, status text, available_balance numeric)
language plpgsql
security definer
set search_path=pg_catalog
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_asset text := upper(btrim(coalesce(p_asset_code,'')));
  v_network text := btrim(coalesce(p_network,''));
  v_address text := btrim(coalesce(p_destination_address,''));
  v_balance numeric(36,18);
  v_reserved numeric(36,18);
  v_transfer_reserved numeric(36,18);
  v_available numeric(36,18);
  v_id uuid;
  v_reference text;
  v_status text;
begin
  if v_user_id is null then raise exception 'Please sign in to submit a withdrawal request'; end if;
  if length(v_asset)<2 or length(v_asset)>12 or v_asset ~ '[^A-Z0-9]' then raise exception 'Select a valid asset'; end if;
  if p_amount is null or p_amount<=0 or p_amount>999999999999999999 or p_amount<>round(p_amount,12) then
    raise exception 'Enter a positive amount with no more than 12 decimal places';
  end if;
  if length(v_network)<2 or length(v_network)>40 then raise exception 'Enter a valid network'; end if;
  if length(v_address)<8 or length(v_address)>256 then raise exception 'Enter a valid destination address'; end if;
  if length(coalesce(p_user_note,''))>500 then raise exception 'Your note must be 500 characters or fewer'; end if;

  select b.balance into v_balance
  from public.nexbit_account_asset_balances b
  where b.user_id=v_user_id and b.asset_code=v_asset
  for update;
  if not found then raise exception 'You do not have a recorded balance for this asset'; end if;

  select coalesce(sum(w.amount),0) into v_reserved
  from public.nexbit_withdrawal_requests w
  where w.user_id=v_user_id and w.asset_code=v_asset and w.status in ('pending','approved');
  select coalesce(sum(t.amount),0) into v_transfer_reserved
  from public.nexbit_internal_transfers t
  where t.sender_user_id=v_user_id and t.asset_code=v_asset and t.status='pending';

  v_available:=v_balance-v_reserved-v_transfer_reserved;
  if p_amount>v_available then
    raise exception 'Insufficient available balance. Available for new requests: % %',greatest(v_available,0),v_asset;
  end if;

  insert into public.nexbit_withdrawal_requests
    (user_id,asset_code,amount,network,destination_address,user_note)
  values
    (v_user_id,v_asset,p_amount,v_network,v_address,nullif(btrim(coalesce(p_user_note,'')),''))
  returning id,nexbit_withdrawal_requests.reference,nexbit_withdrawal_requests.status
    into v_id,v_reference,v_status;

  return query select v_id,v_reference,v_status,v_available-p_amount;
end;
$fn$;


create or replace function public.nexbit_request_internal_transfer(
  p_recipient_email text,
  p_asset_code text,
  p_amount numeric
)
returns table(transfer_id uuid,reference text,status text,available_balance numeric)
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
  v_balance numeric(36,18);
  v_reserved_withdrawals numeric(36,18);
  v_reserved_transfers numeric(36,18);
  v_id uuid;
  v_reference text;
begin
  if v_sender is null then raise exception 'Please sign in before requesting a transfer'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter the recipient’s registered email address'; end if;
  if v_asset !~ '^[A-Z0-9]{2,12}$' then raise exception 'Select a valid asset'; end if;
  if p_amount is null or p_amount<=0 or p_amount>999999999999999999 or p_amount<>round(p_amount,12) then
    raise exception 'Enter a positive amount with no more than 12 decimal places';
  end if;

  select (u.email_confirmed_at is not null) into v_sender_verified
  from auth.users u where u.id=v_sender;
  if coalesce(v_sender_verified,false)=false then raise exception 'Verify your email before requesting a transfer'; end if;

  select u.id,(u.email_confirmed_at is not null)
    into v_recipient,v_recipient_verified
  from auth.users u
  where lower(u.email)=v_email and u.id<>v_sender
  limit 1;
  if v_recipient is null then raise exception 'No other NEXBIT account was found with that email'; end if;
  if coalesce(v_recipient_verified,false)=false then raise exception 'The recipient must have a verified email address'; end if;

  if not exists(select 1 from public.nexbit_kyc_submissions k where k.user_id=v_sender and k.status='approved') then
    raise exception 'Your KYC must be approved before you can request a transfer';
  end if;
  if not exists(select 1 from public.nexbit_kyc_submissions k where k.user_id=v_recipient and k.status='approved') then
    raise exception 'The recipient must have approved KYC before receiving transfers';
  end if;

  insert into public.nexbit_account_asset_balances(user_id,asset_code,balance)
  values(v_sender,v_asset,0) on conflict(user_id,asset_code) do nothing;

  -- Lock sender balance while checking and reserving this pending request.
  select b.balance into v_balance
  from public.nexbit_account_asset_balances b
  where b.user_id=v_sender and b.asset_code=v_asset
  for update;

  select coalesce(sum(w.amount),0) into v_reserved_withdrawals
  from public.nexbit_withdrawal_requests w
  where w.user_id=v_sender and w.asset_code=v_asset and w.status in ('pending','approved');

  select coalesce(sum(t.amount),0) into v_reserved_transfers
  from public.nexbit_internal_transfers t
  where t.sender_user_id=v_sender and t.asset_code=v_asset and t.status='pending';

  if p_amount>v_balance-v_reserved_withdrawals-v_reserved_transfers then
    raise exception 'Insufficient available balance. Available: % %',
      greatest(v_balance-v_reserved_withdrawals-v_reserved_transfers,0),v_asset;
  end if;

  insert into public.nexbit_internal_transfers(sender_user_id,recipient_user_id,asset_code,amount,status)
  values(v_sender,v_recipient,v_asset,p_amount,'pending')
  returning id,nexbit_internal_transfers.reference into v_id,v_reference;

  return query select v_id,v_reference,'pending'::text,
    v_balance-v_reserved_withdrawals-v_reserved_transfers-p_amount;
end;
$$;

create or replace function public.nexbit_list_my_internal_transfers(p_limit integer default 50)
returns table(
  id uuid,reference text,direction text,counterparty_email text,
  asset_code text,amount numeric,status text,admin_comment text,created_at timestamptz,reviewed_at timestamptz
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
    t.asset_code,t.amount,t.status,
    case when t.sender_user_id=auth.uid() then t.admin_comment else null end,
    t.created_at,t.reviewed_at
  from public.nexbit_internal_transfers t
  left join auth.users sender on sender.id=t.sender_user_id
  left join auth.users recipient on recipient.id=t.recipient_user_id
  where t.sender_user_id=auth.uid() or t.recipient_user_id=auth.uid()
  order by t.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;

create or replace function public.admin_list_internal_transfer_requests(
  p_search text default null,
  p_status text default null,
  p_limit integer default 200
)
returns table(
  id uuid,reference text,sender_user_id uuid,sender_email text,
  recipient_user_id uuid,recipient_email text,asset_code text,amount numeric,
  status text,admin_comment text,created_at timestamptz,reviewed_at timestamptz
)
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com'
     or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Administrator access required';
  end if;
  if p_status is not null and p_status not in ('pending','approved','rejected') then
    raise exception 'Invalid transfer status filter';
  end if;
  return query
  select t.id,t.reference,t.sender_user_id,s.email::text,
         t.recipient_user_id,r.email::text,t.asset_code,t.amount,
         t.status,t.admin_comment,t.created_at,t.reviewed_at
  from public.nexbit_internal_transfers t
  left join auth.users s on s.id=t.sender_user_id
  left join auth.users r on r.id=t.recipient_user_id
  where (p_status is null or t.status=p_status)
    and (nullif(btrim(p_search),'') is null
      or coalesce(s.email,'') ilike '%'||btrim(p_search)||'%'
      or coalesce(r.email,'') ilike '%'||btrim(p_search)||'%'
      or t.reference ilike '%'||btrim(p_search)||'%'
      or t.asset_code ilike '%'||btrim(p_search)||'%'
      or t.sender_user_id::text ilike '%'||btrim(p_search)||'%'
      or t.recipient_user_id::text ilike '%'||btrim(p_search)||'%')
  order by case when t.status='pending' then 0 else 1 end,t.created_at desc
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$$;

create or replace function public.admin_review_internal_transfer(
  p_id uuid,
  p_status text,
  p_comment text default null
)
returns table(reference text,status text,sender_new_balance numeric,recipient_new_balance numeric)
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
  v_transfer public.nexbit_internal_transfers%rowtype;
  v_sender_balance numeric(36,18);
  v_recipient_balance numeric(36,18);
  v_reserved_withdrawals numeric(36,18);
  v_reserved_transfers numeric(36,18);
begin
  if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com'
     or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
    raise exception 'Administrator access required';
  end if;
  if p_status not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
  if p_status='rejected' and length(btrim(coalesce(p_comment,'')))<3 then
    raise exception 'Enter a reason of at least 3 characters when rejecting';
  end if;

  select * into v_transfer
  from public.nexbit_internal_transfers
  where id=p_id
  for update;
  if not found then raise exception 'Transfer request not found'; end if;
  if v_transfer.status<>'pending' then raise exception 'This transfer request has already been reviewed'; end if;

  if p_status='rejected' then
    update public.nexbit_internal_transfers
      set status='rejected',admin_comment=nullif(btrim(p_comment),''),reviewed_by=auth.uid(),reviewed_at=now()
      where id=p_id;
    return query select v_transfer.reference,'rejected'::text,null::numeric,null::numeric;
    return;
  end if;

  insert into public.nexbit_account_asset_balances(user_id,asset_code,balance)
  values(v_transfer.sender_user_id,v_transfer.asset_code,0)
  on conflict(user_id,asset_code) do nothing;
  insert into public.nexbit_account_asset_balances(user_id,asset_code,balance)
  values(v_transfer.recipient_user_id,v_transfer.asset_code,0)
  on conflict(user_id,asset_code) do nothing;

  -- Lock both balance rows in stable user-id order.
  perform b.user_id
  from public.nexbit_account_asset_balances b
  where b.asset_code=v_transfer.asset_code
    and b.user_id in (v_transfer.sender_user_id,v_transfer.recipient_user_id)
  order by b.user_id
  for update;

  select b.balance into v_sender_balance
  from public.nexbit_account_asset_balances b
  where b.user_id=v_transfer.sender_user_id and b.asset_code=v_transfer.asset_code;
  select b.balance into v_recipient_balance
  from public.nexbit_account_asset_balances b
  where b.user_id=v_transfer.recipient_user_id and b.asset_code=v_transfer.asset_code;

  select coalesce(sum(w.amount),0) into v_reserved_withdrawals
  from public.nexbit_withdrawal_requests w
  where w.user_id=v_transfer.sender_user_id
    and w.asset_code=v_transfer.asset_code and w.status in ('pending','approved');
  select coalesce(sum(t.amount),0) into v_reserved_transfers
  from public.nexbit_internal_transfers t
  where t.sender_user_id=v_transfer.sender_user_id
    and t.asset_code=v_transfer.asset_code and t.status='pending' and t.id<>p_id;

  if v_transfer.amount>v_sender_balance-v_reserved_withdrawals-v_reserved_transfers then
    raise exception 'Insufficient available balance at approval. Available: % %',
      greatest(v_sender_balance-v_reserved_withdrawals-v_reserved_transfers,0),v_transfer.asset_code;
  end if;

  update public.nexbit_account_asset_balances
    set balance=v_sender_balance-v_transfer.amount,updated_at=now()
    where user_id=v_transfer.sender_user_id and asset_code=v_transfer.asset_code;
  update public.nexbit_account_asset_balances
    set balance=v_recipient_balance+v_transfer.amount,updated_at=now()
    where user_id=v_transfer.recipient_user_id and asset_code=v_transfer.asset_code;

  update public.nexbit_internal_transfers
    set status='approved',admin_comment=nullif(btrim(p_comment),''),reviewed_by=auth.uid(),reviewed_at=now()
    where id=p_id;

  insert into public.nexbit_transactions
    (user_id,transaction_type,asset_code,amount,reference,status,notes,metadata)
  values
    (v_transfer.sender_user_id,'transfer',v_transfer.asset_code,v_transfer.amount,v_transfer.reference,'completed',
     'Admin-approved internal NEXBIT account transfer',
     jsonb_build_object('recipient_user_id',v_transfer.recipient_user_id,'transfer_id',v_transfer.id,'approved_by',auth.uid()));

  return query select v_transfer.reference,'approved'::text,
    v_sender_balance-v_transfer.amount,v_recipient_balance+v_transfer.amount;
end;
$$;

revoke all on function public.nexbit_request_internal_transfer(text,text,numeric) from public,anon;
revoke all on function public.nexbit_list_my_internal_transfers(integer) from public,anon;
revoke all on function public.admin_list_internal_transfer_requests(text,text,integer) from public,anon;
revoke all on function public.admin_review_internal_transfer(uuid,text,text) from public,anon;
grant execute on function public.nexbit_request_internal_transfer(text,text,numeric) to authenticated;
grant execute on function public.nexbit_list_my_internal_transfers(integer) to authenticated;
grant execute on function public.admin_list_internal_transfer_requests(text,text,integer) to authenticated;
grant execute on function public.admin_review_internal_transfer(uuid,text,text) to authenticated;
