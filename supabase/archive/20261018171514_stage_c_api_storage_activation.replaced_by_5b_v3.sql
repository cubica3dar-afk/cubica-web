-- CÚBICA 3D — Etapa C, bloque 7B: activación final de API y Storage.

-- Último paso: concede únicamente los permisos previstos y habilita lectura controlada de recursos.

do $$
begin
  if obj_description(to_regprocedure('public.cleanup_suggestion_protection()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171513' then
    raise exception 'stage_c_171514_missing_prerequisite:public.cleanup_suggestion_protection()';
  end if;
end $$;

drop policy if exists site_assets_public_read on storage.objects;
create policy site_assets_public_read on storage.objects for select to anon,authenticated
using(bucket_id='site-assets' and exists(
  select 1 from private.site_assets a where a.storage_path=name and a.public_since is not null and a.retired_at is null
));
drop policy if exists site_assets_admin_read on storage.objects;
create policy site_assets_admin_read on storage.objects for select to authenticated
using(bucket_id='site-assets' and private.is_admin());

revoke all on function private.get_site_experience(timestamptz),private.get_public_content_page(text),private.get_public_faq() from public,anon,authenticated,service_role;
grant execute on function private.get_site_experience(timestamptz),private.get_public_content_page(text),private.get_public_faq() to anon,authenticated;

revoke all on function public.get_site_experience(),public.get_public_content_page(text),public.get_public_faq() from public,anon,authenticated,service_role;
grant execute on function public.get_site_experience(),public.get_public_content_page(text),public.get_public_faq() to anon,authenticated;

revoke all on function public.consume_suggestion_protection(text,text,uuid),public.submit_public_suggestion(text,text,text,text,uuid,uuid),public.cleanup_suggestion_protection() from public,anon,authenticated,service_role;
grant execute on function public.consume_suggestion_protection(text,text,uuid),public.submit_public_suggestion(text,text,text,text,uuid,uuid),public.cleanup_suggestion_protection() to service_role;

do $$ declare signature regprocedure; begin
  foreach signature in array array['private.admin_get_site_configuration()'::regprocedure,
    'private.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
    'private.admin_publish_site_appearance(integer)'::regprocedure,
    'private.admin_reset_site_appearance_draft()'::regprocedure,
    'private.admin_restore_original_appearance_draft()'::regprocedure,
    'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
    'private.admin_retire_site_asset(uuid)'::regprocedure,
    'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)'::regprocedure,
    'private.admin_set_site_campaign_state(uuid,text,integer)'::regprocedure,
    'private.admin_duplicate_site_campaign(uuid)'::regprocedure,
    'private.admin_delete_site_campaign(uuid,integer)'::regprocedure,
    'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure,
    'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
    'private.admin_publish_content_page(text,integer)'::regprocedure,
    'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
    'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
    'private.admin_list_suggestions(integer,integer,text,text,text,text)'::regprocedure,
    'private.admin_update_suggestion(uuid,text,text)'::regprocedure] loop
    execute 'revoke all on function '||signature||' from public,anon,service_role';
    execute 'grant execute on function '||signature||' to authenticated';
  end loop;
  foreach signature in array array['public.admin_get_site_configuration()'::regprocedure,
    'public.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
    'public.admin_publish_site_appearance(integer)'::regprocedure,
    'public.admin_reset_site_appearance_draft()'::regprocedure,
    'public.admin_restore_original_appearance_draft()'::regprocedure,
    'public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
    'public.admin_retire_site_asset(uuid)'::regprocedure,
    'public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)'::regprocedure,
    'public.admin_set_site_campaign_state(uuid,text,integer)'::regprocedure,
    'public.admin_duplicate_site_campaign(uuid)'::regprocedure,
    'public.admin_delete_site_campaign(uuid,integer)'::regprocedure,
    'public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure,
    'public.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
    'public.admin_publish_content_page(text,integer)'::regprocedure,
    'public.admin_restore_content_version(text,integer,integer)'::regprocedure,
    'public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
    'public.admin_list_suggestions(integer,integer,text,text,text,text)'::regprocedure,
    'public.admin_update_suggestion(uuid,text,text)'::regprocedure] loop
    execute 'revoke all on function '||signature||' from public,anon,service_role';
    execute 'grant execute on function '||signature||' to authenticated';
  end loop;
end $$;

comment on function public.get_site_experience() is 'cubica_stage_c:20261018171514';

do $$ begin
    if not has_function_privilege('anon','public.get_site_experience()','execute') then raise exception 'stage_c_171514_public_read_missing'; end if;
    if has_function_privilege('anon','public.admin_get_site_configuration()','execute') or has_function_privilege('service_role','public.admin_get_site_configuration()','execute') then raise exception 'stage_c_171514_admin_exposed'; end if;
    if not has_function_privilege('authenticated','public.admin_get_site_configuration()','execute') then raise exception 'stage_c_171514_admin_missing'; end if;
    if has_function_privilege('anon','public.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') or not has_function_privilege('service_role','public.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') then raise exception 'stage_c_171514_suggestion_grants'; end if;
    if not exists(select 1 from storage.buckets where id='site-assets' and public=false) then raise exception 'stage_c_171514_bucket_public'; end if;
    if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read'))<>2 then raise exception 'stage_c_171514_storage_policies'; end if;
  end $$;
