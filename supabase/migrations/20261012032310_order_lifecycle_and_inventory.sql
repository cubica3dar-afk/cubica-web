-- Existing checkout, RLS policies, initial email outbox and nonnegative stock remain intact.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('Pendiente','Confirmado','En producción','Preparado','Entregado','Cancelado'));
alter table public.orders add column lifecycle_version integer not null default 0,
  add column production_started_at timestamptz,
  add column ready_recorded boolean not null default false,
  add column ready_email_sent boolean not null default false;
-- Baseline existing fulfilled orders without inventing transition dates or consuming stock.
update public.orders set ready_recorded=true where status in ('Preparado','Entregado');
alter table public.order_email_outbox drop constraint order_email_outbox_kind_check;
alter table public.order_email_outbox add constraint order_email_outbox_kind_check check (kind in ('customer','internal','ready'));

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text not null, to_status text not null,
  version integer not null, actor_id uuid, created_at timestamptz not null default now(),
  cancellation jsonb,
  unique(order_id,version)
);
create table public.order_material_consumptions (
  order_id uuid primary key references public.orders(id) on delete cascade,
  created_at timestamptz not null default now(), actor_id uuid,
  plan jsonb not null, warnings_accepted boolean not null
);
create table public.inventory_movements (
  id bigint generated always as identity primary key,
  order_id uuid, order_number text,
  supply_id text, product_id text, order_item_id bigint,
  name text not null, unit text not null,
  reason text not null check(reason in ('production','cancelled_finished','manual_supply','manual_finished')),
  quantity_before numeric not null, quantity_after numeric not null,
  delta numeric generated always as (quantity_after-quantity_before) stored,
  required numeric not null default 0 check(required>=0),
  deficit numeric not null default 0 check(deficit>=0),
  actor_id uuid, created_at timestamptz not null default now(),
  check ((supply_id is not null)::integer+(product_id is not null)::integer=1)
);
create unique index inventory_production_once on public.inventory_movements(order_id,supply_id) where reason='production';
create unique index inventory_cancelled_finished_once on public.inventory_movements(order_id,order_item_id) where reason='cancelled_finished';
create index inventory_movements_order on public.inventory_movements(order_id,created_at);
create index inventory_movements_supply on public.inventory_movements(supply_id,created_at);
create index inventory_movements_product on public.inventory_movements(product_id,created_at);
alter table public.order_status_history enable row level security;
alter table public.order_material_consumptions enable row level security;
alter table public.inventory_movements enable row level security;
create policy history_admin_read on public.order_status_history for select to authenticated using ((select private.is_admin()));
create policy consumption_admin_read on public.order_material_consumptions for select to authenticated using ((select private.is_admin()));
create policy movements_admin_read on public.inventory_movements for select to authenticated using ((select private.is_admin()));
revoke all on public.order_status_history,public.order_material_consumptions,public.inventory_movements from anon,authenticated;
grant select on public.order_status_history,public.order_material_consumptions,public.inventory_movements to authenticated;

create function private.order_material_plan(p_order_id uuid) returns jsonb
language sql stable set search_path='' as $$
with ordered as (
  select product_id,min(name) name,sum(qty) qty from public.order_items where order_id=p_order_id group by product_id
), needed as (
  select r.supply_id,sum(r.qty_per_unit*o.qty) required from ordered o
  join public.product_recipes r on r.product_id=o.product_id group by r.supply_id
)
select jsonb_build_object(
 'products',coalesce((select jsonb_agg(jsonb_build_object('product_id',o.product_id,'name',o.name,'qty',o.qty,
   'recipe_missing',not exists(select 1 from public.product_recipes r where r.product_id=o.product_id)) order by o.name) from ordered o),'[]'::jsonb),
 'supplies',coalesce((select jsonb_agg(jsonb_build_object('supply_id',s.id,'name',s.name,'unit',s.unit,
   'required',n.required,'available',case when s.active then s.qty else 0 end,'physical_stock',s.qty,'inactive',not s.active,
   'missing',greatest(n.required-case when s.active then s.qty else 0 end,0)) order by s.id)
   from needed n join public.supplies s on s.id=n.supply_id),'[]'::jsonb)
);
$$;
revoke all on function private.order_material_plan(uuid) from public,anon,authenticated;

