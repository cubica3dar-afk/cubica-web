-- CÚBICA 3D — Etapa C, bloque 7A-1: creación cerrada de wrappers públicos.

-- Los wrappers existen al confirmar esta migración, pero ningún rol de API puede ejecutarlos.

do $$
begin
  if obj_description(to_regclass('private.site_content_pages')::oid,'pg_class') is distinct from 'cubica_stage_c:20261018171400' then
    raise exception 'stage_c_171511_missing_prerequisite:private.site_content_pages';
  end if;
  if obj_description(to_regprocedure('private.get_site_experience(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171231' then
    raise exception 'stage_c_171511_missing_prerequisite:private.get_site_experience(timestamptz)';
  end if;
  if obj_description(to_regprocedure('private.admin_get_site_configuration()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171232' then
    raise exception 'stage_c_171511_missing_prerequisite:private.admin_get_site_configuration()';
  end if;
  if obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171251' then
    raise exception 'stage_c_171511_missing_prerequisite:private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171252' then
    raise exception 'stage_c_171511_missing_prerequisite:private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171253' then
    raise exception 'stage_c_171511_missing_prerequisite:private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171301' then
    raise exception 'stage_c_171511_missing_prerequisite:private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)';
  end if;
  if obj_description(to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171302' then
    raise exception 'stage_c_171511_missing_prerequisite:private.submit_public_suggestion(text,text,text,text,uuid,uuid)';
  end if;
  if obj_description(to_regprocedure('private.admin_update_suggestion(uuid,text,text)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171303' then
    raise exception 'stage_c_171511_missing_prerequisite:private.admin_update_suggestion(uuid,text,text)';
  end if;
end $$;

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

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'public.get_site_experience()'::regprocedure,
      'public.get_public_content_page(text)'::regprocedure,
      'public.get_public_faq()'::regprocedure,
      'public.admin_get_site_configuration()'::regprocedure,
      'public.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
      'public.admin_publish_site_appearance(integer)'::regprocedure,
      'public.admin_reset_site_appearance_draft()'::regprocedure,
      'public.admin_restore_original_appearance_draft()'::regprocedure,
      'public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
      'public.admin_retire_site_asset(uuid)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;

comment on function public.admin_retire_site_asset(uuid) is 'cubica_stage_c:20261018171511';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('public.admin_retire_site_asset(uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171511' then
    raise exception 'stage_c_171511_missing_sentinel';
  end if;
  foreach signature in array array[
      'public.get_site_experience()'::regprocedure,
      'public.get_public_content_page(text)'::regprocedure,
      'public.get_public_faq()'::regprocedure,
      'public.admin_get_site_configuration()'::regprocedure,
      'public.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
      'public.admin_publish_site_appearance(integer)'::regprocedure,
      'public.admin_reset_site_appearance_draft()'::regprocedure,
      'public.admin_restore_original_appearance_draft()'::regprocedure,
      'public.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
      'public.admin_retire_site_asset(uuid)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171511_missing_wrapper'; end if;
      if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171511_premature_execute:%',signature;
      end if;
      if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature::oid and a.grantee=0 and a.privilege_type='EXECUTE') then
        raise exception 'stage_c_171511_public_execute:%',signature;
      end if;
      if exists(select 1 from pg_proc p where p.oid=signature::oid and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')) then
        raise exception 'stage_c_171511_unrestricted_search_path:%',signature;
      end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171511_wrong_security_mode:%',signature;
      end if;
  end loop;
end $$;
