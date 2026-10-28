-- Solo lectura: verificación posterior de 4B v2.
with expected_functions(signature) as (values
  ('private.stage_c_begin_campaign_operation(text,uuid,jsonb)'),
  ('private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)'),
  ('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'),
  ('private.admin_set_site_campaign_state(uuid,text,integer,uuid)'),
  ('private.admin_duplicate_site_campaign(uuid,integer,uuid)'),
  ('private.admin_delete_site_campaign(uuid,integer)')
), function_status as (
  select e.signature,
    to_regprocedure(e.signature) is not null as present,
    p.prosecdef as security_definer,
    exists(
      select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
      where setting='search_path=""'
    ) as search_path_restricted,
    has_function_privilege('anon',p.oid,'execute') as anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') as service_role_execute,
    exists(
      select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) as public_execute
  from expected_functions e
  left join pg_proc p on p.oid=to_regprocedure(e.signature)
), table_status as (
  select c.relrowsecurity,
    has_table_privilege('anon',c.oid,'select') as anon_select,
    has_table_privilege('authenticated',c.oid,'select') as authenticated_select,
    has_table_privilege('service_role',c.oid,'select') as service_role_select
  from pg_class c where c.oid=to_regclass('private.site_campaign_idempotency')
)
select jsonb_build_object(
  'version','20261018171254',
  'sentinel',obj_description(
    to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)')::oid,
    'pg_proc'
  ),
  'sentinel_ok',obj_description(
    to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)')::oid,
    'pg_proc'
  )='cubica_stage_c:20261018171254',
  'idempotency_table_present',to_regclass('private.site_campaign_idempotency') is not null,
  'result_campaign_index_present',to_regclass('private.site_campaign_idempotency_result_campaign_idx') is not null,
  'idempotency_table_sentinel',obj_description(to_regclass('private.site_campaign_idempotency')::oid,'pg_class'),
  'table_security',(select to_jsonb(t) from table_status t),
  'functions',(select jsonb_agg(to_jsonb(f) order by signature) from function_status f),
  'old_signatures_absent',
    to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)') is null
    and to_regprocedure('private.admin_set_site_campaign_state(uuid,text,integer)') is null
    and to_regprocedure('private.admin_duplicate_site_campaign(uuid)') is null
);