create function public.get_order_management(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_order public.orders; v_plan jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 select * into v_order from public.orders where id=p_order_id;
 if not found then raise exception 'Pedido inexistente'; end if;
 v_plan:=private.order_material_plan(p_order_id);
 return jsonb_build_object('order',to_jsonb(v_order),
  'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where order_id=p_order_id),'[]'::jsonb),
  'plan',v_plan,'fingerprint',md5(v_plan::text),
  'consumption',(select to_jsonb(c) from public.order_material_consumptions c where order_id=p_order_id),
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by version desc) from public.order_status_history h where order_id=p_order_id),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(to_jsonb(m) order by id desc) from public.inventory_movements m where order_id=p_order_id),'[]'::jsonb));
end;
$$;

-- All status writes must use the transactional RPC (including admin REST updates).
create function private.guard_order_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.status is distinct from old.status or new.production_started_at is distinct from old.production_started_at
     or new.lifecycle_version is distinct from old.lifecycle_version or new.ready_recorded is distinct from old.ready_recorded)
    and current_setting('cubica.lifecycle_order',true) is distinct from new.id::text then
   raise exception 'Cambiar el estado mediante change_order_status';
 end if;
 return new;
end;
$$;
create trigger orders_guard_lifecycle before update on public.orders for each row execute function private.guard_order_lifecycle();
revoke all on function private.guard_order_lifecycle() from public,anon,authenticated;

create function private.audit_inventory_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare v_before numeric; v_after numeric;
begin
 if tg_table_name='supplies' then v_before:=old.qty; v_after:=new.qty;
 else v_before:=old.stock; v_after:=new.stock; end if;
 if v_before is distinct from v_after and coalesce(current_setting('cubica.inventory_order',true),'')='' then
  insert into public.inventory_movements(supply_id,product_id,name,unit,reason,quantity_before,quantity_after,actor_id)
  values(case when tg_table_name='supplies' then new.id end,case when tg_table_name='products' then new.id end,
   new.name,case when tg_table_name='supplies' then to_jsonb(new)->>'unit' else 'unidades' end,
   case when tg_table_name='supplies' then 'manual_supply' else 'manual_finished' end,v_before,v_after,auth.uid());
 end if;
 return new;
end;
$$;
create trigger supplies_audit_stock after update of qty on public.supplies for each row execute function private.audit_inventory_stock();
create trigger products_audit_stock after update of stock on public.products for each row execute function private.audit_inventory_stock();
revoke all on function private.audit_inventory_stock() from public,anon,authenticated;

