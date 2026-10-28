-- Solo lectura: verificación posterior de 20261018171508.
with expected(identity) as (values
  ('public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'),
  ('public.admin_set_site_campaign_state(uuid,text,integer,uuid)'),
  ('public.admin_duplicate_site_campaign(uuid,integer,uuid)'),
  ('public.admin_delete_site_campaign(uuid,integer)'),
  ('public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'),
  ('public.admin_save_content_draft(text,text,jsonb,integer)'),
  ('public.admin_publish_content_page(text,integer)'),
  ('public.admin_restore_content_version(text,integer,integer)'),
  ('public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'),
  ('public.admin_list_faq(boolean)'),
  ('public.admin_restore_faq(bigint,integer)')
)
select jsonb_build_object(
  'version','20261018171508',
  'sentinel',obj_description(to_regprocedure('public.admin_restore_faq(bigint,integer)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('public.admin_restore_faq(bigint,integer)')::oid,'pg_proc')='cubica_stage_c:20261018171508',
  'objects',jsonb_agg(jsonb_build_object('identity',identity,'exists',to_regprocedure(identity) is not null,'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)) order by identity)
) from expected;
