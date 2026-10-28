-- Solo lectura: verificación posterior de 20261018171252.
with expected(identity) as (values
  ('private.admin_upsert_site_campaign'),
  ('private.admin_set_site_campaign_state'),
  ('private.admin_duplicate_site_campaign'),
  ('private.admin_delete_site_campaign')
)
select jsonb_build_object(
  'version','20261018171252',
  'sentinel',obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)')::oid,'pg_proc')='cubica_stage_c:20261018171252',
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;
