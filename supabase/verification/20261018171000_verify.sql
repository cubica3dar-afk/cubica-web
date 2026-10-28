do $$ begin
  if to_regclass('private.site_assets') is null or to_regclass('private.site_campaigns') is null then raise exception 'missing visual schema'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any(array['site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases']) and not c.relrowsecurity) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','private.site_assets','select') or has_table_privilege('authenticated','private.site_campaigns','select') then raise exception 'direct table access'; end if;
end $$;

