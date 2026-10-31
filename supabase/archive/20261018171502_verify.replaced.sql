-- Solo lectura: verificación posterior de 20261018171502.
select jsonb_build_object(
  'version','20261018171502',
  'sentinel',obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc')='cubica_stage_c:20261018171502'
);
