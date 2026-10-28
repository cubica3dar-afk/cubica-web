-- CÚBICA 3D — Etapa C, bloque 7A-2 v3: campañas, frases, contenidos y FAQ.

-- Los wrappers se crean sin EXECUTE para ningún rol de API.

do $$
begin
  if obj_description(to_regprocedure('public.admin_retire_site_asset(uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120000' then
    raise exception 'stage_c_20261025120100_missing_prerequisite:public.admin_retire_site_asset(uuid)';
  end if;
end $$;

create or replace function public.admin_upsert_site_campaign(p_id uuid,p_name text,p_description text,p_priority integer,p_recurrence_mode text,p_starts_at timestamptz,p_ends_at timestamptz,p_annual_start_month integer,p_annual_start_day integer,p_annual_start_time time,p_annual_end_month integer,p_annual_end_day integer,p_annual_end_time time,p_theme jsonb,p_occurrences jsonb,p_expected_version integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_site_campaign(p_id,p_name,p_description,p_priority,p_recurrence_mode,p_starts_at,p_ends_at,p_annual_start_month,p_annual_start_day,p_annual_start_time,p_annual_end_month,p_annual_end_day,p_annual_end_time,p_theme,p_occurrences,p_expected_version,p_request_id); $$;

create or replace function public.admin_set_site_campaign_state(p_id uuid,p_state text,p_expected_version integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_set_site_campaign_state(p_id,p_state,p_expected_version,p_request_id); $$;

create or replace function public.admin_duplicate_site_campaign(p_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_duplicate_site_campaign(p_id,p_expected_version,p_request_id); $$;

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

create or replace function public.admin_list_faq(p_include_deleted boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_list_faq(p_include_deleted); $$;

create or replace function public.admin_restore_faq(p_id bigint,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_restore_faq(p_id,p_expected_version); $$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
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
      'public.admin_restore_faq(bigint,integer)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;

comment on function public.admin_restore_faq(bigint,integer) is 'cubica_stage_c:20261025120100';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('public.admin_restore_faq(bigint,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120100' then
    raise exception 'stage_c_20261025120100_missing_sentinel';
  end if;
  foreach signature in array array[
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
      'public.admin_restore_faq(bigint,integer)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171508_missing_wrapper'; end if;
      if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171508_premature_execute:%',signature;
      end if;
      if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature::oid and a.grantee=0 and a.privilege_type='EXECUTE') then
        raise exception 'stage_c_171508_public_execute:%',signature;
      end if;
      if exists(select 1 from pg_proc p where p.oid=signature::oid and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting='search_path=""')) then
        raise exception 'stage_c_20261025120100_unrestricted_search_path:%',signature;
      end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171508_wrong_security_mode:%',signature;
      end if;
  end loop;
end $$;
