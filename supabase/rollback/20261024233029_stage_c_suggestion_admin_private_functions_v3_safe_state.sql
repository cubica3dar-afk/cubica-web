-- Contención no destructiva de 5C v3.
-- Conserva sugerencias, revisiones e historial; cierra todas las rutas previstas.
do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      to_regprocedure('private.stage_c_prevent_suggestion_history_mutation()'),
      to_regprocedure('private.stage_c_suggestion_transition_allowed(text,text)'),
      to_regprocedure('private.admin_list_suggestions(integer,integer,text,text,text,text,text)'),
      to_regprocedure('private.admin_get_suggestion(uuid)'),
      to_regprocedure('private.admin_update_suggestion(uuid,text,text,integer,text)'),
      to_regprocedure('private.admin_set_suggestion_lifecycle(uuid,text,integer,text)'),
      to_regprocedure('private.cleanup_suggestion_protection()'),
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

alter table if exists private.site_suggestions enable row level security;
alter table if exists private.suggestion_moderation_history enable row level security;
alter table if exists private.suggestion_moderation_history force row level security;
revoke all on private.site_suggestions,private.suggestion_moderation_history
  from public,anon,authenticated,service_role;
