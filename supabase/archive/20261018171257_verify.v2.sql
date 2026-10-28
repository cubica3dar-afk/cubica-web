-- Solo lectura: verificación posterior de 5B v2.
with expected(identity,return_type,security_definer,volatility) as (values
  ('private.stage_c_apply_suggestion_limit(text,text,integer,timestamp with time zone)','jsonb',false,'v'),
  ('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','jsonb',true,'v')
), inspected as (
  select e.*,
    to_regprocedure(e.identity) procedure_id
  from expected e
), details as (
  select i.*,
    p.prorettype::regtype::text actual_return_type,
    p.prosecdef actual_security_definer,
    p.provolatile actual_volatility,
    coalesce(p.proconfig,array[]::text[]) settings,
    coalesce(has_function_privilege('anon',p.oid,'execute'),false) anon_execute,
    coalesce(has_function_privilege('authenticated',p.oid,'execute'),false) authenticated_execute,
    coalesce(has_function_privilege('service_role',p.oid,'execute'),false) service_role_execute,
    exists(
      select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) public_execute
  from inspected i
  left join pg_proc p on p.oid=i.procedure_id
)
select jsonb_build_object(
  'version','20261018171257',
  'sentinel',obj_description(
    to_regprocedure('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,
    'pg_proc'
  ),
  'sentinel_ok',obj_description(
    to_regprocedure('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,
    'pg_proc'
  )='cubica_stage_c:20261018171257',
  'schema_ok',
    to_regclass('private.site_suggestions') is not null
    and to_regclass('private.suggestion_token_uses') is not null
    and to_regclass('private.suggestion_rate_limits') is not null
    and to_regclass('private.suggestion_request_once') is not null
    and to_regclass('private.suggestion_token_cleanup') is not null
    and to_regclass('private.suggestion_payload_lookup') is not null
    and to_regclass('private.suggestion_rate_limit_cleanup') is not null,
  'objects',jsonb_agg(jsonb_build_object(
    'identity',identity,
    'exists',procedure_id is not null,
    'return_ok',actual_return_type=return_type,
    'security_ok',actual_security_definer=security_definer,
    'volatility_ok',actual_volatility=volatility,
    'search_path_ok',exists(select 1 from unnest(settings) setting where setting='search_path=""'),
    'public_execute',public_execute,
    'anon_execute',anon_execute,
    'authenticated_execute',authenticated_execute,
    'service_role_execute',service_role_execute
  ) order by identity)
) as stage_c_5b_v2_verification
from details;
