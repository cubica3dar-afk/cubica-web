-- Additive delivery architecture. Personal data and all commercial costs are private.
create table private.delivery_addresses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 address jsonb not null, is_default boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index delivery_addresses_user on private.delivery_addresses(user_id);
create unique index delivery_addresses_default on private.delivery_addresses(user_id) where is_default;
alter table private.delivery_addresses enable row level security;
create policy address_owner on private.delivery_addresses for all to authenticated
 using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create table private.delivery_settings (
 singleton boolean primary key default true check(singleton), settings jsonb not null,
 updated_at timestamptz not null default now()
);
insert into private.delivery_settings(settings) values ('{"origin":{"city":"Caballito","province":"Ciudad Autónoma de Buenos Aires"},"providers":[{"code":"correo_argentino","enabled":false,"margin_percent":10},{"code":"andreani","enabled":false,"margin_percent":8},{"code":"oca","enabled":false,"margin_percent":12}],"boxes":[],"products":[]}');
alter table private.delivery_settings enable row level security;

create table private.delivery_quotes (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 user_id uuid references auth.users(id) on delete set null, token_hash bytea not null, rate_key text not null,
 address jsonb not null, items jsonb not null, package jsonb, origin jsonb, providers jsonb,
 packaging_cost_ars numeric(14,2), status text not null check(status in ('preparing','needs_configuration','unavailable','quoted','used')),
 rates jsonb not null default '[]', provider_results jsonb not null default '[]', selected jsonb,
 price numeric(14,2) check(price>=0), created_at timestamptz not null default now(), expires_at timestamptz not null,
 order_id uuid references public.orders(id), error_codes jsonb not null default '[]'
);
create index delivery_quotes_user on private.delivery_quotes(user_id);
create index delivery_quotes_order on private.delivery_quotes(order_id);
create index delivery_quotes_rate on private.delivery_quotes(rate_key,created_at);
alter table private.delivery_quotes enable row level security;

create table private.order_deliveries (
 order_id uuid primary key references public.orders(id), request_id uuid not null unique,
 request_hash text not null, token_hash bytea not null, mode text not null check(mode in ('pickup','shipping')),
 address jsonb, quote_id uuid references private.delivery_quotes(id), snapshot jsonb not null,
 charged_ars numeric(14,2) not null check(charged_ars>=0), logistics_status text not null,
 actual_cost_ars numeric(14,2) check(actual_cost_ars>=0), tracking_code text, tracking_url text,
 updated_at timestamptz not null default now(), check(mode<>'pickup' or charged_ars=0)
);
alter table private.order_deliveries enable row level security;
create index order_deliveries_quote on private.order_deliveries(quote_id);
create table private.delivery_history (
 id bigint generated always as identity primary key, order_id uuid not null references public.orders(id),
 actor_id uuid references auth.users(id), change jsonb not null, created_at timestamptz not null default now()
);
create index delivery_history_order on private.delivery_history(order_id,created_at);
alter table private.delivery_history enable row level security;
grant usage on schema private to anon,authenticated;
revoke all on private.delivery_addresses,private.delivery_settings,private.delivery_quotes,private.order_deliveries,private.delivery_history from public,anon,authenticated;

