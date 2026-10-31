-- CÚBICA 3D — Etapa C, bloque 4A v2: apariencia y recursos.
--
-- Migración cerrada: no concede EXECUTE a roles de Data API.
-- La versión 20261018171251 fue archivada sin haberse aplicado.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171249_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if to_regclass('storage.objects') is null then
    raise exception 'stage_c_171249_missing_prerequisite:storage.objects';
  end if;
end $$;

-- Vincula cada publicación con la revisión exacta del borrador que la originó.
-- Las publicaciones históricas anteriores a esta migración pueden conservar NULL.
alter table private.site_appearance_versions
  add column if not exists source_draft_version integer;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.site_appearance_versions'::regclass
      and conname='site_appearance_source_draft_version_positive'
  ) then
    alter table private.site_appearance_versions
      add constraint site_appearance_source_draft_version_positive
      check(source_draft_version is null or source_draft_version>0);
  end if;
end $$;

create unique index if not exists site_appearance_source_draft_once
  on private.site_appearance_versions(source_draft_version)
  where state in('published','archived') and source_draft_version is not null;

-- El validador toma bloqueos SHARE sobre los recursos referenciados. Esto coordina
-- guardados de apariencia/campañas con el retiro concurrente de un recurso.
-- Los recursos kind=campaign son reutilizables en cualquier slot de una campaña;
-- las funciones de apariencia permanente aplican además coincidencia exacta.
create or replace function private.stage_c_validate_theme(p_config jsonb)
returns jsonb language plpgsql volatile set search_path='' as $$
declare
  v jsonb:=coalesce(p_config,'{}'::jsonb);
  k text;
  val text;
  asset_text text;
  asset_id uuid;
  asset_kind text;
