-- CÚBICA 3D — Etapa C, bloque 7B v3: activación final de API y Storage.

-- Último paso: concede únicamente los permisos previstos y habilita lectura controlada de recursos.

do $$
begin
  if obj_description(to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120200' then
    raise exception 'stage_c_20261025120300_missing_prerequisite:public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)';
  end if;
  if to_regprocedure('public.admin_update_suggestion(uuid,text,text,integer,text)') is null
      or to_regprocedure('public.admin_get_suggestion(uuid)') is null
      or to_regprocedure('public.admin_set_suggestion_lifecycle(uuid,text,integer,text)') is null then
    raise exception 'stage_c_171516_missing_prerequisite:suggestion_admin_v3_wrappers';
  end if;
  if not has_schema_privilege('anon','private','usage')
      or not has_schema_privilege('authenticated','private','usage') then
    raise exception 'stage_c_20261025120300_private_schema_usage_missing';
  end if;
end $$;

-- La política de Storage no consulta directamente una tabla privada como anon.
-- Este helper solo revela si una ruta concreta está publicada y vigente.
create or replace function private.stage_c_public_asset_allowed(p_storage_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.site_assets a
    where a.storage_path=p_storage_path
      and a.public_since is not null
      and a.retired_at is null
  );
$$;

revoke all on function private.stage_c_public_asset_allowed(text)
  from public,anon,authenticated,service_role;
grant execute on function private.stage_c_public_asset_allowed(text)
  to anon,authenticated;

drop policy if exists site_assets_public_read on storage.objects;
create policy site_assets_public_read on storage.objects for select to anon,authenticated
using(bucket_id='site-assets' and private.stage_c_public_asset_allowed(name));
drop policy if exists site_assets_admin_read on storage.objects;
create policy site_assets_admin_read on storage.objects for select to authenticated
using(bucket_id='site-assets' and private.is_admin());

revoke all on function private.get_site_experience(timestamptz),private.get_public_content_page(text),private.get_public_faq() from public,anon,authenticated,service_role;
grant execute on function private.get_site_experience(timestamptz),private.get_public_content_page(text),private.get_public_faq() to anon,authenticated;

revoke all on function public.get_site_experience(),public.get_public_content_page(text),public.get_public_faq() from public,anon,authenticated,service_role;
grant execute on function public.get_site_experience(),public.get_public_content_page(text),public.get_public_faq() to anon,authenticated;

revoke all on function public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid),public.cleanup_suggestion_protection() from public,anon,authenticated,service_role;
grant execute on function public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid),public.cleanup_suggestion_protection() to service_role;

