-- Commercial checkout schema. Apply only in an explicitly approved deployment window.
-- Existing orders are not backfilled. Public/private pickup information is separated.
begin;
-- Fail atomically on an incompatible predecessor or inactive MFA enforcement.
do $$ begin
 if to_regprocedure('private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)') is null
  or to_regprocedure('private.existing_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid)') is null
  or to_regprocedure('private.admin_mfa_enforcement_enabled()') is null then
  raise exception 'checkout_missing_predecessor';
 end if;
 if not private.admin_mfa_enforcement_enabled() then raise exception 'checkout_requires_aal2_enforcement'; end if;
end; $$;
create table private.checkout_settings (
 singleton boolean primary key default true check(singleton), version integer not null default 1,
 bank jsonb not null default '{}', contact text not null default '', approved boolean not null default false,
 uber_enabled boolean not null default false
);
insert into private.checkout_settings default values;
create table private.pickup_points (
 id uuid primary key, version integer not null default 1, enabled boolean not null default false,
 name text not null check(length(btrim(name)) between 1 and 120),
 description text not null default '' check(length(description)<=1000),
 public_instructions text not null default '' check(length(public_instructions)<=1500),
 private_instructions text not null default '' check(length(private_instructions)<=1500)
);
create table private.order_commercial (
 order_id uuid primary key references public.orders(id), version integer not null default 1,
 products_total numeric(14,2) not null check(products_total>0), products_credited numeric(14,2) not null default 0,
 deposit_percent integer check(deposit_percent=50), agreement text not null default '',
 transfer_reported boolean not null default false,
 pickup_id uuid references private.pickup_points(id), pickup_public jsonb, pickup_private text,
 release_pickup boolean not null default false,
 uber_status text not null default 'not_requested' check(uber_status in ('not_requested','pending_review','approved','rejected','dispatched')),
 uber_quote numeric(14,2) check(uber_quote>0), quote_version integer not null default 0,
 accepted_quote_version integer, uber_credited numeric(14,2) not null default 0,
 check(products_credited between 0 and products_total), check(uber_credited>=0)
);
create index order_commercial_pickup on private.order_commercial(pickup_id);
create table private.checkout_audit (
 id bigint generated always as identity primary key, order_id uuid references public.orders(id),
 actor uuid, action text not null, details jsonb not null, created_at timestamptz not null default now()
);
create index checkout_audit_order on private.checkout_audit(order_id,id);
alter table private.checkout_settings enable row level security;
alter table private.pickup_points enable row level security;
alter table private.order_commercial enable row level security;
alter table private.checkout_audit enable row level security;
revoke all on private.checkout_settings,private.pickup_points,private.order_commercial,private.checkout_audit from public,anon,authenticated;

create function public.get_checkout_options() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',s.version,'ready',s.approved,'bank',case when s.approved then s.bank else '{}'::jsonb end,
 'contact',case when s.approved then s.contact else '' end,'uber_enabled',s.approved and s.uber_enabled,'uber_limit',20000,
 'pickup_points',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'instructions',public_instructions) order by name,id) from private.pickup_points where enabled),'[]'::jsonb))
 from private.checkout_settings s;
