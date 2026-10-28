-- Solo lectura: verificación posterior de 5C v3.
with expected_functions(signature,expected_return,expected_definer) as(
  values
    ('private.stage_c_prevent_suggestion_history_mutation()','trigger',false),
    ('private.stage_c_suggestion_transition_allowed(text,text)','boolean',false),
    ('private.admin_list_suggestions(integer,integer,text,text,text,text,text)','jsonb',true),
    ('private.admin_get_suggestion(uuid)','jsonb',true),
    ('private.admin_update_suggestion(uuid,text,text,integer,text)','jsonb',true),
    ('private.admin_set_suggestion_lifecycle(uuid,text,integer,text)','jsonb',true),
    ('private.cleanup_suggestion_protection()','void',true)
), function_state as(
  select e.signature,e.expected_return,e.expected_definer,p.oid,
    pg_get_function_result(p.oid) actual_return,p.prosecdef,
    exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting='search_path=""') restricted_path,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') service_execute,
    exists(
      select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) public_execute
  from expected_functions e
  left join pg_proc p on p.oid=to_regprocedure(e.signature)::oid
), table_state as(
  select c.relrowsecurity,c.relforcerowsecurity,
    not exists(
      select 1 from information_schema.role_table_grants g
      where g.table_schema='private' and g.table_name='suggestion_moderation_history'
        and g.grantee in('PUBLIC','anon','authenticated','service_role')
    ) acl_closed
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname='suggestion_moderation_history'
)
select jsonb_build_object(
  'version','20261024233029',
  'sentinel',obj_description(
    to_regprocedure('private.admin_update_suggestion(uuid,text,text,integer,text)')::oid,'pg_proc'
  ),
  'sentinel_ok',obj_description(
    to_regprocedure('private.admin_update_suggestion(uuid,text,text,integer,text)')::oid,'pg_proc'
  )='cubica_stage_c:20261024233029',
  'functions',coalesce((
    select jsonb_agg(jsonb_build_object(
      'signature',signature,
      'present',oid is not null,
      'return_ok',actual_return=expected_return,
      'security_ok',prosecdef=expected_definer,
      'search_path_ok',restricted_path,
      'acl_closed',not anon_execute and not authenticated_execute and not service_execute and not public_execute
    ) order by signature)
    from function_state
  ),'[]'::jsonb),
  'history_table',coalesce((select to_jsonb(table_state) from table_state),'{}'::jsonb),
  'columns_ok',(
    select count(*)=3 from information_schema.columns
    where table_schema='private' and table_name='site_suggestions'
      and column_name in('revision','archived_at','deleted_at')
  ),
  'history_trigger_ok',exists(
    select 1 from pg_trigger
    where tgrelid='private.suggestion_moderation_history'::regclass
      and tgname='stage_c_suggestion_history_immutable' and not tgisinternal
  ),
  'premature_public_wrappers',(
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in(
      'admin_list_suggestions','admin_get_suggestion','admin_update_suggestion',
      'admin_set_suggestion_lifecycle','cleanup_suggestion_protection'
    )
  )
);
