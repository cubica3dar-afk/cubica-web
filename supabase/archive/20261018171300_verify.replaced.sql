do $$ begin
  if to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)') is null or to_regprocedure('private.admin_update_suggestion(uuid,text,text)') is null then raise exception 'missing content or suggestion function'; end if;
  if has_function_privilege('service_role','private.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') or has_function_privilege('authenticated','private.admin_update_suggestion(uuid,text,text)','execute') then raise exception 'premature function access'; end if;
end $$;

