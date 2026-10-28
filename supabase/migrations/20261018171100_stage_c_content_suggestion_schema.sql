-- CÚBICA 3D — Etapa C, bloque 2/7: contenidos, sugerencias y bucket privado.

-- Estado intermedio seguro: no crea RPC ni políticas públicas de Storage.

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

do $$ declare t text; begin
  foreach t in array array['site_content_pages','site_content_versions','site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('drop policy if exists %I on private.%I','stage_c_deny_'||t,t);
    execute format('create policy %I on private.%I for all to anon,authenticated using(false) with check(false)','stage_c_deny_'||t,t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('site-assets','site-assets',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=excluded.allowed_mime_types;

comment on table private.site_suggestions is 'cubica_stage_c:20261018171100';

do $$ begin
    if to_regclass('private.site_content_versions') is null or to_regclass('private.site_suggestions') is null then raise exception 'stage_c_171100_missing_tables'; end if;
    if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any(array['site_content_pages','site_content_versions','site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits']) and not c.relrowsecurity) then raise exception 'stage_c_171100_rls_disabled'; end if;
    if has_table_privilege('anon','private.site_suggestions','select') or has_table_privilege('authenticated','private.site_content_versions','select') then raise exception 'stage_c_171100_direct_access'; end if;
    if not exists(select 1 from storage.buckets where id='site-assets' and public=false and file_size_limit=8388608) then raise exception 'stage_c_171100_private_bucket'; end if;
  end $$;
