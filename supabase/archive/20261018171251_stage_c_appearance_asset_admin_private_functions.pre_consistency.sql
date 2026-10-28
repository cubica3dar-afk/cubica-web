-- CÚBICA 3D — Etapa C, bloque 4A: apariencia y recursos.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171251_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

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

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
      'private.admin_publish_site_appearance(integer)'::regprocedure,
      'private.admin_reset_site_appearance_draft()'::regprocedure,
      'private.admin_restore_original_appearance_draft()'::regprocedure,
      'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
      'private.admin_retire_site_asset(uuid)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer) is 'cubica_stage_c:20261018171251';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171251' then
    raise exception 'stage_c_171251_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
      'private.admin_publish_site_appearance(integer)'::regprocedure,
      'private.admin_reset_site_appearance_draft()'::regprocedure,
      'private.admin_restore_original_appearance_draft()'::regprocedure,
      'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
      'private.admin_retire_site_asset(uuid)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171251_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171251_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171251_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171251_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171251_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
