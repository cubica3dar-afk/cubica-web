-- CÚBICA 3D — ESQUEMA CONSOLIDADO ACTUAL
-- Fecha de consolidación: 2026-10-09
--
-- Objetivo:
--   1) Documentar en un único archivo el esquema que hoy espera el frontend.
--   2) Permitir reconstruir un proyecto Supabase nuevo sin depender de ejecutar
--      todas las migraciones históricas manualmente.
--   3) Servir como base de auditoría para futuras funciones.
--
-- IMPORTANTE:
-- - Este archivo es no destructivo en lo posible (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- - No es necesario ejecutarlo ahora sobre el proyecto Cúbica que ya funciona.
-- - Antes de usarlo sobre producción, hacer backup y revisar diferencias contra la BD real.
-- - No contiene secretos, service_role, Client Secret de Google ni contraseñas.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;

-- ============================================================================
-- 1. PERFILES / ROLES
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'customer',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin','customer'));

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function public.handle_cubica_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id,email,display_name,role)
  values (
    new.id,
    lower(coalesce(new.email,'')),
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name',''),
      nullif(new.raw_user_meta_data->>'name',''),
      nullif(split_part(coalesce(new.email,''),'@',1),''),
      'Cliente'
    ),
    'customer'
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = case
          when coalesce(public.profiles.display_name,'') = '' then excluded.display_name
          else public.profiles.display_name
        end;
  return new;
end;
$$;

drop trigger if exists cubica_auth_user_profile on auth.users;
create trigger cubica_auth_user_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_cubica_auth_user();

insert into public.profiles (id,email,display_name,role)
select
  u.id,
  lower(coalesce(u.email,'')),
  coalesce(
    nullif(u.raw_user_meta_data->>'full_name',''),
    nullif(u.raw_user_meta_data->>'name',''),
    nullif(split_part(coalesce(u.email,''),'@',1),''),
    'Cliente'
  ),
  'customer'
from auth.users u
where not exists (select 1 from public.profiles p where p.id=u.id)
on conflict (id) do nothing;

-- ============================================================================
-- 2. CATÁLOGO / PRODUCTOS
-- ============================================================================

