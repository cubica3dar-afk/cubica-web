do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.get_site_experience(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171230' then
    raise exception 'missing 3C sentinel';
  end if;
  foreach signature in array array[
    'private.get_site_experience(timestamptz)'::regprocedure,
    'private.admin_get_site_configuration()'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid=signature::oid) then raise exception '3C resolver is not SECURITY DEFINER: %',signature; end if;
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or has_function_privilege('service_role',signature,'execute') then
      raise exception '3C function exposed: %',signature;
    end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception '3C PUBLIC execute: %',signature;
    end if;
    if exists(select 1 from pg_proc p where p.oid=signature::oid and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')) then
      raise exception '3C unrestricted search_path: %',signature;
    end if;
  end loop;
  if pg_get_functiondef('private.admin_get_site_configuration()'::regprocedure) not like '%perform private.stage_c_assert_admin()%' then
    raise exception '3C admin resolver lost AAL2 guard';
  end if;
  if pg_get_functiondef('private.get_site_experience(timestamptz)'::regprocedure) like '%state=''draft''%' then
    raise exception '3C public resolver can inspect drafts';
  end if;
end $$;
