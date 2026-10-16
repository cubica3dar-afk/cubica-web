-- Trace finished-product reservations made by checkout and restore only those
-- reservations when an order is cancelled before production starts.

alter table public.inventory_movements drop constraint inventory_movements_reason_check;
alter table public.inventory_movements add constraint inventory_movements_reason_check
check(reason in ('production','cancelled_finished','manual_supply','manual_finished','checkout_reserved','checkout_restocked'));

create unique index inventory_checkout_reserved_once
  on public.inventory_movements(order_id,order_item_id) where reason='checkout_reserved';
create unique index inventory_checkout_restocked_once
  on public.inventory_movements(order_id,order_item_id) where reason='checkout_restocked';

create table private.inventory_movement_corrections (
  id bigint generated always as identity primary key,
  movement_id bigint not null references public.inventory_movements(id),
  order_id uuid not null references public.orders(id),
  correction_kind text not null check(correction_kind in ('qa_checkout_attribution')),
  previous_values jsonb not null,
  corrected_values jsonb not null,
  corrected_at timestamptz not null default now(),
  unique(movement_id,correction_kind)
);
alter table private.inventory_movement_corrections enable row level security;
revoke all on table private.inventory_movement_corrections from public,anon,authenticated,service_role;

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
      from public.products p where p.id=v_product_id and p.active=true for update;
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
      from public.products p where p.id=v_product_id and p.active=true for update;
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

