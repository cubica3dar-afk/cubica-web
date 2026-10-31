-- CÚBICA 3D — Etapa C, bloque 3A/9: validadores y auxiliares visuales privados.

-- Supabase aplica cada archivo como una transacción independiente.

-- Ninguna función recibe EXECUTE desde roles de API en este bloque.

create or replace function private.stage_c_assert_admin()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Solo administradores con MFA AAL2' using errcode='42501';
  end if;
end;
$$;

create or replace function private.stage_c_safe_text(p_value text,p_max integer,p_required boolean default false)
returns text language plpgsql immutable set search_path='' as $$
declare v text:=btrim(coalesce(p_value,''));
begin
  if (p_required and v='') or char_length(v)>p_max then raise exception 'Texto inválido'; end if;
  if v ~* '<[[:space:]]*(script|iframe|object|embed|style)|on[a-z]+[[:space:]]*=|javascript[[:space:]]*:|data[[:space:]]*:[^,]*text/html' then
    raise exception 'El contenido incluye HTML o código no permitido';
  end if;
  return v;
end;
$$;

create or replace function private.stage_c_luminance(p_hex text)
returns numeric language plpgsql immutable set search_path='' as $$
declare r numeric;g numeric;b numeric;
begin
  if p_hex !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Color hexadecimal inválido'; end if;
  r:=get_byte(decode(substring(p_hex from 2 for 2),'hex'),0)/255.0;
  g:=get_byte(decode(substring(p_hex from 4 for 2),'hex'),0)/255.0;
  b:=get_byte(decode(substring(p_hex from 6 for 2),'hex'),0)/255.0;
  r:=case when r<=0.03928 then r/12.92 else power((r+0.055)/1.055,2.4) end;
  g:=case when g<=0.03928 then g/12.92 else power((g+0.055)/1.055,2.4) end;
  b:=case when b<=0.03928 then b/12.92 else power((b+0.055)/1.055,2.4) end;
  return 0.2126*r+0.7152*g+0.0722*b;
end;
$$;

create or replace function private.stage_c_validate_theme(p_config jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare v jsonb:=coalesce(p_config,'{}'::jsonb); k text; val text; asset_text text;
begin
  if jsonb_typeof(v)<>'object' or (v-'colors'-'hero'-'assets')<>'{}'::jsonb then raise exception 'Configuración visual inválida'; end if;
  if jsonb_typeof(coalesce(v->'colors','{}'))<>'object' or jsonb_typeof(coalesce(v->'hero','{}'))<>'object' or jsonb_typeof(coalesce(v->'assets','{}'))<>'object' then raise exception 'Configuración visual inválida'; end if;
  if (coalesce(v->'colors','{}')-array['background','panel','panelAlt','text','muted','accent'])<>'{}'::jsonb then raise exception 'Color no permitido'; end if;
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
  if (coalesce(v->'assets','{}')-array['logo','banner','background'])<>'{}'::jsonb then raise exception 'Recurso visual no permitido'; end if;
  for k,asset_text in select * from jsonb_each_text(coalesce(v->'assets','{}')) loop
    if asset_text<>'' and not exists(select 1 from private.site_assets a where a.id=asset_text::uuid and a.retired_at is null) then raise exception 'Recurso visual inexistente'; end if;
  end loop;
  return v;
exception when invalid_text_representation then raise exception 'Identificador de recurso inválido';
end;
$$;

create or replace function private.stage_c_asset_paths(p_theme jsonb)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_object_agg(e.key,a.storage_path) filter(where a.id is not null),'{}'::jsonb)
  from jsonb_each_text(coalesce(p_theme->'assets','{}'::jsonb)) e
  left join private.site_assets a on a.id=nullif(e.value,'')::uuid and a.retired_at is null;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_assert_admin()'::regprocedure,
      'private.stage_c_safe_text(text,integer,boolean)'::regprocedure,
      'private.stage_c_luminance(text)'::regprocedure,
      'private.stage_c_validate_theme(jsonb)'::regprocedure,
      'private.stage_c_asset_paths(jsonb)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.stage_c_assert_admin() is 'cubica_stage_c:20261018171210';

do $$
begin
  if obj_description(to_regclass('private.site_campaigns')::oid,'pg_class') is distinct from 'cubica_stage_c:20261018171000' then
    raise exception 'stage_c_171210_missing_prerequisite:private.site_campaigns';
  end if;
  if obj_description(to_regclass('private.site_suggestions')::oid,'pg_class') is distinct from 'cubica_stage_c:20261018171100' then
    raise exception 'stage_c_171210_missing_prerequisite:private.site_suggestions';
  end if;
end $$;

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171210_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.stage_c_assert_admin()'::regprocedure,
      'private.stage_c_safe_text(text,integer,boolean)'::regprocedure,
      'private.stage_c_luminance(text)'::regprocedure,
      'private.stage_c_validate_theme(jsonb)'::regprocedure,
      'private.stage_c_asset_paths(jsonb)'::regprocedure
    ] loop
      if signature is null then
        raise exception 'stage_c_171210_missing_function';
      end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171210_premature_execute:%',signature;
      end if;
      if exists(
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then
        raise exception 'stage_c_171210_public_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
          and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then
        raise exception 'stage_c_171210_unrestricted_search_path:%',signature;
      end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid)
        is distinct from (signature=any(array['private.stage_c_assert_admin()'::regprocedure]::regprocedure[])) then
        raise exception 'stage_c_171210_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;

