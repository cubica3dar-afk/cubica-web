-- CÚBICA 3D — Orden personalizado de productos terminados
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- No borra datos existentes.

begin;

alter table public.products
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select
    id,
    row_number() over (order by created_at asc, id asc) * 10 as new_sort_order
  from public.products
)
update public.products p
set sort_order = ranked.new_sort_order
from ranked
where p.id = ranked.id
  and coalesce(p.sort_order,0) = 0;

create index if not exists products_sort_order_idx
  on public.products (sort_order, created_at);

commit;
