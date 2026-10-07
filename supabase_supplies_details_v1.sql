-- CÚBICA 3D — Detalles de insumos y filamentos
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Agrega unidad de medida normalizada, material y color sin borrar datos existentes.

begin;

alter table public.supplies
  add column if not exists material_type text,
  add column if not exists color_name text,
  add column if not exists color_hex text;

-- Normaliza el valor histórico usado por Cúbica.
update public.supplies
set unit = 'unidades'
where unit is null
   or btrim(unit) = ''
   or lower(unit) in ('u','unidad','unit','units');

alter table public.supplies
  alter column unit set default 'unidades';

alter table public.supplies
  drop constraint if exists supplies_unit_check;

alter table public.supplies
  add constraint supplies_unit_check
  check (unit in ('unidades','gramos','cm','m'));

alter table public.supplies
  drop constraint if exists supplies_color_hex_check;

alter table public.supplies
  add constraint supplies_color_hex_check
  check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$');

commit;
