-- CÚBICA 3D — Etapa C, bloque 4B v2: administración consistente de campañas.
--
-- Migración cerrada. No concede EXECUTE a roles de Data API.
-- Creación, duplicación y cambios de estado usan idempotencia transaccional.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171254_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171218' then
    raise exception 'stage_c_171254_missing_prerequisite:private.stage_c_active_campaign(timestamptz)';
  end if;
  if obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171249' then
    raise exception 'stage_c_171254_missing_prerequisite:private.admin_register_site_asset(...)';
  end if;
  if to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)') is not null
    or to_regprocedure('private.admin_set_site_campaign_state(uuid,text,integer)') is not null
    or to_regprocedure('private.admin_duplicate_site_campaign(uuid)') is not null then
    raise exception 'stage_c_171254_old_4b_functions_present';
  end if;
end $$;

create table private.site_campaign_idempotency(
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check(operation in('create','duplicate','state')),
  request_id uuid not null,
  request_payload jsonb not null check(jsonb_typeof(request_payload)='object'),
  result_campaign_id uuid references private.site_campaigns(id) on delete set null,
  result_payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(actor_id,operation,request_id),
  constraint site_campaign_idempotency_completion check(
    (result_payload is null and completed_at is null)
    or (result_payload is not null and completed_at is not null)
  )
);
create index site_campaign_idempotency_result_campaign_idx
  on private.site_campaign_idempotency(result_campaign_id)
  where result_campaign_id is not null;

alter table private.site_campaign_idempotency enable row level security;
create policy stage_c_deny_site_campaign_idempotency
  on private.site_campaign_idempotency
  for all to anon,authenticated
  using(false) with check(false);
revoke all on private.site_campaign_idempotency from public,anon,authenticated,service_role;
comment on table private.site_campaign_idempotency is 'cubica_stage_c:20261018171254';

