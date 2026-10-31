-- Solo lectura: verificación posterior de la activación 7B.
select jsonb_build_object(
  'version','20261018171514',
  'sentinel',obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc')='cubica_stage_c:20261018171514',
  'storage_policies',(select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read'))
);
