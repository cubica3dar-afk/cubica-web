-- Solo lectura: verificación posterior de 20261018171511.
with expected(identity) as (values
  ('public.get_site_experience()'),
  ('public.get_public_content_page(text)'),
  ('public.get_public_faq()'),
  ('public.admin_get_site_configuration()'),
  ('public.admin_save_site_appearance_draft(jsonb,integer)'),
  ('public.admin_publish_site_appearance(integer)'),
  ('public.admin_reset_site_appearance_draft()'),
  ('public.admin_restore_original_appearance_draft()'),
  ('public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'),
  ('public.admin_retire_site_asset(uuid)')
)
select jsonb_build_object(
  'version','20261018171511',
  'sentinel',obj_description(to_regprocedure('public.admin_retire_site_asset(uuid)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.admin_retire_site_asset(uuid)')::oid,'pg_proc')='cubica_stage_c:20261018171511',
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;
