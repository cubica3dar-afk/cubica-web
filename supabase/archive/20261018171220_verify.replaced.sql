do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171220' then
    raise exception 'missing 3B sentinel';
  end if;
  foreach signature in array array[
    'private.stage_c_active_campaign(timestamptz)'::regprocedure,
    'private.stage_c_next_change(timestamptz)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid=signature::oid) then raise exception '3B resolver is not SECURITY DEFINER: %',signature; end if;
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or has_function_privilege('service_role',signature,'execute') then
      raise exception '3B function exposed: %',signature;
    end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception '3B PUBLIC execute: %',signature;
    end if;
    if exists(select 1 from pg_proc p where p.oid=signature::oid and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')) then
      raise exception '3B unrestricted search_path: %',signature;
    end if;
  end loop;
  if pg_get_functiondef('private.stage_c_active_campaign(timestamptz)'::regprocedure) not like '%America/Argentina/Buenos_Aires%'
    or pg_get_functiondef('private.stage_c_next_change(timestamptz)'::regprocedure) not like '%America/Argentina/Buenos_Aires%' then
    raise exception '3B timezone logic missing';
  end if;
end $$;
