-- CÚBICA 3D — Cuentas de clientes con Google + historial propio
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- No elimina pedidos ni usuarios existentes.

begin;

-- 1) Crear/actualizar el perfil público cuando Supabase Auth crea un usuario.
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

-- Crear perfiles faltantes para usuarios que ya existan.
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

-- 2) El cliente puede leer su propio perfil.
alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;

drop policy if exists cubica_customer_read_own_profile on public.profiles;
create policy cubica_customer_read_own_profile
on public.profiles
for select
to authenticated
using (id = auth.uid());

-- 3) El cliente autenticado puede leer únicamente sus propios pedidos.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
grant select on public.orders, public.order_items to authenticated;

drop policy if exists cubica_customer_read_own_orders on public.orders;
create policy cubica_customer_read_own_orders
on public.orders
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists cubica_customer_read_own_order_items on public.order_items;
create policy cubica_customer_read_own_order_items
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and o.user_id = auth.uid()
  )
);

-- 4) Al crear/iniciar sesión con Google, vincular pedidos anteriores hechos como invitado
--    si usaron exactamente el mismo email verificado por Google.
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
  if v_email = '' then
    return 0;
  end if;

  update public.orders
  set user_id = auth.uid()
  where user_id is null
    and lower(customer_email) = v_email;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_my_guest_orders() from public;
grant execute on function public.claim_my_guest_orders() to authenticated;

commit;
