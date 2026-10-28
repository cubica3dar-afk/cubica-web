-- CÚBICA 3D — bootstrap local para diagnosticar 3B-1.
-- EJECUTAR ÚNICAMENTE EN UNA BASE POSTGRESQL 17 DESCARTABLE.
-- No contiene datos reales ni requiere conexión con producción.

\set ON_ERROR_STOP on

begin;

create schema private;
create schema auth;
create schema extensions;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create function auth.uid()
returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000099'::uuid;
$$;

create function extensions.gen_random_uuid()
returns uuid language sql volatile as $$
  select pg_catalog.gen_random_uuid();
$$;

create table private.site_campaigns(
  id uuid primary key,
  name text not null,
  description text not null default '',
  state text not null default 'draft',
  priority integer not null default 0,
  recurrence_mode text not null default 'none',
  starts_at timestamptz,
  ends_at timestamptz,
  annual_start_month smallint,
  annual_start_day smallint,
  annual_start_time time,
  annual_end_month smallint,
  annual_end_day smallint,
  annual_end_time time,
  theme jsonb not null default '{}'::jsonb,
  apply_email_theme boolean not null default false,
  email_theme_key text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  published_at timestamptz,
  published_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

create table private.site_campaign_occurrences(
  id bigint generated always as identity primary key,
  campaign_id uuid not null references private.site_campaigns(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  check(starts_at < ends_at),
  unique(campaign_id,starts_at,ends_at)
);

create table private.site_appearance_versions(
  id bigint generated always as identity primary key,
  state text not null default 'draft',
  config jsonb not null default '{}'::jsonb,
  published_at timestamptz
);

create table private.site_welcome_phrases(
  id bigint generated always as identity primary key,
  campaign_id uuid references private.site_campaigns(id) on delete cascade,
  phrase text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  deleted_at timestamptz
);

create function private.stage_c_assert_admin()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  return;
end;
$$;

revoke all on function private.stage_c_assert_admin() from public,anon,authenticated,service_role;
comment on function private.stage_c_assert_admin() is 'cubica_stage_c:20261018171210';

create function private.stage_c_asset_paths(p_config jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select '{}'::jsonb;
$$;

revoke all on function private.stage_c_asset_paths(jsonb) from public,anon,authenticated,service_role;
comment on function private.stage_c_asset_paths(jsonb) is 'cubica_stage_c:20261018171210';

create function private.stage_c_safe_text(p_value text,p_max integer,p_required boolean default false)
returns text language sql immutable set search_path='' as $$
  select case when p_required and btrim(coalesce(p_value,''))='' then null else left(btrim(coalesce(p_value,'')),p_max) end;
$$;

create function private.stage_c_validate_theme(p_theme jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(p_theme,'{}'::jsonb);
$$;

commit;

-- Siguiente paso, desde la raíz del proyecto:
-- psql --set ON_ERROR_STOP=1 --file supabase/archive/20261018171221_stage_c_active_campaign_private_function.invalid_return.sql <base_descartable>
--
-- Resultado a guardar:
-- 1. código SQLSTATE y mensaje exacto;
-- 2. si la función llegó a existir;
-- 3. confirmar que la función no existe tras el error original.

