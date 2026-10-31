-- CÚBICA 3D — Etapa C, bloque 7/7: activación atómica de API y Storage.

-- Es el único bloque que habilita acceso público o administrativo.

drop policy if exists site_assets_public_read on storage.objects;
create policy site_assets_public_read on storage.objects for select to anon,authenticated
using(bucket_id='site-assets' and exists(
  select 1 from private.site_assets a where a.storage_path=name and a.public_since is not null and a.retired_at is null
));
drop policy if exists site_assets_admin_read on storage.objects;
create policy site_assets_admin_read on storage.objects for select to authenticated
using(bucket_id='site-assets' and private.is_admin());

create or replace function public.get_site_experience()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_site_experience(now()); $$;

create or replace function public.get_public_content_page(p_slug text)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_public_content_page(p_slug); $$;

create or replace function public.get_public_faq()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_public_faq(); $$;

create or replace function public.admin_get_site_configuration()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_get_site_configuration(); $$;

create or replace function public.admin_save_site_appearance_draft(p_config jsonb,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_save_site_appearance_draft(p_config,p_expected_version); $$;

create or replace function public.admin_publish_site_appearance(p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_publish_site_appearance(p_expected_version); $$;

create or replace function public.admin_reset_site_appearance_draft()
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_reset_site_appearance_draft(); $$;

create or replace function public.admin_restore_original_appearance_draft()
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_restore_original_appearance_draft(); $$;

create or replace function public.admin_register_site_asset(p_kind text,p_label text,p_storage_path text,p_mime_type text,p_byte_size bigint,p_width integer,p_height integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_register_site_asset(p_kind,p_label,p_storage_path,p_mime_type,p_byte_size,p_width,p_height); $$;

create or replace function public.admin_retire_site_asset(p_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.admin_retire_site_asset(p_id); $$;

create or replace function public.admin_upsert_site_campaign(p_id uuid,p_name text,p_description text,p_priority integer,p_recurrence_mode text,p_starts_at timestamptz,p_ends_at timestamptz,p_annual_start_month integer,p_annual_start_day integer,p_annual_start_time time,p_annual_end_month integer,p_annual_end_day integer,p_annual_end_time time,p_theme jsonb,p_occurrences jsonb,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_site_campaign(p_id,p_name,p_description,p_priority,p_recurrence_mode,p_starts_at,p_ends_at,p_annual_start_month,p_annual_start_day,p_annual_start_time,p_annual_end_month,p_annual_end_day,p_annual_end_time,p_theme,p_occurrences,p_expected_version); $$;

create or replace function public.admin_set_site_campaign_state(p_id uuid,p_state text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_set_site_campaign_state(p_id,p_state,p_expected_version); $$;

create or replace function public.admin_duplicate_site_campaign(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_duplicate_site_campaign(p_id); $$;

create or replace function public.admin_delete_site_campaign(p_id uuid,p_expected_version integer)
returns void language sql security invoker set search_path='' as $$ select private.admin_delete_site_campaign(p_id,p_expected_version); $$;

create or replace function public.admin_upsert_welcome_phrase(p_id bigint,p_campaign_id uuid,p_phrase text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_welcome_phrase(p_id,p_campaign_id,p_phrase,p_active,p_sort_order,p_expected_version,p_delete); $$;

create or replace function public.admin_save_content_draft(p_slug text,p_title text,p_content jsonb,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_save_content_draft(p_slug,p_title,p_content,p_expected_version); $$;

create or replace function public.admin_publish_content_page(p_slug text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_publish_content_page(p_slug,p_expected_version); $$;

create or replace function public.admin_restore_content_version(p_slug text,p_version integer,p_expected_draft_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_restore_content_version(p_slug,p_version,p_expected_draft_version); $$;

create or replace function public.admin_upsert_faq(p_id bigint,p_question text,p_answer text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_faq(p_id,p_question,p_answer,p_active,p_sort_order,p_expected_version,p_delete); $$;

create or replace function public.consume_suggestion_protection(p_token_hash text,p_identity_hash text,p_request_id uuid)
returns void language sql security definer set search_path='' as $$
  select private.consume_suggestion_protection(p_token_hash,p_identity_hash,p_request_id);
$$;

create or replace function public.submit_public_suggestion(p_category text,p_subject text,p_description text,p_contact text,p_request_id uuid,p_verified_user_id uuid)
returns uuid language sql security definer set search_path='' as $$
  select private.submit_public_suggestion(p_category,p_subject,p_description,p_contact,p_request_id,p_verified_user_id);
$$;

create or replace function public.admin_list_suggestions(p_page integer default 1,p_page_size integer default 25,p_search text default null,p_status text default 'all',p_category text default 'all',p_sort text default 'recent')
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_list_suggestions(p_page,p_page_size,p_search,p_status,p_category,p_sort); $$;

create or replace function public.admin_update_suggestion(p_id uuid,p_status text,p_private_notes text)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_update_suggestion(p_id,p_status,p_private_notes); $$;

create or replace function public.cleanup_suggestion_protection()
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  perform private.cleanup_suggestion_protection();
end;
$$;

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

comment on function public.get_site_experience() is 'cubica_stage_c:20261018171500';

do $$ begin
    if not has_function_privilege('anon','public.get_site_experience()','execute') then raise exception 'stage_c_171500_public_read_missing'; end if;
    if has_function_privilege('anon','public.admin_get_site_configuration()','execute') or has_function_privilege('service_role','public.admin_get_site_configuration()','execute') then raise exception 'stage_c_171500_admin_exposed'; end if;
    if not has_function_privilege('authenticated','public.admin_get_site_configuration()','execute') then raise exception 'stage_c_171500_admin_missing'; end if;
    if has_function_privilege('anon','public.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') or not has_function_privilege('service_role','public.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') then raise exception 'stage_c_171500_suggestion_grants'; end if;
    if not exists(select 1 from storage.buckets where id='site-assets' and public=false) then raise exception 'stage_c_171500_bucket_public'; end if;
    if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read'))<>2 then raise exception 'stage_c_171500_storage_policies'; end if;
  end $$;