create function private.valid_delivery_address(p_address jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare a jsonb; k text; v text;
begin
 if jsonb_typeof(p_address) is distinct from 'object' then raise exception 'Completá la dirección'; end if;
 a:='{}';
 foreach k in array array['recipient','phone','street','number','floor','apartment','city','province','postal_code','instructions','label'] loop
  v:=btrim(coalesce(p_address->>k,''));
  if length(v)>(case when k='instructions' then 500 else 120 end) then raise exception 'Dato de dirección demasiado largo: %',k; end if;
  if k=any(array['recipient','phone','street','number','city','province','postal_code']) and length(v)<1 then raise exception 'Completá el campo de dirección: %',k; end if;
  a:=a||jsonb_build_object(k,v);
 end loop;
 if length(a->>'recipient')<2 then raise exception 'Indicá nombre y apellido del destinatario'; end if;
 if regexp_replace(a->>'phone','[^0-9]','','g') !~ '^[0-9]{8,15}$' then raise exception 'Teléfono de entrega inválido'; end if;
 if upper(a->>'postal_code') !~ '^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$' then raise exception 'Código postal argentino inválido'; end if;
 return jsonb_set(a,'{postal_code}',to_jsonb(upper(a->>'postal_code')));
end; $$;

create function private.delivery_items(p_items jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare x jsonb; p public.products; result jsonb:='[]'; q integer;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'Carrito inválido'; end if;
 for x in select value from jsonb_array_elements(p_items) loop
  if coalesce(x->>'qty','') !~ '^[0-9]{1,3}$' or (x->>'qty')::integer not between 1 and 100 then raise exception 'Cantidad inválida'; end if;
 end loop;
 for x in select jsonb_build_object('product_id',value->>'product_id','color',coalesce(value->>'color',''),'qty',sum((value->>'qty')::integer))
  from jsonb_array_elements(p_items) group by value->>'product_id',coalesce(value->>'color','') order by value->>'product_id',coalesce(value->>'color','') loop
  q:=(x->>'qty')::integer;
  if q>100 then raise exception 'Cantidad máxima por variante: 100'; end if;
  select * into p from public.products where id=x->>'product_id' and active;
  if not found then raise exception 'Producto no disponible'; end if;
  if exists(select 1 from public.product_colors where product_id=p.id) and not exists(select 1 from public.product_colors where product_id=p.id and name=x->>'color') then raise exception 'Seleccioná una variante válida'; end if;
  if not exists(select 1 from public.product_colors where product_id=p.id) and coalesce(x->>'color','')<>'' then raise exception 'Variante inválida'; end if;
  result:=result||jsonb_build_array(x||jsonb_build_object('unit_price',p.price,'name',p.name));
 end loop;
 return result;
end; $$;

create function private.list_my_delivery_addresses() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(a)-'user_id' order by is_default desc,created_at),'[]') from private.delivery_addresses a where user_id=auth.uid());
end; $$;
create function private.save_my_delivery_address(p_address jsonb,p_id uuid default null,p_make_default boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb; n uuid;
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 a:=private.valid_delivery_address(p_address);
 if p_id is not null and not exists(select 1 from private.delivery_addresses where id=p_id and user_id=auth.uid()) then raise exception 'Dirección no disponible' using errcode='42501'; end if;
 if p_id is null and (select count(*) from private.delivery_addresses where user_id=auth.uid())>=20 then raise exception 'Máximo 20 direcciones'; end if;
 if p_make_default then update private.delivery_addresses set is_default=false where user_id=auth.uid(); end if;
 if p_id is null then
  insert into private.delivery_addresses(user_id,address,is_default) values(auth.uid(),a,p_make_default or not exists(select 1 from private.delivery_addresses where user_id=auth.uid())) returning id into n;
 else
  update private.delivery_addresses set address=a,is_default=is_default or p_make_default,updated_at=now() where id=p_id and user_id=auth.uid() returning id into n;
 end if;
 return (select to_jsonb(t)-'user_id' from private.delivery_addresses t where id=n);
end; $$;
create function private.delete_my_delivery_address(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 delete from private.delivery_addresses where id=p_id and user_id=auth.uid();
 if not exists(select 1 from private.delivery_addresses where user_id=auth.uid() and is_default) then
  update private.delivery_addresses set is_default=true where id=(select id from private.delivery_addresses where user_id=auth.uid() order by created_at limit 1);
 end if;
end; $$;

create function private.admin_delivery_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 return (select s.settings||jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name)||coalesce((select d from jsonb_array_elements(s.settings->'products') d where d->>'product_id'=p.id limit 1),'{}') order by p.name) from public.products p),'[]'),
 'quotes',coalesce((select jsonb_agg(to_jsonb(q)-'address'-'token_hash'-'rate_key'-'user_id'-'items' order by q.created_at desc) from (select * from private.delivery_quotes order by created_at desc limit 50) q),'[]')) from private.delivery_settings s);
