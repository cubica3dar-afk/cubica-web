-- Solo lectura: verificación posterior de 20261025120200.
with expected(identity) as (values
  ('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),
  ('public.admin_list_suggestions(integer,integer,text,text,text,text,text)'),
  ('public.admin_get_suggestion(uuid)'),
  ('public.admin_update_suggestion(uuid,text,text,integer,text)'),
  ('public.admin_set_suggestion_lifecycle(uuid,text,integer,text)'),
  ('public.cleanup_suggestion_protection()')
)
select jsonb_build_object(
  'version','20261025120200',
  'sentinel',obj_description(to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,'pg_proc')='cubica_stage_c:20261025120200',
  'legacy_absent',to_regprocedure('public.consume_suggestion_protection(text,text,uuid)') is null and to_regprocedure('public.submit_public_suggestion(text,text,text,text,uuid,uuid)') is null,
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;

