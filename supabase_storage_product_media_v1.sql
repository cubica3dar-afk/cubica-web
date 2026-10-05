-- CÚBICA 3D — Supabase Storage para fotos y videos de productos
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Bucket público para lectura; solo el administrador autenticado puede subir/modificar/eliminar.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-media',
  'product-media',
  true,
  8388608,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm'
  ]::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

drop policy if exists "cubica_product_media_public_read" on storage.objects;
create policy "cubica_product_media_public_read"
on storage.objects
for select
to public
using (bucket_id = 'product-media');

drop policy if exists "cubica_product_media_admin_insert" on storage.objects;
create policy "cubica_product_media_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-media'
  and private.is_admin()
);

drop policy if exists "cubica_product_media_admin_update" on storage.objects;
create policy "cubica_product_media_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-media'
  and private.is_admin()
)
with check (
  bucket_id = 'product-media'
  and private.is_admin()
);

drop policy if exists "cubica_product_media_admin_delete" on storage.objects;
create policy "cubica_product_media_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-media'
  and private.is_admin()
);

commit;