end; $$;
create function private.admin_save_delivery_settings(p_settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare x jsonb; k text; a jsonb; codes text[];
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 if jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>100000 then raise exception 'Configuración inválida'; end if;
 foreach k in array array['providers','boxes','products'] loop
  if jsonb_typeof(p_settings->k) is distinct from 'array' then raise exception 'Configuración incompleta'; end if;
 end loop;
 if (p_settings->'origin'->>'city') is distinct from 'Caballito' or (p_settings->'origin'->>'province') is distinct from 'Ciudad Autónoma de Buenos Aires' then raise exception 'Origen: Caballito, Ciudad Autónoma de Buenos Aires'; end if;
 -- Address can remain incomplete while configuring, never usable for quotes until valid.
 if octet_length((p_settings->'origin')::text)>2000 then raise exception 'Origen inválido'; end if;
 select array_agg(x->>'code') into codes from jsonb_array_elements(p_settings->'providers') x;
 if cardinality(codes)<>3 or not codes @> array['correo_argentino','andreani','oca'] then raise exception 'Transportistas inválidos'; end if;
 for x in select value from jsonb_array_elements(p_settings->'providers') loop
  if nullif(x->>'margin_percent','') is null or (x->>'margin_percent')::numeric not between 0 and 100 or jsonb_typeof(x->'enabled') is distinct from 'boolean' then raise exception 'Margen inválido'; end if;
 end loop;
 for x in select value from jsonb_array_elements(p_settings->'boxes') loop
  foreach k in array array['length_cm','width_cm','height_cm','weight_g','max_weight_g'] loop
   if coalesce((x->>k)::numeric,0)<=0 then raise exception 'Peso y dimensiones de caja deben ser positivos'; end if;
  end loop;
  foreach k in array array['cost_ars','protection_cost_ars'] loop
   if (x->>k) is null or (x->>k)::numeric<0 then raise exception 'Costo de embalaje inválido'; end if;
  end loop;
 end loop;
 for x in select value from jsonb_array_elements(p_settings->'products') loop
  if not exists(select 1 from public.products where id=x->>'product_id') then raise exception 'Producto logístico inválido'; end if;
  foreach k in array array['length_cm','width_cm','height_cm','weight_g'] loop
   if nullif(x->>k,'') is not null and (x->>k)::numeric<=0 then raise exception 'Peso y dimensiones del producto deben ser positivos'; end if;
  end loop;
 end loop;
 update private.delivery_settings set settings=p_settings-'quotes',updated_at=now();
 return private.admin_delivery_settings();
end; $$;

-- Service-only: identity is checked by Edge Auth, and the capability is random 256-bit.
create function public.prepare_delivery_quote(p_items jsonb,p_address jsonb,p_request_id uuid,p_user_id uuid,p_guest_token text,p_rate_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb; items jsonb; s jsonb; x jsonb; d jsonb; b jsonb; chosen jsonb; q private.delivery_quotes;
 w numeric:=0; l numeric:=0; wi numeric:=0; h numeric:=0; dims numeric[]; errors jsonb:='[]'; value_ars numeric:=0;
begin
 if current_user<>'postgres' and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Backend requerido' using errcode='42501'; end if;
 if p_guest_token !~ '^[0-9a-f]{64}$' or p_guest_token is null or p_request_id is null or length(coalesce(p_rate_key,''))<>64 then raise exception 'Solicitud inválida'; end if;
 a:=private.valid_delivery_address(p_address); items:=private.delivery_items(p_items);
 perform pg_advisory_xact_lock(hashtextextended(p_rate_key,1));
 select * into q from private.delivery_quotes where request_id=p_request_id for update;
 if found then
  if q.user_id is distinct from p_user_id or q.token_hash<>extensions.digest(p_guest_token,'sha256') or q.address<>a or q.items<>items then raise exception 'Cotización no disponible' using errcode='42501'; end if;
  return jsonb_build_object('quote_id',q.id,'status',q.status,'package',q.package,'origin',q.origin,'destination',q.address,'providers',q.providers,'packaging_cost_ars',q.packaging_cost_ars,'expires_at',q.expires_at,'price',q.price,'service_label',q.selected->>'label','error_codes',q.error_codes);
 end if;
 if (select count(*) from private.delivery_quotes where rate_key=p_rate_key and created_at>now()-interval '5 minutes')>=10 or (select count(*) from private.delivery_quotes where rate_key=p_rate_key and created_at>now()-interval '1 hour')>=60 then raise exception 'Demasiadas cotizaciones. Esperá unos minutos.' using errcode='P0001'; end if;
 select settings into s from private.delivery_settings;
 if coalesce(s->'origin'->>'street','')='' or coalesce(s->'origin'->>'number','')='' or upper(coalesce(s->'origin'->>'postal_code','')) !~ '^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$' then errors:=errors||'"origin_not_configured"'::jsonb; end if;
 for x in select value from jsonb_array_elements(items) loop
  select value into d from jsonb_array_elements(s->'products') where value->>'product_id'=x->>'product_id' limit 1;
  if coalesce((d->>'weight_g')::numeric,0)<=0 or coalesce((d->>'length_cm')::numeric,0)<=0 or coalesce((d->>'width_cm')::numeric,0)<=0 or coalesce((d->>'height_cm')::numeric,0)<=0 then
   errors:=errors||jsonb_build_array('product_logistics_not_configured'); continue;
  end if;
  -- Conservative single vertical column, ordered dimensions. Only one axis accumulates.
  select array_agg(v order by v desc) into dims from unnest(array[(d->>'length_cm')::numeric,(d->>'width_cm')::numeric,(d->>'height_cm')::numeric]) v;
  l:=greatest(l,dims[1]); wi:=greatest(wi,dims[2]); h:=h+dims[3]*(x->>'qty')::integer;
  w:=w+(d->>'weight_g')::numeric*(x->>'qty')::integer;
  value_ars:=value_ars+(x->>'unit_price')::numeric*(x->>'qty')::integer;
 end loop;
 for b in select value from jsonb_array_elements(s->'boxes') order by (value->>'cost_ars')::numeric+(value->>'protection_cost_ars')::numeric loop
  if (b->>'length_cm')::numeric>=l and (b->>'width_cm')::numeric>=wi and (b->>'height_cm')::numeric>=h and w+(b->>'weight_g')::numeric<=(b->>'max_weight_g')::numeric then chosen:=b; exit; end if;
 end loop;
 if chosen is null then errors:=errors||'"packaging_not_configured_or_no_fit"'::jsonb; end if;
 insert into private.delivery_quotes(request_id,user_id,token_hash,rate_key,address,items,package,origin,providers,packaging_cost_ars,status,expires_at,error_codes)
 values(p_request_id,p_user_id,extensions.digest(p_guest_token,'sha256'),p_rate_key,a,items,
  case when chosen is not null then jsonb_build_object('box_id',chosen->>'id','weight_g',w+(chosen->>'weight_g')::numeric,'length_cm',(chosen->>'length_cm')::numeric,'width_cm',(chosen->>'width_cm')::numeric,'height_cm',(chosen->>'height_cm')::numeric,'declared_value_ars',value_ars) end,
  s->'origin',s->'providers',coalesce((chosen->>'cost_ars')::numeric+(chosen->>'protection_cost_ars')::numeric,0),case when jsonb_array_length(errors)>0 then 'needs_configuration' else 'preparing' end,now()+interval '15 minutes',errors) returning * into q;
 return jsonb_build_object('quote_id',q.id,'status',q.status,'package',q.package,'origin',q.origin,'destination',q.address,'providers',q.providers,'packaging_cost_ars',q.packaging_cost_ars,'expires_at',q.expires_at,'error_codes',q.error_codes);
end; $$;
revoke all on function public.prepare_delivery_quote(jsonb,jsonb,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_delivery_quote(jsonb,jsonb,uuid,uuid,text,text) to service_role;

create function public.finalize_delivery_quote(p_quote_id uuid,p_user_id uuid,p_guest_token text,p_rates jsonb,p_provider_results jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q private.delivery_quotes; x jsonb; provider jsonb; rate numeric; margin numeric; final numeric; best numeric; picked jsonb; allrates jsonb:='[]'; until_at timestamptz;
begin
 select * into q from private.delivery_quotes where id=p_quote_id for update;
 if not found or q.user_id is distinct from p_user_id or q.token_hash is distinct from extensions.digest(p_guest_token,'sha256') then raise exception 'Cotización no disponible' using errcode='42501'; end if;
 if q.status='preparing' and q.expires_at>now() then
  for x in select value from jsonb_array_elements(p_rates) loop
   select value into provider from jsonb_array_elements(q.providers) where value->>'code'=x->>'code' and (value->>'enabled')::boolean;
   if provider is null or coalesce(x->>'base_price_ars','') !~ '^[0-9]+(\.[0-9]+)?$' then continue; end if;
   rate:=round((x->>'base_price_ars')::numeric,2);
   if rate<=0 or rate>10000000 or coalesce(x->>'service_code','')='' or length(coalesce(x->>'label','')) not between 1 and 150 then continue; end if;
   until_at:=coalesce(nullif(x->>'valid_until','')::timestamptz,q.expires_at);
   if until_at<=now() then continue; end if;
   margin:=round(rate*(provider->>'margin_percent')::numeric/100,2); final:=rate+margin+q.packaging_cost_ars;
   x:=x||jsonb_build_object('margin_percent',(provider->>'margin_percent')::numeric,'margin_ars',margin,'packaging_cost_ars',q.packaging_cost_ars,'final_price_ars',final,'valid_until',least(until_at,q.expires_at));
   allrates:=allrates||jsonb_build_array(x);
   if best is null or final<best then best:=final; picked:=x; end if;
  end loop;
  update private.delivery_quotes set rates=allrates,provider_results=p_provider_results,selected=picked,price=best,status=case when best is null then 'unavailable' else 'quoted' end,
    expires_at=case when picked is null then expires_at else least(expires_at,(picked->>'valid_until')::timestamptz) end where id=q.id returning * into q;
 end if;
 return jsonb_build_object('quote_id',q.id,'status',q.status,'price',q.price,'service_label',q.selected->>'label','expires_at',q.expires_at,'error_codes',q.error_codes);
end; $$;
revoke all on function public.finalize_delivery_quote(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_delivery_quote(uuid,uuid,text,jsonb,jsonb) to service_role;

create function private.create_delivery_order(p_client_order_id text,p_customer_name text,p_customer_email text,p_phone text,p_payment text,p_notes text,p_items jsonb,p_delivery jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare mode text; a jsonb; items jsonb; q private.delivery_quotes; old private.order_deliveries; oid uuid; result jsonb; token text; rid uuid; reqhash text; charged numeric:=0; snap jsonb;
begin
 mode:=p_delivery->>'mode';
 if mode is null or mode not in ('pickup','shipping') then raise exception 'Elegí envío a domicilio o retiro coordinado'; end if;
 rid:=(p_delivery->>'request_id')::uuid; token:=p_delivery->>'quote_token';
 if rid is null or token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'Identificador de compra inválido'; end if;
 reqhash:=md5(jsonb_build_object('customer',btrim(p_customer_name),'email',lower(btrim(p_customer_email)),'phone',p_phone,'payment',p_payment,'notes',p_notes,'items',p_items,'delivery',p_delivery)::text);
 perform pg_advisory_xact_lock(hashtextextended(rid::text,2));
 select * into old from private.order_deliveries where request_id=rid;
 if found then
  if old.token_hash<>extensions.digest(token,'sha256') or old.request_hash<>reqhash or (select user_id from public.orders where id=old.order_id) is distinct from auth.uid() then raise exception 'Pedido no disponible' using errcode='42501'; end if;
  return (select jsonb_build_object('ok',true,'order_id',id,'order_number',order_number,'total',total,'delivery_total',old.charged_ars) from public.orders where id=old.order_id);
 end if;
 -- Lock before snapshot validation to prevent price/availability changes between quote and sale.
 perform id from public.products where id in(select value->>'product_id' from jsonb_array_elements(p_items)) order by id for update;
 items:=private.delivery_items(p_items);
 if mode='shipping' then
  a:=private.valid_delivery_address(p_delivery->'address');
  select * into q from private.delivery_quotes where token_hash=extensions.digest(token,'sha256') and request_id=rid for update;
  if not found or q.user_id is distinct from auth.uid() or q.status<>'quoted' or q.expires_at<=now() or q.address<>a or q.items<>items then raise exception 'La cotización venció o cambió el pedido. Volvé a cotizar.'; end if;
  charged:=q.price; snap:=jsonb_build_object('provider',q.selected->>'code','service',q.selected->>'label','rates',q.rates,'selected',q.selected,'package',q.package,'origin',q.origin,'expires_at',q.expires_at);
 else
  if length(btrim(coalesce(p_phone,'')))<8 then raise exception 'Indicá un teléfono para coordinar el retiro'; end if;
  snap:=jsonb_build_object('mode','pickup','coordination','Se coordinará el retiro cuando el pedido esté preparado.');
 end if;
 result:=public.create_public_order(p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,p_notes,p_items);
 oid:=(result->>'order_id')::uuid;
 update public.orders set total=total+charged where id=oid;
 insert into private.order_deliveries(order_id,request_id,request_hash,token_hash,mode,address,quote_id,snapshot,charged_ars,logistics_status)
 values(oid,rid,reqhash,extensions.digest(token,'sha256'),mode,a,q.id,snap,charged,case when mode='pickup' then 'pickup_pending' else 'pending' end);
 if mode='shipping' then update private.delivery_quotes set status='used',order_id=oid where id=q.id; end if;
 return result||jsonb_build_object('total',(result->>'total')::numeric+charged,'delivery_total',charged);
end; $$;

create function private.customer_delivery(p_order_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('mode',mode,'address',address,'charged_ars',charged_ars,'service_label',snapshot->>'service','logistics_status',logistics_status,'tracking_code',tracking_code,'tracking_url',tracking_url)
 from private.order_deliveries where order_id=p_order_id;
$$;
create function private.admin_order_delivery(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 return (select to_jsonb(d)-'token_hash'-'request_hash'||jsonb_build_object('difference_ars',case when actual_cost_ars is not null then charged_ars-actual_cost_ars end,'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from private.delivery_history h where h.order_id=d.order_id),'[]')) from private.order_deliveries d where order_id=p_order_id);
end; $$;
create function private.admin_update_order_delivery(p_order_id uuid,p_update jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.order_deliveries; state text; cost numeric; link text; code text;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 select * into d from private.order_deliveries where order_id=p_order_id for update;
 if not found then raise exception 'Pedido histórico sin modalidad registrada'; end if;
 state:=coalesce(p_update->>'logistics_status',d.logistics_status);
 if d.mode='shipping' and state not in ('pending','dispatched','in_transit','delivered','incident') or d.mode='pickup' and state not in ('pickup_pending','pickup_ready','picked_up') then raise exception 'Estado logístico inválido'; end if;
 cost:=nullif(p_update->>'actual_cost_ars','')::numeric;
 if cost<0 or cost>10000000 or (d.mode='pickup' and cost>0) then raise exception 'Costo real inválido'; end if;
 link:=nullif(btrim(p_update->>'tracking_url'),''); code:=nullif(btrim(p_update->>'tracking_code'),'');
 if length(code)>120 or length(link)>1000 or (link is not null and link !~ '^https://[A-Za-z0-9.-]+(/|$)') then raise exception 'Seguimiento inválido'; end if;
 if d.mode='pickup' and (link is not null or code is not null) then raise exception 'El retiro no lleva seguimiento de transporte'; end if;
 if state is distinct from d.logistics_status or cost is distinct from d.actual_cost_ars or link is distinct from d.tracking_url or code is distinct from d.tracking_code then
  update private.order_deliveries set logistics_status=state,actual_cost_ars=cost,tracking_url=link,tracking_code=code,updated_at=now() where order_id=p_order_id;
  insert into private.delivery_history(order_id,actor_id,change) values(p_order_id,auth.uid(),jsonb_build_object('before',jsonb_build_object('logistics_status',d.logistics_status,'actual_cost_ars',d.actual_cost_ars,'tracking_code',d.tracking_code,'tracking_url',d.tracking_url),'after',p_update));
 end if;
 return private.admin_order_delivery(p_order_id);
end; $$;

-- Narrow invoker API; private implementations enforce ownership/admin and expose no table.
create function public.list_my_delivery_addresses() returns jsonb language sql security invoker set search_path='' as $$ select private.list_my_delivery_addresses(); $$;
create function public.save_my_delivery_address(p_address jsonb,p_id uuid default null,p_make_default boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select private.save_my_delivery_address(p_address,p_id,p_make_default); $$;
create function public.delete_my_delivery_address(p_id uuid) returns void language sql security invoker set search_path='' as $$ select private.delete_my_delivery_address(p_id); $$;
create function public.admin_delivery_settings() returns jsonb language sql security invoker set search_path='' as $$ select private.admin_delivery_settings(); $$;
create function public.admin_save_delivery_settings(p_settings jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_save_delivery_settings(p_settings); $$;
create function public.admin_order_delivery(p_order_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_order_delivery(p_order_id); $$;
create function public.admin_update_order_delivery(p_order_id uuid,p_update jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_update_order_delivery(p_order_id,p_update); $$;
create function public.create_delivery_order(p_client_order_id text,p_customer_name text,p_customer_email text,p_phone text,p_payment text,p_notes text,p_items jsonb,p_delivery jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.create_delivery_order(p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,p_notes,p_items,p_delivery); $$;

revoke all on function private.valid_delivery_address(jsonb),private.delivery_items(jsonb),private.customer_delivery(uuid) from public,anon,authenticated;
revoke all on function private.list_my_delivery_addresses(),private.save_my_delivery_address(jsonb,uuid,boolean),private.delete_my_delivery_address(uuid),private.admin_delivery_settings(),private.admin_save_delivery_settings(jsonb),private.admin_order_delivery(uuid),private.admin_update_order_delivery(uuid,jsonb),private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.list_my_delivery_addresses(),public.save_my_delivery_address(jsonb,uuid,boolean),public.delete_my_delivery_address(uuid),public.admin_delivery_settings(),public.admin_save_delivery_settings(jsonb),public.admin_order_delivery(uuid),public.admin_update_order_delivery(uuid,jsonb),public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.list_my_delivery_addresses(),private.save_my_delivery_address(jsonb,uuid,boolean),private.delete_my_delivery_address(uuid),private.admin_delivery_settings(),private.admin_save_delivery_settings(jsonb),private.admin_order_delivery(uuid),private.admin_update_order_delivery(uuid,jsonb) to authenticated;
grant execute on function public.list_my_delivery_addresses(),public.save_my_delivery_address(jsonb,uuid,boolean),public.delete_my_delivery_address(uuid),public.admin_delivery_settings(),public.admin_save_delivery_settings(jsonb),public.admin_order_delivery(uuid),public.admin_update_order_delivery(uuid,jsonb) to authenticated;
grant execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb),public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) to anon,authenticated;


CREATE OR REPLACE FUNCTION public.get_customer_orders()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'user_id',o.user_id,
  'created_at',o.created_at,'customer_name',o.customer_name,'customer_email',o.customer_email,
  'phone',o.phone,'payment',o.payment,'notes',o.notes,'total',o.total,
  'status',case when o.status='Preparado' then 'Listo para entregar' when o.status in ('Entregado','Cancelado') then o.status else 'Pedido recibido' end,
  'delivery',private.customer_delivery(o.id),'order_items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'name',i.name,'color',i.color,'qty',i.qty,'unit_price',i.unit_price)),'[]'::jsonb) from public.order_items i where i.order_id=o.id)) order by o.created_at desc),'[]'::jsonb)
 from public.orders o where o.user_id=(select auth.uid());
$function$;
CREATE OR REPLACE FUNCTION public.get_order_email_snapshot(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'order',to_jsonb(o)||jsonb_build_object('delivery',(select to_jsonb(d)-'token_hash'-'request_hash' from private.order_deliveries d where d.order_id=o.id)),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
    'recipes',coalesce((select jsonb_agg(to_jsonb(r) order by r.product_id,r.supply_id) from public.product_recipes r
      where r.product_id in (select i.product_id from public.order_items i where i.order_id=o.id)),'[]'::jsonb),
    'supplies',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.supplies s
      where s.id in (select r.supply_id from public.product_recipes r
        where r.product_id in (select i.product_id from public.order_items i where i.order_id=o.id))),'[]'::jsonb)
  ) from public.orders o where o.id=p_order_id;
$function$
;

