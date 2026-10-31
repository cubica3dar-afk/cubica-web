-- CÚBICA 3D — Estado seguro no destructivo para una Etapa C parcial o completa.
-- Conserva tablas, datos, versiones y objetos de Storage. Solo desactiva rutas.

do $$
declare
  signature text;
  procedure_id regprocedure;
begin
  foreach signature in array array[
    'public.get_site_experience()',
    'public.get_public_content_page(text)',
    'public.get_public_faq()',
    'public.admin_get_site_configuration()',
    'public.admin_save_site_appearance_draft(jsonb,integer)',
    'public.admin_publish_site_appearance(integer)',
    'public.admin_reset_site_appearance_draft()',
    'public.admin_reset_site_appearance_draft(integer)',
    'public.admin_restore_original_appearance_draft()',
    'public.admin_restore_original_appearance_draft(integer)',
    'public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)',
    'public.admin_retire_site_asset(uuid)',
    'public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)',
    'public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)',
    'public.admin_set_site_campaign_state(uuid,text,integer)',
    'public.admin_set_site_campaign_state(uuid,text,integer,uuid)',
    'public.admin_duplicate_site_campaign(uuid)',
    'public.admin_duplicate_site_campaign(uuid,integer,uuid)',
    'public.admin_delete_site_campaign(uuid,integer)',
    'public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)',
    'public.admin_save_content_draft(text,text,jsonb,integer)',
    'public.admin_publish_content_page(text,integer)',
    'public.admin_restore_content_version(text,integer,integer)',
    'public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)',
    'public.admin_list_faq(boolean)',
    'public.admin_restore_faq(bigint,integer)',
    'public.admin_list_suggestions(integer,integer,text,text,text,text,text)',
    'public.admin_get_suggestion(uuid)',
    'public.admin_update_suggestion(uuid,text,text,integer,text)',
    'public.admin_set_suggestion_lifecycle(uuid,text,integer,text)',
    'public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)',
    'public.consume_suggestion_protection(text,text,uuid)',
    'public.submit_public_suggestion(text,text,text,text,uuid,uuid)',
    'public.cleanup_suggestion_protection()',
    'private.get_site_experience(timestamptz)',
    'private.stage_c_active_campaign(timestamptz)',
    'private.stage_c_next_change(timestamptz)',
    'private.stage_c_normalize_faq_question(text)',
    'private.get_public_content_page(text)',
    'private.get_public_faq()',
    'private.admin_get_site_configuration()',
    'private.admin_save_site_appearance_draft(jsonb,integer)',
    'private.admin_publish_site_appearance(integer)',
    'private.admin_reset_site_appearance_draft()',
    'private.admin_reset_site_appearance_draft(integer)',
    'private.admin_restore_original_appearance_draft()',
    'private.admin_restore_original_appearance_draft(integer)',
    'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)',
    'private.admin_retire_site_asset(uuid)',
    'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)',
    'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)',
    'private.admin_set_site_campaign_state(uuid,text,integer)',
    'private.admin_set_site_campaign_state(uuid,text,integer,uuid)',
    'private.admin_duplicate_site_campaign(uuid)',
    'private.admin_duplicate_site_campaign(uuid,integer,uuid)',
    'private.admin_delete_site_campaign(uuid,integer)',
    'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)',
    'private.admin_save_content_draft(text,text,jsonb,integer)',
    'private.admin_publish_content_page(text,integer)',
    'private.admin_restore_content_version(text,integer,integer)',
    'private.admin_list_faq(boolean)',
    'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)',
    'private.admin_restore_faq(bigint,integer)',
    'private.admin_list_suggestions(integer,integer,text,text,text,text,text)',
    'private.admin_get_suggestion(uuid)',
    'private.admin_update_suggestion(uuid,text,text,integer,text)',
    'private.admin_set_suggestion_lifecycle(uuid,text,integer,text)',
    'private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)',
    'private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)',
    'private.consume_suggestion_protection(text,text,uuid)',
    'private.submit_public_suggestion(text,text,text,text,uuid,uuid)',
    'private.cleanup_suggestion_protection()'
    ,'private.stage_c_public_asset_allowed(text)'
  ] loop
    procedure_id:=to_regprocedure(signature);
    if procedure_id is not null then
      execute 'revoke all on function '||procedure_id||' from public,anon,authenticated,service_role';
    end if;
  end loop;
end $$;

drop policy if exists site_assets_public_read on storage.objects;
drop policy if exists site_assets_admin_read on storage.objects;
update storage.buckets set public=false where id='site-assets';

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'site_assets','site_appearance_versions','site_campaigns',
    'site_campaign_occurrences','site_welcome_phrases','site_content_pages',
    'site_content_versions','site_faq_items','site_suggestions',
    'suggestion_token_uses','suggestion_rate_limits',
    'site_campaign_idempotency','suggestion_moderation_history'
  ] loop
    if to_regclass(format('private.%I',table_name)) is not null then
      execute format('alter table private.%I enable row level security',table_name);
      execute format('revoke all on private.%I from public,anon,authenticated,service_role',table_name);
    end if;
  end loop;
end $$;