create or replace function private.stage_c_begin_campaign_operation(
  p_operation text,p_request_id uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  operation_row private.site_campaign_idempotency;
  inserted_count bigint;
begin
  perform private.stage_c_assert_admin();
  if actor is null or p_request_id is null or p_operation not in('create','duplicate','state')
    or p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Solicitud idempotente inválida' using errcode='22023';
  end if;

  insert into private.site_campaign_idempotency(actor_id,operation,request_id,request_payload)
  values(actor,p_operation,p_request_id,p_payload)
  on conflict(actor_id,operation,request_id) do nothing;
  get diagnostics inserted_count=row_count;

  select * into operation_row
  from private.site_campaign_idempotency
  where actor_id=actor and operation=p_operation and request_id=p_request_id
  for update;

  if not found then
    raise exception 'No se pudo reservar la operación' using errcode='55000';
  end if;
  if operation_row.request_payload is distinct from p_payload then
    raise exception 'La clave de idempotencia ya fue usada con otros datos' using errcode='22023';
  end if;
  if inserted_count=0 then
    if operation_row.result_payload is null or operation_row.completed_at is null then
      raise exception 'La operación idempotente no tiene un resultado confirmado' using errcode='55000';
    end if;
    return operation_row.result_payload;
  end if;
  return null;
end;
$$;

create or replace function private.stage_c_complete_campaign_operation(
  p_operation text,p_request_id uuid,p_payload jsonb,p_campaign_id uuid,p_result jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); completed private.site_campaign_idempotency;
begin
  perform private.stage_c_assert_admin();
  if actor is null or p_campaign_id is null or p_result is null then
    raise exception 'Resultado idempotente inválido' using errcode='22023';
  end if;
  update private.site_campaign_idempotency
  set result_campaign_id=p_campaign_id,result_payload=p_result,completed_at=now()
  where actor_id=actor and operation=p_operation and request_id=p_request_id
    and request_payload=p_payload and result_payload is null and completed_at is null
  returning * into completed;
  if not found then
    raise exception 'No se pudo confirmar la operación idempotente' using errcode='55000';
  end if;
  return completed.result_payload;
end;
$$;

create or replace function private.admin_upsert_site_campaign(
  p_id uuid,p_name text,p_description text,p_priority integer,p_recurrence_mode text,
  p_starts_at timestamptz,p_ends_at timestamptz,
  p_annual_start_month integer,p_annual_start_day integer,p_annual_start_time time,
  p_annual_end_month integer,p_annual_end_day integer,p_annual_end_time time,
  p_theme jsonb,p_occurrences jsonb,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c private.site_campaigns;
  item jsonb;
  new_id uuid:=coalesce(p_id,extensions.gen_random_uuid());
  checked_name text;
  checked_description text;
  checked_theme jsonb;
  operation_payload jsonb;
  replay jsonb;
  response jsonb;
begin
  perform private.stage_c_assert_admin();
  operation_payload:=jsonb_build_object(
    'name',p_name,'description',p_description,'priority',p_priority,
    'recurrence_mode',p_recurrence_mode,'starts_at',p_starts_at,'ends_at',p_ends_at,
    'annual_start_month',p_annual_start_month,'annual_start_day',p_annual_start_day,
    'annual_start_time',p_annual_start_time,'annual_end_month',p_annual_end_month,
    'annual_end_day',p_annual_end_day,'annual_end_time',p_annual_end_time,
    'theme',p_theme,'occurrences',coalesce(p_occurrences,'[]'::jsonb),
    'expected_version',p_expected_version
  );

  if p_id is null then
    replay:=private.stage_c_begin_campaign_operation('create',p_request_id,operation_payload);
    if replay is not null then return replay; end if;
  elsif p_request_id is not null then
    raise exception 'La clave de creación solo corresponde a campañas nuevas' using errcode='22023';
  end if;

  if p_recurrence_mode not in('none','annual','custom')
    or p_priority is null or p_priority not between -1000 and 1000 then
    raise exception 'Programación inválida';
  end if;
  if jsonb_typeof(coalesce(p_occurrences,'[]'::jsonb))<>'array' then
    raise exception 'Las ocurrencias deben ser una lista';
  end if;
  if p_recurrence_mode<>'custom' and jsonb_array_length(coalesce(p_occurrences,'[]'::jsonb))<>0 then
    raise exception 'Las ocurrencias personalizadas no corresponden a esta recurrencia';
  end if;
  if p_recurrence_mode='annual' then
    perform make_date(case when p_annual_start_month=2 and p_annual_start_day=29 then 2000 else 2001 end,p_annual_start_month,p_annual_start_day);
    perform make_date(case when p_annual_end_month=2 and p_annual_end_day=29 then 2000 else 2001 end,p_annual_end_month,p_annual_end_day);
  end if;
  checked_name:=private.stage_c_safe_text(p_name,120,true);
  checked_description:=private.stage_c_safe_text(p_description,1000,false);

  if p_id is null then
    checked_theme:=private.stage_c_validate_theme(p_theme);
    insert into private.site_campaigns(
      id,name,description,priority,recurrence_mode,starts_at,ends_at,
      annual_start_month,annual_start_day,annual_start_time,
      annual_end_month,annual_end_day,annual_end_time,theme,created_by,updated_by
    ) values(
      new_id,checked_name,checked_description,p_priority,p_recurrence_mode,p_starts_at,p_ends_at,
      p_annual_start_month,p_annual_start_day,p_annual_start_time,
      p_annual_end_month,p_annual_end_day,p_annual_end_time,checked_theme,auth.uid(),auth.uid()
    ) returning * into c;
  else
    select * into c from private.site_campaigns
    where id=p_id and deleted_at is null
    for update;
    if not found or c.version<>p_expected_version then
      raise exception 'La campaña cambió o no existe' using errcode='40001';
    end if;
    if c.state='published' then
      raise exception 'Duplicá o desactivá la campaña antes de editarla';
    end if;
    checked_theme:=private.stage_c_validate_theme(p_theme);
    update private.site_campaigns set
      name=checked_name,description=checked_description,priority=p_priority,
      recurrence_mode=p_recurrence_mode,starts_at=p_starts_at,ends_at=p_ends_at,
      annual_start_month=p_annual_start_month,annual_start_day=p_annual_start_day,
      annual_start_time=p_annual_start_time,annual_end_month=p_annual_end_month,
      annual_end_day=p_annual_end_day,annual_end_time=p_annual_end_time,
      theme=checked_theme,version=version+1,updated_at=now(),updated_by=auth.uid()
    where id=p_id returning * into c;
  end if;

  delete from private.site_campaign_occurrences where campaign_id=new_id;
  if p_recurrence_mode='custom' then
    for item in select value from jsonb_array_elements(coalesce(p_occurrences,'[]'::jsonb)) loop
      insert into private.site_campaign_occurrences(campaign_id,starts_at,ends_at,created_by)
      values(new_id,(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,auth.uid());
    end loop;
    if not exists(select 1 from private.site_campaign_occurrences where campaign_id=new_id) then
      raise exception 'Agregá al menos una fecha';
    end if;
  end if;

  response:=to_jsonb(c)-'created_by'-'updated_by'-'published_by'-'deleted_by';
  if p_id is null then
    return private.stage_c_complete_campaign_operation('create',p_request_id,operation_payload,c.id,response);
  end if;
  return response;
end;
$$;

create or replace function private.admin_set_site_campaign_state(
  p_id uuid,p_state text,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c private.site_campaigns;
  asset_id uuid;
  operation_payload jsonb:=jsonb_build_object(
    'campaign_id',p_id,'state',p_state,'expected_version',p_expected_version
  );
  replay jsonb;
  response jsonb;
begin
  perform private.stage_c_assert_admin();
  replay:=private.stage_c_begin_campaign_operation('state',p_request_id,operation_payload);
  if replay is not null then return replay; end if;
  if p_state not in('draft','published','disabled') then raise exception 'Estado inválido'; end if;

  select * into c from private.site_campaigns
  where id=p_id and deleted_at is null
  for update;
  if not found or c.version<>p_expected_version then
    raise exception 'La campaña cambió o no existe' using errcode='40001';
  end if;

  if c.state=p_state then
    response:=to_jsonb(c)-'created_by'-'updated_by'-'published_by'-'deleted_by';
    return private.stage_c_complete_campaign_operation('state',p_request_id,operation_payload,c.id,response);
  end if;

  if p_state='published' then
    perform private.stage_c_validate_theme(c.theme);
  end if;
  update private.site_campaigns set
    state=p_state,version=version+1,updated_at=now(),updated_by=auth.uid(),
    published_at=case when p_state='published' then now() else published_at end,
    published_by=case when p_state='published' then auth.uid() else published_by end
  where id=p_id returning * into c;

  if p_state='published' then
    for asset_id in
      select value::uuid from jsonb_each_text(coalesce(c.theme->'assets','{}'::jsonb))
      where value is not null and value<>''
    loop
      update private.site_assets
      set public_since=coalesce(public_since,now())
      where id=asset_id and retired_at is null;
    end loop;
  end if;
  response:=to_jsonb(c)-'created_by'-'updated_by'-'published_by'-'deleted_by';
  return private.stage_c_complete_campaign_operation('state',p_request_id,operation_payload,c.id,response);
end;
$$;

create or replace function private.admin_duplicate_site_campaign(
  p_id uuid,p_expected_version integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  source private.site_campaigns;
  campaign_copy private.site_campaigns;
  operation_payload jsonb:=jsonb_build_object(
    'campaign_id',p_id,'expected_version',p_expected_version
  );
  replay jsonb;
  response jsonb;
begin
  perform private.stage_c_assert_admin();
  replay:=private.stage_c_begin_campaign_operation('duplicate',p_request_id,operation_payload);
  if replay is not null then return replay; end if;

  select * into source from private.site_campaigns
  where id=p_id and deleted_at is null
  for update;
  if not found or source.version<>p_expected_version then
    raise exception 'La campaña cambió o no existe' using errcode='40001';
  end if;

  perform 1 from private.site_campaign_occurrences
  where campaign_id=source.id order by id for share;
  perform 1 from private.site_welcome_phrases
  where campaign_id=source.id and deleted_at is null order by id for share;

  insert into private.site_campaigns(
    name,description,state,priority,recurrence_mode,starts_at,ends_at,
    annual_start_month,annual_start_day,annual_start_time,
    annual_end_month,annual_end_day,annual_end_time,theme,created_by,updated_by
  ) values(
    left(source.name||' — copia',120),source.description,'draft',source.priority,
    source.recurrence_mode,source.starts_at,source.ends_at,
    source.annual_start_month,source.annual_start_day,source.annual_start_time,
    source.annual_end_month,source.annual_end_day,source.annual_end_time,
    source.theme,auth.uid(),auth.uid()
  ) returning * into campaign_copy;

  insert into private.site_campaign_occurrences(campaign_id,starts_at,ends_at,created_by)
  select campaign_copy.id,starts_at,ends_at,auth.uid()
  from private.site_campaign_occurrences
  where campaign_id=source.id order by id;

  insert into private.site_welcome_phrases(
    campaign_id,phrase,active,sort_order,created_by,updated_by
  )
  select campaign_copy.id,phrase,active,sort_order,auth.uid(),auth.uid()
  from private.site_welcome_phrases
  where campaign_id=source.id and deleted_at is null order by id;

  response:=to_jsonb(campaign_copy)-'created_by'-'updated_by'-'published_by'-'deleted_by';
  return private.stage_c_complete_campaign_operation(
    'duplicate',p_request_id,operation_payload,campaign_copy.id,response
  );
end;
$$;

create or replace function private.admin_delete_site_campaign(
  p_id uuid,p_expected_version integer
) returns void language plpgsql security definer set search_path='' as $$
declare c private.site_campaigns;
begin
  perform private.stage_c_assert_admin();
  select * into c from private.site_campaigns
  where id=p_id and deleted_at is null
  for update;
  if not found or c.version<>p_expected_version then
    raise exception 'La campaña cambió o no existe' using errcode='40001';
  end if;
  if c.state='published' then raise exception 'Desactivá la campaña antes de retirarla'; end if;
  update private.site_campaigns set
    deleted_at=now(),deleted_by=auth.uid(),version=version+1,
    updated_at=now(),updated_by=auth.uid()
  where id=p_id;
  update private.site_welcome_phrases set
    deleted_at=coalesce(deleted_at,now()),version=version+1,
    updated_at=now(),updated_by=auth.uid()
  where campaign_id=p_id and deleted_at is null;
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_begin_campaign_operation(text,uuid,jsonb)'::regprocedure,
      'private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)'::regprocedure,
      'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'::regprocedure,
      'private.admin_set_site_campaign_state(uuid,text,integer,uuid)'::regprocedure,
      'private.admin_duplicate_site_campaign(uuid,integer,uuid)'::regprocedure,
      'private.admin_delete_site_campaign(uuid,integer)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)
  is 'cubica_stage_c:20261018171254';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171254' then
    raise exception 'stage_c_171254_missing_sentinel';
  end if;
  if to_regclass('private.site_campaign_idempotency') is null
    or not (select relrowsecurity from pg_class where oid='private.site_campaign_idempotency'::regclass) then
    raise exception 'stage_c_171254_idempotency_table_unprotected';
  end if;
  if has_table_privilege('anon','private.site_campaign_idempotency','select')
    or has_table_privilege('authenticated','private.site_campaign_idempotency','select')
    or has_table_privilege('service_role','private.site_campaign_idempotency','select') then
    raise exception 'stage_c_171254_idempotency_table_exposed';
  end if;

  foreach signature in array array[
      'private.stage_c_begin_campaign_operation(text,uuid,jsonb)'::regprocedure,
      'private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)'::regprocedure,
      'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'::regprocedure,
      'private.admin_set_site_campaign_state(uuid,text,integer,uuid)'::regprocedure,
      'private.admin_duplicate_site_campaign(uuid,integer,uuid)'::regprocedure,
      'private.admin_delete_site_campaign(uuid,integer)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171254_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171254_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171254_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(
          select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
          where setting like 'search_path=%'
        )
      ) then raise exception 'stage_c_171254_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from false then
        raise exception 'stage_c_171254_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
