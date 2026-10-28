-- Solo lectura: verificación posterior de 20261018171302.
with expected(identity) as (values
  ('private.consume_suggestion_protection'),
  ('private.submit_public_suggestion')
)
select jsonb_build_object(
  'version','20261018171302',
  'sentinel',obj_description(to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)')::oid,'pg_proc')='cubica_stage_c:20261018171302',
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;
