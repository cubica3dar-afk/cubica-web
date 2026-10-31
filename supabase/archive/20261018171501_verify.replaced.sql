-- Solo lectura: verificación posterior de 20261018171501.
select jsonb_build_object(
  'version','20261018171501',
  'sentinel',obj_description(to_regprocedure('public.cleanup_suggestion_protection()')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.cleanup_suggestion_protection()')::oid,'pg_proc')='cubica_stage_c:20261018171501'
);
