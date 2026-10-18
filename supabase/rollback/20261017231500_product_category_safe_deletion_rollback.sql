-- Recuperación no destructiva para 20261017231500_product_category_safe_deletion.sql.
-- Retira la validación nueva y restaura las dos RPC a sus definiciones anteriores.

drop trigger if exists products_validate_category_assignment on public.products;
drop function if exists private.validate_product_category_assignment();
drop function if exists public.get_admin_product_category_delete_preview(text);

create or replace function public.manage_admin_product_category(
  p_action text,
  p_name text,
  p_new_name text default null,
  p_active boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_name text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_new_name text := regexp_replace(btrim(coalesce(p_new_name,'')), '\s+', ' ', 'g');
  v_category public.product_categories;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo administradores con MFA pueden administrar categorías' using errcode='42501';
  end if;
  if v_name='' or char_length(v_name)>40 then
    raise exception 'El nombre de categoría debe contener entre 1 y 40 caracteres' using errcode='22023';
  end if;
  if v_action='create' then
    if exists(select 1 from public.product_categories c where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))=lower(v_name)) then
      raise exception 'Esa categoría ya existe' using errcode='23505';
    end if;
    insert into public.product_categories(name,sort_order,active)
    values(v_name,coalesce((select max(sort_order)+10 from public.product_categories),10),true)
    returning * into v_category;
  elsif v_action='rename' then
    if v_new_name='' or char_length(v_new_name)>40 then
      raise exception 'El nuevo nombre debe contener entre 1 y 40 caracteres' using errcode='22023';
    end if;
    select * into v_category from public.product_categories c
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))=lower(v_name) for update;
    if not found then raise exception 'Categoría inexistente' using errcode='P0002'; end if;
    if exists(select 1 from public.product_categories c where c.name<>v_category.name and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))=lower(v_new_name)) then
      raise exception 'Esa categoría ya existe' using errcode='23505';
    end if;
    update public.products set category=v_new_name where category=v_category.name;
    update public.product_categories set name=v_new_name where name=v_category.name returning * into v_category;
  elsif v_action='set_active' then
    if p_active is null then raise exception 'Falta indicar el estado de la categoría' using errcode='22023'; end if;
    update public.product_categories c set active=p_active
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))=lower(v_name)
      returning * into v_category;
    if not found then raise exception 'Categoría inexistente' using errcode='P0002'; end if;
  else
    raise exception 'Acción de categoría inválida' using errcode='22023';
  end if;
  return jsonb_build_object('name',v_category.name,'sort_order',v_category.sort_order,'active',v_category.active);
end;
$$;

revoke all on function public.manage_admin_product_category(text,text,text,boolean) from public,anon,service_role;
grant execute on function public.manage_admin_product_category(text,text,text,boolean) to authenticated;

create or replace function public.convert_admin_quote_to_product(
  p_quote_id text,p_name text,p_description text,p_category text default null,
  p_recipe jsonb default '[]'::jsonb,p_request_id uuid default gen_random_uuid()
) returns jsonb
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

revoke all on function public.convert_admin_quote_to_product(text,text,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.convert_admin_quote_to_product(text,text,text,text,jsonb,uuid) to authenticated;
