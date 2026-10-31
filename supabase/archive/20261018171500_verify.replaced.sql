do $$ begin
  if not has_function_privilege('anon','public.get_site_experience()','execute') then raise exception 'public experience disabled'; end if;
  if has_function_privilege('anon','public.admin_get_site_configuration()','execute') or not has_function_privilege('authenticated','public.admin_get_site_configuration()','execute') then raise exception 'admin grants'; end if;
  if has_function_privilege('anon','public.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') or not has_function_privilege('service_role','public.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') then raise exception 'suggestion grants'; end if;
  if not exists(select 1 from storage.buckets where id='site-assets' and public=false) then raise exception 'bucket public'; end if;
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read'))<>2 then raise exception 'storage policies'; end if;
end $$;
