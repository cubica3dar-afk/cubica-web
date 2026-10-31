-- Solo lectura: verificación posterior de 4C v2.
with target as (
  select to_regprocedure(
    'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'
  ) signature
)
select jsonb_build_object(
  'version','20261018171255',
  'sentinel',obj_description(signature::oid,'pg_proc'),
  'sentinel_ok',obj_description(signature::oid,'pg_proc')='cubica_stage_c:20261018171255',
  'present',signature is not null,
  'security_definer',coalesce((select p.prosecdef from pg_proc p where p.oid=signature::oid),false),
  'search_path_restricted',coalesce((select 'search_path=""'=any(p.proconfig) from pg_proc p where p.oid=signature::oid),false),
  'public_execute',coalesce((select exists(
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
  )),false),
  'anon_execute',coalesce(has_function_privilege('anon',signature,'execute'),false),
  'authenticated_execute',coalesce(has_function_privilege('authenticated',signature,'execute'),false),
  'service_role_execute',coalesce(has_function_privilege('service_role',signature,'execute'),false),
  'old_sentinel_absent',obj_description(signature::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171253'
) from target;
