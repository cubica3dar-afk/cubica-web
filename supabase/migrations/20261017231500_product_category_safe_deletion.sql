-- Corrección final de Etapa A: asignación válida y eliminación atómica de categorías.

create or replace function private.validate_product_category_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_active boolean;
  v_rename_cascade boolean;
begin
  if tg_op = 'INSERT' or new.category is distinct from old.category then
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('cubica:product-categories', 0));
    select c.active into v_target_active
    from public.product_categories c
    where c.name = new.category;
    v_rename_cascade := coalesce(tg_op = 'UPDATE'
      and current_setting('cubica.category_rename_from', true) = old.category
      and current_setting('cubica.category_rename_to', true) = new.category
      and private.is_admin(), false);
    if new.category is null or btrim(new.category) = ''
      or v_target_active is null
      or (not v_target_active and not v_rename_cascade) then
      raise exception 'La categoría seleccionada no existe o está desactivada' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_product_category_assignment() from public, anon, authenticated, service_role;

drop trigger if exists products_validate_category_assignment on public.products;
create trigger products_validate_category_assignment
before insert or update of category on public.products
for each row execute function private.validate_product_category_assignment();

create or replace function public.get_admin_product_category_delete_preview(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_category public.product_categories;
  v_count integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo administradores con MFA pueden administrar categorías' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Falta indicar la categoría' using errcode = '22023';
  end if;

  select * into v_category
  from public.product_categories c
  where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_name);
  if not found then
    raise exception 'Categoría inexistente' using errcode = 'P0002';
  end if;

  select count(*)::integer into v_count
  from public.products p
  where p.category = v_category.name;

  return jsonb_build_object(
    'name', v_category.name,
    'active', v_category.active,
    'product_count', v_count
  );
end;
$$;

revoke all on function public.get_admin_product_category_delete_preview(text) from public, anon, service_role;
grant execute on function public.get_admin_product_category_delete_preview(text) to authenticated;

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
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_new_name text := regexp_replace(btrim(coalesce(p_new_name, '')), '\s+', ' ', 'g');
  v_category public.product_categories;
  v_target public.product_categories;
  v_product_count integer := 0;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo administradores con MFA pueden administrar categorías' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'El nombre de categoría debe contener entre 1 y 40 caracteres' using errcode = '22023';
  end if;

  -- Una escritura de productos toma el mismo bloqueo en modo compartido. La eliminación
  -- usa modo exclusivo para que el conteo, la reasignación y el borrado no tengan carreras.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cubica:product-categories', 0));

  if v_action = 'create' then
    if exists (
      select 1 from public.product_categories c
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_name)
    ) then
      raise exception 'Esa categoría ya existe' using errcode = '23505';
    end if;
    insert into public.product_categories(name, sort_order, active)
    values(v_name, coalesce((select max(sort_order) + 10 from public.product_categories), 10), true)
    returning * into v_category;

  elsif v_action = 'rename' then
    if v_new_name = '' or char_length(v_new_name) > 40 then
      raise exception 'El nuevo nombre debe contener entre 1 y 40 caracteres' using errcode = '22023';
    end if;
    select * into v_category from public.product_categories c
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_name)
      for update;
    if not found then raise exception 'Categoría inexistente' using errcode = 'P0002'; end if;
    if exists (
      select 1 from public.product_categories c
      where c.name <> v_category.name
        and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_new_name)
    ) then
      raise exception 'Esa categoría ya existe' using errcode = '23505';
    end if;
    -- La FK products_category_fkey propaga el cambio a todos los productos. Las marcas
    -- locales permiten únicamente esta cascada aunque la categoría histórica esté inactiva.
    perform set_config('cubica.category_rename_from', v_category.name, true);
    perform set_config('cubica.category_rename_to', v_new_name, true);
    update public.product_categories set name = v_new_name
    where name = v_category.name returning * into v_category;
    perform set_config('cubica.category_rename_from', '', true);
    perform set_config('cubica.category_rename_to', '', true);

  elsif v_action = 'set_active' then
    if p_active is null then raise exception 'Falta indicar el estado de la categoría' using errcode = '22023'; end if;
    update public.product_categories c set active = p_active
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_name)
      returning * into v_category;
    if not found then raise exception 'Categoría inexistente' using errcode = 'P0002'; end if;

  elsif v_action = 'delete' then
    select * into v_category from public.product_categories c
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_name)
      for update;
    if not found then raise exception 'Categoría inexistente' using errcode = 'P0002'; end if;

    select count(*)::integer into v_product_count
    from public.products p where p.category = v_category.name;

    if v_product_count > 0 then
      if v_new_name = '' then
        raise exception 'La categoría tiene % productos asociados; indicá una categoría de destino', v_product_count using errcode = '23503';
      end if;
      select * into v_target from public.product_categories c
        where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = lower(v_new_name)
        for update;
      if not found then raise exception 'La categoría de destino no existe' using errcode = 'P0002'; end if;
      if v_target.name = v_category.name then raise exception 'La categoría de destino debe ser diferente' using errcode = '22023'; end if;
      if not v_target.active then raise exception 'La categoría de destino debe estar activa' using errcode = '23514'; end if;

      update public.products set category = v_target.name where category = v_category.name;
    end if;

    delete from public.product_categories where name = v_category.name;
    return jsonb_build_object(
      'deleted', true,
      'name', v_category.name,
      'reassigned_count', v_product_count,
      'destination', case when v_product_count > 0 then v_target.name else null end
    );

  else
    raise exception 'Acción de categoría inválida' using errcode = '22023';
  end if;

  return jsonb_build_object('name', v_category.name, 'sort_order', v_category.sort_order, 'active', v_category.active);
