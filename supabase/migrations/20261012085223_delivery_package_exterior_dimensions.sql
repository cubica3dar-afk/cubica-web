create or replace function private.admin_save_delivery_settings(p_settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  foreach k in array array['length_cm','width_cm','height_cm'] loop
   if coalesce((x->>('outer_'||k))::numeric,0)<(x->>k)::numeric then raise exception 'Indicá medidas exteriores de caja iguales o mayores a las internas'; end if;
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
create or replace function public.prepare_delivery_quote(p_items jsonb,p_address jsonb,p_request_id uuid,p_user_id uuid,p_guest_token text,p_rate_key text) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if coalesce((b->>'outer_length_cm')::numeric,0)>=(b->>'length_cm')::numeric and coalesce((b->>'outer_width_cm')::numeric,0)>=(b->>'width_cm')::numeric and coalesce((b->>'outer_height_cm')::numeric,0)>=(b->>'height_cm')::numeric and (b->>'length_cm')::numeric>=l and (b->>'width_cm')::numeric>=wi and (b->>'height_cm')::numeric>=h and w+(b->>'weight_g')::numeric<=(b->>'max_weight_g')::numeric then chosen:=b; exit; end if;
 end loop;
 if chosen is null then errors:=errors||'"packaging_not_configured_or_no_fit"'::jsonb; end if;
 insert into private.delivery_quotes(request_id,user_id,token_hash,rate_key,address,items,package,origin,providers,packaging_cost_ars,status,expires_at,error_codes)
 values(p_request_id,p_user_id,extensions.digest(p_guest_token,'sha256'),p_rate_key,a,items,
  case when chosen is not null then jsonb_build_object('box_id',chosen->>'id','weight_g',w+(chosen->>'weight_g')::numeric,'length_cm',(chosen->>'outer_length_cm')::numeric,'width_cm',(chosen->>'outer_width_cm')::numeric,'height_cm',(chosen->>'outer_height_cm')::numeric,'declared_value_ars',value_ars) end,
  s->'origin',s->'providers',coalesce((chosen->>'cost_ars')::numeric+(chosen->>'protection_cost_ars')::numeric,0),case when jsonb_array_length(errors)>0 then 'needs_configuration' else 'preparing' end,now()+interval '15 minutes',errors) returning * into q;
 return jsonb_build_object('quote_id',q.id,'status',q.status,'package',q.package,'origin',q.origin,'destination',q.address,'providers',q.providers,'packaging_cost_ars',q.packaging_cost_ars,'expires_at',q.expires_at,'error_codes',q.error_codes);
end; $$;
