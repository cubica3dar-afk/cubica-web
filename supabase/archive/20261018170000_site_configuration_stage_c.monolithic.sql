-- CÚBICA 3D — Etapa C: configuración, apariencia, campañas, contenidos y sugerencias.
-- Todo dato administrativo vive en private. El Data API expone únicamente RPC con proyecciones acotadas.

create extension if not exists pgcrypto with schema extensions;

create table if not exists private.site_assets(
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null check(kind in ('logo','banner','background','campaign')),
  label text not null check(char_length(btrim(label)) between 1 and 120),
  storage_path text not null unique check(storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 8388608),
  width integer not null check(width between 1 and 8192),
  height integer not null check(height between 1 and 8192),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  retired_at timestamptz,
  retired_by uuid references auth.users(id) on delete set null,
  public_since timestamptz,
  constraint site_assets_retirement check((retired_at is null)=(retired_by is null))
);

create table if not exists private.site_appearance_versions(
  id bigint generated always as identity primary key,
  state text not null check(state in ('draft','published','archived')),
  version integer not null check(version>0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null
);
create unique index if not exists site_appearance_one_draft on private.site_appearance_versions(state) where state='draft';
create unique index if not exists site_appearance_state_version on private.site_appearance_versions(state,version);
create index if not exists site_appearance_published on private.site_appearance_versions(published_at desc,id desc) where state='published';

create table if not exists private.site_campaigns(
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 1 and 120),
  description text not null default '' check(char_length(description)<=1000),
  state text not null default 'draft' check(state in ('draft','published','disabled')),
  priority integer not null default 0 check(priority between -1000 and 1000),
  recurrence_mode text not null default 'none' check(recurrence_mode in ('none','annual','custom')),
  starts_at timestamptz,
  ends_at timestamptz,
  annual_start_month smallint check(annual_start_month between 1 and 12),
  annual_start_day smallint check(annual_start_day between 1 and 31),
  annual_start_time time,
  annual_end_month smallint check(annual_end_month between 1 and 12),
  annual_end_day smallint check(annual_end_day between 1 and 31),
  annual_end_time time,
  theme jsonb not null default '{}'::jsonb,
  apply_email_theme boolean not null default false check(apply_email_theme=false),
  email_theme_key text,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  constraint site_campaign_dates check(
    (recurrence_mode='none' and starts_at is not null and ends_at is not null and starts_at<ends_at)
    or (recurrence_mode='annual' and annual_start_month is not null and annual_start_day is not null and annual_start_time is not null and annual_end_month is not null and annual_end_day is not null and annual_end_time is not null)
    or recurrence_mode='custom'
  ),
  constraint site_campaign_email_future check(email_theme_key is null and apply_email_theme=false)
);