create function public.change_order_status(p_order_id uuid,p_status text,p_expected_version integer,
 p_accept_warnings boolean default false,p_plan_fingerprint text default null,p_cancellation jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.orders; v_plan jsonb; v_has_warnings boolean; v_row jsonb; v_item public.order_items;
 v_supply public.supplies; v_product public.products; v_required numeric; v_take numeric; v_missing numeric; v_qty integer;
 v_states text[]:=array['Pendiente','Confirmado','En producción','Preparado','Entregado']; v_current integer; v_next integer;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found then raise exception 'Pedido inexistente'; end if;
 if v_order.status=p_status then return public.get_order_management(p_order_id); end if;
 if v_order.lifecycle_version<>p_expected_version or p_expected_version is null then
   raise exception 'El pedido cambió. Actualizá la vista e intentá nuevamente.';
 end if;
 if v_order.status in ('Entregado','Cancelado') then raise exception 'El pedido ya está cerrado'; end if;
 v_current:=array_position(v_states,v_order.status); v_next:=array_position(v_states,p_status);
 if p_status<>'Cancelado' and (v_next is null or v_next>v_current+1) then raise exception 'Avanzá un estado por vez'; end if;
 perform set_config('cubica.lifecycle_order',p_order_id::text,true);
 perform set_config('cubica.inventory_order',p_order_id::text,true);
 if p_status='En producción' and not exists(select 1 from public.order_material_consumptions where order_id=p_order_id) then
   -- Lock catalog before supplies, same order as checkout. Freeze recipe writes while snapshotting.
   perform p.id from public.products p where p.id in(select product_id from public.order_items where order_id=p_order_id) order by p.id for update;
   lock table public.product_recipes in share mode;
   perform s.id from public.supplies s where s.id in(
    select r.supply_id from public.product_recipes r join public.order_items i on i.product_id=r.product_id where i.order_id=p_order_id
   ) order by s.id for update;
   v_plan:=private.order_material_plan(p_order_id);
   v_has_warnings:=exists(select 1 from jsonb_array_elements(v_plan->'products') p where (p->>'recipe_missing')::boolean)
      or exists(select 1 from jsonb_array_elements(v_plan->'supplies') s where (s->>'missing')::numeric>0 or (s->>'inactive')::boolean);
   if v_has_warnings and (not p_accept_warnings or p_plan_fingerprint is distinct from md5(v_plan::text)) then
    perform set_config('cubica.inventory_order','',true);
    perform set_config('cubica.lifecycle_order','',true);
    return jsonb_build_object('confirmation_required',true,'plan',v_plan,'fingerprint',md5(v_plan::text),'order',to_jsonb(v_order));
   end if;
   insert into public.order_material_consumptions(order_id,actor_id,plan,warnings_accepted)
     values(p_order_id,auth.uid(),v_plan,v_has_warnings);
   for v_row in select value from jsonb_array_elements(v_plan->'supplies') loop
     select * into v_supply from public.supplies where id=v_row->>'supply_id';
     v_required:=(v_row->>'required')::numeric;
     v_take:=least(v_required,case when v_supply.active then v_supply.qty else 0 end);
     v_missing:=v_required-v_take;
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
    if coalesce(v_row->>'qty','') !~ '^[0-9]+$' then raise exception 'Cantidad inválida'; end if;
    v_qty:=(v_row->>'qty')::integer;
    if v_qty<0 or v_qty>v_item.qty or (v_row->>'disposition'='unfinished' and v_qty<>0) then raise exception 'Cantidad inválida'; end if;
    if v_row->>'disposition'<>'unfinished' and v_qty=0 then raise exception 'Indicá cuántas piezas están terminadas'; end if;
    if v_row->>'disposition'<>'unfinished' and v_order.production_started_at is null and v_order.status<>'Preparado' then
       raise exception 'El pedido no llegó a producción'; end if;
    if v_row->>'disposition'='finished_standard' then
      select * into v_product from public.products where id=v_item.product_id for update;
      if not found then raise exception 'El producto ya no existe. No se puede incorporar al stock'; end if;
      update public.products set stock=stock+v_qty where id=v_product.id;
      insert into public.inventory_movements(order_id,order_number,product_id,order_item_id,name,unit,reason,quantity_before,quantity_after,actor_id)
       values(p_order_id,v_order.order_number,v_product.id,v_item.id,v_product.name,'unidades','cancelled_finished',v_product.stock,v_product.stock+v_qty,auth.uid());
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
 perform set_config('cubica.inventory_order','',true);
 perform set_config('cubica.lifecycle_order','',true);
 return public.get_order_management(p_order_id);
end;
$$;

-- Explicit backend projections: customers never receive production data or raw statuses.
create function public.get_customer_orders() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'user_id',o.user_id,
  'created_at',o.created_at,'customer_name',o.customer_name,'customer_email',o.customer_email,
  'phone',o.phone,'payment',o.payment,'notes',o.notes,'total',o.total,
  'status',case when o.status='Preparado' then 'Listo para entregar' when o.status in ('Entregado','Cancelado') then o.status else 'Pedido recibido' end,
  'order_items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'name',i.name,'color',i.color,'qty',i.qty,'unit_price',i.unit_price)),'[]'::jsonb) from public.order_items i where i.order_id=o.id)) order by o.created_at desc),'[]'::jsonb)
 from public.orders o where o.user_id=(select auth.uid());
$$;
create function public.get_admin_orders() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('order_items',
  (select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.order_items i where i.order_id=o.id)) order by o.created_at desc),'[]'::jsonb) from public.orders o);
