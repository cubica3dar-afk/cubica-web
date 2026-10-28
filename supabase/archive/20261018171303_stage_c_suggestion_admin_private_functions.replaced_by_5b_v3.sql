-- CÚBICA 3D — Etapa C, bloque 5C: administración y limpieza de sugerencias.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171303_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171302' then
    raise exception 'stage_c_171303_missing_prerequisite:private.submit_public_suggestion(text,text,text,text,uuid,uuid)';
  end if;
end $$;

create or replace function private.admin_list_suggestions(p_page integer default 1,p_page_size integer default 25,p_search text default null,p_status text default 'all',p_category text default 'all',p_sort text default 'recent')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1);v_size integer;v_search text:=btrim(coalesce(p_search,''));v_status text:=lower(coalesce(p_status,'all'));v_category text:=lower(coalesce(p_category,'all'));v_sort text:=lower(coalesce(p_sort,'recent'));v_total bigint;v_items jsonb;
begin
  perform private.stage_c_assert_admin(); v_size:=case when p_page_size in(10,25,50) then p_page_size else 25 end;
  if v_status not in('all','new','reviewing','accepted','resolved','dismissed') or v_category not in('all','funcionalidad','visual','error','compra','otro') or v_sort not in('recent','oldest') then raise exception 'Filtro inválido'; end if;
  select count(*) into v_total from private.site_suggestions s where (v_status='all' or s.status=v_status) and (v_category='all' or s.category=v_category) and (v_search='' or s.subject ilike '%'||v_search||'%' or s.description ilike '%'||v_search||'%');
  select coalesce(jsonb_agg(to_jsonb(q)-'user_id' order by case when v_sort='recent' then q.created_at end desc,case when v_sort='oldest' then q.created_at end asc,q.id),'[]'::jsonb) into v_items from(
    select s.id,s.category,s.subject,s.description,s.contact,s.status,s.private_notes,s.created_at,s.updated_at,s.user_id from private.site_suggestions s where (v_status='all' or s.status=v_status) and (v_category='all' or s.category=v_category) and (v_search='' or s.subject ilike '%'||v_search||'%' or s.description ilike '%'||v_search||'%') order by case when v_sort='recent' then s.created_at end desc,case when v_sort='oldest' then s.created_at end asc,s.id limit v_size offset (v_page-1)*v_size
  ) q;
  return jsonb_build_object('items',v_items,'page',v_page,'page_size',v_size,'total',v_total);
end;
$$;

create or replace function private.admin_update_suggestion(p_id uuid,p_status text,p_private_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.site_suggestions;
begin
  perform private.stage_c_assert_admin(); if p_status not in('new','reviewing','accepted','resolved','dismissed') then raise exception 'Estado inválido'; end if;
  update private.site_suggestions set status=p_status,private_notes=private.stage_c_safe_text(p_private_notes,4000,false),updated_at=now(),updated_by=auth.uid() where id=p_id returning * into s;
  if not found then raise exception 'Sugerencia inexistente'; end if;
  return to_jsonb(s)-'user_id'-'updated_by';
end;
$$;

create or replace function private.cleanup_suggestion_protection()
returns void language sql security definer set search_path='' as $$
  delete from private.suggestion_token_uses where expires_at<now()-interval '1 day';
  delete from private.suggestion_rate_limits where window_started_at<now()-interval '2 days' and coalesce(blocked_until,'-infinity')<now();
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.admin_list_suggestions(integer,integer,text,text,text,text)'::regprocedure,
      'private.admin_update_suggestion(uuid,text,text)'::regprocedure,
      'private.cleanup_suggestion_protection()'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_update_suggestion(uuid,text,text) is 'cubica_stage_c:20261018171303';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_update_suggestion(uuid,text,text)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171303' then
    raise exception 'stage_c_171303_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.admin_list_suggestions(integer,integer,text,text,text,text)'::regprocedure,
      'private.admin_update_suggestion(uuid,text,text)'::regprocedure,
      'private.cleanup_suggestion_protection()'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171303_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171303_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171303_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171303_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171303_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
