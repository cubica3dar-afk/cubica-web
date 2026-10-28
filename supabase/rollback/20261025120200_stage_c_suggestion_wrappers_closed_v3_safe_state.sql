-- Contención no destructiva de 7A-3 v3. Conserva funciones y datos.
do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),
    to_regprocedure('public.admin_list_suggestions(integer,integer,text,text,text,text,text)'),
    to_regprocedure('public.admin_get_suggestion(uuid)'),
    to_regprocedure('public.admin_update_suggestion(uuid,text,text,integer,text)'),
    to_regprocedure('public.admin_set_suggestion_lifecycle(uuid,text,integer,text)'),
    to_regprocedure('public.cleanup_suggestion_protection()')
  ] loop
    if signature is not null then
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end if;
  end loop;
end $$;

