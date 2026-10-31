-- Solo lectura: distingue cada bloque confirmado, ausente o inconsistente.
-- La versión efectiva la asigna Supabase; el nombre registrado y el centinela son identidades estables.

with expected as (
  select * from (values
    ('1','20261018171000','stage_c_20261018171000_visual_schema','table','private.site_campaigns','cubica_stage_c:20261018171000',array['private.site_assets','private.site_appearance_versions','private.site_campaigns','private.site_campaign_occurrences','private.site_welcome_phrases']::text[],array[]::text[],'closed_tables',true),
    ('2','20261018171100','stage_c_20261018171100_content_suggestion_schema','table','private.site_suggestions','cubica_stage_c:20261018171100',array['private.site_content_pages','private.site_content_versions','private.site_faq_items','private.site_suggestions','private.suggestion_token_uses','private.suggestion_rate_limits']::text[],array[]::text[],'closed_tables',true),
    ('3-original-replaced','20261018171200','stage_c_20261018171200_visual_private_functions','function','private.get_site_experience(timestamptz)','cubica_stage_c:20261018171200',array[]::text[],array[]::text[],'original_replaced',false),
    ('3A','20261018171210','stage_c_20261018171210_visual_validators_private_functions','function','private.stage_c_assert_admin()','cubica_stage_c:20261018171210',array[]::text[],array['private.stage_c_assert_admin()','private.stage_c_safe_text(text,integer,boolean)','private.stage_c_luminance(text)','private.stage_c_validate_theme(jsonb)','private.stage_c_asset_paths(jsonb)']::text[],'closed_functions',true),
    ('3B-original-replaced','20261018171220','stage_c_20261018171220_campaign_resolution_private_functions','function','private.stage_c_active_campaign(timestamptz)','cubica_stage_c:20261018171220',array[]::text[],array[]::text[],'original_replaced',false),
    ('3B-1-v3','20261018171218','stage_c_20261018171218_active_campaign_private_function_v3','function','private.stage_c_active_campaign(timestamptz)','cubica_stage_c:20261018171218',array[]::text[],array['private.stage_c_active_campaign(timestamptz)']::text[],'closed_functions',true),
    ('3B-1-v2-replaced','20261018171219','stage_c_20261018171219_active_campaign_private_function_v2','function','private.stage_c_active_campaign(timestamptz)','cubica_stage_c:20261018171219',array[]::text[],array[]::text[],'original_replaced',false),
    ('3B-1-invalid-replaced','20261018171221','stage_c_20261018171221_active_campaign_private_function','function','private.stage_c_active_campaign(timestamptz)','cubica_stage_c:20261018171221',array[]::text[],array[]::text[],'original_replaced',false),
    ('3B-2-v1-replaced','20261018171222','stage_c_20261018171222_next_change_private_function','function','private.stage_c_next_change(timestamptz)','cubica_stage_c:20261018171222',array[]::text[],array[]::text[],'original_replaced',false),
    ('3B-2-v2','20261018171223','stage_c_20261018171223_next_change_private_function_v2','function','private.stage_c_next_change(timestamptz)','cubica_stage_c:20261018171223',array[]::text[],array['private.stage_c_next_change(timestamptz)']::text[],'closed_functions',true),
    ('3C-original-replaced','20261018171230','stage_c_20261018171230_configuration_resolution_private_functions','function','private.get_site_experience(timestamptz)','cubica_stage_c:20261018171230',array[]::text[],array[]::text[],'original_replaced',false),
    ('3C-1','20261018171231','stage_c_20261018171231_site_experience_private_function','function','private.get_site_experience(timestamptz)','cubica_stage_c:20261018171231',array[]::text[],array['private.get_site_experience(timestamptz)']::text[],'closed_functions',true),
    ('3C-2','20261018171232','stage_c_20261018171232_admin_configuration_private_function','function','private.admin_get_site_configuration()','cubica_stage_c:20261018171232',array[]::text[],array['private.admin_get_site_configuration()']::text[],'closed_functions',true),
    ('4-original-replaced','20261018171250','stage_c_20261018171250_visual_admin_private_functions','function','private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)','cubica_stage_c:20261018171250',array[]::text[],array[]::text[],'original_replaced',false),
    ('4A-v2','20261018171249','stage_c_20261018171249_appearance_asset_admin_private_functions_v2','function','private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)','cubica_stage_c:20261018171249',array[]::text[],array['private.stage_c_validate_theme(jsonb)','private.admin_save_site_appearance_draft(jsonb,integer)','private.admin_publish_site_appearance(integer)','private.admin_reset_site_appearance_draft(integer)','private.admin_restore_original_appearance_draft(integer)','private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)','private.admin_retire_site_asset(uuid)']::text[],'closed_functions',true),
    ('4A-v1-replaced','20261018171251','stage_c_20261018171251_appearance_asset_admin_private_functions','function','private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)','cubica_stage_c:20261018171251',array[]::text[],array[]::text[],'original_replaced',false),
    ('4B-v1-replaced','20261018171252','stage_c_20261018171252_campaign_admin_private_functions','function','private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)','cubica_stage_c:20261018171252',array[]::text[],array[]::text[],'original_replaced',false),
    ('4B-v2','20261018171254','stage_c_20261018171254_campaign_admin_private_functions_v2','function','private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)','cubica_stage_c:20261018171254',array['private.site_campaign_idempotency']::text[],array['private.stage_c_begin_campaign_operation(text,uuid,jsonb)','private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)','private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)','private.admin_set_site_campaign_state(uuid,text,integer,uuid)','private.admin_duplicate_site_campaign(uuid,integer,uuid)','private.admin_delete_site_campaign(uuid,integer)']::text[],'closed_functions',true),
    ('4C-v1-replaced','20261018171253','stage_c_20261018171253_phrase_admin_private_function','function','private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)','cubica_stage_c:20261018171253',array[]::text[],array[]::text[],'original_replaced',false),
    ('4C-v2','20261018171255','stage_c_20261018171255_phrase_admin_private_function_v2','function','private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)','cubica_stage_c:20261018171255',array[]::text[],array['private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)']::text[],'closed_functions',true),
    ('5-original-replaced','20261018171300','stage_c_20261018171300_content_suggestion_private_functions','function','private.admin_update_suggestion(uuid,text,text)','cubica_stage_c:20261018171300',array[]::text[],array[]::text[],'original_replaced',false),
    ('5A-v1-replaced','20261018171301','stage_c_20261018171301_content_faq_private_functions','function','private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)','cubica_stage_c:20261018171301',array[]::text[],array[]::text[],'original_replaced',false),
    ('5A-v2','20261018171256','stage_c_20261018171256_content_faq_private_functions_v2','function','private.admin_restore_faq(bigint,integer)','cubica_stage_c:20261018171256',array[]::text[],array['private.stage_c_normalize_faq_question(text)','private.get_public_content_page(text)','private.get_public_faq()','private.stage_c_validate_content(jsonb)','private.admin_save_content_draft(text,text,jsonb,integer)','private.admin_publish_content_page(text,integer)','private.admin_restore_content_version(text,integer,integer)','private.admin_list_faq(boolean)','private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)','private.admin_restore_faq(bigint,integer)']::text[],'closed_functions',true),
    ('5B-v3','20261018171258','stage_c_20261018171258_suggestion_protection_private_functions_v3','function','private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','cubica_stage_c:20261018171258',array[]::text[],array['private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)','private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)']::text[],'closed_functions',true),
    ('5C-v2-replaced','20261018171304','stage_c_20261018171304_suggestion_admin_private_functions_v2','function','private.admin_update_suggestion(uuid,text,text)','cubica_stage_c:20261018171304',array[]::text[],array[]::text[],'original_replaced',false),
    ('5C-v3','20261024233029','stage_c_20261024233029_suggestion_admin_private_functions_v3','function','private.admin_update_suggestion(uuid,text,text,integer,text)','cubica_stage_c:20261024233029',array['private.suggestion_moderation_history']::text[],array['private.stage_c_prevent_suggestion_history_mutation()','private.stage_c_suggestion_transition_allowed(text,text)','private.admin_list_suggestions(integer,integer,text,text,text,text,text)','private.admin_get_suggestion(uuid)','private.admin_update_suggestion(uuid,text,text,integer,text)','private.admin_set_suggestion_lifecycle(uuid,text,integer,text)','private.cleanup_suggestion_protection()']::text[],'closed_objects',true),
    ('6-v3','20261018171402','stage_c_20261018171402_safe_defaults_v3','table','private.site_content_pages','cubica_stage_c:20261018171402',array['private.site_content_pages','private.site_appearance_versions','private.site_welcome_phrases']::text[],array[]::text[],'closed_tables',false),
    ('7-original-replaced','20261018171500','stage_c_20261018171500_api_activation','function','public.get_site_experience()','cubica_stage_c:20261018171500',array[]::text[],array[]::text[],'original_replaced',false),
    ('7A-original-replaced','20261018171501','stage_c_20261018171501_api_wrappers_closed','function','public.cleanup_suggestion_protection()','cubica_stage_c:20261018171501',array[]::text[],array[]::text[],'original_replaced',false),
    ('7A-1-v2-replaced','20261018171507','stage_c_20261018171507_public_appearance_wrappers_closed_v2','function','public.admin_retire_site_asset(uuid)','cubica_stage_c:20261018171507',array[]::text[],array[]::text[],'original_replaced',false),
    ('7A-2-v2-replaced','20261018171508','stage_c_20261018171508_campaign_content_wrappers_closed_v2','function','public.admin_restore_faq(bigint,integer)','cubica_stage_c:20261018171508',array[]::text[],array[]::text[],'original_replaced',false),
    ('7A-3-v2-replaced','20261018171515','stage_c_20261018171515_suggestion_wrappers_closed_v2','function','public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','cubica_stage_c:20261018171515',array[]::text[],array[]::text[],'original_replaced',false),
    ('7B-v2-replaced','20261018171516','stage_c_20261018171516_api_storage_activation_v2','function','public.get_site_experience()','cubica_stage_c:20261018171516',array[]::text[],array[]::text[],'original_replaced',false),
    ('7A-1-v3','20261025120000','stage_c_20261025120000_public_appearance_wrappers_closed_v3','function','public.admin_retire_site_asset(uuid)','cubica_stage_c:20261025120000',array[]::text[],array['public.get_site_experience()','public.get_public_content_page(text)','public.get_public_faq()','public.admin_get_site_configuration()','public.admin_save_site_appearance_draft(jsonb,integer)','public.admin_publish_site_appearance(integer)','public.admin_reset_site_appearance_draft(integer)','public.admin_restore_original_appearance_draft(integer)','public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)','public.admin_retire_site_asset(uuid)']::text[],'wrappers_safe',true),
    ('7A-2-v3','20261025120100','stage_c_20261025120100_campaign_content_wrappers_closed_v3','function','public.admin_restore_faq(bigint,integer)','cubica_stage_c:20261025120100',array[]::text[],array['public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)','public.admin_set_site_campaign_state(uuid,text,integer,uuid)','public.admin_duplicate_site_campaign(uuid,integer,uuid)','public.admin_delete_site_campaign(uuid,integer)','public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)','public.admin_save_content_draft(text,text,jsonb,integer)','public.admin_publish_content_page(text,integer)','public.admin_restore_content_version(text,integer,integer)','public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)','public.admin_list_faq(boolean)','public.admin_restore_faq(bigint,integer)']::text[],'wrappers_safe',true),
    ('7A-3-v3','20261025120200','stage_c_20261025120200_suggestion_wrappers_closed_v3','function','public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','cubica_stage_c:20261025120200',array[]::text[],array['public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','public.admin_list_suggestions(integer,integer,text,text,text,text,text)','public.admin_get_suggestion(uuid)','public.admin_update_suggestion(uuid,text,text,integer,text)','public.admin_set_suggestion_lifecycle(uuid,text,integer,text)','public.cleanup_suggestion_protection()']::text[],'wrappers_safe',true),
    ('7B-v3','20261025120300','stage_c_20261025120300_api_storage_activation_v3','function','public.get_site_experience()','cubica_stage_c:20261025120300',array[]::text[],array['public.get_site_experience()','private.stage_c_public_asset_allowed(text)']::text[],'api_active',false)
  ) as x(block_key,local_version,registry_name,sentinel_kind,sentinel_identity,sentinel_comment,expected_tables,expected_functions,permission_profile,absence_requires_zero_objects)
), resolved as (
  select e.*,m.version effective_version,m.name registered_name,
    case when e.sentinel_kind='table' then obj_description(to_regclass(e.sentinel_identity)::oid,'pg_class')
         else obj_description(to_regprocedure(e.sentinel_identity)::oid,'pg_proc') end actual_sentinel,
    cardinality(e.expected_tables)+cardinality(e.expected_functions) expected_object_count,
    (select count(*) from unnest(e.expected_tables) t(identity) where to_regclass(t.identity) is not null)
      +(select count(*) from unnest(e.expected_functions) f(identity) where to_regprocedure(f.identity) is not null) present_object_count
  from expected e
  left join lateral (
    select sm.version,sm.name from supabase_migrations.schema_migrations sm
    where sm.version=e.local_version or sm.name=e.registry_name
    order by sm.version desc limit 1
  ) m on true
), checked as (
  select r.*,
    case r.permission_profile
      when 'closed_tables' then not exists(
        select 1 from unnest(r.expected_tables) t(identity)
        join pg_class c on c.oid=to_regclass(t.identity)
        where not c.relrowsecurity
          or coalesce(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          or coalesce(has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          or coalesce(has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0)
      )
      when 'closed_functions' then not exists(
        select 1 from unnest(r.expected_functions) f(identity)
        join pg_proc p on p.oid=to_regprocedure(f.identity)
        where coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false)
          or coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false)
          or coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false)
          or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')
      )
      when 'closed_objects' then not exists(
        select 1 from unnest(r.expected_tables) t(identity)
        join pg_class c on c.oid=to_regclass(t.identity)
        where not c.relrowsecurity or not c.relforcerowsecurity
          or coalesce(has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          or coalesce(has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          or coalesce(has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),false)
          or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0)
      ) and not exists(
        select 1 from unnest(r.expected_functions) f(identity)
        join pg_proc p on p.oid=to_regprocedure(f.identity)
        where coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false)
          or coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false)
          or coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false)
          or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')
      )
      when 'wrappers_safe' then
        case when obj_description(to_regprocedure('public.get_site_experience()')::oid,'pg_proc')='cubica_stage_c:20261025120300' then true else not exists(
          select 1 from unnest(r.expected_functions) f(identity) join pg_proc p on p.oid=to_regprocedure(f.identity)
          where coalesce(has_function_privilege('anon',p.oid,'EXECUTE'),false)
             or coalesce(has_function_privilege('authenticated',p.oid,'EXECUTE'),false)
             or coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false)
             or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE')
        ) end
      when 'api_active' then
        coalesce(has_function_privilege('anon',to_regprocedure('public.get_site_experience()'),'EXECUTE'),false)
        and coalesce(has_function_privilege('authenticated',to_regprocedure('public.get_site_experience()'),'EXECUTE'),false)
        and not coalesce(has_function_privilege('anon',to_regprocedure('public.admin_get_site_configuration()'),'EXECUTE'),false)
        and coalesce(has_function_privilege('authenticated',to_regprocedure('public.admin_get_site_configuration()'),'EXECUTE'),false)
        and not coalesce(has_function_privilege('service_role',to_regprocedure('public.admin_get_site_configuration()'),'EXECUTE'),false)
        and not coalesce(has_function_privilege('anon',to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),'EXECUTE'),false)
        and not coalesce(has_function_privilege('authenticated',to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),'EXECUTE'),false)
        and coalesce(has_function_privilege('service_role',to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),'EXECUTE'),false)
        and to_regprocedure('public.consume_suggestion_protection(text,text,uuid)') is null
        and to_regprocedure('public.submit_public_suggestion(text,text,text,text,uuid,uuid)') is null
        and exists(select 1 from storage.buckets where id='site-assets' and public=false)
        and (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read'))=2
        and exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='site_assets_public_read' and coalesce(qual,'') like '%stage_c_public_asset_allowed%')
        and coalesce(has_function_privilege('anon',to_regprocedure('private.stage_c_public_asset_allowed(text)'),'EXECUTE'),false)
        and coalesce(has_function_privilege('authenticated',to_regprocedure('private.stage_c_public_asset_allowed(text)'),'EXECUTE'),false)
        and not coalesce(has_function_privilege('service_role',to_regprocedure('private.stage_c_public_asset_allowed(text)'),'EXECUTE'),false)
      when 'original_replaced' then r.effective_version is null and r.actual_sentinel is distinct from r.sentinel_comment
      else false
    end permissions_ok
  from resolved r
)
select jsonb_agg(jsonb_build_object(
  'block',block_key,'local_version',local_version,'registry_name_expected',registry_name,
  'registered',effective_version is not null,'registered_name',registered_name,'effective_version',effective_version,
  'sentinel_expected',sentinel_comment,'sentinel_actual',actual_sentinel,'sentinel_ok',actual_sentinel=sentinel_comment,
  'expected_object_count',expected_object_count,'present_object_count',present_object_count,'permissions_ok',permissions_ok,
  'state',case
    when permission_profile='original_replaced' and effective_version is null and actual_sentinel is distinct from sentinel_comment then 'original_replaced'
    when effective_version is not null and actual_sentinel=sentinel_comment and present_object_count=expected_object_count and permissions_ok then 'confirmed'
    when effective_version is null and actual_sentinel is distinct from sentinel_comment and (not absence_requires_zero_objects or present_object_count=0) then 'absent'
    else 'inconsistent'
  end
) order by local_version,block_key) as stage_c_installation from checked;
