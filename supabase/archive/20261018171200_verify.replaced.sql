do $$ begin
  if to_regprocedure('private.get_site_experience(timestamptz)') is null or to_regprocedure('private.admin_get_site_configuration()') is null then raise exception 'missing visual resolver'; end if;
  if has_function_privilege('anon','private.get_site_experience(timestamptz)','execute') or has_function_privilege('authenticated','private.admin_get_site_configuration()','execute') then raise exception 'premature function access'; end if;
end $$;

