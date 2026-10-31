-- Solo lectura: verificación posterior de 20261018171223.
with signature as (
  select to_regprocedure('private.stage_c_next_change(timestamptz)') procedure_id
)
select jsonb_build_object(
  'version','20261018171223',
  'sentinel',obj_description(signature.procedure_id::oid,'pg_proc'),
  'sentinel_ok',obj_description(signature.procedure_id::oid,'pg_proc')='cubica_stage_c:20261018171223',
  'return_type',pg_get_function_result(signature.procedure_id::oid),
  'return_type_ok',pg_get_function_result(signature.procedure_id::oid)='timestamp with time zone',
  'security_definer',(select p.prosecdef from pg_proc p where p.oid=signature.procedure_id::oid),
  'stable',(select p.provolatile='s' from pg_proc p where p.oid=signature.procedure_id::oid),
  'search_path',(select p.proconfig from pg_proc p where p.oid=signature.procedure_id::oid),
  'public_execute',exists(
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=signature.procedure_id and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ),
  'anon_execute',coalesce(has_function_privilege('anon',signature.procedure_id,'execute'),false),
  'authenticated_execute',coalesce(has_function_privilege('authenticated',signature.procedure_id,'execute'),false),
  'service_role_execute',coalesce(has_function_privilege('service_role',signature.procedure_id,'execute'),false)
) from signature;

