-- Solo lectura: verificación posterior de 20261018171251.
with expected(identity) as (values
  ('private.admin_save_site_appearance_draft'),
  ('private.admin_publish_site_appearance'),
  ('private.admin_reset_site_appearance_draft'),
  ('private.admin_restore_original_appearance_draft'),
  ('private.admin_register_site_asset'),
  ('private.admin_retire_site_asset')
)
select jsonb_build_object(
  'version','20261018171251',
  'sentinel',obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc')='cubica_stage_c:20261018171251',
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;
