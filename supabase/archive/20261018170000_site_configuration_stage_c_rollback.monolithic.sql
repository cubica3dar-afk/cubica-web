-- Recuperación no destructiva de Etapa C.
-- Ejecutar junto con la publicación del frontend anterior. Conserva tablas,
-- versiones, sugerencias y objetos para permitir diagnóstico y recuperación.
begin;

revoke execute on function public.get_site_experience(),public.get_public_content_page(text),public.get_public_faq() from anon,authenticated;
revoke all on function public.admin_get_site_configuration(),public.admin_save_site_appearance_draft(jsonb,integer),public.admin_publish_site_appearance(integer),public.admin_reset_site_appearance_draft(),public.admin_restore_original_appearance_draft(),public.admin_register_site_asset(text,text,text,text,bigint,integer,integer),public.admin_retire_site_asset(uuid),public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer),public.admin_set_site_campaign_state(uuid,text,integer),public.admin_duplicate_site_campaign(uuid),public.admin_delete_site_campaign(uuid,integer),public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean),public.admin_save_content_draft(text,text,jsonb,integer),public.admin_publish_content_page(text,integer),public.admin_restore_content_version(text,integer,integer),public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean),public.admin_list_suggestions(integer,integer,text,text,text,text),public.admin_update_suggestion(uuid,text,text) from public,anon,authenticated;
revoke all on function private.submit_public_suggestion(text,text,text,text,uuid,uuid),private.cleanup_suggestion_protection() from service_role;
revoke all on function public.consume_suggestion_protection(text,text,uuid),public.submit_public_suggestion(text,text,text,text,uuid,uuid),public.cleanup_suggestion_protection() from service_role;

drop policy if exists site_assets_public_read on storage.objects;
-- El bucket sigue privado y los archivos se conservan. La política administrativa
-- permanece para que una recuperación posterior pueda inspeccionarlos con AAL2.
update storage.buckets set public=false where id='site-assets';

commit;

