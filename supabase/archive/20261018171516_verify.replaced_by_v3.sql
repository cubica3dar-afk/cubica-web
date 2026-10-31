-- Solo lectura: verificación posterior de la activación 7B.
select jsonb_build_object(
  'version','20261018171516',
  'sentinel',obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc')='cubica_stage_c:20261018171516',
  'storage_policies',(select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read')),
  'suggestion_service_execute',coalesce(has_function_privilege('service_role',to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),'execute'),false),
  'suggestion_anon_execute',coalesce(has_function_privilege('anon',to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),'execute'),false),
  'suggestion_authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),'execute'),false),
  'admin_list_anon_execute',coalesce(has_function_privilege('anon',to_regprocedure('public.admin_list_suggestions(integer,integer,text,text,text,text,text)'),'execute'),false),
  'admin_list_authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_list_suggestions(integer,integer,text,text,text,text,text)'),'execute'),false),
  'admin_detail_authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_get_suggestion(uuid)'),'execute'),false),
  'admin_update_authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_update_suggestion(uuid,text,text,integer,text)'),'execute'),false),
  'admin_lifecycle_authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_set_suggestion_lifecycle(uuid,text,integer,text)'),'execute'),false),
  'legacy_absent',to_regprocedure('public.consume_suggestion_protection(text,text,uuid)') is null and to_regprocedure('public.submit_public_suggestion(text,text,text,text,uuid,uuid)') is null
);

