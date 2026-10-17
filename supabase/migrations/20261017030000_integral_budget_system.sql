-- Cúbica 3D: presupuestos comerciales versionados, PDF privado y conversiones internas.
-- Todas las operaciones administrativas se exponen únicamente mediante RPC con AAL2.

create sequence if not exists public.quote_number_seq;

alter table public.quotes
  add column if not exists quote_number text,
  add column if not exists status text not null default 'draft',
  add column if not exists current_version integer not null default 0,
  add column if not exists customer_name text not null default '',
  add column if not exists customer_email text not null default '',
  add column if not exists customer_phone text not null default '',
  add column if not exists customer_reference text not null default '',
  add column if not exists draft_data jsonb not null default '{}'::jsonb,
  add column if not exists total numeric not null default 0,
  add column if not exists valid_until date,
  add column if not exists issued_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists last_request_id uuid,
  add column if not exists source_local_id text,
  add column if not exists converted_order_id uuid,
  add column if not exists converted_product_id text;

update public.quotes set
  quote_number=coalesce(quote_number,'PRE-'||to_char(created_at at time zone 'America/Argentina/Buenos_Aires','YYYYMMDD')||'-'||lpad(nextval('public.quote_number_seq')::text,4,'0')),
  draft_data=case when draft_data='{}'::jsonb then jsonb_build_object('title',coalesce(title,'Presupuesto importado'),'legacy_data',data,'legacy_summary',summary,'items','[]'::jsonb) else draft_data end,
  customer_name=coalesce(nullif(customer_name,''),'Cliente'), updated_at=coalesce(updated_at,created_at)
where quote_number is null or draft_data='{}'::jsonb;

alter table public.quotes alter column quote_number set not null;
create unique index if not exists quotes_quote_number_key on public.quotes(quote_number);
create unique index if not exists quotes_source_local_id_key on public.quotes(source_local_id) where source_local_id is not null;
alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check check(status in ('draft','issued','accepted','rejected','converted'));
alter table public.quotes drop constraint if exists quotes_total_check;
alter table public.quotes add constraint quotes_total_check check(total>=0);

create table if not exists public.quote_versions(
  id uuid primary key default gen_random_uuid(),
  quote_id text not null references public.quotes(id) on delete restrict,
  version integer not null check(version>0),
  quote_number text not null,
  issued_at timestamptz not null default now(),
  valid_until date,
  snapshot jsonb not null,
  commercial_snapshot jsonb not null,
  total numeric not null check(total>=0),
  pdf_path text,
  pdf_sha256 text,
  created_by uuid references auth.users(id) on delete set null,
  unique(quote_id,version)
);

