do $$ begin
  if to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)') is null then raise exception 'missing admin campaign function'; end if;
  if has_function_privilege('authenticated','private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)','execute') then raise exception 'premature admin access'; end if;
end $$;

