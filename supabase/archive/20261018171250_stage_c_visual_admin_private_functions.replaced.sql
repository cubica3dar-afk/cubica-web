-- CÚBICA 3D — Etapa C, bloque 4/7: mutaciones privadas de apariencia y campañas.

-- Ninguna función recibe EXECUTE desde roles de API en este bloque.

create or replace function private.admin_save_site_appearance_draft(p_config jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current private.site_appearance_versions; next_config jsonb;
begin
  perform private.stage_c_assert_admin(); next_config:=private.stage_c_validate_theme(p_config);
  select * into current from private.site_appearance_versions where state='draft' for update;
  if current.id is null then
    insert into private.site_appearance_versions(state,version,config,created_by) values('draft',1,next_config,auth.uid()) returning * into current;
  else
    if current.version<>p_expected_version then raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001'; end if;
    update private.site_appearance_versions set config=next_config,version=version+1,created_at=now(),created_by=auth.uid() where id=current.id returning * into current;
  end if;
  return to_jsonb(current)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_publish_site_appearance(p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.site_appearance_versions; published private.site_appearance_versions; asset_id uuid;
begin
  perform private.stage_c_assert_admin();
  select * into d from private.site_appearance_versions where state='draft' for update;
  if not found or d.version<>p_expected_version then raise exception 'El borrador cambió o no existe' using errcode='40001'; end if;
  update private.site_appearance_versions set state='archived' where state='published';
  insert into private.site_appearance_versions(state,version,config,created_by,published_at,published_by)
  values('published',(select coalesce(max(version),0)+1 from private.site_appearance_versions where state in('published','archived')),private.stage_c_validate_theme(d.config),auth.uid(),now(),auth.uid()) returning * into published;
  for asset_id in select value::uuid from jsonb_each_text(coalesce(d.config->'assets','{}')) where value is not null and value<>'' loop
    update private.site_assets set public_since=coalesce(public_since,now()) where id=asset_id and retired_at is null;
  end loop;
  return to_jsonb(published)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_reset_site_appearance_draft()
returns jsonb language plpgsql security definer set search_path='' as $$
declare source jsonb; d private.site_appearance_versions;
begin
  perform private.stage_c_assert_admin();
  source:=coalesce((select config from private.site_appearance_versions where state='published' order by published_at desc,id desc limit 1),jsonb_build_object('colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),'hero',jsonb_build_object('title','Objetos únicos, impresos en 3D.','subtitle','Diseños listos para acompañar tus espacios y tus ideas.'),'assets',jsonb_build_object('logo',null,'banner',null,'background',null)));
  insert into private.site_appearance_versions(state,version,config,created_by) values('draft',1,source,auth.uid())
  on conflict(state) where state='draft' do update set config=excluded.config,version=private.site_appearance_versions.version+1,created_at=now(),created_by=auth.uid() returning * into d;
  return to_jsonb(d)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_restore_original_appearance_draft()
returns jsonb language plpgsql security definer set search_path='' as $$
declare original jsonb:=jsonb_build_object(
  'colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),
  'hero',jsonb_build_object('title','Objetos hechos para vos.','subtitle','Explorá los productos disponibles, elegí cantidades y armá tu pedido.'),
  'assets',jsonb_build_object('logo',null,'banner',null,'background',null)
); d private.site_appearance_versions;
begin
  perform private.stage_c_assert_admin();
  insert into private.site_appearance_versions(state,version,config,created_by) values('draft',1,original,auth.uid())
  on conflict(state) where state='draft' do update set config=excluded.config,version=private.site_appearance_versions.version+1,created_at=now(),created_by=auth.uid() returning * into d;
  return to_jsonb(d)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_register_site_asset(p_kind text,p_label text,p_storage_path text,p_mime_type text,p_byte_size bigint,p_width integer,p_height integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.site_assets;
begin
  perform private.stage_c_assert_admin();
  insert into private.site_assets(kind,label,storage_path,mime_type,byte_size,width,height,created_by)
  values(p_kind,private.stage_c_safe_text(p_label,120,true),p_storage_path,p_mime_type,p_byte_size,p_width,p_height,auth.uid()) returning * into a;
  return to_jsonb(a)-'created_by'-'retired_by';
end;
$$;

create or replace function private.admin_retire_site_asset(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.stage_c_assert_admin();
  if exists(select 1 from private.site_appearance_versions where state in('draft','published') and config::text like '%'||p_id::text||'%')
    or exists(select 1 from private.site_campaigns where state in('draft','published') and theme::text like '%'||p_id::text||'%') then
    raise exception 'El recurso está en uso';
  end if;
  update private.site_assets set retired_at=coalesce(retired_at,now()),retired_by=coalesce(retired_by,auth.uid()) where id=p_id;
end;
$$;

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
    perform make_date(2001,p_annual_start_month,p_annual_start_day);
    perform make_date(2001,p_annual_end_month,p_annual_end_day);
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

do $$ declare signature regprocedure; begin
    foreach signature in array array[
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
      'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure
    ] loop execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role'; end loop;
  end $$;

comment on function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer) is 'cubica_stage_c:20261018171250';

do $$ begin
    if to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)') is null or to_regprocedure('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)') is null then raise exception 'stage_c_171250_missing_functions'; end if;
    if has_function_privilege('authenticated','private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)','execute') then raise exception 'stage_c_171250_premature_execute'; end if;
  end $$;