do $$ declare signature regprocedure; begin
  foreach signature in array array['private.admin_get_site_configuration()'::regprocedure,
    'private.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
    'private.admin_publish_site_appearance(integer)'::regprocedure,
    'private.admin_reset_site_appearance_draft(integer)'::regprocedure,
    'private.admin_restore_original_appearance_draft(integer)'::regprocedure,
    'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
    'private.admin_retire_site_asset(uuid)'::regprocedure,
    'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'::regprocedure,
    'private.admin_set_site_campaign_state(uuid,text,integer,uuid)'::regprocedure,
    'private.admin_duplicate_site_campaign(uuid,integer,uuid)'::regprocedure,
    'private.admin_delete_site_campaign(uuid,integer)'::regprocedure,
    'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure,
    'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
    'private.admin_publish_content_page(text,integer)'::regprocedure,
    'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
    'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
    'private.admin_list_faq(boolean)'::regprocedure,
    'private.admin_restore_faq(bigint,integer)'::regprocedure,
    'private.admin_list_suggestions(integer,integer,text,text,text,text,text)'::regprocedure,
    'private.admin_get_suggestion(uuid)'::regprocedure,
    'private.admin_update_suggestion(uuid,text,text,integer,text)'::regprocedure,
    'private.admin_set_suggestion_lifecycle(uuid,text,integer,text)'::regprocedure] loop
    execute 'revoke all on function '||signature||' from public,anon,service_role';
    execute 'grant execute on function '||signature||' to authenticated';
  end loop;
  foreach signature in array array['public.admin_get_site_configuration()'::regprocedure,
    'public.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
    'public.admin_publish_site_appearance(integer)'::regprocedure,
    'public.admin_reset_site_appearance_draft(integer)'::regprocedure,
    'public.admin_restore_original_appearance_draft(integer)'::regprocedure,
    'public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
    'public.admin_retire_site_asset(uuid)'::regprocedure,
    'public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'::regprocedure,
    'public.admin_set_site_campaign_state(uuid,text,integer,uuid)'::regprocedure,
    'public.admin_duplicate_site_campaign(uuid,integer,uuid)'::regprocedure,
    'public.admin_delete_site_campaign(uuid,integer)'::regprocedure,
    'public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure,
    'public.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
    'public.admin_publish_content_page(text,integer)'::regprocedure,
    'public.admin_restore_content_version(text,integer,integer)'::regprocedure,
    'public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
    'public.admin_list_faq(boolean)'::regprocedure,
    'public.admin_restore_faq(bigint,integer)'::regprocedure,
    'public.admin_list_suggestions(integer,integer,text,text,text,text,text)'::regprocedure,
    'public.admin_get_suggestion(uuid)'::regprocedure,
    'public.admin_update_suggestion(uuid,text,text,integer,text)'::regprocedure,
    'public.admin_set_suggestion_lifecycle(uuid,text,integer,text)'::regprocedure] loop
    execute 'revoke all on function '||signature||' from public,anon,service_role';
    execute 'grant execute on function '||signature||' to authenticated';
  end loop;
end $$;

comment on function private.stage_c_public_asset_allowed(text) is 'cubica_stage_c:20261025120300';
comment on function public.get_site_experience() is 'cubica_stage_c:20261025120300';

