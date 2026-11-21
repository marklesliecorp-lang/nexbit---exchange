-- NEXBIT: User withdrawal submission and personal request history
-- Run this entire file in Supabase SQL Editor as project owner.
-- This creates withdrawal requests only. It does not send funds or deduct ledger balances.
-- Pending and approved requests are reserved against the user's available ledger balance
-- when checking later requests, to prevent repeated requests exceeding the recorded balance.

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
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset text := upper(btrim(coalesce(p_asset_code,'')));
  v_network text := btrim(coalesce(p_network,''));
  v_address text := btrim(coalesce(p_destination_address,''));
  v_balance numeric(36,18);
  v_reserved numeric(36,18);
  v_available numeric(36,18);
  v_id uuid;
  v_reference text;
  v_status text;
begin
  if v_user_id is null then raise exception 'Please sign in to submit a withdrawal request'; end if;
  if v_asset !~ '^[A-Z0-9]{2,12}$' then raise exception 'Select a valid asset'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000000000000
     or p_amount <> round(p_amount,12) then
    raise exception 'Enter a positive amount with no more than 12 decimal places';
  end if;
  if length(v_network) < 2 or length(v_network) > 40 then raise exception 'Enter a valid network'; end if;
  if length(v_address) < 8 or length(v_address) > 256 then raise exception 'Enter a valid destination address'; end if;
  if length(coalesce(p_user_note,'')) > 500 then raise exception 'Your note must be 500 characters or fewer'; end if;

  -- Lock the user's asset balance row so concurrent requests cannot over-reserve it.
  select b.balance into v_balance
  from public.nexbit_account_asset_balances b
  where b.user_id = v_user_id and b.asset_code = v_asset
  for update;

  if not found then raise exception 'You do not have a recorded balance for this asset'; end if;

  select coalesce(sum(w.amount),0) into v_reserved
  from public.nexbit_withdrawal_requests w
  where w.user_id = v_user_id
    and w.asset_code = v_asset
    and w.status in ('pending','approved');

  v_available := v_balance - v_reserved;
  if p_amount > v_available then
    raise exception 'Insufficient available balance. Available for new requests: % %', v_available, v_asset;
  end if;

  insert into public.nexbit_withdrawal_requests
    (user_id, asset_code, amount, network, destination_address, user_note)
  values
    (v_user_id, v_asset, p_amount, v_network, v_address, nullif(btrim(coalesce(p_user_note,'')), ''))
  returning id, nexbit_withdrawal_requests.reference, nexbit_withdrawal_requests.status
    into v_id, v_reference, v_status;

  return query select v_id, v_reference, v_status, v_available - p_amount;
end;
$$;

create or replace function public.nexbit_list_my_withdrawal_requests(p_limit integer default 50)
returns table(
  id uuid,
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
  if auth.uid() is null then raise exception 'Please sign in to view withdrawal requests'; end if;
  return query
  select w.id, w.asset_code, w.amount, w.network, w.destination_address,
         w.reference, w.status, w.user_note, w.admin_comment, w.created_at, w.reviewed_at
  from public.nexbit_withdrawal_requests w
  where w.user_id = auth.uid()
  order by w.created_at desc
  limit greatest(1, least(coalesce(p_limit,50),100));
end;
$$;

revoke all on function public.nexbit_submit_withdrawal_request(text,numeric,text,text,text) from public, anon;
revoke all on function public.nexbit_list_my_withdrawal_requests(integer) from public, anon;
grant execute on function public.nexbit_submit_withdrawal_request(text,numeric,text,text,text) to authenticated;
grant execute on function public.nexbit_list_my_withdrawal_requests(integer) to authenticated;
