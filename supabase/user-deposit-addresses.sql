-- NEXBIT: Secure read-only list of active deposit addresses for signed-in users.
-- Run this file in Supabase SQL Editor as the project owner.
-- This function only displays configured addresses. It does not verify or credit deposits.

create or replace function public.nexbit_list_active_deposit_addresses()
returns table (
  asset_code text,
  network text,
  address text,
  label text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return query
    select d.asset_code, d.network, d.address, d.label
    from public.nexbit_deposit_addresses d
    where d.is_active = true
      and (
        (d.asset_code = 'BTC' and lower(d.network) = 'bitcoin')
        or (d.asset_code = 'ETH' and lower(d.network) = 'ethereum')
        or (d.asset_code = 'USDT' and lower(d.network) in ('ethereum', 'ton'))
        or (d.asset_code = 'XRP' and lower(d.network) = 'xrp ledger')
        or (d.asset_code = 'SOL' and lower(d.network) = 'solana')
      )
    order by
      case
        when d.asset_code = 'BTC' then 1
        when d.asset_code = 'ETH' then 2
        when d.asset_code = 'USDT' and lower(d.network) = 'ethereum' then 3
        when d.asset_code = 'USDT' and lower(d.network) = 'ton' then 4
        when d.asset_code = 'XRP' then 5
        when d.asset_code = 'SOL' then 6
        else 7
      end;
end;
$$;

revoke all on function public.nexbit_list_active_deposit_addresses() from public, anon;
grant execute on function public.nexbit_list_active_deposit_addresses() to authenticated;
