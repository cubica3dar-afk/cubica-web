-- CÚBICA 3D — Etapa C, bloque 3C-1: resolución de experiencia pública.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171231_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171218' then
    raise exception 'stage_c_171231_missing_prerequisite:private.stage_c_active_campaign(timestamptz)';
  end if;
  if obj_description(to_regprocedure('private.stage_c_next_change(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171223' then
    raise exception 'stage_c_171231_missing_prerequisite:private.stage_c_next_change(timestamptz)';
  end if;
end $$;

create or replace function private.get_site_experience(p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; campaign private.site_campaigns; merged jsonb; phrases jsonb; next_at timestamptz;
begin
  select config into base from private.site_appearance_versions where state='published' order by published_at desc,id desc limit 1;
  base:=coalesce(base,jsonb_build_object(
    'colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),
    'hero',jsonb_build_object('title','Objetos hechos para vos.','subtitle','Explorá los productos disponibles, elegí cantidades y armá tu pedido.'),
    'assets',jsonb_build_object('logo',null,'banner',null,'background',null)
  ));
  campaign:=private.stage_c_active_campaign(p_at);
  merged:=base;
  if campaign.id is not null then
    merged:=jsonb_set(jsonb_set(jsonb_set(base,
      '{colors}',coalesce(base->'colors','{}')||jsonb_strip_nulls(coalesce(campaign.theme->'colors','{}')),true),
      '{hero}',coalesce(base->'hero','{}')||jsonb_strip_nulls(coalesce(campaign.theme->'hero','{}')),true),
      '{assets}',coalesce(base->'assets','{}')||jsonb_strip_nulls(coalesce(campaign.theme->'assets','{}')),true);
  end if;
  select coalesce(jsonb_agg(phrase order by sort_order,id),'[]'::jsonb) into phrases
  from private.site_welcome_phrases where active and deleted_at is null and campaign_id is not distinct from campaign.id;
  if jsonb_array_length(phrases)=0 then
    select coalesce(jsonb_agg(phrase order by sort_order,id),'[]'::jsonb) into phrases
    from private.site_welcome_phrases where active and deleted_at is null and campaign_id is null;
  end if;
  next_at:=private.stage_c_next_change(p_at);
  return jsonb_build_object('appearance',merged,'asset_paths',private.stage_c_asset_paths(merged),'welcome_phrases',phrases,
    'campaign',case when campaign.id is null then null else jsonb_build_object('id',campaign.id,'name',campaign.name) end,
    'resolved_at',p_at,'next_change_at',next_at,'timezone','America/Argentina/Buenos_Aires');
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.get_site_experience(timestamptz)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.get_site_experience(timestamptz) is 'cubica_stage_c:20261018171231';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.get_site_experience(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171231' then
    raise exception 'stage_c_171231_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.get_site_experience(timestamptz)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171231_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171231_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171231_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171231_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171231_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