do $$ begin
    if not has_function_privilege('anon','public.get_site_experience()','execute') then raise exception 'stage_c_20261025120300_public_read_missing'; end if;
    if has_function_privilege('anon','public.admin_get_site_configuration()','execute') or has_function_privilege('service_role','public.admin_get_site_configuration()','execute') then raise exception 'stage_c_171516_admin_exposed'; end if;
    if not has_function_privilege('authenticated','public.admin_get_site_configuration()','execute') then raise exception 'stage_c_171516_admin_missing'; end if;
    if has_function_privilege('anon','public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','execute')
        or has_function_privilege('authenticated','public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','execute')
        or not has_function_privilege('service_role','public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','execute') then
      raise exception 'stage_c_171516_suggestion_grants';
    end if;
    if exists(
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid='public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure
        and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) then raise exception 'stage_c_171516_suggestion_public_execute'; end if;
    if to_regprocedure('public.consume_suggestion_protection(text,text,uuid)') is not null
        or to_regprocedure('public.submit_public_suggestion(text,text,text,text,uuid,uuid)') is not null then
      raise exception 'stage_c_171516_legacy_suggestion_wrapper_present';
    end if;
    if obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120300' then raise exception 'stage_c_20261025120300_missing_sentinel'; end if;
    if obj_description(to_regprocedure('private.stage_c_public_asset_allowed(text)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120300' then raise exception 'stage_c_20261025120300_missing_storage_helper_sentinel'; end if;
    if not has_function_privilege('anon','private.stage_c_public_asset_allowed(text)','execute')
        or not has_function_privilege('authenticated','private.stage_c_public_asset_allowed(text)','execute')
        or has_function_privilege('service_role','private.stage_c_public_asset_allowed(text)','execute') then
      raise exception 'stage_c_20261025120300_storage_helper_grants';
    end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='private.stage_c_public_asset_allowed(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'stage_c_20261025120300_storage_helper_public_execute'; end if;
    if not exists(select 1 from pg_proc p cross join lateral unnest(coalesce(p.proconfig,array[]::text[])) setting where p.oid='private.stage_c_public_asset_allowed(text)'::regprocedure and setting='search_path=""') then raise exception 'stage_c_20261025120300_storage_helper_search_path'; end if;
    if not exists(select 1 from storage.buckets where id='site-assets' and public=false) then raise exception 'stage_c_20261025120300_bucket_public'; end if;
    if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read'))<>2 then raise exception 'stage_c_20261025120300_storage_policies'; end if;
  end $$;

-- Atestación exhaustiva: 22 rutas administrativas, 3 lecturas públicas,
-- 2 rutas internas y 13 tablas privadas. Cualquier desvío aborta 7B.
do $$
declare
  v_admin_names constant text[]:=array[
    'admin_get_site_configuration','admin_save_site_appearance_draft',
    'admin_publish_site_appearance','admin_reset_site_appearance_draft',
    'admin_restore_original_appearance_draft','admin_register_site_asset',
    'admin_retire_site_asset','admin_upsert_site_campaign',
    'admin_set_site_campaign_state','admin_duplicate_site_campaign',
    'admin_delete_site_campaign','admin_upsert_welcome_phrase',
    'admin_save_content_draft','admin_publish_content_page',
    'admin_restore_content_version','admin_upsert_faq','admin_list_faq',
    'admin_restore_faq','admin_list_suggestions','admin_get_suggestion',
    'admin_update_suggestion','admin_set_suggestion_lifecycle'
  ];
  v_table_names constant text[]:=array[
    'site_assets','site_appearance_versions','site_campaigns',
    'site_campaign_occurrences','site_welcome_phrases','site_content_pages',
    'site_content_versions','site_faq_items','site_suggestions',
    'suggestion_token_uses','suggestion_rate_limits',
    'site_campaign_idempotency','suggestion_moderation_history'
  ];
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any(v_admin_names))<>22 then
    raise exception 'stage_c_20261025120300_admin_wrapper_count';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(v_admin_names)
      and (p.prosecdef
        or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']
        or not has_function_privilege('authenticated',p.oid,'execute')
        or has_function_privilege('anon',p.oid,'execute')
        or has_function_privilege('service_role',p.oid,'execute')
        or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                  where a.grantee=0 and a.privilege_type='EXECUTE'))
  ) then raise exception 'stage_c_20261025120300_admin_wrapper_acl_or_mode'; end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname=any(v_admin_names))<>22 then
    raise exception 'stage_c_20261025120300_admin_target_count';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname=any(v_admin_names)
      and (not p.prosecdef
        or not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']
        or position('stage_c_assert_admin' in p.prosrc)=0
        or not has_function_privilege('authenticated',p.oid,'execute')
        or has_function_privilege('anon',p.oid,'execute')
        or has_function_privilege('service_role',p.oid,'execute')
        or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                  where a.grantee=0 and a.privilege_type='EXECUTE'))
  ) then raise exception 'stage_c_20261025120300_admin_target_acl_mode_or_mfa'; end if;

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private')
      and p.proname=any(array['get_site_experience','get_public_content_page','get_public_faq'])
      and (not coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']
        or not has_function_privilege('anon',p.oid,'execute')
        or not has_function_privilege('authenticated',p.oid,'execute')
        or has_function_privilege('service_role',p.oid,'execute')
        or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                  where a.grantee=0 and a.privilege_type='EXECUTE'))
  ) then raise exception 'stage_c_20261025120300_public_reader_acl'; end if;

  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname=any(v_table_names)
      and (not c.relrowsecurity
        or has_table_privilege('anon',c.oid,'select,insert,update,delete')
        or has_table_privilege('authenticated',c.oid,'select,insert,update,delete')
        or has_table_privilege('service_role',c.oid,'select,insert,update,delete'))
  ) then raise exception 'stage_c_20261025120300_private_table_acl_or_rls'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=any(v_table_names))<>13 then
    raise exception 'stage_c_20261025120300_private_table_count';
  end if;

  if not exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='site_assets_public_read'
      and coalesce(qual,'') like '%stage_c_public_asset_allowed%'
  ) then raise exception 'stage_c_20261025120300_storage_policy_bypasses_helper'; end if;
end $$;