end;
$$;
-- Keep RLS predicates intact; remove access to internal order columns via REST.
revoke select on public.orders from authenticated;
grant select(id,order_number,client_order_id,user_id,created_at,customer_name,customer_email,phone,payment,notes,total,username) on public.orders to authenticated;
revoke all on function public.get_customer_orders(),public.get_admin_orders(),public.get_order_management(uuid),public.change_order_status(uuid,text,integer,boolean,text,jsonb) from public,anon;
grant execute on function public.get_customer_orders(),public.get_admin_orders(),public.get_order_management(uuid),public.change_order_status(uuid,text,integer,boolean,text,jsonb) to authenticated;

-- Compare only explicit stock edits; metadata edits preserve concurrent stock changes.
create function public.save_admin_inventory_row(p_table text,p_row jsonb,p_expected numeric,p_change_stock boolean)
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
  insert into public.products(id,name,category,description,price,stock,color_mode,sort_order,active)
  values(p_row->>'id',p_row->>'name',p_row->>'category',p_row->>'description',(p_row->>'price')::numeric,
    case when v_exists and not p_change_stock then v_stock::integer else (p_row->>'stock')::integer end,
    p_row->>'color_mode',(p_row->>'sort_order')::integer,(p_row->>'active')::boolean)
  on conflict(id) do update set name=excluded.name,category=excluded.category,description=excluded.description,price=excluded.price,
   stock=excluded.stock,color_mode=excluded.color_mode,sort_order=excluded.sort_order,active=excluded.active;
 else raise exception 'Inventario inválido'; end if;
end;
$$;
revoke all on function public.save_admin_inventory_row(text,jsonb,numeric,boolean) from public,anon;
grant execute on function public.save_admin_inventory_row(text,jsonb,numeric,boolean) to authenticated;
CREATE OR REPLACE FUNCTION public.finish_order_email_delivery(p_order_id uuid, p_kind text, p_lock_token uuid, p_sent boolean, p_provider_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text, p_retryable boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_attempt integer; v_status text;
begin
  select attempts into v_attempt from public.order_email_outbox
  where order_id=p_order_id and kind=p_kind and lock_token=p_lock_token and status='processing'
  for update;
  if not found then raise exception 'Lease de email vencido'; end if;
  v_status := case when p_sent then 'sent' when not p_retryable then 'failed'
    when v_attempt>=10 then 'review' else 'pending' end;
  update public.order_email_outbox set status=v_status,provider_id=coalesce(p_provider_id,provider_id),
    last_error=case when p_sent then null else left(coalesce(p_error,'delivery_failed'),120) end,
    next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(v_attempt-1,6))::integer)),
    lock_token=null,locked_until=null
  where order_id=p_order_id and kind=p_kind;

  -- El UPDATE del pedido serializa ambos destinatarios, sin pisar sus resultados.
  update public.orders o set
    customer_email_sent=o.customer_email_sent or (p_sent and p_kind='customer'),
    internal_email_sent=o.internal_email_sent or (p_sent and p_kind='internal'),
    ready_email_sent=o.ready_email_sent or (p_sent and p_kind='ready'),
    email_errors=coalesce((select jsonb_agg(entry) from jsonb_array_elements(
      case when jsonb_typeof(o.email_errors)='array' then o.email_errors else '[]'::jsonb end
    ) entry where entry->>'kind' is distinct from p_kind),'[]'::jsonb)
    || case when p_sent then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'kind',p_kind,'code',left(coalesce(p_error,'delivery_failed'),120),
      'attempt',v_attempt,'status',v_status,'at',now())) end
  where o.id=p_order_id;
end;
$function$