begin
  if jsonb_typeof(v)<>'object' or (v-'colors'-'hero'-'assets')<>'{}'::jsonb then
    raise exception 'Configuración visual inválida';
  end if;
  if jsonb_typeof(coalesce(v->'colors','{}'))<>'object'
    or jsonb_typeof(coalesce(v->'hero','{}'))<>'object'
    or jsonb_typeof(coalesce(v->'assets','{}'))<>'object' then
    raise exception 'Configuración visual inválida';
  end if;
  if (coalesce(v->'colors','{}')-array['background','panel','panelAlt','text','muted','accent'])<>'{}'::jsonb then
    raise exception 'Color no permitido';
  end if;
  for k,val in select * from jsonb_each_text(coalesce(v->'colors','{}')) loop
    if val !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Color hexadecimal inválido'; end if;
  end loop;
  if v#>>'{colors,text}' is not null and v#>>'{colors,background}' is not null and
    (greatest(private.stage_c_luminance(v#>>'{colors,text}'),private.stage_c_luminance(v#>>'{colors,background}'))+0.05)
      /(least(private.stage_c_luminance(v#>>'{colors,text}'),private.stage_c_luminance(v#>>'{colors,background}'))+0.05)<4.5 then
    raise exception 'Contraste insuficiente entre texto y fondo';
  end if;
  perform private.stage_c_safe_text(v#>>'{hero,title}',120,false);
  perform private.stage_c_safe_text(v#>>'{hero,subtitle}',300,false);
  if (coalesce(v->'assets','{}')-array['logo','banner','background'])<>'{}'::jsonb then
    raise exception 'Recurso visual no permitido';
  end if;
  for k,asset_text in select * from jsonb_each_text(coalesce(v->'assets','{}')) order by key loop
    if asset_text is null or asset_text='' then continue; end if;
    begin
      asset_id:=asset_text::uuid;
    exception when invalid_text_representation then
      raise exception 'Identificador de recurso inválido';
    end;
    select a.kind into asset_kind
    from private.site_assets a
    where a.id=asset_id and a.retired_at is null
    for share;
    if not found then raise exception 'Recurso visual inexistente'; end if;
    if asset_kind<>k and asset_kind<>'campaign' then
      raise exception 'Tipo de recurso incompatible con %',k;
    end if;
  end loop;
  return v;
end;
$$;

create or replace function private.admin_save_site_appearance_draft(p_config jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  current private.site_appearance_versions;
  next_config jsonb;
begin
  perform private.stage_c_assert_admin();
  perform pg_advisory_xact_lock(1817124901);
  select * into current from private.site_appearance_versions where state='draft' for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001';
    end if;
  elsif p_expected_version is distinct from current.version then
    raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001';
  end if;
  next_config:=private.stage_c_validate_theme(p_config);
  if exists(
    select 1 from jsonb_each_text(coalesce(next_config->'assets','{}'::jsonb)) e
    join private.site_assets a on a.id=nullif(e.value,'')::uuid
    where a.kind<>e.key
  ) then
    raise exception 'La apariencia permanente requiere recursos del tipo correspondiente';
  end if;
  if current.id is null then
    insert into private.site_appearance_versions(state,version,config,created_by)
    values('draft',1,next_config,auth.uid()) returning * into current;
  else
    update private.site_appearance_versions
    set config=next_config,version=version+1,created_at=now(),created_by=auth.uid()
    where id=current.id returning * into current;
  end if;
  return to_jsonb(current)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_publish_site_appearance(p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  d private.site_appearance_versions;
  published private.site_appearance_versions;
  checked_config jsonb;
  asset_id uuid;
begin
  perform private.stage_c_assert_admin();
  perform pg_advisory_xact_lock(1817124901);
  select * into d from private.site_appearance_versions where state='draft' for update;
  if not found or p_expected_version is distinct from d.version then
    raise exception 'El borrador cambió o no existe' using errcode='40001';
  end if;

  select * into published
  from private.site_appearance_versions
  where state in('published','archived') and source_draft_version=d.version
  order by id desc limit 1;
  if found then
    return to_jsonb(published)-'created_by'-'published_by';
  end if;

  checked_config:=private.stage_c_validate_theme(d.config);
  if exists(
    select 1 from jsonb_each_text(coalesce(checked_config->'assets','{}'::jsonb)) e
    join private.site_assets a on a.id=nullif(e.value,'')::uuid
    where a.kind<>e.key
  ) then
    raise exception 'La apariencia permanente requiere recursos del tipo correspondiente';
  end if;

  update private.site_appearance_versions set state='archived' where state='published';
  insert into private.site_appearance_versions(
    state,version,config,created_by,published_at,published_by,source_draft_version
  ) values(
    'published',
    (select coalesce(max(version),0)+1 from private.site_appearance_versions where state in('published','archived')),
    checked_config,auth.uid(),now(),auth.uid(),d.version
  ) returning * into published;
  for asset_id in
    select value::uuid from jsonb_each_text(coalesce(checked_config->'assets','{}'))
    where value is not null and value<>''
  loop
    update private.site_assets
    set public_since=coalesce(public_since,now())
    where id=asset_id and retired_at is null;
  end loop;
  return to_jsonb(published)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_reset_site_appearance_draft(p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  source jsonb;
  d private.site_appearance_versions;
begin
  perform private.stage_c_assert_admin();
  perform pg_advisory_xact_lock(1817124901);
  select * into d from private.site_appearance_versions where state='draft' for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001';
    end if;
  elsif p_expected_version is distinct from d.version then
    raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001';
  end if;
  source:=coalesce(
    (select config from private.site_appearance_versions where state='published' order by published_at desc,id desc limit 1),
    jsonb_build_object(
      'colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),
      'hero',jsonb_build_object('title','Objetos únicos, impresos en 3D.','subtitle','Diseños listos para acompañar tus espacios y tus ideas.'),
      'assets',jsonb_build_object('logo',null,'banner',null,'background',null)
    )
  );
  source:=private.stage_c_validate_theme(source);
  if exists(
    select 1 from jsonb_each_text(coalesce(source->'assets','{}'::jsonb)) e
    join private.site_assets a on a.id=nullif(e.value,'')::uuid
    where a.kind<>e.key
  ) then
    raise exception 'La apariencia permanente requiere recursos del tipo correspondiente';
  end if;
  if d.id is null then
    insert into private.site_appearance_versions(state,version,config,created_by)
    values('draft',1,source,auth.uid()) returning * into d;
  else
    update private.site_appearance_versions
    set config=source,version=version+1,created_at=now(),created_by=auth.uid()
    where id=d.id returning * into d;
  end if;
  return to_jsonb(d)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_restore_original_appearance_draft(p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  original jsonb:=jsonb_build_object(
    'colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),
    'hero',jsonb_build_object('title','Objetos hechos para vos.','subtitle','Explorá los productos disponibles, elegí cantidades y armá tu pedido.'),
    'assets',jsonb_build_object('logo',null,'banner',null,'background',null)
  );
  d private.site_appearance_versions;
begin
  perform private.stage_c_assert_admin();
  perform pg_advisory_xact_lock(1817124901);
  select * into d from private.site_appearance_versions where state='draft' for update;
  if not found then
    if p_expected_version is not null then
      raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001';
    end if;
  elsif p_expected_version is distinct from d.version then
    raise exception 'El borrador fue actualizado en otra sesión' using errcode='40001';
  end if;
  original:=private.stage_c_validate_theme(original);
  if d.id is null then
    insert into private.site_appearance_versions(state,version,config,created_by)
    values('draft',1,original,auth.uid()) returning * into d;
  else
    update private.site_appearance_versions
    set config=original,version=version+1,created_at=now(),created_by=auth.uid()
    where id=d.id returning * into d;
  end if;
  return to_jsonb(d)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_register_site_asset(
  p_kind text,p_label text,p_storage_path text,p_mime_type text,
  p_byte_size bigint,p_width integer,p_height integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a private.site_assets;
  object_metadata jsonb;
  object_mime text;
  object_size_text text;
  extension text;
begin
  perform private.stage_c_assert_admin();
  if p_kind not in('logo','banner','background','campaign') then raise exception 'Tipo de recurso inválido'; end if;
  if p_storage_path is null or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$' then
    raise exception 'Ruta de recurso inválida';
  end if;
  if p_mime_type not in('image/jpeg','image/png','image/webp') then raise exception 'Formato de recurso inválido'; end if;
  if p_byte_size is null or p_byte_size not between 1 and 8388608
    or p_width is null or p_width not between 1 and 8192
    or p_height is null or p_height not between 1 and 8192 then
    raise exception 'Dimensiones o tamaño de recurso inválidos';
  end if;
  extension:=lower(substring(p_storage_path from '[.]([^.]+)$'));
  if not (
    (p_mime_type='image/png' and extension='png')
    or (p_mime_type='image/webp' and extension='webp')
    or (p_mime_type='image/jpeg' and extension in('jpg','jpeg'))
  ) then
    raise exception 'La extensión no coincide con el tipo MIME';
  end if;

  select o.metadata into object_metadata
  from storage.objects o
  where o.bucket_id='site-assets' and o.name=p_storage_path
    and o.archived_at is null and not o.is_delete_marker
  for share;
  if not found then raise exception 'El recurso no existe en Storage'; end if;
  object_mime:=lower(coalesce(object_metadata->>'mimetype',''));
  object_size_text:=coalesce(object_metadata->>'size','');
  if object_mime<>p_mime_type then raise exception 'El MIME no coincide con Storage'; end if;
  if object_size_text !~ '^[0-9]+$' or object_size_text::bigint<>p_byte_size then
    raise exception 'El tamaño no coincide con Storage';
  end if;

  insert into private.site_assets(kind,label,storage_path,mime_type,byte_size,width,height,created_by)
  values(
    p_kind,private.stage_c_safe_text(p_label,120,true),p_storage_path,
    p_mime_type,p_byte_size,p_width,p_height,auth.uid()
  ) returning * into a;
  return to_jsonb(a)-'created_by'-'retired_by';
end;
$$;

create or replace function private.admin_retire_site_asset(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a private.site_assets;
begin
  perform private.stage_c_assert_admin();
  if p_id is null then raise exception 'Identificador de recurso inválido'; end if;
  select * into a from private.site_assets where id=p_id for update;
  if not found then raise exception 'Recurso inexistente'; end if;
  if a.retired_at is not null then return; end if;
  if exists(
    select 1 from private.site_appearance_versions v
    where v.state in('draft','published') and (
      v.config#>>'{assets,logo}'=p_id::text
      or v.config#>>'{assets,banner}'=p_id::text
      or v.config#>>'{assets,background}'=p_id::text
    )
  ) or exists(
    select 1 from private.site_campaigns c
    where c.deleted_at is null and (
      c.theme#>>'{assets,logo}'=p_id::text
      or c.theme#>>'{assets,banner}'=p_id::text
      or c.theme#>>'{assets,background}'=p_id::text
    )
  ) then
    raise exception 'El recurso está en uso';
  end if;
  update private.site_assets
  set retired_at=now(),retired_by=auth.uid()
  where id=p_id and retired_at is null;
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_validate_theme(jsonb)'::regprocedure,
      'private.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
      'private.admin_publish_site_appearance(integer)'::regprocedure,
      'private.admin_reset_site_appearance_draft(integer)'::regprocedure,
      'private.admin_restore_original_appearance_draft(integer)'::regprocedure,
      'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
      'private.admin_retire_site_asset(uuid)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)
  is 'cubica_stage_c:20261018171249';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171249' then
    raise exception 'stage_c_171249_missing_sentinel';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='private' and table_name='site_appearance_versions'
      and column_name='source_draft_version'
  ) or to_regclass('private.site_appearance_source_draft_once') is null then
    raise exception 'stage_c_171249_missing_publication_integrity';
  end if;
  foreach signature in array array[
      'private.stage_c_validate_theme(jsonb)'::regprocedure,
      'private.admin_save_site_appearance_draft(jsonb,integer)'::regprocedure,
      'private.admin_publish_site_appearance(integer)'::regprocedure,
      'private.admin_reset_site_appearance_draft(integer)'::regprocedure,
      'private.admin_restore_original_appearance_draft(integer)'::regprocedure,
      'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)'::regprocedure,
      'private.admin_retire_site_asset(uuid)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171249_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171249_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171249_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(
          select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
          where setting like 'search_path=%'
        )
      ) then raise exception 'stage_c_171249_unrestricted_search_path:%',signature; end if;
      if signature<>'private.stage_c_validate_theme(jsonb)'::regprocedure
        and (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from false then
        raise exception 'stage_c_171249_wrong_security_mode:%',signature;
      end if;
      if signature='private.stage_c_validate_theme(jsonb)'::regprocedure
        and (select p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from false then
        raise exception 'stage_c_171249_validator_security_mode';
      end if;
    end loop;
end $$;