$$;
create function public.admin_checkout_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Administrador AAL2 requerido' using errcode='42501'; end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from private.checkout_settings s),'points',coalesce((select jsonb_agg(to_jsonb(p) order by name) from private.pickup_points p),'[]'::jsonb));
end; $$;
create function public.admin_save_checkout_settings(p_expected_version integer,p_bank jsonb,p_contact text,p_approved boolean,p_uber_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.checkout_settings; b jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Administrador AAL2 requerido' using errcode='42501'; end if;
 select * into s from private.checkout_settings for update;
 if p_expected_version is distinct from s.version then raise exception 'Configuración modificada' using errcode='40001'; end if;
 b:=jsonb_build_object('cbu',btrim(coalesce(p_bank->>'cbu','')),'holder',btrim(coalesce(p_bank->>'holder','')),'bank',btrim(coalesce(p_bank->>'bank','')),'alias',btrim(coalesce(p_bank->>'alias','')));
 if length(b::text)>1000 or length(coalesce(p_contact,''))>300 then raise exception 'Datos demasiado largos'; end if;
 if p_approved and ((b->>'cbu')!~'^[0-9]{22}$' or length(b->>'holder')<2 or length(b->>'bank')<2) then raise exception 'Completá y verificá CBU, titular y banco antes de aprobar'; end if;
 update private.checkout_settings set bank=b,contact=coalesce(p_contact,''),approved=coalesce(p_approved,false),uber_enabled=coalesce(p_uber_enabled,false),version=version+1;
 return public.admin_checkout_settings();
end; $$;
create function public.admin_save_pickup_point(p_id uuid,p_expected_version integer,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.pickup_points;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Administrador AAL2 requerido' using errcode='42501'; end if;
 if p_id is null then raise exception 'Identidad requerida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,53));
 select * into p from private.pickup_points where id=p_id for update;
 if p_expected_version is distinct from coalesce(p.version,0) then raise exception 'Punto modificado' using errcode='40001'; end if;
 insert into private.pickup_points(id,name,description,public_instructions,private_instructions,enabled)
 values(p_id,btrim(p_data->>'name'),coalesce(p_data->>'description',''),coalesce(p_data->>'public_instructions',''),coalesce(p_data->>'private_instructions',''),coalesce((p_data->>'enabled')::boolean,false))
 on conflict(id) do update set name=excluded.name,description=excluded.description,public_instructions=excluded.public_instructions,private_instructions=excluded.private_instructions,enabled=excluded.enabled,version=private.pickup_points.version+1;
 return public.admin_checkout_settings();
end; $$;

-- Extend delivery semantics without rewriting historical shipping orders.
alter table private.order_deliveries drop constraint order_deliveries_mode_check;
alter table private.order_deliveries add constraint order_deliveries_mode_check check(mode in ('pickup','shipping','uber'));
alter table private.order_deliveries alter column charged_ars drop not null;
alter table private.order_deliveries add constraint order_deliveries_uber_unknown check(mode<>'uber' or charged_ars is null);
alter function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) rename to create_delivery_order_prelaunch;
revoke all on function private.create_delivery_order_prelaunch(text,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
create function private.create_delivery_order(p_client_order_id text,p_customer_name text,p_customer_email text,p_phone text,p_payment text,p_notes text,p_items jsonb,p_delivery jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare mode text:=p_delivery->>'mode'; rid uuid:=(p_delivery->>'request_id')::uuid; token text:=p_delivery->>'quote_token'; prior jsonb; s private.checkout_settings; point private.pickup_points; a jsonb; items jsonb; total numeric; result jsonb; oid uuid; reqhash text;
begin
 perform pg_advisory_xact_lock(hashtextextended(rid::text,2));
 prior:=private.existing_delivery_order(p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,p_notes,p_items,p_delivery,auth.uid());
 if prior is not null then return prior; end if;
 if rid is null or rid::text<>p_client_order_id or token is null or token!~'^[0-9a-f]{64}$' then raise exception 'order_invalid_request'; end if;
 if p_payment is distinct from 'Transferencia' then raise exception 'order_transfer_required'; end if;
 select * into s from private.checkout_settings for share;
 if not s.approved then raise exception 'order_checkout_not_configured'; end if;
 if mode is null or mode not in ('pickup','uber') then raise exception 'order_delivery_disabled'; end if;
 perform id from public.products where id in(select value->>'product_id' from jsonb_array_elements(p_items)) order by id for update;
 begin
  items:=private.delivery_items(p_items);
 exception when raise_exception then raise exception 'order_invalid_items'; end;
 select sum((x->>'unit_price')::numeric*(x->>'qty')::integer) into total from jsonb_array_elements(items)x;
 if regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')!~'^[0-9]{8,15}$' then raise exception 'order_invalid_phone'; end if;
 if mode='pickup' then
  select * into point from private.pickup_points where id=(p_delivery->>'pickup_id')::uuid and enabled for share;
  if not found then raise exception 'order_pickup_unavailable'; end if;
 else
  if not s.uber_enabled or total>20000 then raise exception 'order_uber_ineligible'; end if;
  begin
   a:=private.valid_delivery_address(p_delivery->'address');
  exception when raise_exception then raise exception 'order_invalid_address'; end;
  if a->>'province' is distinct from 'Ciudad Autónoma de Buenos Aires' or length(btrim(coalesce(p_delivery#>>'{address,neighborhood}','')))<2 then raise exception 'order_uber_address_required'; end if;
  a:=a||jsonb_build_object('neighborhood',left(p_delivery#>>'{address,neighborhood}',120));
  -- This is a declaration, NOT geographic verification. Administrative review is mandatory.
 end if;
 if length(btrim(coalesce(p_customer_name,''))) not between 2 and 120
  or length(btrim(coalesce(p_customer_email,''))) not between 5 and 180
  or btrim(p_customer_email)!~*'^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  or length(coalesce(p_notes,''))>1500 then raise exception 'order_invalid_customer'; end if;
 result:=public.create_public_order(p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,p_notes,p_items);
 oid:=(result->>'order_id')::uuid;
 reqhash:=md5(jsonb_build_object('customer',btrim(p_customer_name),'email',lower(btrim(p_customer_email)),'phone',p_phone,'payment',p_payment,'notes',p_notes,'items',p_items,'delivery',p_delivery)::text);
 insert into private.order_deliveries(order_id,request_id,request_hash,token_hash,mode,address,snapshot,charged_ars,logistics_status)
 values(oid,rid,reqhash,extensions.digest(token,'sha256'),mode,a,jsonb_build_object('checkout_version',1),case when mode='pickup' then 0 else null end,case when mode='pickup' then 'pickup_pending' else 'pending' end);
 insert into private.order_commercial(order_id,products_total,pickup_id,pickup_public,pickup_private,uber_status)
 values(oid,(result->>'total')::numeric,point.id,case when point.id is not null then jsonb_build_object('name',point.name,'description',point.description,'instructions',point.public_instructions) end,point.private_instructions,case when mode='uber' then 'pending_review' else 'not_requested' end);
 return result||jsonb_build_object('delivery_total',case when mode='pickup' then 0 else null end,'payment_status','pending');
end; $$;
revoke all on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;

create function private.checkout_access(p_order_id uuid,p_token text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.orders o join private.order_deliveries d on d.order_id=o.id where o.id=p_order_id and
 ((auth.uid() is not null and o.user_id=auth.uid()) or (o.user_id is null and p_token ~ '^[0-9a-f]{64}$' and d.token_hash=extensions.digest(p_token,'sha256'))));
$$;
create function public.get_checkout_receipt(p_order_id uuid,p_token text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.checkout_access(p_order_id,p_token) and not (auth.uid() is not null and private.is_admin()) then raise exception 'Pedido no disponible' using errcode='42501'; end if;
 select jsonb_build_object('order_id',o.id,'order_number',o.order_number,'items',(select jsonb_agg(jsonb_build_object('name',name,'color',color,'qty',qty,'price',unit_price)) from public.order_items where order_id=o.id),
 'commercial',to_jsonb(c)-'pickup_private','order_status',o.status,'origin',o.origin,'delivery_mode',d.mode,
 'admin_address',case when auth.uid() is not null and private.is_admin() then d.address else null end,
 'pickup_instructions',case when c.release_pickup then c.pickup_private else null end,'options',public.get_checkout_options()) into result
 from public.orders o join private.order_commercial c on c.order_id=o.id left join private.order_deliveries d on d.order_id=o.id where o.id=p_order_id;
 return result;
end; $$;
create function public.checkout_customer_action(p_order_id uuid,p_token text,p_action text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.order_commercial;
begin
 if not private.checkout_access(p_order_id,p_token) then raise exception 'Pedido no disponible' using errcode='42501'; end if;
 perform id from public.orders where id=p_order_id and status<>'Cancelado'
  and (status<>'Entregado' or p_action='report_transfer') for share;
 if not found then raise exception 'Pedido cerrado'; end if;
 select * into c from private.order_commercial where order_id=p_order_id for update;
 if not found or c.version is distinct from p_expected_version then raise exception 'Pedido modificado' using errcode='40001'; end if;
 if p_action='report_transfer' and c.products_credited<c.products_total then update private.order_commercial set transfer_reported=true,version=version+1 where order_id=p_order_id;
 elsif p_action='accept_uber_quote' and c.uber_status='approved' and c.uber_quote is not null then
  update private.order_commercial set accepted_quote_version=quote_version,version=version+1 where order_id=p_order_id;
 else raise exception 'Acción no disponible'; end if;
 insert into private.checkout_audit(order_id,actor,action,details) values(p_order_id,auth.uid(),p_action,'{}');
 return public.get_checkout_receipt(p_order_id,p_token);
end; $$;

create function public.admin_checkout_order_action(p_order_id uuid,p_expected_version integer,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.order_commercial; o public.orders; p private.pickup_points; amount numeric;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Administrador AAL2 requerido' using errcode='42501'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found or o.status='Cancelado' or (o.status='Entregado' and p_action is distinct from 'credit_products') then raise exception 'Pedido no disponible'; end if;
 select * into c from private.order_commercial where order_id=p_order_id for update;
 if not found then
  if o.origin is distinct from 'budget' or p_action is distinct from 'budget_agreement' or p_expected_version is distinct from 0 then raise exception 'Pedido histórico sin contrato; no se modifica'; end if;
  insert into private.order_commercial(order_id,products_total) values(o.id,o.total) returning * into c;
 elsif p_expected_version is distinct from c.version then raise exception 'Pedido modificado' using errcode='40001'; end if;
 if p_action='credit_products' then
  amount:=(p_data->>'amount')::numeric;
  if amount is null or amount<=0 or amount<>round(amount,2) or c.products_credited+amount>c.products_total then raise exception 'Importe inválido'; end if;
  update private.order_commercial set products_credited=products_credited+amount,transfer_reported=false where order_id=o.id;
  if o.origin='budget' then
   update public.orders set commercial_status=case when c.products_credited+amount=c.products_total then 'paid' else 'accepted_unpaid' end where id=o.id;
  end if;
 elsif p_action='budget_agreement' then
  if o.origin<>'budget' or length(btrim(coalesce(p_data->>'agreement','')))<3 then raise exception 'Acuerdo explícito requerido'; end if;
  update private.order_commercial set deposit_percent=case when p_data->>'deposit_percent'='50' then 50 when coalesce(p_data->>'deposit_percent','')='' then null else -1 end,agreement=left(p_data->>'agreement',1000) where order_id=o.id;
 elsif p_action='approve_uber' then
  if c.uber_status not in ('pending_review','rejected') or (p_data->>'caba_verified')::boolean is distinct from true or (p_data->>'compatible')::boolean is distinct from true then raise exception 'Verificá destino CABA y compatibilidad'; end if;
  update private.order_commercial set uber_status='approved' where order_id=o.id;
 elsif p_action='reject_uber' then
  if c.uber_status not in ('pending_review','approved') or c.uber_credited>0 then raise exception 'Acción no disponible'; end if;
  update private.order_commercial set uber_status='rejected',uber_quote=null,accepted_quote_version=null where order_id=o.id;
 elsif p_action='quote_uber' then
  amount:=(p_data->>'amount')::numeric;
  if c.uber_status<>'approved' or o.status<>'Preparado' or amount is null or amount<=0 or amount<c.uber_credited or amount>10000000 or amount<>round(amount,2) then raise exception 'Pedido listo e importe válido requeridos; no reducir por debajo de lo acreditado'; end if;
  update private.order_commercial set uber_quote=amount,quote_version=quote_version+1,accepted_quote_version=null where order_id=o.id;
 elsif p_action='record_uber_acceptance' then
  if c.uber_status<>'approved' or c.uber_quote is null or length(btrim(coalesce(p_data->>'agreement','')))<3 then raise exception 'Conformidad del cliente requerida'; end if;
  update private.order_commercial set accepted_quote_version=quote_version where order_id=o.id;
 elsif p_action='credit_uber' then
  amount:=(p_data->>'amount')::numeric;
  if c.uber_status<>'approved' or c.accepted_quote_version is distinct from c.quote_version or c.uber_quote is null or amount is null or amount<=0 or amount<>round(amount,2) or c.uber_credited+amount>c.uber_quote then raise exception 'Cotización aceptada e importe válido requeridos'; end if;
  update private.order_commercial set uber_credited=uber_credited+amount where order_id=o.id;
 elsif p_action='dispatch_uber' then
  if c.uber_status<>'approved' or c.uber_quote is null or c.accepted_quote_version is distinct from c.quote_version or c.uber_credited<c.uber_quote or c.products_credited<c.products_total or o.status<>'Preparado' then raise exception 'Falta aprobación, conformidad, preparación o acreditación'; end if;
  update private.order_commercial set uber_status='dispatched' where order_id=o.id;
 elsif p_action='switch_pickup' then
  if c.uber_status not in ('pending_review','rejected','approved') or c.uber_credited>0 or length(btrim(coalesce(p_data->>'agreement','')))<3 then raise exception 'Requiere acuerdo del cliente y resolver cobros del traslado'; end if;
  select * into p from private.pickup_points where id=(p_data->>'pickup_id')::uuid and enabled for share;
  if not found then raise exception 'Punto no habilitado'; end if;
  update private.order_commercial set pickup_id=p.id,pickup_public=jsonb_build_object('name',p.name,'description',p.description,'instructions',p.public_instructions),pickup_private=p.private_instructions,release_pickup=false,uber_status='not_requested',uber_quote=null,accepted_quote_version=null where order_id=o.id;
  update private.order_deliveries set mode='pickup',charged_ars=0,logistics_status='pickup_pending' where order_id=o.id;
 elsif p_action='release_pickup' then
  if c.pickup_id is null or o.status='Pendiente' then raise exception 'Confirmá el pedido y el punto de retiro antes de comunicar la ubicación'; end if;
  update private.order_commercial set release_pickup=true where order_id=o.id;
 else raise exception 'Acción inválida'; end if;
 update private.order_commercial set version=version+1 where order_id=o.id;
 insert into private.checkout_audit(order_id,actor,action,details) values(o.id,auth.uid(),p_action,p_data);
 return public.get_checkout_receipt(o.id);
end; $$;
revoke all on function private.checkout_access(uuid,text),public.get_checkout_options(),public.admin_checkout_settings(),public.admin_save_checkout_settings(integer,jsonb,text,boolean,boolean),public.admin_save_pickup_point(uuid,integer,jsonb),public.get_checkout_receipt(uuid,text),public.checkout_customer_action(uuid,text,text,integer),public.admin_checkout_order_action(uuid,integer,text,jsonb) from public,anon,authenticated;
-- Existing owner-filtered history can identify new receipts without exposing capabilities.
create or replace function private.customer_delivery(p_order_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('mode',mode,'address',address,'charged_ars',charged_ars,'service_label',snapshot->>'service','logistics_status',logistics_status,'tracking_code',tracking_code,'tracking_url',tracking_url)
 ||case when exists(select 1 from private.order_commercial c where c.order_id=p_order_id) then '{"commercial_checkout":true}'::jsonb else '{}'::jsonb end
 from private.order_deliveries where order_id=p_order_id;
$$;
revoke all on function private.customer_delivery(uuid) from public,anon,authenticated;
grant execute on function public.get_checkout_options(),public.get_checkout_receipt(uuid,text),public.checkout_customer_action(uuid,text,text,integer) to anon,authenticated;
grant execute on function public.admin_checkout_settings(),public.admin_save_checkout_settings(integer,jsonb,text,boolean,boolean),public.admin_save_pickup_point(uuid,integer,jsonb),public.admin_checkout_order_action(uuid,integer,text,jsonb) to authenticated;
create function public.reconcile_checkout(p_request_id uuid,p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare oid uuid;
begin
 select order_id into oid from private.order_deliveries where request_id=p_request_id;
 if oid is null then return null; end if;
 return public.get_checkout_receipt(oid,p_token);
end; $$;
revoke all on function public.reconcile_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_checkout(uuid,text) to anon,authenticated;
-- Legacy logistics updates must not bypass the new Uber approval/payment gates.
create function private.guard_uber_dispatch() returns trigger language plpgsql set search_path='' as $$
begin
 if new.mode='uber' and new.logistics_status not in ('pending','dispatched','in_transit','delivered','incident') then
  raise exception 'Estado logístico Uber inválido';
 end if;
 if new.mode='uber' and new.logistics_status in ('dispatched','in_transit','delivered') and not exists(select 1 from private.order_commercial c where c.order_id=new.order_id and c.uber_status='dispatched') then
  raise exception 'Uber requiere aprobación y acreditaciones';
 end if;
 return new;
end; $$;
revoke all on function private.guard_uber_dispatch() from public,anon,authenticated;
create trigger commercial_uber_dispatch before update on private.order_deliveries for each row execute function private.guard_uber_dispatch();
create function private.guard_uber_order_completion() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='Entregado' and new.status is distinct from old.status
  and exists(select 1 from private.order_commercial c where c.order_id=new.id and c.uber_status not in ('not_requested','dispatched')) then
  raise exception 'Uber requiere aprobación, conformidad y acreditaciones antes de completar la entrega';
 end if;
 return new;
end; $$;
revoke all on function private.guard_uber_order_completion() from public,anon,authenticated;
create trigger commercial_uber_order_completion before update of status on public.orders for each row execute function private.guard_uber_order_completion();
-- Delivered only after COMMIT; refresh the API schema when PostgREST is present.
notify pgrst, 'reload schema';
commit;
