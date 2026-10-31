-- CÚBICA 3D — Etapa C, bloque 1/7: esquema visual y campañas.

-- Estado intermedio seguro: tablas privadas, RLS activo y ningún acceso directo.

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

do $$ declare t text; begin
  foreach t in array array['site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('drop policy if exists %I on private.%I','stage_c_deny_'||t,t);
    execute format('create policy %I on private.%I for all to anon,authenticated using(false) with check(false)','stage_c_deny_'||t,t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

comment on table private.site_campaigns is 'cubica_stage_c:20261018171000';

do $$ begin
    if to_regclass('private.site_assets') is null or to_regclass('private.site_campaigns') is null then raise exception 'stage_c_171000_missing_tables'; end if;
    if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any(array['site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases']) and not c.relrowsecurity) then raise exception 'stage_c_171000_rls_disabled'; end if;
    if has_table_privilege('anon','private.site_assets','select') or has_table_privilege('authenticated','private.site_campaigns','select') then raise exception 'stage_c_171000_direct_access'; end if;
  end $$;