create table if not exists private.site_campaign_occurrences(
  id bigint generated always as identity primary key,
  campaign_id uuid not null references private.site_campaigns(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check(starts_at<ends_at),
  unique(campaign_id,starts_at,ends_at)
);

create table if not exists private.site_welcome_phrases(
  id bigint generated always as identity primary key,
  campaign_id uuid references private.site_campaigns(id) on delete cascade,
  phrase text not null check(char_length(btrim(phrase)) between 1 and 500),
  active boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists site_welcome_active on private.site_welcome_phrases(campaign_id,sort_order,id) where active and deleted_at is null;
create unique index if not exists site_welcome_unique_active_text on private.site_welcome_phrases(coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(phrase)) where deleted_at is null;

create table if not exists private.site_content_pages(
  slug text primary key check(slug in ('about','contact','terms','community')),
  label text not null,
  created_at timestamptz not null default now()
);
create table if not exists private.site_content_versions(
  id bigint generated always as identity primary key,
  page_slug text not null references private.site_content_pages(slug) on delete restrict,
  state text not null check(state in ('draft','published','archived')),
  version integer not null check(version>0),
  title text not null check(char_length(btrim(title)) between 1 and 140),
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  unique(page_slug,state,version)
);
create unique index if not exists site_content_one_draft on private.site_content_versions(page_slug) where state='draft';
create index if not exists site_content_published on private.site_content_versions(page_slug,published_at desc,id desc) where state='published';

create table if not exists private.site_faq_items(
  id bigint generated always as identity primary key,
  question text not null check(char_length(btrim(question)) between 3 and 240),
  answer text not null check(char_length(btrim(answer)) between 3 and 3000),
  active boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists site_faq_public on private.site_faq_items(sort_order,id) where active and deleted_at is null;

create table if not exists private.site_suggestions(
  id uuid primary key default extensions.gen_random_uuid(),
  category text not null check(category in ('funcionalidad','visual','error','compra','otro')),
  subject text not null check(char_length(btrim(subject)) between 3 and 160),
  description text not null check(char_length(btrim(description)) between 10 and 3000),
  contact text check(contact is null or char_length(contact)<=320),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check(status in ('new','reviewing','accepted','resolved','dismissed')),
  private_notes text not null default '' check(char_length(private_notes)<=4000),
  request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists site_suggestions_admin on private.site_suggestions(status,created_at desc,id);

create table if not exists private.suggestion_token_uses(
  token_hash text primary key,
  used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check(expires_at>used_at)
);
create table if not exists private.suggestion_rate_limits(
  identity_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 1 check(attempts>0),
  blocked_until timestamptz
);

insert into private.site_content_pages(slug,label) values
 ('about','Sobre Cúbica'),('contact','Contacto'),('terms','Términos y condiciones'),('community','Normas de Comunidad')
on conflict(slug) do update set label=excluded.label;

insert into private.site_appearance_versions(state,version,config)
select 'draft',1,jsonb_build_object(
  'colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),
  'hero',jsonb_build_object('title','Objetos únicos, impresos en 3D.','subtitle','Diseños listos para acompañar tus espacios y tus ideas.'),
  'assets',jsonb_build_object('logo',null,'banner',null,'background',null)
)
where not exists(select 1 from private.site_appearance_versions);

insert into private.site_welcome_phrases(phrase,sort_order) values
 ('Hay cosas que comprás porque las necesitás. Y hay otras que elegís porque simplemente querés tenerlas. Bienvenido a Cúbica.',10),
 ('Que una impresión salga de una máquina no significa que sea una más. En Cúbica, cada objeto empieza con una idea y termina en tus manos.',20),
 ('A veces un pequeño objeto puede cambiar un rincón, acompañar un momento o simplemente sacarte una sonrisa. Gracias por pasar por Cúbica.',30),
 ('Elegiste algo hecho en 3D. Nosotros queremos que cuando llegue a tus manos se sienta mucho más que eso: que se sienta tuyo.',40),
 ('Detrás de cada producto de Cúbica hay tiempo, material y muchas decisiones. Pero lo más importante sucede cuando finalmente llega a vos.',50),
 ('No imprimimos solamente objetos. Le damos forma a ideas para que puedan encontrar un lugar en tu mundo. Bienvenido a Cúbica.',60),
 ('Tu próxima compra puede terminar en un estante, en un escritorio, en una habitación o convertirse en un regalo inolvidable. Descubrila en Cúbica.',70),
 ('Hay algo especial en recibir algo que fue creado para vos. Ojalá encuentres en Cúbica eso que estabas buscando sin saberlo.',80),
 ('Cada pieza tiene un origen: una idea. Y quizás hoy esa idea encuentre un lugar en tu casa. Bienvenido a Cúbica.',90),
 ('Gracias por elegir un emprendimiento que crea de a una pieza por vez. Esperamos que encuentres algo que realmente quieras llevarte.',100),
 ('Lo que hoy ves en pantalla, mañana puede estar en tus manos. Elegí, imaginá y dejá que Cúbica haga el resto.',110),
 ('Cúbica nace de transformar material en objetos con propósito. Ahora queremos transformar tu elección en algo que puedas disfrutar.',120)
on conflict do nothing;

alter table private.site_assets enable row level security;
alter table private.site_appearance_versions enable row level security;
alter table private.site_campaigns enable row level security;
alter table private.site_campaign_occurrences enable row level security;
alter table private.site_welcome_phrases enable row level security;
alter table private.site_content_pages enable row level security;
alter table private.site_content_versions enable row level security;
alter table private.site_faq_items enable row level security;
alter table private.site_suggestions enable row level security;
alter table private.suggestion_token_uses enable row level security;
alter table private.suggestion_rate_limits enable row level security;

do $$ declare t text; begin
  foreach t in array array['site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases','site_content_pages','site_content_versions','site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits'] loop
    execute format('drop policy if exists %I on private.%I','stage_c_deny_'||t,t);
    execute format('create policy %I on private.%I for all to anon,authenticated using(false) with check(false)','stage_c_deny_'||t,t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('site-assets','site-assets',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists site_assets_public_read on storage.objects;
create policy site_assets_public_read on storage.objects for select to anon,authenticated
using(bucket_id='site-assets' and exists(
  select 1 from private.site_assets a where a.storage_path=name and a.public_since is not null and a.retired_at is null
));
drop policy if exists site_assets_admin_read on storage.objects;
create policy site_assets_admin_read on storage.objects for select to authenticated
using(bucket_id='site-assets' and private.is_admin());

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

create or replace function public.get_site_experience()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_site_experience(now()); $$;

create or replace function private.get_public_content_page(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('slug',p.slug,'label',p.label,'title',v.title,'content',v.content,'published_at',v.published_at)
  from private.site_content_pages p join lateral(
    select * from private.site_content_versions x where x.page_slug=p.slug and x.state='published' order by x.published_at desc,x.id desc limit 1
  ) v on true where p.slug=p_slug;
$$;
create or replace function public.get_public_content_page(p_slug text)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_public_content_page(p_slug); $$;

create or replace function private.get_public_faq()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'answer',answer) order by sort_order,id),'[]'::jsonb)
  from private.site_faq_items where active and deleted_at is null;
$$;
create or replace function public.get_public_faq()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_public_faq(); $$;

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
create or replace function public.admin_get_site_configuration()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_get_site_configuration(); $$;

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
create or replace function public.admin_save_site_appearance_draft(p_config jsonb,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_save_site_appearance_draft(p_config,p_expected_version); $$;

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
create or replace function public.admin_publish_site_appearance(p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_publish_site_appearance(p_expected_version); $$;

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
create or replace function public.admin_reset_site_appearance_draft()
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_reset_site_appearance_draft(); $$;

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
create or replace function public.admin_restore_original_appearance_draft()
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_restore_original_appearance_draft(); $$;

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
create or replace function public.admin_register_site_asset(p_kind text,p_label text,p_storage_path text,p_mime_type text,p_byte_size bigint,p_width integer,p_height integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_register_site_asset(p_kind,p_label,p_storage_path,p_mime_type,p_byte_size,p_width,p_height); $$;

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
create or replace function public.admin_retire_site_asset(p_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.admin_retire_site_asset(p_id); $$;

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
create or replace function public.admin_upsert_site_campaign(p_id uuid,p_name text,p_description text,p_priority integer,p_recurrence_mode text,p_starts_at timestamptz,p_ends_at timestamptz,p_annual_start_month integer,p_annual_start_day integer,p_annual_start_time time,p_annual_end_month integer,p_annual_end_day integer,p_annual_end_time time,p_theme jsonb,p_occurrences jsonb,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_site_campaign(p_id,p_name,p_description,p_priority,p_recurrence_mode,p_starts_at,p_ends_at,p_annual_start_month,p_annual_start_day,p_annual_start_time,p_annual_end_month,p_annual_end_day,p_annual_end_time,p_theme,p_occurrences,p_expected_version); $$;

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
create or replace function public.admin_set_site_campaign_state(p_id uuid,p_state text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_set_site_campaign_state(p_id,p_state,p_expected_version); $$;

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
create or replace function public.admin_duplicate_site_campaign(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_duplicate_site_campaign(p_id); $$;

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
create or replace function public.admin_delete_site_campaign(p_id uuid,p_expected_version integer)
returns void language sql security invoker set search_path='' as $$ select private.admin_delete_site_campaign(p_id,p_expected_version); $$;

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
create or replace function public.admin_upsert_welcome_phrase(p_id bigint,p_campaign_id uuid,p_phrase text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_welcome_phrase(p_id,p_campaign_id,p_phrase,p_active,p_sort_order,p_expected_version,p_delete); $$;

create or replace function private.stage_c_validate_content(p_content jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare body text; key text; value text;
begin
  if jsonb_typeof(coalesce(p_content,'{}'))<>'object' or (p_content-array['body','email','phone','instagram','address','hours','commercial'])<>'{}'::jsonb then raise exception 'Contenido inválido'; end if;
  body:=private.stage_c_safe_text(p_content->>'body',20000,false);
  for key,value in select * from jsonb_each_text(p_content-'body') loop
    perform private.stage_c_safe_text(value,500,false);
    if key='email' and value<>'' and value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Email inválido'; end if;
    if key='instagram' and value<>'' and value !~* '^https://(www[.])?instagram[.]com/' then raise exception 'Enlace de Instagram inválido'; end if;
  end loop;
  return p_content;
end;
$$;

create or replace function private.admin_save_content_draft(p_slug text,p_title text,p_content jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.site_content_versions;
begin
  perform private.stage_c_assert_admin();
  if not exists(select 1 from private.site_content_pages where slug=p_slug) then raise exception 'Página inválida'; end if;
  select * into d from private.site_content_versions where page_slug=p_slug and state='draft' for update;
  if found and d.version<>p_expected_version then raise exception 'El borrador cambió' using errcode='40001'; end if;
  if found then update private.site_content_versions set title=private.stage_c_safe_text(p_title,140,true),content=private.stage_c_validate_content(p_content),version=version+1,created_at=now(),created_by=auth.uid() where id=d.id returning * into d;
  else insert into private.site_content_versions(page_slug,state,version,title,content,created_by) values(p_slug,'draft',1,private.stage_c_safe_text(p_title,140,true),private.stage_c_validate_content(p_content),auth.uid()) returning * into d; end if;
  return to_jsonb(d)-'created_by'-'published_by';
end;
$$;
create or replace function public.admin_save_content_draft(p_slug text,p_title text,p_content jsonb,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_save_content_draft(p_slug,p_title,p_content,p_expected_version); $$;

create or replace function private.admin_publish_content_page(p_slug text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.site_content_versions; v private.site_content_versions; n integer;
begin
  perform private.stage_c_assert_admin(); select * into d from private.site_content_versions where page_slug=p_slug and state='draft' for update;
  if not found or d.version<>p_expected_version then raise exception 'El borrador cambió o no existe' using errcode='40001'; end if;
  update private.site_content_versions set state='archived' where page_slug=p_slug and state='published';
  select coalesce(max(version),0)+1 into n from private.site_content_versions where page_slug=p_slug and state in('published','archived');
  insert into private.site_content_versions(page_slug,state,version,title,content,created_by,published_at,published_by) values(p_slug,'published',n,d.title,private.stage_c_validate_content(d.content),auth.uid(),now(),auth.uid()) returning * into v;
  return to_jsonb(v)-'created_by'-'published_by';
end;
$$;
create or replace function public.admin_publish_content_page(p_slug text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_publish_content_page(p_slug,p_expected_version); $$;

create or replace function private.admin_restore_content_version(p_slug text,p_version integer,p_expected_draft_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source private.site_content_versions; draft private.site_content_versions;
begin
  perform private.stage_c_assert_admin();
  select * into source from private.site_content_versions where page_slug=p_slug and version=p_version and state in('published','archived') order by id desc limit 1;
  if not found then raise exception 'Versión inexistente'; end if;
  select * into draft from private.site_content_versions where page_slug=p_slug and state='draft' for update;
  if found and draft.version<>p_expected_draft_version then raise exception 'El borrador cambió' using errcode='40001'; end if;
  if found then update private.site_content_versions set title=source.title,content=source.content,version=version+1,created_at=now(),created_by=auth.uid() where id=draft.id returning * into draft;
  else insert into private.site_content_versions(page_slug,state,version,title,content,created_by) values(p_slug,'draft',1,source.title,source.content,auth.uid()) returning * into draft; end if;
  return to_jsonb(draft)-'created_by'-'published_by';
end;
$$;
create or replace function public.admin_restore_content_version(p_slug text,p_version integer,p_expected_draft_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_restore_content_version(p_slug,p_version,p_expected_draft_version); $$;

create or replace function private.admin_upsert_faq(p_id bigint,p_question text,p_answer text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.site_faq_items;
begin
  perform private.stage_c_assert_admin();
  if p_id is null then insert into private.site_faq_items(question,answer,active,sort_order,created_by,updated_by) values(private.stage_c_safe_text(p_question,240,true),private.stage_c_safe_text(p_answer,3000,true),coalesce(p_active,true),coalesce(p_sort_order,0),auth.uid(),auth.uid()) returning * into f;
  else select * into f from private.site_faq_items where id=p_id for update; if not found or f.version<>p_expected_version then raise exception 'La pregunta cambió o no existe' using errcode='40001'; end if; update private.site_faq_items set question=private.stage_c_safe_text(p_question,240,true),answer=private.stage_c_safe_text(p_answer,3000,true),active=coalesce(p_active,active),sort_order=coalesce(p_sort_order,sort_order),deleted_at=case when p_delete then now() else null end,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into f; end if;
  return to_jsonb(f)-'created_by'-'updated_by';
end;
$$;
create or replace function public.admin_upsert_faq(p_id bigint,p_question text,p_answer text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_upsert_faq(p_id,p_question,p_answer,p_active,p_sort_order,p_expected_version,p_delete); $$;

-- Solo la Edge Function (service_role) puede insertar. user_id nunca se acepta desde el navegador.
create or replace function private.consume_suggestion_protection(p_token_hash text,p_identity_hash text,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare current private.suggestion_rate_limits; now_at timestamptz:=now();
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  if p_token_hash !~ '^([0-9a-f]{64})$' or p_identity_hash !~ '^([0-9a-f]{64})$' or p_request_id is null then raise exception 'Protección inválida'; end if;
  insert into private.suggestion_token_uses(token_hash,expires_at) values(p_token_hash,now_at+interval '10 minutes')
  on conflict do nothing;
  if not found then raise exception 'suggestion_turnstile_replayed' using errcode='23505'; end if;
  select * into current from private.suggestion_rate_limits where identity_hash=p_identity_hash for update;
  if not found or current.window_started_at<=now_at-interval '1 hour' then
    insert into private.suggestion_rate_limits(identity_hash,window_started_at,attempts,blocked_until) values(p_identity_hash,now_at,1,null)
    on conflict(identity_hash) do update set window_started_at=excluded.window_started_at,attempts=1,blocked_until=null;
  else
    if current.blocked_until>now_at or current.attempts>=5 then
      update private.suggestion_rate_limits set blocked_until=greatest(coalesce(blocked_until,now_at),now_at+interval '1 hour') where identity_hash=p_identity_hash;
      raise exception 'suggestion_rate_limit' using errcode='P0001';
    end if;
    update private.suggestion_rate_limits set attempts=attempts+1 where identity_hash=p_identity_hash;
  end if;
end;
$$;

create or replace function private.submit_public_suggestion(p_category text,p_subject text,p_description text,p_contact text,p_request_id uuid,p_verified_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  insert into private.site_suggestions(category,subject,description,contact,user_id,request_id)
  values(p_category,private.stage_c_safe_text(p_subject,160,true),private.stage_c_safe_text(p_description,3000,true),nullif(private.stage_c_safe_text(p_contact,320,false),''),p_verified_user_id,p_request_id)
  on conflict(request_id) do update set request_id=excluded.request_id returning id into new_id;
  return new_id;
end;
$$;

-- Los wrappers públicos son SECURITY DEFINER porque service_role no recibe USAGE
-- sobre el esquema private. Las implementaciones vuelven a validar auth.role()
-- y solo estos wrappers reciben EXECUTE, manteniendo el acceso mínimo.
create or replace function public.consume_suggestion_protection(p_token_hash text,p_identity_hash text,p_request_id uuid)
returns void language sql security definer set search_path='' as $$
  select private.consume_suggestion_protection(p_token_hash,p_identity_hash,p_request_id);
$$;
create or replace function public.submit_public_suggestion(p_category text,p_subject text,p_description text,p_contact text,p_request_id uuid,p_verified_user_id uuid)
returns uuid language sql security definer set search_path='' as $$
  select private.submit_public_suggestion(p_category,p_subject,p_description,p_contact,p_request_id,p_verified_user_id);
$$;

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
create or replace function public.admin_list_suggestions(p_page integer default 1,p_page_size integer default 25,p_search text default null,p_status text default 'all',p_category text default 'all',p_sort text default 'recent')
returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_list_suggestions(p_page,p_page_size,p_search,p_status,p_category,p_sort); $$;

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
create or replace function public.admin_update_suggestion(p_id uuid,p_status text,p_private_notes text)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_update_suggestion(p_id,p_status,p_private_notes); $$;

revoke all on function private.get_site_experience(timestamptz),private.get_public_content_page(text),private.get_public_faq(),private.consume_suggestion_protection(text,text,uuid),private.submit_public_suggestion(text,text,text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.stage_c_assert_admin(),private.stage_c_safe_text(text,integer,boolean),private.stage_c_luminance(text),private.stage_c_validate_theme(jsonb),private.stage_c_asset_paths(jsonb),private.stage_c_active_campaign(timestamptz),private.stage_c_next_change(timestamptz),private.stage_c_validate_content(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.get_site_experience(timestamptz),private.get_public_content_page(text),private.get_public_faq() to anon,authenticated;
revoke all on function public.consume_suggestion_protection(text,text,uuid),public.submit_public_suggestion(text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.consume_suggestion_protection(text,text,uuid),public.submit_public_suggestion(text,text,text,text,uuid,uuid) to service_role;

grant execute on function public.get_site_experience(),public.get_public_content_page(text),public.get_public_faq() to anon,authenticated;
grant execute on function public.admin_get_site_configuration(),public.admin_save_site_appearance_draft(jsonb,integer),public.admin_publish_site_appearance(integer),public.admin_reset_site_appearance_draft(),public.admin_restore_original_appearance_draft(),public.admin_register_site_asset(text,text,text,text,bigint,integer,integer),public.admin_retire_site_asset(uuid),public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer),public.admin_set_site_campaign_state(uuid,text,integer),public.admin_duplicate_site_campaign(uuid),public.admin_delete_site_campaign(uuid,integer),public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean),public.admin_save_content_draft(text,text,jsonb,integer),public.admin_publish_content_page(text,integer),public.admin_restore_content_version(text,integer,integer),public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean),public.admin_list_suggestions(integer,integer,text,text,text,text),public.admin_update_suggestion(uuid,text,text) to authenticated;
revoke all on function public.admin_get_site_configuration(),public.admin_save_site_appearance_draft(jsonb,integer),public.admin_publish_site_appearance(integer),public.admin_reset_site_appearance_draft(),public.admin_restore_original_appearance_draft(),public.admin_register_site_asset(text,text,text,text,bigint,integer,integer),public.admin_retire_site_asset(uuid),public.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer),public.admin_set_site_campaign_state(uuid,text,integer),public.admin_duplicate_site_campaign(uuid),public.admin_delete_site_campaign(uuid,integer),public.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean),public.admin_save_content_draft(text,text,jsonb,integer),public.admin_publish_content_page(text,integer),public.admin_restore_content_version(text,integer,integer),public.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean),public.admin_list_suggestions(integer,integer,text,text,text,text),public.admin_update_suggestion(uuid,text,text) from public,anon;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'private.admin_get_site_configuration()'::regprocedure,
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
    'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure,
    'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
    'private.admin_publish_content_page(text,integer)'::regprocedure,
    'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
    'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
    'private.admin_list_suggestions(integer,integer,text,text,text,text)'::regprocedure,
    'private.admin_update_suggestion(uuid,text,text)'::regprocedure
  ] loop
    execute 'revoke all on function '||signature||' from public,anon,service_role';
    execute 'grant execute on function '||signature||' to authenticated';
  end loop;
end $$;

-- Limpieza limitada a datos técnicos vencidos; no borra sugerencias.
create or replace function private.cleanup_suggestion_protection()
returns void language sql security definer set search_path='' as $$
  delete from private.suggestion_token_uses where expires_at<now()-interval '1 day';
  delete from private.suggestion_rate_limits where window_started_at<now()-interval '2 days' and coalesce(blocked_until,'-infinity')<now();
$$;
revoke all on function private.cleanup_suggestion_protection() from public,anon,authenticated,service_role;

create or replace function public.cleanup_suggestion_protection()
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  perform private.cleanup_suggestion_protection();
end;
$$;
revoke all on function public.cleanup_suggestion_protection() from public,anon,authenticated;
grant execute on function public.cleanup_suggestion_protection() to service_role;
