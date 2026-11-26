-- NEXTBIT Spot execution schema and atomic balance conversion.
-- The server-only Edge Function supplies verified Binance quotes and calls the RPC.

create table if not exists public.nexbit_spot_trades (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete restrict,
 reference text not null unique default ('NEX-SPOT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
 idempotency_key uuid not null,
 action text not null check(action in ('buy','sell','convert')),
 from_asset text not null,to_asset text not null,
 input_amount numeric(36,18) not null check(input_amount>0),
 gross_output numeric(36,18) not null check(gross_output>0),
 fee_rate numeric(10,8) not null default 0.001 check(fee_rate=0.001),
 fee_amount numeric(36,18) not null check(fee_amount>=0),
 fee_asset text not null,
 net_output numeric(36,18) not null check(net_output>0),
 from_price_usdt numeric(36,18) not null check(from_price_usdt>0),
 to_price_usdt numeric(36,18) not null check(to_price_usdt>0),
 quote_at timestamptz not null,created_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
create index if not exists nexbit_spot_trades_user_created_idx on public.nexbit_spot_trades(user_id,created_at desc);
create table if not exists public.nexbit_spot_trade_ledger (
 id uuid primary key default gen_random_uuid(),
 trade_id uuid not null references public.nexbit_spot_trades(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 account_type text not null check(account_type in ('main','asset')),
 asset_code text not null,change_amount numeric(36,18) not null check(change_amount<>0),
 balance_before numeric(36,18) not null check(balance_before>=0),
 balance_after numeric(36,18) not null check(balance_after>=0),created_at timestamptz not null default now()
);
create index if not exists nexbit_spot_trade_ledger_user_idx on public.nexbit_spot_trade_ledger(user_id,created_at desc);
alter table public.nexbit_spot_trades enable row level security;
alter table public.nexbit_spot_trade_ledger enable row level security;
revoke all on public.nexbit_spot_trades,public.nexbit_spot_trade_ledger from anon,authenticated;
grant select on public.nexbit_spot_trades,public.nexbit_spot_trade_ledger to authenticated;
drop policy if exists "Users view own spot trades" on public.nexbit_spot_trades;
create policy "Users view own spot trades" on public.nexbit_spot_trades for select to authenticated using(user_id=auth.uid());
drop policy if exists "Users view own spot trade ledger" on public.nexbit_spot_trade_ledger;
create policy "Users view own spot trade ledger" on public.nexbit_spot_trade_ledger for select to authenticated using(user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.nexbit_execute_spot_trade(p_user_id uuid, p_action text, p_from_asset text, p_to_asset text, p_amount numeric, p_from_price_usdt numeric, p_to_price_usdt numeric, p_quote_at timestamp with time zone, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_action text:=lower(btrim(coalesce(p_action,'')));
 v_from text:=upper(btrim(coalesce(p_from_asset,'')));
 v_to text:=upper(btrim(coalesce(p_to_asset,'')));
 v_input numeric(36,18); v_gross numeric(36,18); v_fee numeric(36,18); v_net numeric(36,18);
 v_from_price numeric(36,18); v_to_price numeric(36,18);
 v_main_before numeric(36,18); v_main_after numeric(36,18);
 v_asset_before numeric(36,18); v_asset_after numeric(36,18);
 v_trade_id uuid; v_reference text; v_existing public.nexbit_spot_trades%rowtype;
 v_codes text[]; v_code text; v_balance numeric(36,18); v_before numeric(36,18); v_after numeric(36,18);
 v_fee_asset text;
begin
 if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Valid account required'; end if;
 if v_action not in ('buy','sell','convert') then raise exception 'Choose Buy, Sell or Convert'; end if;
 if v_from !~ '^[A-Z0-9]{2,12}$' or v_to !~ '^[A-Z0-9]{2,12}$' or v_from=v_to then raise exception 'Select two different valid assets'; end if;
 if p_amount is null or p_amount<=0 or p_amount>1000000000000000000 or p_amount<>round(p_amount,12) then raise exception 'Enter a valid amount with up to 12 decimal places'; end if;
 if p_from_price_usdt is null or p_to_price_usdt is null or p_from_price_usdt<=0 or p_to_price_usdt<=0 then raise exception 'A valid live market quote is required'; end if;
 if p_quote_at is null or p_quote_at>now()+interval '5 seconds' or p_quote_at<now()-interval '30 seconds' then raise exception 'The market quote has expired. Refresh and try again'; end if;
 if p_idempotency_key is null then raise exception 'A unique execution reference is required'; end if;
 if v_action='buy' and (v_from<>'USD' or v_to not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX')) then raise exception 'Unsupported Buy asset pair'; end if;
 if v_action='sell' and (v_to<>'USD' or v_from not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX')) then raise exception 'Unsupported Sell asset pair'; end if;
 if v_action='convert' and (v_from not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX','USDT') or v_to not in ('BTC','ETH','SOL','BNB','XRP','DOGE','ADA','TRX','USDT')) then raise exception 'Unsupported Convert asset pair'; end if;
 select * into v_existing from public.nexbit_spot_trades where user_id=p_user_id and idempotency_key=p_idempotency_key;
 if found then return jsonb_build_object('success',true,'duplicate',true,'reference',v_existing.reference,'action',v_existing.action,'inputAmount',v_existing.input_amount,'grossOutput',v_existing.gross_output,'feeAmount',v_existing.fee_amount,'feeAsset',v_existing.fee_asset,'netOutput',v_existing.net_output); end if;
 v_input:=p_amount; v_from_price:=p_from_price_usdt; v_to_price:=p_to_price_usdt;
 if v_action='buy' then v_from_price:=1; v_gross:=v_input; v_fee_asset:=v_to;
 elsif v_action='sell' then v_to_price:=1; v_gross:=v_input*v_from_price; v_fee_asset:='USD';
 else v_gross:=v_input*v_from_price/v_to_price; v_fee_asset:=v_to; end if;
 v_gross:=round(v_gross,12); v_fee:=round(v_gross*0.001,12); v_net:=v_gross-v_fee;
 if v_gross<=0 or v_net<=0 then raise exception 'Trade amount is too small after fees'; end if;
 if v_action='buy' then
   select balance into v_main_before from public.nexbit_account_balances where user_id=p_user_id for update;
   if not found then raise exception 'Main wallet balance was not found'; end if;
   if v_main_before<v_input*v_to_price then raise exception 'Insufficient main wallet balance'; end if;
   insert into public.nexbit_account_asset_balances(user_id,asset_code,balance) values(p_user_id,v_to,0) on conflict(user_id,asset_code) do nothing;
   select balance into v_asset_before from public.nexbit_account_asset_balances where user_id=p_user_id and asset_code=v_to for update;
 elsif v_action='sell' then
   select balance into v_main_before from public.nexbit_account_balances where user_id=p_user_id for update;
   if not found then raise exception 'Main wallet balance was not found'; end if;
   select balance into v_asset_before from public.nexbit_account_asset_balances where user_id=p_user_id and asset_code=v_from for update;
   if not found or v_asset_before<v_input then raise exception 'Insufficient available asset balance'; end if;
 else
   v_codes:=array(select distinct x from unnest(array[v_from,v_to]) x order by x);
   foreach v_code in array v_codes loop
     insert into public.nexbit_account_asset_balances(user_id,asset_code,balance) values(p_user_id,v_code,0) on conflict(user_id,asset_code) do nothing;
   end loop;
   foreach v_code in array v_codes loop
     select balance into v_balance from public.nexbit_account_asset_balances where user_id=p_user_id and asset_code=v_code for update;
     if v_code=v_from then v_asset_before:=v_balance; end if;
     if v_code=v_to then v_main_before:=v_balance; end if;
   end loop;
   if v_asset_before<v_input then raise exception 'Insufficient available source asset balance'; end if;
 end if;
 insert into public.nexbit_spot_trades(user_id,idempotency_key,action,from_asset,to_asset,input_amount,gross_output,fee_amount,fee_asset,net_output,from_price_usdt,to_price_usdt,quote_at)
 values(p_user_id,p_idempotency_key,v_action,v_from,v_to,v_input,v_gross,v_fee,v_fee_asset,v_net,v_from_price,v_to_price,p_quote_at)
 returning id,reference into v_trade_id,v_reference;
 if v_action='buy' then
   v_main_after:=v_main_before-(v_input*v_to_price);
   update public.nexbit_account_balances set balance=v_main_after,updated_at=now() where user_id=p_user_id;
   v_asset_after:=v_asset_before+v_net;
   update public.nexbit_account_asset_balances set balance=v_asset_after,updated_at=now() where user_id=p_user_id and asset_code=v_to;
   insert into public.nexbit_spot_trade_ledger(trade_id,user_id,account_type,asset_code,change_amount,balance_before,balance_after)
   values(v_trade_id,p_user_id,'main','USD',-(v_input*v_to_price),v_main_before,v_main_after),(v_trade_id,p_user_id,'asset',v_to,v_net,v_asset_before,v_asset_after);
 elsif v_action='sell' then
   v_asset_after:=v_asset_before-v_input;
   update public.nexbit_account_asset_balances set balance=v_asset_after,updated_at=now() where user_id=p_user_id and asset_code=v_from;
   v_main_after:=v_main_before+v_net;
   update public.nexbit_account_balances set balance=v_main_after,updated_at=now() where user_id=p_user_id;
   insert into public.nexbit_spot_trade_ledger(trade_id,user_id,account_type,asset_code,change_amount,balance_before,balance_after)
   values(v_trade_id,p_user_id,'asset',v_from,-v_input,v_asset_before,v_asset_after),(v_trade_id,p_user_id,'main','USD',v_net,v_main_before,v_main_after);
 else
   v_asset_after:=v_asset_before-v_input;
   update public.nexbit_account_asset_balances set balance=v_asset_after,updated_at=now() where user_id=p_user_id and asset_code=v_from;
   v_before:=v_main_before; v_after:=v_before+v_net;
   update public.nexbit_account_asset_balances set balance=v_after,updated_at=now() where user_id=p_user_id and asset_code=v_to;
   insert into public.nexbit_spot_trade_ledger(trade_id,user_id,account_type,asset_code,change_amount,balance_before,balance_after)
   values(v_trade_id,p_user_id,'asset',v_from,-v_input,v_asset_before,v_asset_after),(v_trade_id,p_user_id,'asset',v_to,v_net,v_before,v_after);
 end if;
 insert into public.nexbit_transactions(user_id,transaction_type,asset_code,amount,reference,status,notes,metadata)
 values(p_user_id,'trade',v_to,v_gross,v_reference,'completed','Spot '||initcap(v_action),
 jsonb_build_object('trade_id',v_trade_id,'action',v_action,'from_asset',v_from,'to_asset',v_to,'input_amount',v_input,'gross_output',v_gross,'fee_rate',0.001,'fee_amount',v_fee,'fee_asset',v_fee_asset,'net_output',v_net,'from_price_usdt',v_from_price,'to_price_usdt',v_to_price,'quote_at',p_quote_at));
 return jsonb_build_object('success',true,'reference',v_reference,'action',v_action,'inputAmount',v_input,'grossOutput',v_gross,'feeAmount',v_fee,'feeAsset',v_fee_asset,'netOutput',v_net);
end; $function$


revoke all on function public.nexbit_execute_spot_trade(uuid,text,text,text,numeric,numeric,numeric,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.nexbit_execute_spot_trade(uuid,text,text,text,numeric,numeric,numeric,timestamptz,uuid) to service_role;
