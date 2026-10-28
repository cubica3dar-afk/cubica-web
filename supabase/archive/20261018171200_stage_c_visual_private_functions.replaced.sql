-- CÚBICA 3D — Etapa C, bloque 3/7: resolución privada de apariencia y campañas.

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

create or replace function private.stage_c_active_campaign(p_at timestamptz default now())
returns private.site_campaigns language sql stable security definer set search_path='' as $$
  with local_now as(select p_at at time zone 'America/Argentina/Buenos_Aires' v), candidates as(
    select c.*,
      case
        when c.recurrence_mode='none' then c.starts_at
        when c.recurrence_mode='custom' then (select max(o.starts_at) from private.site_campaign_occurrences o where o.campaign_id=c.id and p_at>=o.starts_at and p_at<o.ends_at)
        else (
          case when (c.annual_start_month,c.annual_start_day,c.annual_start_time)>(c.annual_end_month,c.annual_end_day,c.annual_end_time)
            and n.v < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
          then make_date(extract(year from n.v)::int-1,c.annual_start_month,c.annual_start_day)+c.annual_start_time
          else make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time end
        ) at time zone 'America/Argentina/Buenos_Aires'
      end effective_start
    from private.site_campaigns c,local_now n
    where c.state='published' and c.deleted_at is null and (
      (c.recurrence_mode='none' and p_at>=c.starts_at and p_at<c.ends_at)
      or (c.recurrence_mode='custom' and exists(select 1 from private.site_campaign_occurrences o where o.campaign_id=c.id and p_at>=o.starts_at and p_at<o.ends_at))
      or (c.recurrence_mode='annual' and (
        case
          when make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time
               < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
          then n.v >= make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time
           and n.v < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
          else n.v >= make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time
            or n.v < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
        end
      ))
    )
  ) select c from candidates c order by priority desc,effective_start desc,published_at desc,id asc limit 1;
$$;

create or replace function private.stage_c_next_change(p_at timestamptz default now())
returns timestamptz language sql stable security definer set search_path='' as $$
  select min(x) from(
    select starts_at x from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and starts_at>p_at
    union all select ends_at from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and ends_at>p_at
    union all select starts_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and starts_at>p_at
    union all select ends_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and ends_at>p_at
    union all select (make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_start_month,c.annual_start_day)+c.annual_start_time) at time zone 'America/Argentina/Buenos_Aires'
      from private.site_campaigns c cross join generate_series(0,1) y where c.state='published' and c.deleted_at is null and c.recurrence_mode='annual'
        and ((make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_start_month,c.annual_start_day)+c.annual_start_time) at time zone 'America/Argentina/Buenos_Aires')>p_at
    union all select (make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_end_month,c.annual_end_day)+c.annual_end_time) at time zone 'America/Argentina/Buenos_Aires'
      from private.site_campaigns c cross join generate_series(0,1) y where c.state='published' and c.deleted_at is null and c.recurrence_mode='annual'
        and ((make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_end_month,c.annual_end_day)+c.annual_end_time) at time zone 'America/Argentina/Buenos_Aires')>p_at
  ) q;
$$;

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

do $$ declare signature regprocedure; begin
    foreach signature in array array[
      'private.stage_c_assert_admin()'::regprocedure,
      'private.stage_c_safe_text(text,integer,boolean)'::regprocedure,
      'private.stage_c_luminance(text)'::regprocedure,
      'private.stage_c_validate_theme(jsonb)'::regprocedure,
      'private.stage_c_asset_paths(jsonb)'::regprocedure,
      'private.stage_c_active_campaign(timestamptz)'::regprocedure,
      'private.stage_c_next_change(timestamptz)'::regprocedure,
      'private.get_site_experience(timestamptz)'::regprocedure,
      'private.admin_get_site_configuration()'::regprocedure
    ] loop execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role'; end loop;
  end $$;

comment on function private.get_site_experience(timestamptz) is 'cubica_stage_c:20261018171200';

do $$ begin
    if to_regprocedure('private.get_site_experience(timestamptz)') is null or to_regprocedure('private.admin_get_site_configuration()') is null then raise exception 'stage_c_171200_missing_functions'; end if;
    if has_function_privilege('anon','private.get_site_experience(timestamptz)','execute') or has_function_privilege('authenticated','private.admin_get_site_configuration()','execute') then raise exception 'stage_c_171200_premature_execute'; end if;
  end $$;
