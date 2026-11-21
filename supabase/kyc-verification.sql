-- NEXBIT KYC submission and administrator review
-- Run this entire file in Supabase SQL Editor.
create table if not exists public.nexbit_kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legal_name text not null,
  residential_address text not null,
  phone_number text not null,
  document_paths jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','resubmission_required')),
  admin_comment text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nexbit_kyc_user_created_idx on public.nexbit_kyc_submissions(user_id, created_at desc);
create index if not exists nexbit_kyc_status_created_idx on public.nexbit_kyc_submissions(status, created_at desc);
alter table public.nexbit_kyc_submissions enable row level security;
revoke all on public.nexbit_kyc_submissions from anon, authenticated;
grant select on public.nexbit_kyc_submissions to authenticated;
drop policy if exists "Users can view own KYC submissions" on public.nexbit_kyc_submissions;
create policy "Users can view own KYC submissions" on public.nexbit_kyc_submissions
for select to authenticated using (user_id = auth.uid());

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('nexbit-kyc-documents','nexbit-kyc-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "KYC users upload to own folder" on storage.objects;
create policy "KYC users upload to own folder" on storage.objects
for insert to authenticated with check (
 bucket_id='nexbit-kyc-documents' and (storage.foldername(name))[1]=auth.uid()::text
);
drop policy if exists "KYC users view own files" on storage.objects;
create policy "KYC users view own files" on storage.objects
for select to authenticated using (
 bucket_id='nexbit-kyc-documents' and (
   (storage.foldername(name))[1]=auth.uid()::text
   or (lower(coalesce(auth.jwt()->>'email',''))='markleslie.corp@gmail.com'
       and coalesce(auth.jwt()->'app_metadata'->>'role','')='admin')
 )
);

create or replace function public.nexbit_submit_kyc(
 p_legal_name text, p_residential_address text, p_phone_number text, p_document_paths jsonb
) returns uuid
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_id uuid; v_uid uuid := auth.uid();
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if length(trim(coalesce(p_legal_name,''))) < 3 then raise exception 'Enter your full legal name'; end if;
 if length(trim(coalesce(p_residential_address,''))) < 8 then raise exception 'Enter your residential address'; end if;
 if length(trim(coalesce(p_phone_number,''))) < 7 then raise exception 'Enter a valid phone number'; end if;
 if jsonb_typeof(p_document_paths) <> 'object'
    or coalesce(p_document_paths->>'id_front','') = ''
    or coalesce(p_document_paths->>'selfie','') = '' then
   raise exception 'Government ID front and selfie are required';
 end if;
 if exists(select 1 from jsonb_each_text(p_document_paths) d
   where split_part(d.value,'/',1) <> v_uid::text) then
   raise exception 'Invalid document path';
 end if;
 if exists(select 1 from public.nexbit_kyc_submissions
   where user_id=v_uid and status in ('pending','approved')) then
   raise exception 'A KYC application is already pending or approved';
 end if;
 insert into public.nexbit_kyc_submissions(user_id,legal_name,residential_address,phone_number,document_paths,status,admin_comment,reviewed_by,reviewed_at)
 values(v_uid,trim(p_legal_name),trim(p_residential_address),trim(p_phone_number),p_document_paths,'pending',null,null,null)
 returning id into v_id;
 return v_id;
end $$;

create or replace function public.admin_list_kyc_submissions(p_status text default null)
returns table(
 id uuid,user_id uuid,legal_name text,residential_address text,phone_number text,
 document_paths jsonb,status text,admin_comment text,created_at timestamptz,reviewed_at timestamptz
)
language plpgsql security definer set search_path=public,auth,pg_temp as $$
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com'
    or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
   raise exception 'Administrator access required';
 end if;
 return query select k.id,k.user_id,k.legal_name,k.residential_address,k.phone_number,
   k.document_paths,k.status,k.admin_comment,k.created_at,k.reviewed_at
 from public.nexbit_kyc_submissions k
 where p_status is null or k.status=p_status
 order by k.created_at desc limit 300;
end $$;

create or replace function public.admin_review_kyc(
 p_id uuid,p_status text,p_comment text default null
) returns void
language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare v_uid uuid := auth.uid();
begin
 if lower(coalesce(auth.jwt()->>'email','')) <> 'markleslie.corp@gmail.com'
    or coalesce(auth.jwt()->'app_metadata'->>'role','') <> 'admin' then
   raise exception 'Administrator access required';
 end if;
 if p_status not in ('approved','rejected','resubmission_required') then
   raise exception 'Invalid KYC review decision';
 end if;
 if p_status in ('rejected','resubmission_required') and length(trim(coalesce(p_comment,''))) < 3 then
   raise exception 'A review comment is required for this decision';
 end if;
 update public.nexbit_kyc_submissions
 set status=p_status,admin_comment=nullif(trim(coalesce(p_comment,'')),''),reviewed_by=v_uid,reviewed_at=now(),updated_at=now()
 where id=p_id;
 if not found then raise exception 'KYC application not found'; end if;
 insert into public.nexbit_admin_audit_logs(actor_user_id,action,entity_type,entity_id,details)
 values(v_uid,'kyc_review','kyc_submission',p_id,
   jsonb_build_object('status',p_status,'comment',nullif(trim(coalesce(p_comment,'')),'')));
end $$;

revoke all on function public.nexbit_submit_kyc(text,text,text,jsonb) from public,anon;
revoke all on function public.admin_list_kyc_submissions(text) from public,anon;
revoke all on function public.admin_review_kyc(uuid,text,text) from public,anon;
grant execute on function public.nexbit_submit_kyc(text,text,text,jsonb) to authenticated;
grant execute on function public.admin_list_kyc_submissions(text) to authenticated;
grant execute on function public.admin_review_kyc(uuid,text,text) to authenticated;
