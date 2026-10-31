select jsonb_build_object(
  'table_present',to_regclass('private.site_runtime_settings') is not null,
  'table_rls',coalesce((select c.relrowsecurity from pg_class c where c.oid=to_regclass('private.site_runtime_settings')),false),
  'row_count',case when to_regclass('private.site_runtime_settings') is null then null else (select count(*) from private.site_runtime_settings) end,
  'enabled',case when to_regclass('private.site_runtime_settings') is null then null else (select welcome_screen_enabled from private.site_runtime_settings where singleton) end,
  'public_reader_anon',coalesce(has_function_privilege('anon',to_regprocedure('public.get_welcome_screen_preference()'),'execute'),false),
  'public_reader_authenticated',coalesce(has_function_privilege('authenticated',to_regprocedure('public.get_welcome_screen_preference()'),'execute'),false),
  'admin_reader_authenticated',coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_get_welcome_screen_preference()'),'execute'),false),
  'admin_writer_authenticated',coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_set_welcome_screen_preference(boolean,integer)'),'execute'),false),
  'anon_admin_denied',not coalesce(has_function_privilege('anon',to_regprocedure('public.admin_set_welcome_screen_preference(boolean,integer)'),'execute'),false),
  'table_api_acl_closed',case when to_regclass('private.site_runtime_settings') is null then false else not (
    has_table_privilege('anon','private.site_runtime_settings','select,insert,update,delete')
    or has_table_privilege('authenticated','private.site_runtime_settings','select,insert,update,delete')
    or has_table_privilege('service_role','private.site_runtime_settings','select,insert,update,delete')
  ) end
) as welcome_screen_preference_status;
