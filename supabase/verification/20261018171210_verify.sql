do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'missing 3A sentinel';
  end if;
  foreach signature in array array[
    'private.stage_c_assert_admin()'::regprocedure,
    'private.stage_c_safe_text(text,integer,boolean)'::regprocedure,
    'private.stage_c_luminance(text)'::regprocedure,
    'private.stage_c_validate_theme(jsonb)'::regprocedure,
    'private.stage_c_asset_paths(jsonb)'::regprocedure
  ] loop
    if has_function_privilege('anon',signature,'execute')
      or has_function_privilege('authenticated',signature,'execute')
      or has_function_privilege('service_role',signature,'execute') then
      raise exception '3A function exposed: %',signature;
    end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception '3A PUBLIC execute: %',signature;
    end if;
    if exists(select 1 from pg_proc p where p.oid=signature::oid and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')) then
      raise exception '3A unrestricted search_path: %',signature;
    end if;
  end loop;
  if not (select prosecdef from pg_proc where oid='private.stage_c_assert_admin()'::regprocedure) then raise exception '3A admin guard is not SECURITY DEFINER'; end if;
  if pg_get_functiondef('private.stage_c_assert_admin()'::regprocedure) not like '%auth.uid()%'
    or pg_get_functiondef('private.stage_c_assert_admin()'::regprocedure) not like '%private.is_admin()%' then
    raise exception '3A admin guard lost identity or MFA/admin validation';
  end if;
end $$;
