create or replace function private.delivery_items(p_items jsonb) returns jsonb language plpgsql stable set search_path='' as $$
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
  if exists(select 1 from public.product_colors where product_id=p.id) then
   if p.color_mode='multiple' then
    if coalesce(x->>'color','')='' or exists(select 1 from regexp_split_to_table(x->>'color',' \+ ') c where not exists(select 1 from public.product_colors where product_id=p.id and name=c)) then raise exception 'Seleccioná variantes válidas'; end if;
   elsif not exists(select 1 from public.product_colors where product_id=p.id and name=x->>'color') then raise exception 'Seleccioná una variante válida'; end if;
  end if;
  if not exists(select 1 from public.product_colors where product_id=p.id) and coalesce(x->>'color','')<>'' then raise exception 'Variante inválida'; end if;
  result:=result||jsonb_build_array(x||jsonb_build_object('unit_price',p.price,'name',p.name));
 end loop;
 return result;
end; $$;
create or replace function private.create_delivery_order(p_client_order_id text,p_customer_name text,p_customer_email text,p_phone text,p_payment text,p_notes text,p_items jsonb,p_delivery jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') !~ '^[0-9]{8,15}$' then raise exception 'Indicá un teléfono para coordinar el retiro'; end if;
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

