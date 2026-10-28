-- CÚBICA 3D — Etapa C, bloque 4B: administración de campañas.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171252_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171218' then
    raise exception 'stage_c_171252_missing_prerequisite:private.stage_c_active_campaign(timestamptz)';
  end if;
end $$;

create or replace function private.admin_upsert_site_campaign(
  p_id uuid,p_name text,p_description text,p_priority integer,p_recurrence_mode text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_annual_start_month integer,p_annual_start_day integer,p_annual_start_time time,p_annual_end_month integer,p_annual_end_day integer,p_annual_end_time time,
  p_theme jsonb,p_occurrences jsonb,p_expected_version integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.site_campaigns; item jsonb; new_id uuid:=coalesce(p_id,extensions.gen_random_uuid());
begin
  perform private.stage_c_assert_admin();
  if p_recurrence_mode not in('none','annual','custom') or p_priority not between -1000 and 1000 then raise exception 'Programación inválida'; end if;
  if p_recurrence_mode='annual' then
    perform make_date(case when p_annual_start_month=2 and p_annual_start_day=29 then 2000 else 2001 end,p_annual_start_month,p_annual_start_day);
    perform make_date(case when p_annual_end_month=2 and p_annual_end_day=29 then 2000 else 2001 end,p_annual_end_month,p_annual_end_day);
  end if;
  if p_id is null then
    insert into private.site_campaigns(id,name,description,priority,recurrence_mode,starts_at,ends_at,annual_start_month,annual_start_day,annual_start_time,annual_end_month,annual_end_day,annual_end_time,theme,created_by,updated_by)
    values(new_id,private.stage_c_safe_text(p_name,120,true),private.stage_c_safe_text(p_description,1000,false),p_priority,p_recurrence_mode,p_starts_at,p_ends_at,p_annual_start_month,p_annual_start_day,p_annual_start_time,p_annual_end_month,p_annual_end_day,p_annual_end_time,private.stage_c_validate_theme(p_theme),auth.uid(),auth.uid()) returning * into c;
  else
    select * into c from private.site_campaigns where id=p_id and deleted_at is null for update;
    if not found or c.version<>p_expected_version then raise exception 'La campaña cambió o no existe' using errcode='40001'; end if;
    if c.state='published' then raise exception 'Duplicá o desactivá la campaña antes de editarla'; end if;
    update private.site_campaigns set name=private.stage_c_safe_text(p_name,120,true),description=private.stage_c_safe_text(p_description,1000,false),priority=p_priority,recurrence_mode=p_recurrence_mode,starts_at=p_starts_at,ends_at=p_ends_at,annual_start_month=p_annual_start_month,annual_start_day=p_annual_start_day,annual_start_time=p_annual_start_time,annual_end_month=p_annual_end_month,annual_end_day=p_annual_end_day,annual_end_time=p_annual_end_time,theme=private.stage_c_validate_theme(p_theme),version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into c;
  end if;
  delete from private.site_campaign_occurrences where campaign_id=new_id;
  if p_recurrence_mode='custom' then
    for item in select * from jsonb_array_elements(coalesce(p_occurrences,'[]')) loop
      insert into private.site_campaign_occurrences(campaign_id,starts_at,ends_at,created_by) values(new_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,auth.uid());
    end loop;
    if not exists(select 1 from private.site_campaign_occurrences where campaign_id=new_id) then raise exception 'Agregá al menos una fecha'; end if;
  end if;
  return to_jsonb(c)-'created_by'-'updated_by'-'published_by';
end;
$$;

create or replace function private.admin_set_site_campaign_state(p_id uuid,p_state text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.site_campaigns; asset_id uuid;
begin
  perform private.stage_c_assert_admin();
  if p_state not in('draft','published','disabled') then raise exception 'Estado inválido'; end if;
  select * into c from private.site_campaigns where id=p_id and deleted_at is null for update;
  if not found or c.version<>p_expected_version then raise exception 'La campaña cambió o no existe' using errcode='40001'; end if;
  update private.site_campaigns set state=p_state,version=version+1,updated_at=now(),updated_by=auth.uid(),published_at=case when p_state='published' then now() else published_at end,published_by=case when p_state='published' then auth.uid() else published_by end where id=p_id returning * into c;
  if p_state='published' then
    for asset_id in select value::uuid from jsonb_each_text(coalesce(c.theme->'assets','{}')) where value is not null and value<>'' loop update private.site_assets set public_since=coalesce(public_since,now()) where id=asset_id; end loop;
  end if;
  return to_jsonb(c)-'created_by'-'updated_by'-'published_by';
end;
$$;

create or replace function private.admin_duplicate_site_campaign(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source private.site_campaigns; copy private.site_campaigns;
begin
  perform private.stage_c_assert_admin();
  select * into source from private.site_campaigns where id=p_id and deleted_at is null;
  if not found then raise exception 'Campaña inexistente'; end if;
  insert into private.site_campaigns(name,description,state,priority,recurrence_mode,starts_at,ends_at,annual_start_month,annual_start_day,annual_start_time,annual_end_month,annual_end_day,annual_end_time,theme,created_by,updated_by)
  values(left(source.name||' — copia',120),source.description,'draft',source.priority,source.recurrence_mode,source.starts_at,source.ends_at,source.annual_start_month,source.annual_start_day,source.annual_start_time,source.annual_end_month,source.annual_end_day,source.annual_end_time,source.theme,auth.uid(),auth.uid()) returning * into copy;
  insert into private.site_campaign_occurrences(campaign_id,starts_at,ends_at,created_by) select copy.id,starts_at,ends_at,auth.uid() from private.site_campaign_occurrences where campaign_id=source.id;
  insert into private.site_welcome_phrases(campaign_id,phrase,active,sort_order,created_by,updated_by) select copy.id,phrase,active,sort_order,auth.uid(),auth.uid() from private.site_welcome_phrases where campaign_id=source.id and deleted_at is null;
  return to_jsonb(copy)-'created_by'-'updated_by'-'published_by'-'deleted_by';
end;
$$;

create or replace function private.admin_delete_site_campaign(p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare c private.site_campaigns;
begin
  perform private.stage_c_assert_admin();
  select * into c from private.site_campaigns where id=p_id and deleted_at is null for update;
  if not found or c.version<>p_expected_version then raise exception 'La campaña cambió o no existe' using errcode='40001'; end if;
  if c.state='published' then raise exception 'Desactivá la campaña antes de retirarla'; end if;
  update private.site_campaigns set deleted_at=now(),deleted_by=auth.uid(),version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
  update private.site_welcome_phrases set deleted_at=coalesce(deleted_at,now()),version=version+1,updated_at=now(),updated_by=auth.uid() where campaign_id=p_id and deleted_at is null;
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)'::regprocedure,
      'private.admin_set_site_campaign_state(uuid,text,integer)'::regprocedure,
      'private.admin_duplicate_site_campaign(uuid)'::regprocedure,
      'private.admin_delete_site_campaign(uuid,integer)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer) is 'cubica_stage_c:20261018171252';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171252' then
    raise exception 'stage_c_171252_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)'::regprocedure,
      'private.admin_set_site_campaign_state(uuid,text,integer)'::regprocedure,
      'private.admin_duplicate_site_campaign(uuid)'::regprocedure,
      'private.admin_delete_site_campaign(uuid,integer)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171252_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171252_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171252_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171252_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171252_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