create table if not exists public.quote_status_history(
  id bigint generated always as identity primary key,
  quote_id text not null references public.quotes(id) on delete restrict,
  from_status text,
  to_status text not null,
  version integer not null default 0,
  actor_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quote_email_outbox(
  version_id uuid primary key references public.quote_versions(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','review')),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  lock_token uuid,
  locked_until timestamptz,
  first_send_at timestamptz,
  payload jsonb,
  provider_id text,
  last_error text
);

create table if not exists public.quote_conversions(
  id uuid primary key default gen_random_uuid(),
  quote_id text not null references public.quotes(id) on delete restrict,
  version_id uuid not null references public.quote_versions(id) on delete restrict,
  kind text not null check(kind in ('order','product')),
  destination_id text not null,
  request_id uuid not null unique,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(quote_id,kind)
);

create index if not exists quote_versions_quote on public.quote_versions(quote_id,version desc);
create index if not exists quote_history_quote on public.quote_status_history(quote_id,id desc);
create index if not exists quote_outbox_pending on public.quote_email_outbox(status,next_attempt_at);
create index if not exists quotes_admin_list on public.quotes(status,updated_at desc);

alter table public.quote_versions enable row level security;
alter table public.quote_status_history enable row level security;
alter table public.quote_email_outbox enable row level security;
alter table public.quote_conversions enable row level security;
drop policy if exists quote_versions_admin_all on public.quote_versions;
create policy quote_versions_admin_all on public.quote_versions for all to authenticated using((select private.is_admin())) with check((select private.is_admin()));
drop policy if exists quote_status_history_admin_all on public.quote_status_history;
create policy quote_status_history_admin_all on public.quote_status_history for all to authenticated using((select private.is_admin())) with check((select private.is_admin()));
drop policy if exists quote_email_outbox_no_client_access on public.quote_email_outbox;
create policy quote_email_outbox_no_client_access on public.quote_email_outbox for all to anon,authenticated using(false) with check(false);
drop policy if exists quote_conversions_admin_all on public.quote_conversions;
create policy quote_conversions_admin_all on public.quote_conversions for all to authenticated using((select private.is_admin())) with check((select private.is_admin()));
revoke all on public.quote_versions,public.quote_status_history,public.quote_email_outbox,public.quote_conversions from public,anon,authenticated;
grant select on public.quote_versions,public.quote_status_history,public.quote_conversions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('budget-documents','budget-documents',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists budget_documents_admin_read on storage.objects;
create policy budget_documents_admin_read on storage.objects for select to authenticated
using(bucket_id='budget-documents' and (select private.is_admin()));

create or replace function private.next_quote_number() returns text language sql volatile set search_path='' as $$
 select 'PRE-'||to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYYMMDD')||'-'||lpad(nextval('public.quote_number_seq')::text,4,'0');
$$;
revoke all on function private.next_quote_number() from public,anon,authenticated;

create or replace function private.quote_num(p jsonb,p_key text,p_min numeric default 0,p_max numeric default 100000000)
returns numeric language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
 if jsonb_typeof(p->p_key) not in ('number','string') then raise exception 'Campo numérico inválido: %',p_key; end if;
 begin v:=(p->>p_key)::numeric; exception when others then raise exception 'Campo numérico inválido: %',p_key; end;
 if v<p_min or v>p_max then raise exception 'Valor fuera de rango: %',p_key; end if;
 return v;
end;
$$;
revoke all on function private.quote_num(jsonb,text,numeric,numeric) from public,anon,authenticated;

create or replace function private.build_quote_snapshot(p_quote_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.quotes; item jsonb; supply_input jsonb; material public.supplies; extra public.supplies;
  items jsonb:='[]'::jsonb; commercial_items jsonb:='[]'::jsonb; extra_rows jsonb;
  qty numeric; weight numeric; hours numeric; watts numeric; kwh numeric; machine_rate numeric; failure numeric; prod_margin numeric; supply_margin numeric;
  material_cost numeric; electricity numeric; machine_cost numeric; supplies_cost numeric; production_cost numeric; subtotal numeric; fail_cost numeric;
  production_fail numeric; supplies_fail numeric; production_sale numeric; supplies_sale numeric; unit_sale numeric; line_total numeric; grand_total numeric:=0; idx integer:=0;
begin
 select * into q from public.quotes where id=p_quote_id;
 if not found then raise exception 'Presupuesto inexistente'; end if;
 if jsonb_typeof(q.draft_data->'items')<>'array' or jsonb_array_length(q.draft_data->'items')<1 or jsonb_array_length(q.draft_data->'items')>50 then raise exception 'El presupuesto debe tener entre 1 y 50 conceptos'; end if;
 for item in select value from jsonb_array_elements(q.draft_data->'items') loop
  idx:=idx+1;
  if length(btrim(coalesce(item->>'title','')))<2 or length(item->>'title')>180 then raise exception 'Título de concepto inválido'; end if;
  qty:=private.quote_num(item,'quantity',1,100000); weight:=private.quote_num(item,'weight_g',0,10000000);
  hours:=private.quote_num(item,'print_hours',0,100000); watts:=private.quote_num(item,'printer_watts',0,100000);
  kwh:=private.quote_num(item,'electricity_ars_kwh',0,10000000); machine_rate:=private.quote_num(item,'machine_ars_hour',0,10000000);
  failure:=private.quote_num(item,'failure_pct',0,100)/100; prod_margin:=private.quote_num(item,'production_margin_pct',0,10000)/100;
  supply_margin:=private.quote_num(item,'supplies_margin_pct',0,10000)/100;
  select * into material from public.supplies where id=item->>'material_id' and active;
  if not found or not lower(coalesce(material.category,'')) like 'filamento%' then raise exception 'Filamento inválido en concepto %',idx; end if;
  material_cost:=weight/1000*material.cost; electricity:=watts/1000*hours*kwh; machine_cost:=hours*machine_rate;
  supplies_cost:=0; extra_rows:='[]'::jsonb;
  if coalesce(jsonb_typeof(item->'supplies'),'array')<>'array' or jsonb_array_length(coalesce(item->'supplies','[]'::jsonb))>100 then raise exception 'Insumos inválidos'; end if;
  for supply_input in select value from jsonb_array_elements(coalesce(item->'supplies','[]'::jsonb)) loop
   select * into extra from public.supplies where id=supply_input->>'supply_id' and active;
   if not found then raise exception 'Insumo inválido en concepto %',idx; end if;
   qty:=private.quote_num(supply_input,'quantity',0,10000000);
   supplies_cost:=supplies_cost+extra.cost*qty;
   extra_rows:=extra_rows||jsonb_build_array(jsonb_build_object('supply_id',extra.id,'name',extra.name,'unit',extra.unit,'quantity',qty,'unit_cost',extra.cost,'cost',extra.cost*qty));
  end loop;
  qty:=private.quote_num(item,'quantity',1,100000);
  production_cost:=material_cost+electricity+machine_cost; subtotal:=production_cost+supplies_cost; fail_cost:=subtotal*failure;
  production_fail:=case when subtotal>0 then fail_cost*production_cost/subtotal else 0 end;
  supplies_fail:=case when subtotal>0 then fail_cost*supplies_cost/subtotal else 0 end;
  production_sale:=(production_cost+production_fail)*(1+prod_margin); supplies_sale:=(supplies_cost+supplies_fail)*(1+supply_margin);
  unit_sale:=round(production_sale+supplies_sale,2); line_total:=round(unit_sale*qty,2); grand_total:=grand_total+line_total;
  items:=items||jsonb_build_array(item||jsonb_build_object('position',idx,'quantity',qty,'material',jsonb_build_object('supply_id',material.id,'name',material.name,'unit_cost',material.cost,'weight_g',weight,'cost',material_cost),'supplies',extra_rows,'calculation',jsonb_build_object('material_cost',material_cost,'electricity_cost',electricity,'machine_cost',machine_cost,'supplies_cost',supplies_cost,'production_cost',production_cost,'subtotal',subtotal,'failure_cost',fail_cost,'production_failure_cost',production_fail,'supplies_failure_cost',supplies_fail,'production_margin_pct',prod_margin*100,'supplies_margin_pct',supply_margin*100,'production_sale',production_sale,'supplies_sale',supplies_sale,'unit_price',unit_sale,'line_total',line_total)));
  commercial_items:=commercial_items||jsonb_build_array(jsonb_build_object('position',idx,'title',item->>'title','description',left(coalesce(item->>'description',''),2000),'quantity',qty,'material',material.name,'color',left(coalesce(item->>'color',''),120),'unit_price',unit_sale,'line_total',line_total,'customer_notes',left(coalesce(item->>'customer_notes',''),2000)));
 end loop;
 return jsonb_build_object('quote_id',q.id,'quote_number',q.quote_number,'title',left(coalesce(q.draft_data->>'title',q.title,'Presupuesto'),180),'customer',jsonb_build_object('name',q.customer_name,'email',q.customer_email,'phone',q.customer_phone,'reference',q.customer_reference),'items',items,'commercial',jsonb_build_object('quote_number',q.quote_number,'title',left(coalesce(q.draft_data->>'title',q.title,'Presupuesto'),180),'customer_name',q.customer_name,'items',commercial_items,'total',round(grand_total,2),'manufacturing_time',left(coalesce(q.draft_data->>'manufacturing_time','A coordinar'),300),'payment_terms',left(coalesce(q.draft_data->>'payment_terms','A coordinar'),1000),'delivery_terms',left(coalesce(q.draft_data->>'delivery_terms','A coordinar'),1000),'commercial_notes',left(coalesce(q.draft_data->>'commercial_notes',''),2000),'valid_until',q.valid_until),'total',round(grand_total,2),'internal_notes',left(coalesce(q.draft_data->>'internal_notes',''),4000));
end;
$$;
revoke all on function private.build_quote_snapshot(text) from public,anon,authenticated;

create or replace function public.save_admin_quote_draft(p_data jsonb,p_quote_id text default null,p_expected_updated_at timestamptz default null,p_request_id uuid default gen_random_uuid(),p_source_local_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; v_id text:=coalesce(nullif(p_quote_id,''),gen_random_uuid()::text); snap jsonb; email text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 if jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>500000 then raise exception 'Datos de presupuesto inválidos'; end if;
 if length(btrim(coalesce(p_data#>>'{customer,name}','')))<2 then raise exception 'Ingresá el nombre del cliente'; end if;
 email:=lower(btrim(coalesce(p_data#>>'{customer,email}','')));
 if email<>'' and email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Email inválido'; end if;
 select * into q from public.quotes where quotes.id=v_id for update;
 if found then
  if q.last_request_id=p_request_id then return public.get_admin_quote(v_id); end if;
  if q.status<>'draft' then raise exception 'Creá una revisión antes de editar un presupuesto emitido'; end if;
  if p_expected_updated_at is null or q.updated_at<>p_expected_updated_at then raise exception 'El presupuesto cambió. Actualizá la vista.'; end if;
  update public.quotes set title=left(coalesce(p_data->>'title','Presupuesto'),180),customer_name=left(p_data#>>'{customer,name}',180),customer_email=left(email,320),customer_phone=left(coalesce(p_data#>>'{customer,phone}',''),80),customer_reference=left(coalesce(p_data#>>'{customer,reference}',''),120),draft_data=p_data,valid_until=nullif(p_data->>'valid_until','')::date,updated_at=clock_timestamp(),updated_by=auth.uid(),last_request_id=p_request_id where quotes.id=v_id returning * into q;
 else
  insert into public.quotes(id,quote_number,title,data,summary,created_by,updated_by,customer_name,customer_email,customer_phone,customer_reference,draft_data,valid_until,last_request_id,source_local_id)
  values(v_id,private.next_quote_number(),left(coalesce(p_data->>'title','Presupuesto'),180),'{}','',auth.uid(),auth.uid(),left(p_data#>>'{customer,name}',180),left(email,320),left(coalesce(p_data#>>'{customer,phone}',''),80),left(coalesce(p_data#>>'{customer,reference}',''),120),p_data,nullif(p_data->>'valid_until','')::date,p_request_id,nullif(p_source_local_id,'')) returning * into q;
  insert into public.quote_status_history(quote_id,to_status,actor_id,details) values(q.id,'draft',auth.uid(),jsonb_build_object('source',case when p_source_local_id is null then 'admin' else 'local_import' end));
 end if;
 snap:=private.build_quote_snapshot(q.id);
 update public.quotes set data=snap,total=(snap->>'total')::numeric,summary='Presupuesto '||quote_number||' · '||customer_name||' · $'||(snap->>'total'),updated_at=clock_timestamp() where id=q.id;
 return public.get_admin_quote(q.id);
end;
$$;

create or replace function public.get_admin_quote(p_quote_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 select to_jsonb(q)||jsonb_build_object('effective_status',case when q.status='issued' and q.valid_until<current_date then 'expired' else q.status end,'versions',coalesce((select jsonb_agg(to_jsonb(v)-'snapshot'-'commercial_snapshot' order by v.version desc) from public.quote_versions v where v.quote_id=q.id),'[]'::jsonb),'current_snapshot',(select v.snapshot from public.quote_versions v where v.quote_id=q.id and v.version=q.current_version),'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.id desc) from public.quote_status_history h where h.quote_id=q.id),'[]'::jsonb),'conversions',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.quote_conversions c where c.quote_id=q.id),'[]'::jsonb),'email',coalesce((select to_jsonb(e) from public.quote_email_outbox e join public.quote_versions v on v.id=e.version_id where v.quote_id=q.id order by v.version desc limit 1),'null'::jsonb)) into result from public.quotes q where q.id=p_quote_id;
 if result is null then raise exception 'Presupuesto inexistente'; end if; return result;
end;
$$;

create or replace function public.get_admin_quotes(p_limit integer default 10,p_offset integer default 0,p_search text default '',p_status text default 'all',p_from date default null,p_to date default null,p_sort text default 'updated_desc') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 if p_limit not in (10,25,50) or p_offset<0 then raise exception 'Paginación inválida'; end if;
 if p_status not in ('all','draft','issued','accepted','rejected','expired','converted') then raise exception 'Estado inválido'; end if;
 if p_sort not in ('updated_desc','updated_asc','total_desc','total_asc','number_desc','number_asc') then raise exception 'Orden inválido'; end if;
 with filtered as(select q.*,case when q.status='issued' and q.valid_until<current_date then 'expired' else q.status end effective_status from public.quotes q where
  (btrim(coalesce(p_search,''))='' or q.quote_number ilike '%'||p_search||'%' or q.customer_name ilike '%'||p_search||'%' or q.title ilike '%'||p_search||'%')
  and (p_from is null or q.created_at>=p_from) and (p_to is null or q.created_at<p_to+1)
 ), scoped as(select * from filtered where p_status='all' or effective_status=p_status), page as(select * from scoped order by
  case when p_sort='updated_desc' then updated_at end desc,case when p_sort='updated_asc' then updated_at end asc,
  case when p_sort='total_desc' then total end desc,case when p_sort='total_asc' then total end asc,
  case when p_sort='number_desc' then quote_number end desc,case when p_sort='number_asc' then quote_number end asc,id limit p_limit offset p_offset)
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page)-'data'-'draft_data' order by
  case when p_sort='updated_desc' then updated_at end desc,case when p_sort='updated_asc' then updated_at end asc,
  case when p_sort='total_desc' then total end desc,case when p_sort='total_asc' then total end asc,
  case when p_sort='number_desc' then quote_number end desc,case when p_sort='number_asc' then quote_number end asc),'[]'::jsonb),'total',(select count(*) from scoped)) into result from page;
 return result;
end;
$$;

create or replace function public.create_admin_quote_revision(p_quote_id text,p_expected_updated_at timestamptz,p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception 'Presupuesto inexistente'; end if;
 if q.last_request_id=p_request_id then return public.get_admin_quote(q.id); end if;
 if q.updated_at<>p_expected_updated_at then raise exception 'El presupuesto cambió. Actualizá la vista.'; end if;
 if q.status not in ('issued','rejected') then raise exception 'Solo un presupuesto emitido o rechazado admite revisión'; end if;
 update public.quotes set status='draft',issued_at=null,accepted_at=null,rejected_at=null,updated_at=clock_timestamp(),updated_by=auth.uid(),last_request_id=p_request_id where id=q.id;
 insert into public.quote_status_history(quote_id,from_status,to_status,version,actor_id,details) values(q.id,q.status,'draft',q.current_version,auth.uid(),jsonb_build_object('action','new_revision'));
 return public.get_admin_quote(q.id);
end;
$$;

create or replace function public.emit_admin_quote(p_quote_id text,p_expected_updated_at timestamptz,p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes; snap jsonb; v public.quote_versions;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception 'Presupuesto inexistente'; end if;
 if q.last_request_id=p_request_id then return public.get_admin_quote(q.id); end if;
 if q.updated_at<>p_expected_updated_at then raise exception 'El presupuesto cambió. Actualizá la vista.'; end if;
 if q.status<>'draft' then raise exception 'Solo se puede emitir un borrador'; end if;
 snap:=private.build_quote_snapshot(q.id);
 insert into public.quote_versions(quote_id,version,quote_number,valid_until,snapshot,commercial_snapshot,total,created_by)
 values(q.id,q.current_version+1,q.quote_number,q.valid_until,snap,snap->'commercial',(snap->>'total')::numeric,auth.uid()) returning * into v;
 update public.quotes set status='issued',current_version=v.version,issued_at=v.issued_at,total=v.total,data=snap,updated_at=clock_timestamp(),updated_by=auth.uid(),last_request_id=p_request_id where id=q.id;
 insert into public.quote_email_outbox(version_id) values(v.id) on conflict do nothing;
 insert into public.quote_status_history(quote_id,from_status,to_status,version,actor_id) values(q.id,'draft','issued',v.version,auth.uid());
 return public.get_admin_quote(q.id);
end;
$$;

create or replace function public.set_admin_quote_status(p_quote_id text,p_status text,p_expected_updated_at timestamptz,p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes; effective text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 if p_status not in ('accepted','rejected') then raise exception 'Estado inválido'; end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception 'Presupuesto inexistente'; end if;
 if q.last_request_id=p_request_id then return public.get_admin_quote(q.id); end if;
 if q.updated_at<>p_expected_updated_at then raise exception 'El presupuesto cambió. Actualizá la vista.'; end if;
 effective:=case when q.status='issued' and q.valid_until<current_date then 'expired' else q.status end;
 if effective not in ('issued','expired') then raise exception 'Solo un presupuesto emitido puede aceptarse o rechazarse'; end if;
 update public.quotes set status=p_status,accepted_at=case when p_status='accepted' then now() end,rejected_at=case when p_status='rejected' then now() end,updated_at=clock_timestamp(),updated_by=auth.uid(),last_request_id=p_request_id where id=q.id;
 insert into public.quote_status_history(quote_id,from_status,to_status,version,actor_id) values(q.id,effective,p_status,q.current_version,auth.uid());
 return public.get_admin_quote(q.id);
end;
$$;

alter table public.orders add column if not exists origin text not null default 'store';
alter table public.orders add column if not exists quote_id text references public.quotes(id) on delete restrict;
alter table public.orders add column if not exists quote_version integer;
alter table public.orders add column if not exists commercial_status text not null default 'store_checkout';
alter table public.order_items add column if not exists recipe_snapshot jsonb not null default '[]'::jsonb;
alter table public.orders drop constraint if exists orders_origin_check;
alter table public.orders add constraint orders_origin_check check(origin in ('store','budget'));
alter table public.orders drop constraint if exists orders_commercial_status_check;
alter table public.orders add constraint orders_commercial_status_check check(commercial_status in ('store_checkout','accepted_unpaid','paid','cancelled'));
create unique index if not exists orders_quote_conversion_key on public.orders(quote_id) where origin='budget';
alter table public.quotes drop constraint if exists quotes_converted_order_id_fkey;
alter table public.quotes add constraint quotes_converted_order_id_fkey foreign key(converted_order_id) references public.orders(id) on delete set null;
alter table public.quotes drop constraint if exists quotes_converted_product_id_fkey;
alter table public.quotes add constraint quotes_converted_product_id_fkey foreign key(converted_product_id) references public.products(id) on delete set null;

create or replace function public.convert_admin_quote_to_product(p_quote_id text,p_name text,p_description text,p_category text default null,p_recipe jsonb default '[]'::jsonb,p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes; v public.quote_versions; pid text:=gen_random_uuid()::text; r jsonb; prior text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 select destination_id into prior from public.quote_conversions where request_id=p_request_id; if found then return jsonb_build_object('product_id',prior,'idempotent',true); end if;
 select * into q from public.quotes where id=p_quote_id for update; if not found then raise exception 'Presupuesto inexistente'; end if;
 if q.status<>'accepted' then raise exception 'El presupuesto debe estar aceptado'; end if;
 if exists(select 1 from public.quote_conversions where quote_id=q.id and kind='product') then raise exception 'El presupuesto ya fue convertido en producto'; end if;
 select * into v from public.quote_versions where quote_id=q.id and version=q.current_version;
 if length(btrim(coalesce(p_name,'')))<2 then raise exception 'Nombre inválido'; end if;
 if jsonb_typeof(p_recipe)<>'array' then raise exception 'Receta inválida'; end if;
 perform set_config('cubica.inventory_order','quote-product:'||q.id,true);
 insert into public.products(id,name,category,description,price,stock,color_mode,active,published,sort_order)
 values(pid,left(p_name,160),nullif(p_category,''),left(coalesce(p_description,''),1200),v.total,0,'single',true,false,coalesce((select max(sort_order)+10 from public.products),10));
 for r in select value from jsonb_array_elements(p_recipe) loop
  if not exists(select 1 from public.supplies where id=r->>'supply_id') or (r->>'qty_per_unit')::numeric<=0 then raise exception 'Receta inválida'; end if;
  insert into public.product_recipes(product_id,supply_id,qty_per_unit) values(pid,r->>'supply_id',(r->>'qty_per_unit')::numeric);
 end loop;
 perform set_config('cubica.inventory_order','',true);
 insert into public.quote_conversions(quote_id,version_id,kind,destination_id,request_id,actor_id) values(q.id,v.id,'product',pid,p_request_id,auth.uid());
 update public.quotes set status='converted',converted_at=now(),converted_product_id=pid,updated_at=clock_timestamp(),updated_by=auth.uid() where id=q.id;
 insert into public.quote_status_history(quote_id,from_status,to_status,version,actor_id,details) values(q.id,'accepted','converted',q.current_version,auth.uid(),jsonb_build_object('kind','product','destination_id',pid));
 return jsonb_build_object('product_id',pid,'published',false,'stock',0);
end;
$$;

create or replace function public.convert_admin_quote_to_order(p_quote_id text,p_request_id uuid default gen_random_uuid()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.quotes; v public.quote_versions; o public.orders; item jsonb; recipe jsonb:='[]'::jsonb; s jsonb; prior text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
 select destination_id into prior from public.quote_conversions where request_id=p_request_id; if found then return jsonb_build_object('order_id',prior,'idempotent',true); end if;
 select * into q from public.quotes where id=p_quote_id for update; if not found then raise exception 'Presupuesto inexistente'; end if;
 if q.status<>'accepted' then raise exception 'El presupuesto debe estar aceptado'; end if;
 if exists(select 1 from public.quote_conversions where quote_id=q.id and kind='order') then raise exception 'El presupuesto ya fue convertido en pedido'; end if;
 select * into v from public.quote_versions where quote_id=q.id and version=q.current_version;
 perform set_config('cubica.lifecycle_order','quote-conversion:'||q.id,true);
 insert into public.orders(user_id,customer_name,customer_email,phone,payment,notes,total,status,username,origin,quote_id,quote_version,commercial_status)
 values(null,q.customer_name,q.customer_email,q.customer_phone,'A coordinar','Pedido interno desde '||q.quote_number,v.total,'Pendiente','admin', 'budget',q.id,q.current_version,'accepted_unpaid') returning * into o;
 for item in select value from jsonb_array_elements(v.snapshot->'items') loop
  recipe:='[]'::jsonb;
  if coalesce((item#>>'{material,weight_g}')::numeric,0)>0 then recipe:=recipe||jsonb_build_array(jsonb_build_object('supply_id',item#>>'{material,supply_id}','name',item#>>'{material,name}','unit','gramos','qty_per_unit',(item#>>'{material,weight_g}')::numeric)); end if;
  for s in select value from jsonb_array_elements(coalesce(item->'supplies','[]'::jsonb)) loop
   recipe:=recipe||jsonb_build_array(jsonb_build_object('supply_id',s->>'supply_id','name',s->>'name','unit',s->>'unit','qty_per_unit',(s->>'quantity')::numeric));
  end loop;
  insert into public.order_items(order_id,product_id,name,color,qty,unit_price,recipe_snapshot)
  values(o.id,null,item->>'title',coalesce(item->>'color',''),(item->>'quantity')::integer,(item#>>'{calculation,unit_price}')::numeric,recipe);
 end loop;
 perform set_config('cubica.lifecycle_order','',true);
 insert into public.quote_conversions(quote_id,version_id,kind,destination_id,request_id,actor_id) values(q.id,v.id,'order',o.id::text,p_request_id,auth.uid());
 update public.quotes set status='converted',converted_at=now(),converted_order_id=o.id,updated_at=clock_timestamp(),updated_by=auth.uid() where id=q.id;
 insert into public.quote_status_history(quote_id,from_status,to_status,version,actor_id,details) values(q.id,'accepted','converted',q.current_version,auth.uid(),jsonb_build_object('kind','order','destination_id',o.id));
 return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'origin','budget','commercial_status','accepted_unpaid');
end;
$$;

create or replace function private.enqueue_order_emails() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.origin<>'store' or new.created_at<transaction_timestamp()-interval '5 minutes' or not exists(select 1 from public.order_items where order_id=new.id) then return new; end if;
 begin insert into public.order_email_outbox(order_id,kind) values(new.id,'customer'),(new.id,'internal') on conflict do nothing;
 exception when others then
  begin update public.orders set email_errors=(case when jsonb_typeof(email_errors)='array' then email_errors else '[]'::jsonb end)||jsonb_build_array(jsonb_build_object('kind','queue','code','enqueue_failed','at',now())) where id=new.id; exception when others then null; end;
  raise warning 'No se pudo encolar email de pedido';
 end;
 return new;
end;
$$;

create or replace function public.claim_my_guest_orders() returns integer language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); verified_email text; claimed integer;
begin
 if uid is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 select lower(u.email) into verified_email from auth.users u where u.id=uid and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and lower(u.email)=lower(coalesce(auth.jwt()->>'email',''));
 if nullif(verified_email,'') is null then return 0; end if;
 update public.orders set user_id=uid where origin='store' and user_id is null and lower(customer_email)=verified_email;
 get diagnostics claimed=row_count; return claimed;
end;
$$;

create or replace function public.get_customer_orders() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'user_id',o.user_id,'created_at',o.created_at,'customer_name',o.customer_name,'customer_email',o.customer_email,'phone',o.phone,'payment',o.payment,'notes',o.notes,'total',o.total,'status',case when o.status='Preparado' then 'Listo para entregar' when o.status in ('Entregado','Cancelado') then o.status else 'Pedido recibido' end,'delivery',private.customer_delivery(o.id),'order_items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'name',i.name,'color',i.color,'qty',i.qty,'unit_price',i.unit_price)),'[]'::jsonb) from public.order_items i where i.order_id=o.id)) order by o.created_at desc),'[]'::jsonb)
 from public.orders o where o.origin='store' and o.user_id=(select auth.uid());
$$;

drop policy if exists cubica_customer_read_own_orders on public.orders;
drop policy if exists orders_owner_read on public.orders;
create policy orders_owner_read on public.orders for select to authenticated using(origin='store' and user_id=(select auth.uid()));
drop policy if exists cubica_customer_read_own_order_items on public.order_items;
drop policy if exists order_items_owner_read on public.order_items;
create policy order_items_owner_read on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_items.order_id and o.origin='store' and o.user_id=(select auth.uid())));

create or replace function private.order_material_plan(p_order_id uuid) returns jsonb language sql stable set search_path='' as $$
with items as(select i.* from public.order_items i where i.order_id=p_order_id),
recipe_rows as(
 select i.id item_id,i.name,i.qty,r.supply_id,r.qty_per_unit from items i join public.product_recipes r on r.product_id=i.product_id where jsonb_array_length(i.recipe_snapshot)=0
 union all
 select i.id,i.name,i.qty,x->>'supply_id',(x->>'qty_per_unit')::numeric from items i cross join lateral jsonb_array_elements(i.recipe_snapshot) x where jsonb_array_length(i.recipe_snapshot)>0
), needed as(select supply_id,sum(qty_per_unit*qty) required from recipe_rows group by supply_id)
select jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('item_id',i.id,'product_id',i.product_id,'name',i.name,'qty',i.qty,'recipe_missing',not exists(select 1 from recipe_rows r where r.item_id=i.id)) order by i.id) from items i),'[]'::jsonb),'supplies',coalesce((select jsonb_agg(jsonb_build_object('supply_id',s.id,'name',s.name,'unit',s.unit,'required',n.required,'available',case when s.active then s.qty else 0 end,'physical_stock',s.qty,'inactive',not s.active,'missing',greatest(n.required-case when s.active then s.qty else 0 end,0)) order by s.id) from needed n join public.supplies s on s.id=n.supply_id),'[]'::jsonb));
$$;
revoke all on function private.order_material_plan(uuid) from public,anon,authenticated;

-- Extend the already deployed lifecycle RPC without duplicating its cancellation
-- logic: snapshot materials join the deterministic lock set and budget-ready
-- transitions never enqueue an email. Abort on drift instead of applying a
-- partial security patch to an unknown function body.
do $patch$
declare source text; changed text;
begin
 select pg_get_functiondef(p.oid) into source from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='change_order_status'
   and pg_get_function_identity_arguments(p.oid)='p_order_id uuid, p_status text, p_expected_version integer, p_accept_warnings boolean, p_plan_fingerprint text, p_cancellation jsonb';
 if source is null then raise exception 'No se encontró change_order_status esperado'; end if;
 changed:=replace(source,
$old$select r.supply_id from public.product_recipes r join public.order_items i on i.product_id=r.product_id where i.order_id=p_order_id$old$,
$new$select r.supply_id from public.product_recipes r join public.order_items i on i.product_id=r.product_id where i.order_id=p_order_id
      union
      select x->>'supply_id' from public.order_items i cross join lateral jsonb_array_elements(i.recipe_snapshot) x where i.order_id=p_order_id$new$);
 if changed=source then raise exception 'La función change_order_status cambió: no se aplicó el bloqueo de recetas congeladas'; end if;
 source:=changed;
 changed:=replace(source,
$old$if p_status='Preparado' and not v_order.ready_recorded then
    insert into public.order_email_outbox(order_id,kind) values(p_order_id,'ready') on conflict do nothing;
  end if;$old$,
$new$if p_status='Preparado' and not v_order.ready_recorded and v_order.origin='store' then
    insert into public.order_email_outbox(order_id,kind) values(p_order_id,'ready') on conflict do nothing;
  end if;$new$);
 if changed=source then raise exception 'La función change_order_status cambió: no se aplicó el aislamiento de emails'; end if;
 execute changed;
end
$patch$;

-- Patch only the ready notification at the database boundary. Production consumes
-- recipe_snapshot through private.order_material_plan; locks include snapshot supplies.
create or replace function private.block_budget_ready_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.origin='budget' and new.ready_recorded and not old.ready_recorded then
  delete from public.order_email_outbox where order_id=new.id and kind='ready';
 end if;
 return new;
end;
$$;
drop trigger if exists orders_block_budget_ready_email on public.orders;
create constraint trigger orders_block_budget_ready_email after update on public.orders deferrable initially deferred for each row execute function private.block_budget_ready_email();

-- Store-only commercial analytics and verified purchase are enforced by replacing
-- the source relation used by the existing routines.
create or replace view private.store_orders with (security_invoker=true) as select * from public.orders where origin='store';
revoke all on private.store_orders from public,anon,authenticated;

create or replace function private.get_product_community(p_product_id text,p_parent_id bigint default null,p_before_id bigint default null,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim integer:=greatest(1,least(coalesce(p_limit,10),20)); result jsonb;
begin
 if not exists(select 1 from public.products where id=p_product_id and active and published) then raise exception 'Producto no disponible'; end if;
 if p_parent_id is not null and not exists(select 1 from private.community_comments where id=p_parent_id and product_id=p_product_id and parent_id is null and status='published') then raise exception 'Comentario no disponible'; end if;
 with selected as (
  select c.* from private.community_comments c where c.product_id=p_product_id and c.parent_id is not distinct from p_parent_id
   and c.status='published' and (c.deleted_at is null or (c.parent_id is null and exists(select 1 from private.community_comments r where r.parent_id=c.id and r.status='published' and r.deleted_at is null)))
   and (p_before_id is null or c.id<p_before_id) order by c.id desc limit lim+1
 ), page as (select * from selected order by id desc limit lim),
 likes as (select l.comment_id,count(*) n,bool_or(l.user_id=auth.uid()) mine from private.comment_likes l join page c on c.id=l.comment_id group by l.comment_id),
 replies as (select c.parent_id,count(*) n from private.community_comments c join page p on p.id=c.parent_id where c.status='published' and c.deleted_at is null group by c.parent_id),
 verified as (select distinct o.user_id from public.orders o join public.order_items i on i.order_id=o.id where o.origin='store' and o.status='Entregado' and i.product_id=p_product_id and o.user_id in(select user_id from page))
 select jsonb_build_object('comments',coalesce(jsonb_agg(jsonb_build_object('id',c.id,'parent_id',c.parent_id,
   'body',case when c.deleted_at is null then c.body end,'deleted',c.deleted_at is not null,'created_at',c.created_at,'edited_at',c.edited_at,
   'author',case when c.deleted_at is null then private.community_identity(p.display_name,coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture')) end,
   'is_owner',c.deleted_at is null and c.user_id=auth.uid(),'verified_purchase',c.deleted_at is null and v.user_id is not null,
   'likes',case when c.deleted_at is null then coalesce(l.n,0) else 0 end,'my_like',c.deleted_at is null and coalesce(l.mine,false),
   'reply_count',coalesce(r.n,0),'can_edit',c.deleted_at is null and c.user_id=auth.uid() and not exists(select 1 from private.community_comments child where child.parent_id=c.id)
  ) order by c.id desc),'[]'::jsonb),'has_more',(select count(*)>lim from selected),'next_cursor',(select min(id) from page))
 into result from page c left join public.profiles p on p.id=c.user_id left join auth.users u on u.id=c.user_id
 left join likes l on l.comment_id=c.id left join replies r on r.parent_id=c.id left join verified v on v.user_id=c.user_id;
 return result||jsonb_build_object('product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),'my_reaction',coalesce((select reaction from private.product_reactions where product_id=p_product_id and user_id=auth.uid()),0));
end;
$$;

create or replace function private.get_product_performance(p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz; result jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 if p_days is not null and p_days not in (7,30,90) then raise exception 'Período inválido'; end if;
 start_at:=case when p_days is not null then (date_trunc('day',now() at time zone 'America/Argentina/Buenos_Aires')-make_interval(days=>p_days-1)) at time zone 'America/Argentina/Buenos_Aires' end;
 with events as(select product_id,count(*) filter(where event_name='product_view') views,count(distinct nullif(session_id,'')) filter(where event_name='product_view') sessions,count(*) filter(where event_name='add_to_cart') carts from public.analytics_events where (start_at is null or created_at>=start_at) and created_at<=now() and event_name in ('product_view','add_to_cart') group by product_id),
 sales as(select i.product_id,count(distinct o.id) orders,sum(i.qty) units,sum(i.line_total) revenue from public.orders o join public.order_items i on i.order_id=o.id where o.origin='store' and o.status<>'Cancelado' and (start_at is null or o.created_at>=start_at) and o.created_at<=now() group by i.product_id),
 reactions as(select product_id,count(*) filter(where reaction=1) likes,count(*) filter(where reaction=-1) dislikes from private.product_reactions group by product_id),
 comments as(select c.product_id,count(*) n from private.community_comments c where c.status='published' and c.deleted_at is null and (c.parent_id is null or exists(select 1 from private.community_comments p where p.id=c.parent_id and p.status='published')) group by c.product_id)
 select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'active',p.active,'views',coalesce(e.views,0),'view_sessions',coalesce(e.sessions,0),'likes',coalesce(r.likes,0),'dislikes',coalesce(r.dislikes,0),'comments',coalesce(c.n,0),'carts',coalesce(e.carts,0),'orders',coalesce(s.orders,0),'units',coalesce(s.units,0),'revenue',coalesce(s.revenue,0),'view_to_cart',case when e.views>0 then coalesce(e.carts,0)*100.0/e.views end,'view_to_order',case when e.views>0 then coalesce(s.orders,0)*100.0/e.views end,'positive_ratio',case when r.likes+r.dislikes>0 then r.likes*100.0/(r.likes+r.dislikes) end) order by p.sort_order,p.name),'[]'::jsonb) into result from public.products p left join events e on e.product_id=p.id left join sales s on s.product_id=p.id left join reactions r on r.product_id=p.id left join comments c on c.product_id=p.id;
 return jsonb_build_object('products',result,'period_start',start_at,'period_end',now(),'community_scope','current');
end;
$$;

-- Quote email worker leases. service_role is the only caller.
create or replace function public.claim_quote_email_deliveries(p_limit integer default 3) returns setof public.quote_email_outbox language plpgsql security definer set search_path='' as $$
begin
 update public.quote_email_outbox set status='review',last_error=case when attempts>=10 then 'retry_limit_exceeded' else 'idempotency_window_expired' end where status in ('pending','processing') and (first_send_at<now()-interval '23 hours' or attempts>=10) and coalesce(locked_until,'-infinity'::timestamptz)<now();
 return query with candidates as(select q.version_id from public.quote_email_outbox q where q.status in ('pending','processing') and q.next_attempt_at<=now() and coalesce(q.locked_until,'-infinity'::timestamptz)<now() order by q.next_attempt_at,q.version_id limit greatest(1,least(coalesce(p_limit,3),3)) for update skip locked)
 update public.quote_email_outbox q set status='processing',attempts=q.attempts+1,lock_token=gen_random_uuid(),locked_until=now()+interval '5 minutes' from candidates c where q.version_id=c.version_id returning q.*;
end;
$$;

create or replace function public.get_quote_email_snapshot(p_version_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',to_jsonb(v),'quote',to_jsonb(q)-'data'-'draft_data') from public.quote_versions v join public.quotes q on q.id=v.quote_id where v.id=p_version_id;
$$;

create or replace function public.prepare_quote_email_delivery(p_version_id uuid,p_lock_token uuid,p_payload jsonb,p_pdf_path text,p_pdf_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>250000 or p_pdf_path!~'^[0-9a-f-]+/v[0-9]+[.]pdf$' or p_pdf_sha256!~'^[0-9a-f]{64}$' then raise exception 'Entrega inválida'; end if;
 update public.quote_email_outbox set payload=coalesce(payload,p_payload),first_send_at=coalesce(first_send_at,now()),locked_until=now()+interval '5 minutes' where version_id=p_version_id and lock_token=p_lock_token and status='processing' and locked_until>now() returning payload into result;
 update public.quote_versions set pdf_path=coalesce(pdf_path,p_pdf_path),pdf_sha256=coalesce(pdf_sha256,p_pdf_sha256) where id=p_version_id and result is not null;
 return result;
end;
$$;

create or replace function public.finish_quote_email_delivery(p_version_id uuid,p_lock_token uuid,p_sent boolean,p_provider_id text default null,p_error text default null,p_retryable boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare n integer; final_status text;
begin
 select attempts into n from public.quote_email_outbox where version_id=p_version_id and lock_token=p_lock_token and status='processing' for update;
 if not found then raise exception 'Lease de email vencido'; end if;
 final_status:=case when p_sent then 'sent' when not p_retryable then 'failed' when n>=10 then 'review' else 'pending' end;
 update public.quote_email_outbox set status=final_status,provider_id=coalesce(p_provider_id,provider_id),last_error=case when p_sent then null else left(coalesce(p_error,'delivery_failed'),120) end,next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(n-1,6))::integer)),lock_token=null,locked_until=null where version_id=p_version_id;
end;
$$;

do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='cubica_budget_email_worker_secret') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'cubica_budget_email_worker_secret','Autenticación privada del worker de presupuestos');
 end if;
end $$;
create or replace function public.validate_quote_email_worker_secret(p_secret text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(length(p_secret) between 32 and 256 and exists(select 1 from vault.decrypted_secrets where name='cubica_budget_email_worker_secret' and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_secret,'sha256')),false);
$$;
create or replace function private.invoke_quote_email_worker() returns bigint language plpgsql security definer set search_path='' as $$
declare secret text; request_id bigint;
begin
 if not exists(select 1 from public.quote_email_outbox where status in ('pending','processing') and next_attempt_at<=now() and coalesce(locked_until,'-infinity'::timestamptz)<now()) then return null; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='cubica_budget_email_worker_secret' limit 1;
 if coalesce(length(secret),0)<32 then raise exception 'Worker secret no configurado'; end if;
 select net.http_post(url:='https://mymrbpwvghxmqqpzzdqk.supabase.co/functions/v1/budget-emails',headers:=jsonb_build_object('Content-Type','application/json','x-cubica-budget-worker-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=90000) into request_id;
 return request_id;
end;
$$;
revoke all on function private.invoke_quote_email_worker() from public,anon,authenticated;

do $$ begin
 if not exists(select 1 from cron.job where jobname='cubica-budget-email-worker') then perform cron.schedule('cubica-budget-email-worker','* * * * *','select private.invoke_quote_email_worker();'); end if;
end $$;

-- Worker RPC permissions.
revoke all on function public.claim_quote_email_deliveries(integer),public.get_quote_email_snapshot(uuid),public.prepare_quote_email_delivery(uuid,uuid,jsonb,text,text),public.finish_quote_email_delivery(uuid,uuid,boolean,text,text,boolean),public.validate_quote_email_worker_secret(text) from public,anon,authenticated;
grant execute on function public.claim_quote_email_deliveries(integer),public.get_quote_email_snapshot(uuid),public.prepare_quote_email_delivery(uuid,uuid,jsonb,text,text),public.finish_quote_email_delivery(uuid,uuid,boolean,text,text,boolean),public.validate_quote_email_worker_secret(text) to service_role;

-- Admin RPC permissions.
revoke all on function public.save_admin_quote_draft(jsonb,text,timestamptz,uuid,text),public.get_admin_quote(text),public.get_admin_quotes(integer,integer,text,text,date,date,text),public.create_admin_quote_revision(text,timestamptz,uuid),public.emit_admin_quote(text,timestamptz,uuid),public.set_admin_quote_status(text,text,timestamptz,uuid),public.convert_admin_quote_to_product(text,text,text,text,jsonb,uuid),public.convert_admin_quote_to_order(text,uuid) from public,anon,service_role;
grant execute on function public.save_admin_quote_draft(jsonb,text,timestamptz,uuid,text),public.get_admin_quote(text),public.get_admin_quotes(integer,integer,text,text,date,date,text),public.create_admin_quote_revision(text,timestamptz,uuid),public.emit_admin_quote(text,timestamptz,uuid),public.set_admin_quote_status(text,text,timestamptz,uuid),public.convert_admin_quote_to_product(text,text,text,text,jsonb,uuid),public.convert_admin_quote_to_order(text,uuid) to authenticated;

