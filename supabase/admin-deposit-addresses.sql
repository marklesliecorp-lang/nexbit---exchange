-- NEXBIT Admin: Deposit Address Management
-- Run this entire file in Supabase SQL Editor as the project owner.
-- Addresses are stored as configuration only; this does not process deposits or move funds.

create table if not exists public.nexbit_deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null,
  network text not null,
  address text not null,
  label text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint nexbit_deposit_asset_format check (asset_code ~ '^[A-Z0-9]{2,12}$'),
  constraint nexbit_deposit_address_length check (length(btrim(address)) between 8 and 256),
  constraint nexbit_deposit_network_length check (length(btrim(network)) between 2 and 40)
);

create table if not exists public.nexbit_admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.nexbit_deposit_addresses enable row level security;
alter table public.nexbit_admin_audit_logs enable row level security;
revoke all on public.nexbit_deposit_addresses from anon, authenticated;
revoke all on public.nexbit_admin_audit_logs from anon, authenticated;

create or replace function public.admin_list_deposit_addresses()
returns table (
  id uuid,
  asset_code text,
  network text,
  address text,
  label text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'markleslie.corp@gmail.com' then
    raise exception 'Administrator access required';
  end if;

  return query
    select d.id, d.asset_code, d.network, d.address, d.label,
           d.is_active, d.created_at, d.updated_at
    from public.nexbit_deposit_addresses d
    order by d.asset_code, d.network, d.created_at desc;
end;
$$;

create or replace function public.admin_save_deposit_address(
  p_id uuid,
  p_asset_code text,
  p_network text,
  p_address text,
  p_label text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'markleslie.corp@gmail.com' then
    raise exception 'Administrator access required';
  end if;

  if p_asset_code is null or upper(btrim(p_asset_code)) !~ '^[A-Z0-9]{2,12}$'
     or p_network is null or length(btrim(p_network)) not between 2 and 40
     or p_address is null or length(btrim(p_address)) not between 8 and 256 then
    raise exception 'Enter a valid asset, network and deposit address';
  end if;

  if p_id is null then
    insert into public.nexbit_deposit_addresses
      (asset_code, network, address, label, is_active, created_by, updated_by)
    values
      (upper(btrim(p_asset_code)), btrim(p_network), btrim(p_address),
       coalesce(btrim(p_label), ''), true, auth.uid(), auth.uid())
    returning id into v_id;
    v_old := null;
    v_new := jsonb_build_object('asset_code', upper(btrim(p_asset_code)),
      'network', btrim(p_network), 'address', btrim(p_address),
      'label', coalesce(btrim(p_label), ''), 'is_active', true);
    insert into public.nexbit_admin_audit_logs
      (actor_user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'deposit_address_created', 'deposit_address', v_id::text,
      jsonb_build_object('before', v_old, 'after', v_new));
  else
    select to_jsonb(d) into v_old
    from public.nexbit_deposit_addresses d where d.id = p_id;
    if v_old is null then raise exception 'Deposit address not found'; end if;

    update public.nexbit_deposit_addresses
    set asset_code = upper(btrim(p_asset_code)),
        network = btrim(p_network),
        address = btrim(p_address),
        label = coalesce(btrim(p_label), ''),
        updated_at = now(),
        updated_by = auth.uid()
    where id = p_id
    returning id, jsonb_build_object('asset_code', asset_code,
      'network', network, 'address', address, 'label', label,
      'is_active', is_active) into v_id, v_new;

    insert into public.nexbit_admin_audit_logs
      (actor_user_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'deposit_address_updated', 'deposit_address', v_id::text,
      jsonb_build_object('before', v_old, 'after', v_new));
  end if;

  return v_id;
end;
$$;

create or replace function public.admin_set_deposit_address_active(
  p_id uuid,
  p_is_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_old jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'markleslie.corp@gmail.com' then
    raise exception 'Administrator access required';
  end if;

  select to_jsonb(d) into v_old
  from public.nexbit_deposit_addresses d where d.id = p_id;
  if v_old is null then raise exception 'Deposit address not found'; end if;

  update public.nexbit_deposit_addresses
  set is_active = p_is_active, updated_at = now(), updated_by = auth.uid()
  where id = p_id;

  insert into public.nexbit_admin_audit_logs
    (actor_user_id, action, entity_type, entity_id, details)
  values (auth.uid(),
    case when p_is_active then 'deposit_address_activated'
         else 'deposit_address_deactivated' end,
    'deposit_address', p_id::text,
    jsonb_build_object('before', v_old, 'is_active', p_is_active));

  return true;
end;
$$;

revoke all on function public.admin_list_deposit_addresses() from public, anon;
revoke all on function public.admin_save_deposit_address(uuid, text, text, text, text) from public, anon;
revoke all on function public.admin_set_deposit_address_active(uuid, boolean) from public, anon;
grant execute on function public.admin_list_deposit_addresses() to authenticated;
grant execute on function public.admin_save_deposit_address(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_set_deposit_address_active(uuid, boolean) to authenticated;