create or replace function public.change_order_status(
  p_order_id uuid,p_status text,p_expected_version integer,
  p_accept_warnings boolean default false,p_plan_fingerprint text default null,
  p_cancellation jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.orders; v_plan jsonb; v_has_warnings boolean; v_row jsonb; v_item public.order_items;
  v_supply public.supplies; v_product public.products; v_required numeric; v_take numeric;
  v_missing numeric; v_qty integer; v_reserved integer;
  v_states text[]:=array['Pendiente','Confirmado','En producción','Preparado','Entregado'];
  v_current integer; v_next integer;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Pedido inexistente'; end if;
  if v_order.status=p_status then return public.get_order_management(p_order_id); end if;
  if v_order.lifecycle_version<>p_expected_version or p_expected_version is null then raise exception 'El pedido cambió. Actualizá la vista e intentá nuevamente.'; end if;
  if v_order.status in ('Entregado','Cancelado') then raise exception 'El pedido ya está cerrado'; end if;
  v_current:=array_position(v_states,v_order.status); v_next:=array_position(v_states,p_status);
  if p_status<>'Cancelado' and (v_next is null or v_next>v_current+1) then raise exception 'Avanzá un estado por vez'; end if;
  perform set_config('cubica.lifecycle_order',p_order_id::text,true);
  perform set_config('cubica.inventory_order',p_order_id::text,true);

  if p_status='En producción' and not exists(select 1 from public.order_material_consumptions where order_id=p_order_id) then
    perform p.id from public.products p where p.id in(select product_id from public.order_items where order_id=p_order_id) order by p.id for update;
    lock table public.product_recipes in share mode;
    perform s.id from public.supplies s where s.id in(
      select r.supply_id from public.product_recipes r join public.order_items i on i.product_id=r.product_id where i.order_id=p_order_id
    ) order by s.id for update;
    v_plan:=private.order_material_plan(p_order_id);
    v_has_warnings:=exists(select 1 from jsonb_array_elements(v_plan->'products') p where (p->>'recipe_missing')::boolean)
      or exists(select 1 from jsonb_array_elements(v_plan->'supplies') s where (s->>'missing')::numeric>0 or (s->>'inactive')::boolean);
    if v_has_warnings and (not p_accept_warnings or p_plan_fingerprint is distinct from md5(v_plan::text)) then
      perform set_config('cubica.inventory_order','',true); perform set_config('cubica.lifecycle_order','',true);
      return jsonb_build_object('confirmation_required',true,'plan',v_plan,'fingerprint',md5(v_plan::text),'order',to_jsonb(v_order));
    end if;
    insert into public.order_material_consumptions(order_id,actor_id,plan,warnings_accepted) values(p_order_id,auth.uid(),v_plan,v_has_warnings);
    for v_row in select value from jsonb_array_elements(v_plan->'supplies') loop
      select * into v_supply from public.supplies where id=v_row->>'supply_id';
      v_required:=(v_row->>'required')::numeric; v_take:=least(v_required,case when v_supply.active then v_supply.qty else 0 end); v_missing:=v_required-v_take;
      update public.supplies set qty=qty-v_take where id=v_supply.id;
      insert into public.inventory_movements(order_id,order_number,supply_id,name,unit,reason,quantity_before,quantity_after,required,deficit,actor_id)
        values(p_order_id,v_order.order_number,v_supply.id,v_supply.name,v_supply.unit,'production',v_supply.qty,v_supply.qty-v_take,v_required,v_missing,auth.uid());
    end loop;
  end if;

  if p_status='Cancelado' then
    if jsonb_typeof(p_cancellation) is distinct from 'array' then raise exception 'Decisión de cancelación inválida'; end if;
    if jsonb_array_length(p_cancellation)<>(select count(*) from public.order_items where order_id=p_order_id)
      or (select count(distinct value->>'item_id') from jsonb_array_elements(p_cancellation))<>jsonb_array_length(p_cancellation) then
      raise exception 'Indicá la decisión para cada producto';
    end if;
    for v_row in select value from jsonb_array_elements(p_cancellation) order by value->>'item_id' loop
      select * into v_item from public.order_items where order_id=p_order_id and id=(v_row->>'item_id')::bigint;
      if not found or coalesce(v_row->>'disposition','') not in ('unfinished','finished_standard','finished_personalized') then raise exception 'Decisión de cancelación inválida'; end if;
      if coalesce(v_row->>'qty','')!~'^[0-9]+$' then raise exception 'Cantidad inválida'; end if;
      v_qty:=(v_row->>'qty')::integer;
      if v_qty<0 or v_qty>v_item.qty or (v_row->>'disposition'='unfinished' and v_qty<>0) then raise exception 'Cantidad inválida'; end if;
      if v_row->>'disposition'<>'unfinished' and v_qty=0 then raise exception 'Indicá cuántas piezas están terminadas'; end if;
      if v_row->>'disposition'<>'unfinished' and v_order.production_started_at is null and v_order.status<>'Preparado' then raise exception 'El pedido no llegó a producción'; end if;

      if v_order.production_started_at is null and v_order.status<>'Preparado' then
        select greatest(-m.delta,0)::integer into v_reserved from public.inventory_movements m
          where m.order_id=p_order_id and m.order_item_id=v_item.id and m.reason='checkout_reserved';
        v_reserved:=coalesce(v_reserved,0);
        if v_reserved>0 and not exists(select 1 from public.inventory_movements m
          where m.order_id=p_order_id and m.order_item_id=v_item.id and m.reason='checkout_restocked') then
          select * into v_product from public.products where id=v_item.product_id for update;
          if not found then raise exception 'El producto ya no existe. No se puede restituir la reserva'; end if;
          update public.products set stock=v_product.stock+v_reserved where id=v_product.id;
          insert into public.inventory_movements(order_id,order_number,product_id,order_item_id,name,unit,reason,quantity_before,quantity_after,required,actor_id)
            values(p_order_id,v_order.order_number,v_product.id,v_item.id,v_product.name,'unidades','checkout_restocked',
              v_product.stock,v_product.stock+v_reserved,v_reserved,auth.uid());
        end if;
      end if;

      if v_row->>'disposition'='finished_standard' then
        select * into v_product from public.products where id=v_item.product_id for update;
        if not found then raise exception 'El producto ya no existe. No se puede incorporar al stock'; end if;
        update public.products set stock=v_product.stock+v_qty where id=v_product.id;
        insert into public.inventory_movements(order_id,order_number,product_id,order_item_id,name,unit,reason,quantity_before,quantity_after,actor_id)
          values(p_order_id,v_order.order_number,v_product.id,v_item.id,v_product.name,'unidades','cancelled_finished',
            v_product.stock,v_product.stock+v_qty,auth.uid());
      end if;
    end loop;
  end if;

  update public.orders set status=p_status,lifecycle_version=lifecycle_version+1,
    production_started_at=case when p_status='En producción' then coalesce(production_started_at,now()) else production_started_at end,
    ready_recorded=ready_recorded or p_status='Preparado' where id=p_order_id;
  insert into public.order_status_history(order_id,from_status,to_status,version,actor_id,cancellation)
    values(p_order_id,v_order.status,p_status,v_order.lifecycle_version+1,auth.uid(),case when p_status='Cancelado' then p_cancellation end);
  if p_status='Preparado' and not v_order.ready_recorded then
    insert into public.order_email_outbox(order_id,kind) values(p_order_id,'ready') on conflict do nothing;
  end if;
  perform set_config('cubica.inventory_order','',true); perform set_config('cubica.lifecycle_order','',true);
  return public.get_order_management(p_order_id);
end;
$$;

-- Reclassify only the single verified QA movement. Abort rather than guessing
-- if the recorded order, movement, stock or concurrency evidence changed.
do $$
declare
  v_order public.orders; v_item public.order_items; v_movement public.inventory_movements;
  v_before jsonb; v_after jsonb;
begin
  select * into v_order from public.orders where order_number='CUB-20261016-0200';
  if not found then return; end if;
  if v_order.status<>'Pendiente' or v_order.lifecycle_version<>0 or v_order.production_started_at is not null then
    raise exception 'QA order state changed; checkout movement attribution aborted';
  end if;
  select * into strict v_item from public.order_items where order_id=v_order.id;
  if v_item.product_id<>'p12' or v_item.qty<>1 then raise exception 'QA order item changed; checkout movement attribution aborted'; end if;
  select * into strict v_movement from public.inventory_movements
    where product_id=v_item.product_id and reason='manual_finished' and order_id is null and order_item_id is null and actor_id is null
      and quantity_before=5 and quantity_after=4 and delta=-1 and created_at=v_order.created_at;
  if (select stock from public.products where id=v_item.product_id)<>4 then raise exception 'QA product stock changed; checkout movement attribution aborted'; end if;
  if exists(select 1 from public.inventory_movements m where m.product_id=v_item.product_id
      and m.created_at between v_order.created_at-interval '10 minutes' and v_order.created_at+interval '10 minutes' and m.id<>v_movement.id)
    or exists(select 1 from public.order_items i join public.orders o on o.id=i.order_id where i.product_id=v_item.product_id
      and o.created_at between v_order.created_at-interval '10 minutes' and v_order.created_at+interval '10 minutes' and i.id<>v_item.id) then
    raise exception 'Concurrent QA product activity detected; checkout movement attribution aborted';
  end if;
  v_before:=to_jsonb(v_movement);
  update public.inventory_movements set order_id=v_order.id,order_number=v_order.order_number,order_item_id=v_item.id,
    reason='checkout_reserved',required=v_item.qty,deficit=v_item.qty-greatest(-v_movement.delta,0)
  where id=v_movement.id returning to_jsonb(public.inventory_movements.*) into v_after;
  insert into private.inventory_movement_corrections(movement_id,order_id,correction_kind,previous_values,corrected_values)
    values(v_movement.id,v_order.id,'qa_checkout_attribution',v_before,v_after);
end;
$$;

comment on table private.inventory_movement_corrections is
  'Append-only audit trail for narrowly verified inventory movement corrections.';
comment on index public.inventory_checkout_reserved_once is
  'At most one finished-stock reservation movement per order item.';
comment on index public.inventory_checkout_restocked_once is
  'Prevents a cancelled order item from restoring its checkout reservation twice.';
