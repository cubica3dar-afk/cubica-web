do $$ begin
  if to_regclass('private.site_content_versions') is null or to_regclass('private.site_suggestions') is null then raise exception 'missing content schema'; end if;
  if has_table_privilege('anon','private.site_suggestions','select') or has_table_privilege('authenticated','private.site_content_versions','select') then raise exception 'direct table access'; end if;
  if not exists(select 1 from storage.buckets where id='site-assets' and public=false and file_size_limit=8388608) then raise exception 'unsafe bucket'; end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read')) then raise exception 'storage exposed before activation'; end if;
end $$;

