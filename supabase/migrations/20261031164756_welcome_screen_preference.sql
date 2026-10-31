-- CÚBICA 3D — Preferencia global para la pantalla de bienvenida.
--
-- La preferencia es independiente de los borradores de apariencia: cambiarla
-- nunca publica colores, recursos, campañas, frases ni contenidos.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'welcome_screen_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261025120300' then
    raise exception 'welcome_screen_missing_prerequisite:stage_c_7b_v3';
  end if;
end $$;

create table private.site_runtime_settings(
  singleton boolean primary key default true check(singleton),
  welcome_screen_enabled boolean not null default false,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table private.site_runtime_settings enable row level security;
revoke all on table private.site_runtime_settings from public,anon,authenticated,service_role;

insert into private.site_runtime_settings(singleton,welcome_screen_enabled)
values(true,false);

create function private.get_welcome_screen_preference()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    (select s.welcome_screen_enabled
       from private.site_runtime_settings as s
      where s.singleton),
    false
  );
$$;

create function private.admin_get_welcome_screen_preference()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  result jsonb;
begin
  perform private.stage_c_assert_admin();

  select jsonb_build_object(
    'enabled',s.welcome_screen_enabled,
    'version',s.version,
    'updated_at',s.updated_at
  )
    into result
    from private.site_runtime_settings as s
   where s.singleton;

  return coalesce(result,jsonb_build_object(
    'enabled',false,
    'version',1,
    'updated_at',null
  ));
end;
$$;

