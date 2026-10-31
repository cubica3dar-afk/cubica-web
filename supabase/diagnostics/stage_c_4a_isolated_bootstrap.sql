-- CÚBICA 3D — bootstrap local para validar 4A v2.
-- EJECUTAR ÚNICAMENTE EN PostgreSQL 17 DESCARTABLE.

create schema private;
create schema auth;
create schema extensions;
create schema storage;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create function auth.uid()
returns uuid language sql stable set search_path='' as $$
  select nullif(current_setting('app.test_uid',true),'')::uuid;
$$;

create function extensions.gen_random_uuid()
returns uuid language sql volatile set search_path='' as $$
  select pg_catalog.gen_random_uuid();
$$;

create table storage.objects(
  id uuid primary key default pg_catalog.gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz,
  metadata jsonb,
  path_tokens text[],
  version text,
  owner_id text,
  user_metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean not null default false,
  is_versioned boolean not null default false,
  unique(bucket_id,name)
);

create table private.site_assets(
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null check(kind in ('logo','banner','background','campaign')),
  label text not null check(char_length(btrim(label)) between 1 and 120),
  storage_path text not null unique check(storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$'),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 8388608),
  width integer not null check(width between 1 and 8192),
  height integer not null check(height between 1 and 8192),
  created_at timestamptz not null default now(),
  created_by uuid,
  retired_at timestamptz,
  retired_by uuid,
  public_since timestamptz,
  constraint site_assets_retirement check((retired_at is null)=(retired_by is null))
);

create table private.site_appearance_versions(
  id bigint generated always as identity primary key,
  state text not null check(state in ('draft','published','archived')),
  version integer not null check(version>0),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  published_at timestamptz,
  published_by uuid
);
create unique index site_appearance_one_draft on private.site_appearance_versions(state) where state='draft';
create unique index site_appearance_state_version on private.site_appearance_versions(state,version);
create index site_appearance_published on private.site_appearance_versions(published_at desc,id desc) where state='published';

create table private.site_campaigns(
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  description text not null default '',
  state text not null default 'draft' check(state in ('draft','published','disabled')),
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

create function private.stage_c_assert_admin()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('app.test_admin',true) is distinct from 'true'
    or current_setting('app.test_aal',true) is distinct from 'aal2'
    or auth.uid() is null then
    raise exception 'Solo administradores con MFA AAL2' using errcode='42501';
  end if;
end;
$$;

create function private.stage_c_safe_text(p_value text,p_max integer,p_required boolean default false)
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

create function private.stage_c_luminance(p_hex text)
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

create function private.stage_c_validate_theme(p_config jsonb)
returns jsonb language sql stable set search_path='' as $$ select coalesce(p_config,'{}'::jsonb); $$;

revoke all on function private.stage_c_assert_admin() from public,anon,authenticated,service_role;
revoke all on function private.stage_c_safe_text(text,integer,boolean) from public,anon,authenticated,service_role;
revoke all on function private.stage_c_luminance(text) from public,anon,authenticated,service_role;
revoke all on function private.stage_c_validate_theme(jsonb) from public,anon,authenticated,service_role;
comment on function private.stage_c_assert_admin() is 'cubica_stage_c:20261018171210';

select set_config('app.test_uid','00000000-0000-0000-0000-000000000099',false);
select set_config('app.test_admin','true',false);
select set_config('app.test_aal','aal2',false);