create table if not exists public.product_categories (
  name text primary key,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  name text not null,
  category text,
  description text not null default '',
  price numeric(14,2) not null default 0,
  stock integer not null default 0,
  color_mode text not null default 'single',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.products add column if not exists description text not null default '';
alter table public.products add column if not exists price numeric(14,2) not null default 0;
alter table public.products add column if not exists stock integer not null default 0;
alter table public.products add column if not exists color_mode text not null default 'single';
alter table public.products add column if not exists active boolean not null default true;
alter table public.products add column if not exists sort_order integer not null default 0;
alter table public.products add column if not exists created_at timestamptz not null default now();

alter table public.products drop constraint if exists products_price_check;
alter table public.products add constraint products_price_check check (price >= 0);
alter table public.products drop constraint if exists products_stock_check;
alter table public.products add constraint products_stock_check check (stock >= 0);
alter table public.products drop constraint if exists products_color_mode_check;
alter table public.products add constraint products_color_mode_check check (color_mode in ('single','multiple'));

create table if not exists public.product_colors (
  id bigint generated by default as identity primary key,
  product_id text not null references public.products(id) on delete cascade,
  name text not null,
  hex text not null default '#ffffff',
  sort_order integer not null default 0
);

alter table public.product_colors drop constraint if exists product_colors_hex_check;
alter table public.product_colors
  add constraint product_colors_hex_check check (hex ~ '^#[0-9A-Fa-f]{6}$');

create table if not exists public.product_media (
  id bigint generated by default as identity primary key,
  product_id text not null references public.products(id) on delete cascade,
  media_type text not null,
  storage_path text not null,
  public_url text not null,
  file_name text not null default '',
  sort_order integer not null default 0
);

alter table public.product_media drop constraint if exists product_media_type_check;
alter table public.product_media
  add constraint product_media_type_check check (media_type in ('image','video'));

create index if not exists products_active_sort_idx
  on public.products (active, sort_order, created_at);
create index if not exists product_colors_product_idx
  on public.product_colors (product_id, sort_order);
create index if not exists product_media_product_idx
  on public.product_media (product_id, sort_order);

-- ============================================================================
-- 3. INSUMOS / BOM
-- ============================================================================

create table if not exists public.supply_categories (
  name text primary key,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.supplies (
  id text primary key,
  name text not null,
  category text,
  cost numeric(14,4) not null default 0,
  qty numeric(14,4) not null default 0,
  unit text not null default 'unidades',
  material_type text,
  brand text,
  color_name text,
  color_hex text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.supplies add column if not exists material_type text;
alter table public.supplies add column if not exists brand text;
alter table public.supplies add column if not exists color_name text;
alter table public.supplies add column if not exists color_hex text;
alter table public.supplies add column if not exists sort_order integer not null default 0;
alter table public.supplies add column if not exists active boolean not null default true;
alter table public.supplies add column if not exists created_at timestamptz not null default now();

update public.supplies
set unit='unidades'
where unit is null
   or btrim(unit)=''
   or lower(unit) in ('u','unidad','unit','units');

alter table public.supplies alter column unit set default 'unidades';
alter table public.supplies drop constraint if exists supplies_unit_check;
alter table public.supplies
  add constraint supplies_unit_check check (unit in ('unidades','gramos','cm','m'));
alter table public.supplies drop constraint if exists supplies_color_hex_check;
alter table public.supplies
  add constraint supplies_color_hex_check
  check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');
alter table public.supplies drop constraint if exists supplies_cost_check;
alter table public.supplies add constraint supplies_cost_check check (cost >= 0);
alter table public.supplies drop constraint if exists supplies_qty_check;
alter table public.supplies add constraint supplies_qty_check check (qty >= 0);

create table if not exists public.product_recipes (
  product_id text not null references public.products(id) on delete cascade,
  supply_id text not null references public.supplies(id) on delete restrict,
  qty_per_unit numeric(14,4) not null,
  primary key (product_id, supply_id)
);

alter table public.product_recipes drop constraint if exists product_recipes_qty_check;
alter table public.product_recipes
  add constraint product_recipes_qty_check check (qty_per_unit > 0);

create index if not exists supplies_sort_order_idx
  on public.supplies (sort_order, created_at);
create index if not exists product_recipes_supply_idx
  on public.product_recipes (supply_id);

-- ============================================================================
-- 4. PEDIDOS / VENTAS
-- ============================================================================

create sequence if not exists public.cubica_order_number_seq;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  client_order_id text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  customer_name text not null,
  customer_email text not null,
  phone text not null default '',
  payment text not null default '',
  notes text not null default '',
  total numeric(14,2) not null default 0,
  status text not null default 'Pendiente',
  username text not null default 'guest',
  supply_plan jsonb not null default '{"products":[],"supplies":[]}'::jsonb,
  internal_email_sent boolean not null default false,
  customer_email_sent boolean not null default false,
  email_errors jsonb not null default '[]'::jsonb
);

alter table public.orders add column if not exists order_number text;
alter table public.orders add column if not exists client_order_id text;
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists customer_name text;
alter table public.orders add column if not exists customer_email text;
alter table public.orders add column if not exists phone text not null default '';
alter table public.orders add column if not exists payment text not null default '';
alter table public.orders add column if not exists notes text not null default '';
alter table public.orders add column if not exists total numeric(14,2) not null default 0;
alter table public.orders add column if not exists status text not null default 'Pendiente';
alter table public.orders add column if not exists username text not null default 'guest';
alter table public.orders add column if not exists supply_plan jsonb not null default '{"products":[],"supplies":[]}'::jsonb;
alter table public.orders add column if not exists internal_email_sent boolean not null default false;
alter table public.orders add column if not exists customer_email_sent boolean not null default false;
alter table public.orders add column if not exists email_errors jsonb not null default '[]'::jsonb;

create unique index if not exists orders_order_number_uidx
  on public.orders(order_number) where order_number is not null;
create index if not exists orders_created_at_idx
  on public.orders(created_at desc);
create index if not exists orders_user_id_idx
  on public.orders(user_id, created_at desc);
create index if not exists orders_customer_email_idx
  on public.orders(lower(customer_email));

create or replace function public.assign_cubica_order_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.order_number is null or btrim(new.order_number)='' then
    new.order_number :=
      'CUB-' ||
      to_char(current_date,'YYYYMMDD') ||
      '-' ||
      lpad(nextval('public.cubica_order_number_seq')::text,6,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists cubica_assign_order_number on public.orders;
create trigger cubica_assign_order_number
before insert on public.orders
for each row execute function public.assign_cubica_order_number();

create table if not exists public.order_items (
  id bigint generated by default as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  name text not null,
  color text not null default '',
  qty integer not null,
  unit_price numeric(14,2) not null,
  line_total numeric(14,2) generated always as (qty * unit_price) stored
);

alter table public.order_items drop constraint if exists order_items_qty_check;
alter table public.order_items add constraint order_items_qty_check check (qty > 0);
alter table public.order_items drop constraint if exists order_items_unit_price_check;
alter table public.order_items add constraint order_items_unit_price_check check (unit_price >= 0);

create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_product_idx on public.order_items(product_id);

-- ============================================================================
-- 5. PRESUPUESTOS
-- ============================================================================

create table if not exists public.quotes (
  id text primary key,
  created_at timestamptz not null default now(),
  title text,
  data jsonb not null default '{}'::jsonb,
  summary text not null default '',
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists quotes_created_at_idx
  on public.quotes(created_at desc);

-- ============================================================================
-- 6. ANALÍTICA
-- ============================================================================

create table if not exists public.analytics_events (
  id bigint generated by default as identity primary key,
  event_name text not null,
  product_id text,
  session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.analytics_events drop constraint if exists analytics_events_event_name_check;
alter table public.analytics_events
  add constraint analytics_events_event_name_check
  check (event_name in ('page_view','product_view','add_to_cart','checkout_started','purchase'));

create index if not exists analytics_events_created_at_idx
  on public.analytics_events(created_at desc);
create index if not exists analytics_events_event_name_idx
  on public.analytics_events(event_name, created_at desc);
create index if not exists analytics_events_product_id_idx
  on public.analytics_events(product_id, created_at desc);

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_colors enable row level security;
alter table public.product_media enable row level security;
alter table public.supply_categories enable row level security;
alter table public.supplies enable row level security;
alter table public.product_recipes enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.quotes enable row level security;
alter table public.analytics_events enable row level security;

-- Perfiles
drop policy if exists cubica_profile_read on public.profiles;
create policy cubica_profile_read
on public.profiles for select to authenticated
using (id=auth.uid() or private.is_admin());

-- Catálogo público
drop policy if exists cubica_product_categories_public_read on public.product_categories;
create policy cubica_product_categories_public_read
on public.product_categories for select to public
using (active=true);

drop policy if exists cubica_products_public_read on public.products;
create policy cubica_products_public_read
on public.products for select to public
using (active=true);

drop policy if exists cubica_product_colors_public_read on public.product_colors;
create policy cubica_product_colors_public_read
on public.product_colors for select to public
using (
  exists (
    select 1 from public.products p
    where p.id=product_colors.product_id and p.active=true
  )
);

drop policy if exists cubica_product_media_public_read on public.product_media;
create policy cubica_product_media_public_read
on public.product_media for select to public
using (
  exists (
    select 1 from public.products p
    where p.id=product_media.product_id and p.active=true
  )
);

-- Escritura catálogo solo admin
drop policy if exists cubica_product_categories_admin_all on public.product_categories;
create policy cubica_product_categories_admin_all
on public.product_categories for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_products_admin_all on public.products;
create policy cubica_products_admin_all
on public.products for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_product_colors_admin_all on public.product_colors;
create policy cubica_product_colors_admin_all
on public.product_colors for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_product_media_admin_all on public.product_media;
create policy cubica_product_media_admin_all
on public.product_media for all to authenticated
using (private.is_admin()) with check (private.is_admin());

-- Inventario y recetas solo admin
drop policy if exists cubica_supply_categories_admin_all on public.supply_categories;
create policy cubica_supply_categories_admin_all
on public.supply_categories for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_supplies_admin_all on public.supplies;
create policy cubica_supplies_admin_all
on public.supplies for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_product_recipes_admin_all on public.product_recipes;
create policy cubica_product_recipes_admin_all
on public.product_recipes for all to authenticated
using (private.is_admin()) with check (private.is_admin());

-- Pedidos: admin gestiona todo; cliente solo lee los propios.
drop policy if exists cubica_orders_admin_all on public.orders;
create policy cubica_orders_admin_all
on public.orders for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_customer_read_own_orders on public.orders;
create policy cubica_customer_read_own_orders
on public.orders for select to authenticated
using (user_id=auth.uid());

drop policy if exists cubica_order_items_admin_all on public.order_items;
create policy cubica_order_items_admin_all
on public.order_items for all to authenticated
using (private.is_admin()) with check (private.is_admin());

drop policy if exists cubica_customer_read_own_order_items on public.order_items;
create policy cubica_customer_read_own_order_items
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id=order_items.order_id
      and o.user_id=auth.uid()
  )
);

-- Presupuestos solo admin
drop policy if exists cubica_quotes_admin_all on public.quotes;
create policy cubica_quotes_admin_all
on public.quotes for all to authenticated
using (private.is_admin()) with check (private.is_admin());

-- Analytics: solo admin lee directamente.
drop policy if exists cubica_analytics_admin_read on public.analytics_events;
create policy cubica_analytics_admin_read
on public.analytics_events for select to authenticated
using (private.is_admin());

-- ============================================================================
-- 8. PERMISOS SQL
-- ============================================================================

grant select on public.product_categories, public.products, public.product_colors, public.product_media
to anon, authenticated;

grant select on public.profiles to authenticated;

grant select, insert, update, delete
on public.product_categories, public.products, public.product_colors, public.product_media,
   public.supply_categories, public.supplies, public.product_recipes,
   public.orders, public.order_items, public.quotes
to authenticated;

grant select on public.analytics_events to authenticated;

revoke insert, update, delete on public.analytics_events from anon, authenticated;
revoke all on public.supply_categories, public.supplies, public.product_recipes,
              public.orders, public.order_items, public.quotes
from anon;

grant usage, select on all sequences in schema public to authenticated;

-- ============================================================================
-- 9. RPC: PEDIDO PÚBLICO
-- ============================================================================

create or replace function public.create_public_order(
  p_client_order_id text,
  p_customer_name text,
  p_customer_email text,
  p_phone text default '',
  p_payment text default '',
  p_notes text default '',
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_product_id text;
  v_name text;
  v_price numeric(14,2);
  v_stock integer;
  v_qty integer;
  v_color text;
begin
  if length(btrim(coalesce(p_customer_name,''))) < 2
     or length(btrim(coalesce(p_customer_name,''))) > 120 then
    raise exception 'Nombre inválido';
  end if;

  if length(btrim(coalesce(p_customer_email,''))) < 5
     or length(btrim(coalesce(p_customer_email,''))) > 180
     or btrim(p_customer_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Email inválido';
  end if;

  if length(coalesce(p_phone,'')) > 80 then
    raise exception 'Teléfono inválido';
  end if;

  if length(coalesce(p_notes,'')) > 1500 then
    raise exception 'Observaciones demasiado largas';
  end if;

  if coalesce(p_payment,'') not in ('Efectivo','Transferencia') then
    raise exception 'Forma de pago inválida';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Pedido inválido';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(btrim(v_item->>'product_id'),'');
    v_color := left(coalesce(v_item->>'color',''),120);

    if v_product_id is null then
      raise exception 'Producto inválido';
    end if;

    if coalesce(v_item->>'qty','') !~ '^[0-9]+$' then
      raise exception 'Cantidad inválida';
    end if;

    v_qty := (v_item->>'qty')::integer;
    if v_qty < 1 or v_qty > 100 then
      raise exception 'Cantidad inválida';
    end if;

    select p.name,p.price,p.stock
      into v_name,v_price,v_stock
    from public.products p
    where p.id=v_product_id and p.active=true
    for update;

    if not found then
      raise exception 'Producto no disponible';
    end if;

    v_total := v_total + (v_price*v_qty);
  end loop;

  if v_total <= 0 or v_total > 100000000 then
    raise exception 'Total inválido';
  end if;

  insert into public.orders (
    client_order_id,user_id,customer_name,customer_email,phone,payment,notes,total,status,username
  )
  values (
    nullif(left(coalesce(p_client_order_id,''),160),''),
    auth.uid(),
    btrim(p_customer_name),
    lower(btrim(p_customer_email)),
    left(coalesce(p_phone,''),80),
    p_payment,
    coalesce(p_notes,''),
    v_total,
    'Pendiente',
    'guest'
  )
  returning id,order_number into v_order_id,v_order_number;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := btrim(v_item->>'product_id');
    v_qty := (v_item->>'qty')::integer;
    v_color := left(coalesce(v_item->>'color',''),120);

    select p.name,p.price,p.stock
      into v_name,v_price,v_stock
    from public.products p
    where p.id=v_product_id and p.active=true
    for update;

    insert into public.order_items(order_id,product_id,name,color,qty,unit_price)
    values(v_order_id,v_product_id,v_name,v_color,v_qty,v_price);

    update public.products
    set stock=greatest(stock-v_qty,0)
    where id=v_product_id;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'order_id',v_order_id,
    'order_number',v_order_number,
    'total',v_total
  );
end;
$$;

revoke all on function public.create_public_order(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
to anon, authenticated;

-- ============================================================================
-- 10. RPC: VINCULAR PEDIDOS DE INVITADO A CUENTA
-- ============================================================================

create or replace function public.claim_my_guest_orders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sesión requerida';
  end if;

  v_email := lower(coalesce(auth.jwt()->>'email',''));
  if v_email='' then return 0; end if;

  update public.orders
  set user_id=auth.uid()
  where user_id is null
    and lower(customer_email)=v_email;

  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_my_guest_orders() from public;
grant execute on function public.claim_my_guest_orders() to authenticated;

-- ============================================================================
-- 11. RPC: ANALÍTICA PÚBLICA MÍNIMA
-- ============================================================================

create or replace function public.track_public_event(
  p_event_name text,
  p_product_id text default null,
  p_session_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_name not in ('page_view','product_view','add_to_cart','checkout_started','purchase') then
    raise exception 'Evento no permitido';
  end if;

  if length(coalesce(p_session_id,'')) > 120 then
    raise exception 'session_id inválido';
  end if;

  insert into public.analytics_events(event_name,product_id,session_id,metadata)
  values(
    p_event_name,
    nullif(left(coalesce(p_product_id,''),120),''),
    nullif(left(coalesce(p_session_id,''),120),''),
    coalesce(p_metadata,'{}'::jsonb)
  );
end;
$$;

revoke all on function public.track_public_event(text,text,text,jsonb) from public;
grant execute on function public.track_public_event(text,text,text,jsonb)
to anon, authenticated;

-- ============================================================================
-- 12. STORAGE
-- ============================================================================

insert into storage.buckets (
  id,name,public,file_size_limit,allowed_mime_types
)
values (
  'product-media',
  'product-media',
  true,
  8388608,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm']::text[]
)
on conflict (id) do update
set
  name=excluded.name,
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists cubica_product_media_public_read on storage.objects;
create policy cubica_product_media_public_read
on storage.objects for select to public
using (bucket_id='product-media');

drop policy if exists cubica_product_media_admin_insert on storage.objects;
create policy cubica_product_media_admin_insert
on storage.objects for insert to authenticated
with check (bucket_id='product-media' and private.is_admin());

drop policy if exists cubica_product_media_admin_update on storage.objects;
create policy cubica_product_media_admin_update
on storage.objects for update to authenticated
using (bucket_id='product-media' and private.is_admin())
with check (bucket_id='product-media' and private.is_admin());

drop policy if exists cubica_product_media_admin_delete on storage.objects;
create policy cubica_product_media_admin_delete
on storage.objects for delete to authenticated
using (bucket_id='product-media' and private.is_admin());

commit;