create function private.admin_set_welcome_screen_preference(
  p_enabled boolean,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  current private.site_runtime_settings;
  saved private.site_runtime_settings;
begin
  perform private.stage_c_assert_admin();

  if p_enabled is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'Preferencia de bienvenida inválida' using errcode='22023';
  end if;

  select * into current
    from private.site_runtime_settings
   where singleton
   for update;

  if not found then
    raise exception 'No existe la configuración global' using errcode='55000';
  end if;
  if current.version<>p_expected_version then
    raise exception 'La configuración cambió en otra sesión. Recargá e intentá nuevamente.'
      using errcode='40001';
  end if;

  update private.site_runtime_settings
     set welcome_screen_enabled=p_enabled,
         version=version+1,
         updated_at=now(),
         updated_by=auth.uid()
   where singleton
   returning * into saved;

  return jsonb_build_object(
    'enabled',saved.welcome_screen_enabled,
    'version',saved.version,
    'updated_at',saved.updated_at
  );
end;
$$;

create function public.get_welcome_screen_preference()
returns boolean
language sql
stable
security invoker
set search_path=''
as $$ select private.get_welcome_screen_preference(); $$;

create function public.admin_get_welcome_screen_preference()
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$ select private.admin_get_welcome_screen_preference(); $$;

create function public.admin_set_welcome_screen_preference(
  p_enabled boolean,
  p_expected_version integer
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.admin_set_welcome_screen_preference(p_enabled,p_expected_version);
$$;

revoke all on function private.get_welcome_screen_preference() from public,anon,authenticated,service_role;
revoke all on function private.admin_get_welcome_screen_preference() from public,anon,authenticated,service_role;
revoke all on function private.admin_set_welcome_screen_preference(boolean,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_welcome_screen_preference() from public,anon,authenticated,service_role;
revoke all on function public.admin_get_welcome_screen_preference() from public,anon,authenticated,service_role;
revoke all on function public.admin_set_welcome_screen_preference(boolean,integer) from public,anon,authenticated,service_role;

grant execute on function private.get_welcome_screen_preference() to anon,authenticated;
grant execute on function public.get_welcome_screen_preference() to anon,authenticated;
grant execute on function private.admin_get_welcome_screen_preference() to authenticated;
grant execute on function private.admin_set_welcome_screen_preference(boolean,integer) to authenticated;
grant execute on function public.admin_get_welcome_screen_preference() to authenticated;
grant execute on function public.admin_set_welcome_screen_preference(boolean,integer) to authenticated;

comment on table private.site_runtime_settings is 'cubica_welcome_screen:20261031164756';
comment on function private.get_welcome_screen_preference() is 'cubica_welcome_screen:20261031164756';
comment on function private.admin_get_welcome_screen_preference() is 'cubica_welcome_screen:20261031164756';
comment on function private.admin_set_welcome_screen_preference(boolean,integer) is 'cubica_welcome_screen:20261031164756';
comment on function public.get_welcome_screen_preference() is 'cubica_welcome_screen:20261031164756';
comment on function public.admin_get_welcome_screen_preference() is 'cubica_welcome_screen:20261031164756';
comment on function public.admin_set_welcome_screen_preference(boolean,integer) is 'cubica_welcome_screen:20261031164756';

do $$
declare
  signature regprocedure;
begin
  if obj_description('private.site_runtime_settings'::regclass,'pg_class')
      is distinct from 'cubica_welcome_screen:20261031164756' then
    raise exception 'welcome_screen_missing_table_sentinel';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid='private.site_runtime_settings'::regclass) then
    raise exception 'welcome_screen_rls_disabled';
  end if;
  if exists(
    select 1
      from pg_class c
     where c.oid='private.site_runtime_settings'::regclass
       and (has_table_privilege('anon',c.oid,'select,insert,update,delete')
         or has_table_privilege('authenticated',c.oid,'select,insert,update,delete')
         or has_table_privilege('service_role',c.oid,'select,insert,update,delete'))
  ) then raise exception 'welcome_screen_table_exposed'; end if;
  if (select count(*) from private.site_runtime_settings)<>1
      or (select welcome_screen_enabled from private.site_runtime_settings where singleton) then
    raise exception 'welcome_screen_default_must_be_disabled';
  end if;

  foreach signature in array array[
    'private.get_welcome_screen_preference()'::regprocedure,
    'private.admin_get_welcome_screen_preference()'::regprocedure,
    'private.admin_set_welcome_screen_preference(boolean,integer)'::regprocedure,
    'public.get_welcome_screen_preference()'::regprocedure,
    'public.admin_get_welcome_screen_preference()'::regprocedure,
    'public.admin_set_welcome_screen_preference(boolean,integer)'::regprocedure
  ] loop
    if signature is null then raise exception 'welcome_screen_missing_function'; end if;
    if exists(
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=signature::oid and a.grantee=0 and a.privilege_type='EXECUTE'
    ) then raise exception 'welcome_screen_public_execute:%',signature; end if;
    if not exists(
      select 1 from pg_proc p
      cross join lateral unnest(coalesce(p.proconfig,array[]::text[])) setting
      where p.oid=signature::oid and setting='search_path=""'
    ) then raise exception 'welcome_screen_unrestricted_search_path:%',signature; end if;
  end loop;

  if not has_function_privilege('anon','public.get_welcome_screen_preference()','execute')
      or not has_function_privilege('authenticated','public.get_welcome_screen_preference()','execute')
      or has_function_privilege('service_role','public.get_welcome_screen_preference()','execute') then
    raise exception 'welcome_screen_public_reader_acl';
  end if;
  if has_function_privilege('anon','public.admin_get_welcome_screen_preference()','execute')
      or not has_function_privilege('authenticated','public.admin_get_welcome_screen_preference()','execute')
      or has_function_privilege('service_role','public.admin_get_welcome_screen_preference()','execute')
      or has_function_privilege('anon','public.admin_set_welcome_screen_preference(boolean,integer)','execute')
      or not has_function_privilege('authenticated','public.admin_set_welcome_screen_preference(boolean,integer)','execute')
      or has_function_privilege('service_role','public.admin_set_welcome_screen_preference(boolean,integer)','execute') then
    raise exception 'welcome_screen_admin_acl';
  end if;
  if position('stage_c_assert_admin' in pg_get_functiondef('private.admin_set_welcome_screen_preference(boolean,integer)'::regprocedure))=0 then
    raise exception 'welcome_screen_admin_mfa_guard_missing';
  end if;
end $$;
