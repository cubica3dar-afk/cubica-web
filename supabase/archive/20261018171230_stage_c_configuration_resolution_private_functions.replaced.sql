-- CÚBICA 3D — Etapa C, bloque 3C/9: resolución privada de configuración.

-- Supabase aplica cada archivo como una transacción independiente.

-- Ninguna función recibe EXECUTE desde roles de API en este bloque.

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

create or replace function private.admin_get_site_configuration()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.stage_c_assert_admin();
  select jsonb_build_object(
    'appearance',coalesce((select to_jsonb(v)-'created_by'-'published_by' from private.site_appearance_versions v where state='draft' order by id desc limit 1),'{}'::jsonb),
    'published_appearance',coalesce((select to_jsonb(v)-'created_by'-'published_by' from private.site_appearance_versions v where state='published' order by published_at desc,id desc limit 1),'{}'::jsonb),
    'assets',coalesce((select jsonb_agg(to_jsonb(a)-'created_by'-'retired_by' order by created_at desc) from private.site_assets a),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(to_jsonb(c)-'created_by'-'updated_by'-'published_by'-'deleted_by' order by priority desc,updated_at desc) from private.site_campaigns c where deleted_at is null),'[]'::jsonb),
    'occurrences',coalesce((select jsonb_agg(to_jsonb(o)-'created_by' order by starts_at) from private.site_campaign_occurrences o),'[]'::jsonb),
    'phrases',coalesce((select jsonb_agg(to_jsonb(w)-'created_by'-'updated_by' order by campaign_id nulls first,sort_order,id) from private.site_welcome_phrases w where deleted_at is null),'[]'::jsonb),
    'pages',coalesce((select jsonb_agg(jsonb_build_object('slug',p.slug,'label',p.label,'draft',(select to_jsonb(v)-'created_by'-'published_by' from private.site_content_versions v where v.page_slug=p.slug and state='draft' order by id desc limit 1),'published',(select to_jsonb(v)-'created_by'-'published_by' from private.site_content_versions v where v.page_slug=p.slug and state='published' order by published_at desc,id desc limit 1),'history',(select coalesce(jsonb_agg(to_jsonb(h)-'created_by'-'published_by' order by h.version desc),'[]'::jsonb) from (select * from private.site_content_versions v where v.page_slug=p.slug and state in('published','archived') order by version desc limit 20) h)) order by p.slug) from private.site_content_pages p),'[]'::jsonb),
    'faqs',coalesce((select jsonb_agg(to_jsonb(f)-'created_by'-'updated_by' order by sort_order,id) from private.site_faq_items f where deleted_at is null),'[]'::jsonb),
    'timezone','America/Argentina/Buenos_Aires','email_theme_enabled',false
  ) into result;
  return result;
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.get_site_experience(timestamptz)'::regprocedure,
      'private.admin_get_site_configuration()'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.get_site_experience(timestamptz) is 'cubica_stage_c:20261018171230';

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171230_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171220' then
    raise exception 'stage_c_171230_missing_prerequisite:private.stage_c_active_campaign(timestamptz)';
  end if;
end $$;

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.get_site_experience(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171230' then
    raise exception 'stage_c_171230_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.get_site_experience(timestamptz)'::regprocedure,
      'private.admin_get_site_configuration()'::regprocedure
    ] loop
      if signature is null then
        raise exception 'stage_c_171230_missing_function';
      end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171230_premature_execute:%',signature;
      end if;
      if exists(
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then
        raise exception 'stage_c_171230_public_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
          and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then
        raise exception 'stage_c_171230_unrestricted_search_path:%',signature;
      end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid)
        is distinct from (signature=any(array['private.get_site_experience(timestamptz)'::regprocedure,'private.admin_get_site_configuration()'::regprocedure]::regprocedure[])) then
        raise exception 'stage_c_171230_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;

