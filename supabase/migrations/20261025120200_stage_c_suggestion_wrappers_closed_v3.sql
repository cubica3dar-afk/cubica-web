-- CÚBICA 3D — Etapa C, bloque 7A-3 v3: sugerencias.

-- Los wrappers se crean sin EXECUTE para ningún rol de API.

do $$
begin
  if obj_description(to_regprocedure('public.admin_restore_faq(bigint,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120100' then
    raise exception 'stage_c_20261025120200_missing_prerequisite:public.admin_restore_faq(bigint,integer)';
  end if;
  if obj_description(to_regprocedure('private.admin_update_suggestion(uuid,text,text,integer,text)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261024233029' then
    raise exception 'stage_c_171515_missing_prerequisite:private.admin_update_suggestion(uuid,text,text,integer,text)';
  end if;
end $$;

create or replace function public.submit_protected_suggestion(
  p_token_hash text,
  p_network_hash text,
  p_actor_hash text,
  p_actor_kind text,
  p_category text,
  p_subject text,
  p_description text,
  p_contact text,
  p_request_id uuid,
  p_verified_user_id uuid
)
returns jsonb language sql security definer set search_path='' as $$
  select private.submit_protected_suggestion(
    p_token_hash,p_network_hash,p_actor_hash,p_actor_kind,p_category,p_subject,
    p_description,p_contact,p_request_id,p_verified_user_id
  );
$$;

create or replace function public.admin_list_suggestions(p_page integer default 1,p_page_size integer default 25,p_search text default null,p_status text default 'all',p_category text default 'all',p_sort text default 'recent',p_lifecycle text default 'active')
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_list_suggestions(p_page,p_page_size,p_search,p_status,p_category,p_sort,p_lifecycle); $$;

create or replace function public.admin_get_suggestion(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_get_suggestion(p_id); $$;

create or replace function public.admin_update_suggestion(p_id uuid,p_status text,p_private_notes text,p_expected_revision integer,p_reason text default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_update_suggestion(p_id,p_status,p_private_notes,p_expected_revision,p_reason); $$;

create or replace function public.admin_set_suggestion_lifecycle(p_id uuid,p_action text,p_expected_revision integer,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_set_suggestion_lifecycle(p_id,p_action,p_expected_revision,p_reason); $$;

create or replace function public.cleanup_suggestion_protection()
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  perform private.cleanup_suggestion_protection();
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure,
      'public.admin_list_suggestions(integer,integer,text,text,text,text,text)'::regprocedure,
      'public.admin_get_suggestion(uuid)'::regprocedure,
      'public.admin_update_suggestion(uuid,text,text,integer,text)'::regprocedure,
      'public.admin_set_suggestion_lifecycle(uuid,text,integer,text)'::regprocedure,
      'public.cleanup_suggestion_protection()'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;

comment on function public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)
  is 'cubica_stage_c:20261025120200';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261025120200' then
    raise exception 'stage_c_20261025120200_missing_sentinel';
  end if;
  foreach signature in array array[
      'public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure,
      'public.admin_list_suggestions(integer,integer,text,text,text,text,text)'::regprocedure,
      'public.admin_get_suggestion(uuid)'::regprocedure,
      'public.admin_update_suggestion(uuid,text,text,integer,text)'::regprocedure,
      'public.admin_set_suggestion_lifecycle(uuid,text,integer,text)'::regprocedure,
      'public.cleanup_suggestion_protection()'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171515_missing_wrapper'; end if;
      if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171515_premature_execute:%',signature;
      end if;
      if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature::oid and a.grantee=0 and a.privilege_type='EXECUTE') then
        raise exception 'stage_c_171515_public_execute:%',signature;
      end if;
      if exists(select 1 from pg_proc p where p.oid=signature::oid and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting='search_path=""')) then
        raise exception 'stage_c_20261025120200_unrestricted_search_path:%',signature;
      end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (signature=any(array['public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure,'public.cleanup_suggestion_protection()'::regprocedure]::regprocedure[])) then
        raise exception 'stage_c_171515_wrong_security_mode:%',signature;
      end if;
  end loop;
  if to_regprocedure('public.consume_suggestion_protection(text,text,uuid)') is not null
      or to_regprocedure('public.submit_public_suggestion(text,text,text,text,uuid,uuid)') is not null then
    raise exception 'stage_c_171515_legacy_suggestion_wrapper_present';
  end if;
end $$;

