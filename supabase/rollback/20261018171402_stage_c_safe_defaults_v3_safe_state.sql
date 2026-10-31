-- Contención no destructiva del bloque 6 v3.
-- No elimina semillas: no existe una marca de procedencia que permita distinguir
-- con certeza una fila intacta de otra editada legítimamente después de instalar.

do $$
begin
  if obj_description(to_regclass('private.site_content_pages')::oid,'pg_class')
       is distinct from 'cubica_stage_c:20261018171402' then
    raise exception 'stage_c_171402_safe_state_wrong_or_missing_sentinel';
  end if;
end $$;

comment on table private.site_content_pages is null;

do $$
declare
  v_table text;
  v_signature text;
  v_oid regprocedure;
begin
  foreach v_table in array array[
    'site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences',
    'site_welcome_phrases','site_campaign_idempotency','site_content_pages','site_content_versions',
    'site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits',
    'suggestion_moderation_history'
  ] loop
    if to_regclass('private.'||v_table) is not null then
      execute format('alter table private.%I enable row level security',v_table);
      execute format('revoke all on private.%I from public,anon,authenticated,service_role',v_table);
    end if;
  end loop;

  foreach v_signature in array array[
    'public.get_site_experience()','public.get_public_content_page(text)','public.get_public_faq()',
    'public.admin_get_site_configuration()','public.admin_save_site_appearance_draft(jsonb,integer)',
    'public.admin_publish_site_appearance(integer)','public.admin_reset_site_appearance_draft(integer)',
    'public.admin_restore_original_appearance_draft(integer)',
    'public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)',
    'public.admin_retire_site_asset(uuid)',
    'public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)',
    'public.admin_set_site_campaign_state(uuid,text,integer,uuid)',
    'public.admin_duplicate_site_campaign(uuid,integer,uuid)',
    'public.admin_delete_site_campaign(uuid,integer)',
    'public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)',
    'public.admin_save_content_draft(text,text,jsonb,integer)',
    'public.admin_publish_content_page(text,integer)',
    'public.admin_restore_content_version(text,integer,integer)',
    'public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)',
    'public.admin_list_faq(boolean)','public.admin_restore_faq(bigint,integer)',
    'public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)',
    'public.admin_list_suggestions(integer,integer,text,text,text,text,text)',
    'public.admin_get_suggestion(uuid)','public.admin_update_suggestion(uuid,text,text,integer,text)',
    'public.admin_set_suggestion_lifecycle(uuid,text,integer,text)','public.cleanup_suggestion_protection()'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is not null then
      execute 'revoke all on function '||v_oid||' from public,anon,authenticated,service_role';
    end if;
  end loop;
end $$;

drop policy if exists site_assets_public_read on storage.objects;
drop policy if exists site_assets_admin_read on storage.objects;
update storage.buckets set public=false where id='site-assets';
