-- CÚBICA 3D — Etapa C, bloque 4C: administración de frases.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171253_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

create or replace function private.admin_upsert_welcome_phrase(p_id bigint,p_campaign_id uuid,p_phrase text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.site_welcome_phrases;
begin
  perform private.stage_c_assert_admin();
  if p_campaign_id is not null and not exists(select 1 from private.site_campaigns where id=p_campaign_id) then raise exception 'Campaña inexistente'; end if;
  if p_id is null then
    insert into private.site_welcome_phrases(campaign_id,phrase,active,sort_order,created_by,updated_by) values(p_campaign_id,private.stage_c_safe_text(p_phrase,500,true),coalesce(p_active,true),coalesce(p_sort_order,0),auth.uid(),auth.uid()) returning * into w;
  else
    select * into w from private.site_welcome_phrases where id=p_id for update;
    if not found or w.version<>p_expected_version then raise exception 'La frase cambió o no existe' using errcode='40001'; end if;
    update private.site_welcome_phrases set campaign_id=p_campaign_id,phrase=private.stage_c_safe_text(p_phrase,500,true),active=coalesce(p_active,active),sort_order=coalesce(p_sort_order,sort_order),deleted_at=case when p_delete then now() else null end,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into w;
  end if;
  return to_jsonb(w)-'created_by'-'updated_by';
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) is 'cubica_stage_c:20261018171253';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171253' then
    raise exception 'stage_c_171253_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171253_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171253_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171253_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171253_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171253_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
