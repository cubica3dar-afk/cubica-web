-- Secure publication state for catalog products.
-- Existing active products stay visible; new products are hidden by default.
alter table public.products add column if not exists published boolean;
update public.products set published=true where published is null;
alter table public.products alter column published set default false;
alter table public.products alter column published set not null;
comment on column public.products.published is 'Controls public catalog, detail, community and checkout availability independently from active inventory state.';

create index if not exists products_public_catalog_idx
  on public.products(sort_order,created_at,id)
  where active and published;
create index if not exists products_admin_filters_idx
  on public.products(active,published,category,created_at,id);
create index if not exists supplies_admin_filters_idx
  on public.supplies(active,category,brand,material_type,id);

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon,authenticated
  using (active=true and published=true);

drop policy if exists product_colors_public_read on public.product_colors;
create policy product_colors_public_read on public.product_colors
  for select to anon,authenticated
  using (exists(
    select 1 from public.products p
    where p.id=product_colors.product_id and p.active=true and p.published=true
  ));

drop policy if exists product_media_public_read on public.product_media;
create policy product_media_public_read on public.product_media
  for select to anon,authenticated
  using (exists(
    select 1 from public.products p
    where p.id=product_media.product_id and p.active=true and p.published=true
  ));
create or replace function public.save_admin_inventory_row(p_table text,p_row jsonb,p_expected numeric,p_change_stock boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_stock numeric; v_exists boolean;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 if p_change_stock is null then raise exception 'Indicá si cambia el stock'; end if;
 if p_table='supplies' then
  select qty into v_stock from public.supplies where id=p_row->>'id' for update;
  v_exists:=found;
  if v_exists and p_change_stock and v_stock is distinct from p_expected then raise exception 'El stock cambió. Actualizá el inventario antes de editarlo.'; end if;
  insert into public.supplies(id,name,category,cost,qty,unit,material_type,brand,color_name,color_hex,sort_order,active)
  values(p_row->>'id',p_row->>'name',p_row->>'category',(p_row->>'cost')::numeric,
   case when v_exists and not p_change_stock then v_stock else (p_row->>'qty')::numeric end,
   p_row->>'unit',p_row->>'material_type',p_row->>'brand',p_row->>'color_name',p_row->>'color_hex',(p_row->>'sort_order')::integer,(p_row->>'active')::boolean)
  on conflict(id) do update set name=excluded.name,category=excluded.category,cost=excluded.cost,qty=excluded.qty,unit=excluded.unit,
   material_type=excluded.material_type,brand=excluded.brand,color_name=excluded.color_name,color_hex=excluded.color_hex,sort_order=excluded.sort_order,active=excluded.active;
 elsif p_table='products' then
  select stock into v_stock from public.products where id=p_row->>'id' for update;
  v_exists:=found;
  if v_exists and p_change_stock and v_stock is distinct from p_expected then raise exception 'El stock cambió. Actualizá el catálogo antes de editarlo.'; end if;
  insert into public.products(id,name,category,description,price,stock,color_mode,sort_order,active,published)
  values(p_row->>'id',p_row->>'name',p_row->>'category',p_row->>'description',(p_row->>'price')::numeric,
    case when v_exists and not p_change_stock then v_stock::integer else (p_row->>'stock')::integer end,
    p_row->>'color_mode',(p_row->>'sort_order')::integer,(p_row->>'active')::boolean,coalesce((p_row->>'published')::boolean,false))
  on conflict(id) do update set name=excluded.name,category=excluded.category,description=excluded.description,price=excluded.price,
   stock=excluded.stock,color_mode=excluded.color_mode,sort_order=excluded.sort_order,active=excluded.active,published=excluded.published;
 else raise exception 'Inventario inválido'; end if;
end;
$$;

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
  select * into p from public.products where id=x->>'product_id' and active and published;
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

create or replace function public.create_public_order(
  p_client_order_id text,p_customer_name text,p_customer_email text,
  p_phone text default '',p_payment text default '',p_notes text default '',
  p_items jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order_id uuid; v_order_number text; v_total numeric(14,2):=0; v_item jsonb;
  v_product_id text; v_name text; v_price numeric(14,2); v_stock integer;
  v_qty integer; v_color text; v_order_item_id bigint; v_reserved integer;
begin
  if length(btrim(coalesce(p_customer_name,'')))<2 or length(btrim(coalesce(p_customer_name,'')))>120 then raise exception 'Nombre inválido'; end if;
  if length(btrim(coalesce(p_customer_email,'')))<5 or length(btrim(coalesce(p_customer_email,'')))>180
    or btrim(p_customer_email)!~*'^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then raise exception 'Email inválido'; end if;
  if length(coalesce(p_phone,''))>80 then raise exception 'Teléfono inválido'; end if;
  if length(coalesce(p_notes,''))>1500 then raise exception 'Observaciones demasiado largas'; end if;
  if coalesce(p_payment,'') not in ('Efectivo','Transferencia') then raise exception 'Forma de pago inválida'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'Pedido inválido'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=nullif(btrim(v_item->>'product_id'),'');
    v_color:=left(coalesce(v_item->>'color',''),120);
    if v_product_id is null then raise exception 'Producto inválido'; end if;
    if coalesce(v_item->>'qty','')!~'^[0-9]+$' then raise exception 'Cantidad inválida'; end if;
    v_qty:=(v_item->>'qty')::integer;
    if v_qty<1 or v_qty>100 then raise exception 'Cantidad inválida'; end if;
    select p.name,p.price,p.stock into v_name,v_price,v_stock
      from public.products p where p.id=v_product_id and p.active=true and p.published=true for update;
    if not found then raise exception 'Producto no disponible'; end if;
    v_total:=v_total+(v_price*v_qty);
  end loop;
  if v_total<=0 or v_total>100000000 then raise exception 'Total inválido'; end if;

  insert into public.orders(client_order_id,user_id,customer_name,customer_email,phone,payment,notes,total,status,username)
  values(nullif(left(coalesce(p_client_order_id,''),160),''),(select auth.uid()),btrim(p_customer_name),
    lower(btrim(p_customer_email)),left(coalesce(p_phone,''),80),p_payment,coalesce(p_notes,''),v_total,'Pendiente','guest')
  returning id,order_number into v_order_id,v_order_number;

  -- Suppress the generic manual-adjustment trigger and record one explicit
  -- reservation per item, including partial and zero reservations.
  perform set_config('cubica.inventory_order',v_order_id::text,true);
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id:=btrim(v_item->>'product_id'); v_qty:=(v_item->>'qty')::integer;
    v_color:=left(coalesce(v_item->>'color',''),120);
    select p.name,p.price,p.stock into v_name,v_price,v_stock
      from public.products p where p.id=v_product_id and p.active=true and p.published=true for update;
    insert into public.order_items(order_id,product_id,name,color,qty,unit_price)
      values(v_order_id,v_product_id,v_name,v_color,v_qty,v_price) returning id into v_order_item_id;
    v_reserved:=least(v_qty,v_stock);
    if v_reserved>0 then update public.products set stock=v_stock-v_reserved where id=v_product_id; end if;
    insert into public.inventory_movements(
      order_id,order_number,product_id,order_item_id,name,unit,reason,
      quantity_before,quantity_after,required,deficit,actor_id
    ) values(v_order_id,v_order_number,v_product_id,v_order_item_id,v_name,'unidades','checkout_reserved',
      v_stock,v_stock-v_reserved,v_qty,v_qty-v_reserved,auth.uid());
  end loop;
  perform set_config('cubica.inventory_order','',true);
  return jsonb_build_object('ok',true,'order_id',v_order_id,'order_number',v_order_number,'total',v_total);
end;
$$;

create or replace function private.community_comment_visible(p_id bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.community_comments c where c.id=p_id and c.status='published' and c.deleted_at is null
 and (c.parent_id is null or exists(select 1 from private.community_comments p where p.id=c.parent_id and p.status='published'))
 and exists(select 1 from public.products p where p.id=c.product_id and p.active and p.published));
$$;

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
 verified as (select distinct o.user_id from public.orders o join public.order_items i on i.order_id=o.id where o.status='Entregado' and i.product_id=p_product_id and o.user_id in(select user_id from page))
 select jsonb_build_object('comments',coalesce(jsonb_agg(jsonb_build_object('id',c.id,'parent_id',c.parent_id,
   'body',case when c.deleted_at is null then c.body end,'deleted',c.deleted_at is not null,'created_at',c.created_at,'edited_at',c.edited_at,
   'author',case when c.deleted_at is null then private.community_identity(p.display_name,coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture')) end,
   'is_owner',c.deleted_at is null and c.user_id=auth.uid(),'verified_purchase',c.deleted_at is null and v.user_id is not null,
   'likes',case when c.deleted_at is null then coalesce(l.n,0) else 0 end,'my_like',c.deleted_at is null and coalesce(l.mine,false),
   'reply_count',coalesce(r.n,0),'can_edit',c.deleted_at is null and c.user_id=auth.uid() and not exists(select 1 from private.community_comments child where child.parent_id=c.id)
  ) order by c.id desc),'[]'::jsonb),'has_more',(select count(*)>lim from selected),'next_cursor',(select min(id) from page))
 into result from page c left join public.profiles p on p.id=c.user_id left join auth.users u on u.id=c.user_id
 left join likes l on l.comment_id=c.id left join replies r on r.parent_id=c.id left join verified v on v.user_id=c.user_id;
 return result||jsonb_build_object('product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),
  'my_reaction',coalesce((select reaction from private.product_reactions where product_id=p_product_id and user_id=auth.uid()),0));
end;
$$;

create or replace function private.set_product_reaction(p_product_id text,p_reaction integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 if p_reaction is null or p_reaction not in (-1,0,1) then raise exception 'Reacción inválida'; end if;
 if not exists(select 1 from public.products where id=p_product_id and active and published) then raise exception 'Producto no disponible'; end if;
 if p_reaction=0 then delete from private.product_reactions where product_id=p_product_id and user_id=auth.uid();
 else insert into private.product_reactions(product_id,user_id,reaction) values(p_product_id,auth.uid(),p_reaction)
  on conflict(product_id,user_id) do update set reaction=excluded.reaction,updated_at=case when private.product_reactions.reaction<>excluded.reaction then now() else private.product_reactions.updated_at end; end if;
 return jsonb_build_object('product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),'my_reaction',p_reaction);
end;
$$;

create or replace function private.create_community_comment(p_product_id text,p_body text,p_request_id uuid,p_parent_id bigint default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare existing private.community_comments; new_id bigint;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 if p_request_id is null or char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Escribí entre 1 y 2000 caracteres'; end if;
 if not exists(select 1 from public.products where id=p_product_id and active and published) then raise exception 'Producto no disponible'; end if;
 insert into private.community_comments(product_id,user_id,parent_id,body,request_id) values(p_product_id,auth.uid(),p_parent_id,btrim(p_body),p_request_id)
 on conflict(user_id,request_id) do nothing returning id into new_id;
 if new_id is null then
  select * into existing from private.community_comments where user_id=auth.uid() and request_id=p_request_id;
  if existing.product_id<>p_product_id or existing.parent_id is distinct from p_parent_id then raise exception 'Referencia de comentario inválida'; end if;
  new_id:=existing.id;
 end if;
 return new_id;
end;
$$;
-- Preserve the existing narrow execution surface.
revoke all on function public.save_admin_inventory_row(text,jsonb,numeric,boolean) from public,anon;
grant execute on function public.save_admin_inventory_row(text,jsonb,numeric,boolean) to authenticated;
revoke all on function private.delivery_items(jsonb) from public,anon,authenticated;
revoke all on function private.community_comment_visible(bigint) from public,anon,authenticated;

do $$
begin
  if exists(select 1 from public.products where published is null) then
    raise exception 'products.published contains null values';
  end if;
  if not exists(
    select 1 from pg_policies
    where schemaname='public' and tablename='products' and policyname='products_public_read'
      and qual ilike '%published%'
  ) then
    raise exception 'products_public_read does not enforce publication';
  end if;
end;
$$;