end;
$$;

revoke all on function public.manage_admin_product_category(text, text, text, boolean) from public, anon, service_role;
grant execute on function public.manage_admin_product_category(text, text, text, boolean) to authenticated;

create or replace function public.convert_admin_quote_to_product(
  p_quote_id text,
  p_name text,
  p_description text,
  p_category text default null,
  p_recipe jsonb default '[]'::jsonb,
  p_request_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.quote_versions;
  pid text := gen_random_uuid()::text;
  r jsonb;
  prior text;
  v_category text;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo administradores con MFA' using errcode = '42501';
  end if;
  select destination_id into prior from public.quote_conversions where request_id = p_request_id;
  if found then return jsonb_build_object('product_id', prior, 'idempotent', true); end if;

  select * into q from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'Presupuesto inexistente'; end if;
  if q.status <> 'accepted' then raise exception 'El presupuesto debe estar aceptado'; end if;
  if exists(select 1 from public.quote_conversions where quote_id = q.id and kind = 'product') then
    raise exception 'El presupuesto ya fue convertido en producto';
  end if;
  select * into v from public.quote_versions where quote_id = q.id and version = q.current_version;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Nombre inválido'; end if;
  if jsonb_typeof(p_recipe) <> 'array' then raise exception 'Receta inválida'; end if;

  select c.name into v_category
  from public.product_categories c
  where c.name = btrim(coalesce(p_category, '')) and c.active
  for key share;
  if not found then
    raise exception 'Seleccioná una categoría activa para el nuevo producto' using errcode = '23514';
  end if;

  perform set_config('cubica.inventory_order', 'quote-product:' || q.id, true);
  insert into public.products(id, name, category, description, price, stock, color_mode, active, published, sort_order)
  values(pid, left(p_name, 160), v_category, left(coalesce(p_description, ''), 1200), v.total, 0, 'single', true, false,
    coalesce((select max(sort_order) + 10 from public.products), 10));
  for r in select value from jsonb_array_elements(p_recipe) loop
    if not exists(select 1 from public.supplies where id = r->>'supply_id')
      or (r->>'qty_per_unit')::numeric <= 0 then raise exception 'Receta inválida'; end if;
    insert into public.product_recipes(product_id, supply_id, qty_per_unit)
    values(pid, r->>'supply_id', (r->>'qty_per_unit')::numeric);
  end loop;
  perform set_config('cubica.inventory_order', '', true);
  insert into public.quote_conversions(quote_id, version_id, kind, destination_id, request_id, actor_id)
  values(q.id, v.id, 'product', pid, p_request_id, auth.uid());
  update public.quotes set status = 'converted', converted_at = now(), converted_product_id = pid,
    updated_at = clock_timestamp(), updated_by = auth.uid() where id = q.id;
  insert into public.quote_status_history(quote_id, from_status, to_status, version, actor_id, details)
  values(q.id, 'accepted', 'converted', q.current_version, auth.uid(),
    jsonb_build_object('kind', 'product', 'destination_id', pid));
  return jsonb_build_object('product_id', pid, 'published', false, 'stock', 0, 'category', v_category);
end;
$$;

revoke all on function public.convert_admin_quote_to_product(text, text, text, text, jsonb, uuid) from public, anon, service_role;
grant execute on function public.convert_admin_quote_to_product(text, text, text, text, jsonb, uuid) to authenticated;

comment on function public.manage_admin_product_category(text, text, text, boolean)
  is 'Administra categorías con autorización admin AAL2; delete revalida asociaciones y reasigna productos atómicamente cuando corresponde.';
comment on function public.get_admin_product_category_delete_preview(text)
  is 'Devuelve a un administrador AAL2 el conteo actual para confirmar una eliminación; la mutación vuelve a validarlo.';
