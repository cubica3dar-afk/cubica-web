-- Solo lectura: verificación posterior de 20261018171513.
with expected(identity) as (values
  ('public.consume_suggestion_protection(text,text,uuid)'),
  ('public.submit_public_suggestion(text,text,text,text,uuid,uuid)'),
  ('public.admin_list_suggestions(integer,integer,text,text,text,text)'),
  ('public.admin_update_suggestion(uuid,text,text)'),
  ('public.cleanup_suggestion_protection()')
)
select jsonb_build_object(
  'version','20261018171513',
  'sentinel',obj_description(to_regprocedure('public.cleanup_suggestion_protection()')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.cleanup_suggestion_protection()')::oid,'pg_proc')='cubica_stage_c:20261018171513',
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;
