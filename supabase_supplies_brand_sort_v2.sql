-- CÚBICA 3D — Marca y orden personalizado de insumos
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- No borra datos existentes.

begin;

alter table public.supplies
  add column if not exists brand text,
  add column if not exists sort_order integer not null default 0;

-- Asigna un orden inicial estable a los insumos ya existentes.
with ranked as (
  select
    id,
    row_number() over (order by created_at asc, id asc) * 10 as new_sort_order
  from public.supplies
)
update public.supplies s
set sort_order = ranked.new_sort_order
from ranked
where s.id = ranked.id
  and coalesce(s.sort_order,0) = 0;

create index if not exists supplies_sort_order_idx
  on public.supplies (sort_order, created_at);

commit;
