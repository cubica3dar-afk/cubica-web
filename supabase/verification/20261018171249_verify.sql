-- Solo lectura: verificación posterior de 20261018171249 (4A v2).
with expected(identity,security_definer) as (values
  ('private.stage_c_validate_theme(jsonb)',false),
  ('private.admin_save_site_appearance_draft(jsonb,integer)',true),
  ('private.admin_publish_site_appearance(integer)',true),
  ('private.admin_reset_site_appearance_draft(integer)',true),
  ('private.admin_restore_original_appearance_draft(integer)',true),
  ('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)',true),
  ('private.admin_retire_site_asset(uuid)',true)
), inspected as (
  select e.identity,e.security_definer,p.oid,p.prosecdef,p.provolatile,p.proconfig,
    coalesce(has_function_privilege('anon',p.oid,'execute'),false) anon_execute,
    coalesce(has_function_privilege('authenticated',p.oid,'execute'),false) authenticated_execute,
    coalesce(has_function_privilege('service_role',p.oid,'execute'),false) service_role_execute,
    exists(
      select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) public_execute
  from expected e left join pg_proc p on p.oid=to_regprocedure(e.identity)
)
select jsonb_build_object(
  'version','20261018171249',
  'sentinel',obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc')='cubica_stage_c:20261018171249',
  'source_draft_column',exists(
    select 1 from information_schema.columns
    where table_schema='private' and table_name='site_appearance_versions' and column_name='source_draft_version'
  ),
  'idempotency_index',to_regclass('private.site_appearance_source_draft_once') is not null,
  'objects',(
    select jsonb_agg(jsonb_build_object(
      'identity',identity,'exists',oid is not null,
      'security_mode_ok',prosecdef=security_definer,
      'volatile_locking_validator',case when identity='private.stage_c_validate_theme(jsonb)' then provolatile='v' else null end,
      'search_path_restricted',exists(select 1 from unnest(coalesce(proconfig,array[]::text[])) setting where setting like 'search_path=%'),
      'public_execute',public_execute,'anon_execute',anon_execute,
      'authenticated_execute',authenticated_execute,'service_role_execute',service_role_execute
    ) order by identity) from inspected
  )
);
