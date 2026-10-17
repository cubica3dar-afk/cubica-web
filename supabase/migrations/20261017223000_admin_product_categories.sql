-- Etapa A: administración atómica de categorías de productos terminados.
-- Mantiene la tabla existente y protege toda mutación con el control admin AAL2.

create unique index if not exists product_categories_normalized_name_uidx
  on public.product_categories (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

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
      where lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))=lower(v_name)
      for update;
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

comment on function public.manage_admin_product_category(text,text,text,boolean)
  is 'Crea, renombra o activa/desactiva categorías de productos con autorización admin AAL2; el renombrado actualiza productos en la misma transacción.';

