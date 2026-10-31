import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const migrationPath=path.join(root,"supabase/migrations/20261018171402_stage_c_safe_defaults_v3.sql");
const migration=fs.readFileSync(migrationPath,"utf8");
const verification=fs.readFileSync(path.join(root,"supabase/verification/20261018171402_verify.sql"),"utf8");
const sha=crypto.createHash("sha256").update(migration).digest("hex").toUpperCase();
const DEFAULT_FIRST="Hay cosas que comprás porque las necesitás. Y hay otras que elegís porque simplemente querés tenerlas. Bienvenido a Cúbica.";

const results=[];
function pass(number,name,detail=""){
  results.push({number,name,status:"PASS",detail});
  console.log(`✓ ${number}. ${name}${detail?`: ${detail}`:""}`);
}

async function database(){
  const db=new PGlite();
  await db.waitReady;
  const version=(await db.query("show server_version")).rows[0].server_version;
  assert.match(String(version),/^17[.]/);
  await db.exec(`
    create schema private;
    create schema auth;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table auth.users(id uuid primary key);

    create table private.site_assets(id uuid primary key default gen_random_uuid(),kind text,path text);
    create table private.site_appearance_versions(
      id bigint generated always as identity primary key,
      state text not null check(state in('draft','published','archived')),
      version integer not null check(version>0),config jsonb not null default '{}',
      created_at timestamptz not null default now(),created_by uuid references auth.users(id),
      published_at timestamptz,published_by uuid references auth.users(id),source_draft_version integer
    );
    create unique index site_appearance_one_draft on private.site_appearance_versions(state) where state='draft';
    create table private.site_campaigns(
      id uuid primary key default gen_random_uuid(),name text not null default 'Campaña',description text not null default '',
      state text not null default 'draft',priority integer not null default 0,recurrence_mode text not null default 'none',
      starts_at timestamptz,ends_at timestamptz,annual_start_month smallint,annual_start_day smallint,annual_start_time time,
      annual_end_month smallint,annual_end_day smallint,annual_end_time time,theme jsonb not null default '{}',
      apply_email_theme boolean not null default false,email_theme_key text,version integer not null default 1,
      created_at timestamptz not null default now(),created_by uuid,updated_at timestamptz not null default now(),updated_by uuid,
      published_at timestamptz,published_by uuid,deleted_at timestamptz,deleted_by uuid
    );
    create table private.site_campaign_occurrences(id bigint generated always as identity primary key,campaign_id uuid references private.site_campaigns(id),starts_at timestamptz,ends_at timestamptz);
    create table private.site_welcome_phrases(
      id bigint generated always as identity primary key,campaign_id uuid references private.site_campaigns(id),
      phrase text not null,active boolean not null default true,sort_order integer not null default 0,version integer not null default 1,
      deleted_at timestamptz,created_at timestamptz not null default now(),created_by uuid,updated_at timestamptz not null default now(),updated_by uuid
    );
    create unique index site_welcome_unique_active_text on private.site_welcome_phrases(
      coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(phrase)
    ) where deleted_at is null;
    create table private.site_campaign_idempotency(request_id uuid primary key,campaign_id uuid,response jsonb);

    create table private.site_content_pages(slug text primary key check(slug in('about','contact','terms','community')),label text not null,created_at timestamptz not null default now());
    create table private.site_content_versions(
      id bigint generated always as identity primary key,page_slug text not null references private.site_content_pages(slug),
      state text not null,version integer not null,title text not null,content jsonb not null default '{}',
      created_at timestamptz not null default now(),created_by uuid,published_at timestamptz,published_by uuid
    );
    create table private.site_faq_items(
      id bigint generated always as identity primary key,question text not null,answer text not null,active boolean not null default true,
      sort_order integer not null default 0,version integer not null default 1,deleted_at timestamptz,
      created_at timestamptz not null default now(),created_by uuid,updated_at timestamptz not null default now(),updated_by uuid
    );
    create table private.site_suggestions(id uuid primary key default gen_random_uuid());
    create table private.suggestion_token_uses(token_hash text primary key,used_at timestamptz,expires_at timestamptz);
    create table private.suggestion_rate_limits(identity_hash text primary key,window_started_at timestamptz,attempts integer,blocked_until timestamptz);
    create table private.suggestion_moderation_history(id bigint generated always as identity primary key,suggestion_id uuid,operation text,created_at timestamptz default now());

    create table public.products(id bigint generated always as identity primary key,name text);
    create table public.orders(id bigint generated always as identity primary key,status text);
    create table public.inventory_movements(id bigint generated always as identity primary key,quantity numeric);

    do $$ declare t text; begin
      foreach t in array array[
        'site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases',
        'site_campaign_idempotency','site_content_pages','site_content_versions','site_faq_items','site_suggestions',
        'suggestion_token_uses','suggestion_rate_limits','suggestion_moderation_history'
      ] loop
        execute format('alter table private.%I enable row level security',t);
        execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
      end loop;
    end $$;
    comment on table private.site_campaigns is 'cubica_stage_c:20261018171000';
    comment on table private.site_suggestions is 'cubica_stage_c:20261018171100';

    create function private.stage_c_validate_theme(jsonb) returns jsonb language plpgsql volatile set search_path='' as $$
    begin
      if jsonb_typeof($1)<>'object' or not ($1 ? 'colors' and $1 ? 'hero' and $1 ? 'assets') then
        raise exception 'Configuración visual inválida';
      end if;
      return $1;
    end $$;
    create function private.stage_c_assert_admin() returns void language plpgsql security definer set search_path='' as $$
    begin
      if current_setting('app.test_admin',true) is distinct from 'true' or current_setting('app.test_aal',true) is distinct from 'aal2' then
        raise exception 'Solo administradores con MFA AAL2' using errcode='42501';
      end if;
    end $$;
    create function private.stage_c_active_campaign(timestamptz) returns private.site_campaigns language sql security definer set search_path='' as $$
      select c from private.site_campaigns c where c.state='published' and c.deleted_at is null order by c.priority desc,c.id limit 1
    $$;
    create function private.stage_c_next_change(timestamptz) returns timestamptz language sql security definer set search_path='' as $$select null::timestamptz$$;
    create function private.get_site_experience(timestamptz) returns jsonb language sql security definer set search_path='' as $$
      select jsonb_build_object(
        'appearance',coalesce((select config from private.site_appearance_versions where state='published' order by published_at desc nulls last,id desc limit 1),jsonb_build_object('fallback',true)),
        'phrases',coalesce((select jsonb_agg(phrase order by sort_order,id) from private.site_welcome_phrases where active and deleted_at is null),'[]'::jsonb),
        'campaign',(select to_jsonb(c) from private.site_campaigns c where c.state='published' and c.deleted_at is null order by c.priority desc,c.id limit 1),
        'pages',coalesce((select jsonb_agg(page_slug order by page_slug) from private.site_content_versions where state='published'),'[]'::jsonb),
        'faq',coalesce((select jsonb_agg(question order by sort_order,id) from private.site_faq_items where active and deleted_at is null),'[]'::jsonb)
      )
    $$;
    create function private.admin_get_site_configuration() returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_restore_faq(bigint,integer) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_update_suggestion(uuid,text,text,integer,text) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    revoke all on all functions in schema private from public,anon,authenticated,service_role;

    comment on function private.stage_c_assert_admin() is 'cubica_stage_c:20261018171210';
    comment on function private.stage_c_active_campaign(timestamptz) is 'cubica_stage_c:20261018171218';
    comment on function private.stage_c_next_change(timestamptz) is 'cubica_stage_c:20261018171223';
    comment on function private.get_site_experience(timestamptz) is 'cubica_stage_c:20261018171231';
    comment on function private.admin_get_site_configuration() is 'cubica_stage_c:20261018171232';
    comment on function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer) is 'cubica_stage_c:20261018171249';
    comment on function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid) is 'cubica_stage_c:20261018171254';
    comment on function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) is 'cubica_stage_c:20261018171255';
    comment on function private.admin_restore_faq(bigint,integer) is 'cubica_stage_c:20261018171256';
    comment on function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid) is 'cubica_stage_c:20261018171258';
    comment on function private.admin_update_suggestion(uuid,text,text,integer,text) is 'cubica_stage_c:20261024233029';
  `);
  return {db,version};
}

async function apply(db){
  await db.exec("begin");
  try{await db.exec(migration);await db.exec("commit");}
  catch(error){await db.exec("rollback");throw error;}
}
const row=async(db,sql,params=[])=>(await db.query(sql,params)).rows[0];
const count=async(db,table)=>(await row(db,`select count(*)::int n from ${table}`)).n;
const snapshot=async db=>(await row(db,`select jsonb_build_object(
  'pages',(select coalesce(jsonb_agg(to_jsonb(x) order by slug),'[]') from private.site_content_pages x),
  'appearance',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from private.site_appearance_versions x),
  'phrases',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from private.site_welcome_phrases x),
  'campaigns',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from private.site_campaigns x),
  'content',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from private.site_content_versions x),
  'faq',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from private.site_faq_items x)
) value`)).value;

{
  const {db,version}=await database();
  await apply(db);
  assert.equal(await count(db,"private.site_content_pages"),4);
  assert.equal(await count(db,"private.site_appearance_versions"),1);
  assert.deepEqual(await row(db,"select count(*)::int total,count(*) filter(where active)::int active from private.site_welcome_phrases"),{total:12,active:0});
  const verified=(await db.query(verification)).rows[0].result;
  assert.equal(verified.sentinel_ok,true);assert.equal(verified.required_pages_ok,true);
  assert.equal(verified.default_phrase_matches,12);assert.equal(verified.defaults_not_automatically_public,true);
  assert.equal(verified.rls_acl_ok,true);assert.equal(verified.premature_public_wrappers,0);
  pass(1,"base sin configuraciones iniciales",`PostgreSQL ${version}; valores seguros creados`);
  await db.close();
}

{
  const {db}=await database();
  await db.exec(`insert into private.site_content_pages values('about','Etiqueta parcial','2024-01-01'); insert into private.site_welcome_phrases(phrase,active,sort_order) values('${DEFAULT_FIRST.replaceAll("'","''")}',false,777)`);
  await apply(db);
  assert.equal(await count(db,"private.site_content_pages"),4);
  assert.equal(await count(db,"private.site_welcome_phrases"),12);
  pass(2,"base parcialmente inicializada");
  const before=await snapshot(db);await apply(db);assert.deepEqual(await snapshot(db),before);
  pass(3,"base completamente inicializada");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("insert into private.site_content_pages values('about','Quiénes somos','2024-02-03')");
  await apply(db);
  assert.deepEqual(await row(db,"select label,created_at::text created_at from private.site_content_pages where slug='about'"),{label:"Quiénes somos",created_at:"2024-02-03 00:00:00+00"});
  pass(4,"etiquetas personalizadas preservadas");
  await db.close();
}

for(const [number,state,active,deleted] of [[5,"soft-delete",false,true],[6,"activa",true,false],[7,"inactiva",false,false]]){
  const {db}=await database();
  await db.query("insert into private.site_welcome_phrases(phrase,active,sort_order,version,deleted_at,updated_at) values($1,$2,987,9,$3,'2024-03-04')",[DEFAULT_FIRST,active,deleted?"2024-03-03":null]);
  const before=await row(db,"select * from private.site_welcome_phrases");
  await apply(db);
  const after=await row(db,"select * from private.site_welcome_phrases where lower(phrase)=lower($1)",[DEFAULT_FIRST]);
  assert.deepEqual(after,before);
  pass(number,`frase existente ${state} preservada`);
  await db.close();
}

for(const [number,state,config] of [[8,"published",{published:true}],[9,"draft",{draft:true}],[10,"archived",{custom:true,assets:{logo:"asset-1"}}]]){
  const {db}=await database();
  await db.query("insert into private.site_appearance_versions(state,version,config,created_at,published_at) values($1,7,$2,'2024-04-01',$3)",[state,config,state==="published"?"2024-04-02":null]);
  const before=await row(db,"select * from private.site_appearance_versions");
  await apply(db);
  assert.equal(await count(db,"private.site_appearance_versions"),1);
  assert.deepEqual(await row(db,"select * from private.site_appearance_versions"),before);
  pass(number,`apariencia ${state} preservada`);
  await db.close();
}

for(const [number,state] of [[11,"published"],[12,"draft"]]){
  const {db}=await database();
  await db.exec("insert into private.site_content_pages values('about','Personalizada','2024-05-01')");
  await db.query("insert into private.site_content_versions(page_slug,state,version,title,content,created_at,published_at) values('about',$1,4,'Título propio','{\"blocks\":[\"propio\"]}','2024-05-02',$2)",[state,state==="published"?"2024-05-03":null]);
  const before=await row(db,"select * from private.site_content_versions");
  await apply(db);assert.deepEqual(await row(db,"select * from private.site_content_versions"),before);
  pass(number,`página ${state} preservada`);
  await db.close();
}

for(const [number,deleted,active,label] of [[13,false,true,"activa"],[14,true,false,"eliminada"]]){
  const {db}=await database();
  await db.query("insert into private.site_faq_items(question,answer,active,version,deleted_at,created_at,updated_at) values('Pregunta propia','Respuesta propia',$1,5,$2,'2024-06-01','2024-06-02')",[active,deleted?"2024-06-03":null]);
  const before=await row(db,"select * from private.site_faq_items");await apply(db);assert.deepEqual(await row(db,"select * from private.site_faq_items"),before);
  pass(number,`FAQ ${label} preservada`);
  await db.close();
}

{
  const {db}=await database();
  await db.exec(`insert into private.site_content_pages values('contact','Contacto especial','2024-07-01'); insert into private.site_content_versions(page_slug,state,version,title,content,created_at) values('contact','archived',8,'Histórico','{"custom":true}','2024-07-02')`);
  const before=await snapshot(db);await apply(db);
  const archived=(await row(db,"select * from private.site_content_versions where page_slug='contact'")).id;
  assert.equal(archived,1);assert.equal((await row(db,"select label from private.site_content_pages where slug='contact'")).label,"Contacto especial");
  assert.equal(before.content[0].version,8);
  pass(15,"contenido legítimo preexistente preservado");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("insert into private.site_campaigns(id,name,state,priority,recurrence_mode,starts_at,ends_at,theme,version,created_at,updated_at) values('00000000-0000-4000-8000-000000000016','Existente','published',9,'none','2026-01-01','2027-01-01','{\"hero\":\"propio\"}',6,'2024-08-01','2024-08-02')");
  const before=await row(db,"select * from private.site_campaigns");await apply(db);assert.deepEqual(await row(db,"select * from private.site_campaigns"),before);
  pass(16,"campaña existente preservada");
  await db.close();
}

{
  const {db}=await database();await apply(db);
  assert.ok((await row(db,"select to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)') is not null ok")).ok);
  assert.ok(!(await row(db,"select to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)') is not null ok")).ok);
  pass(17,"firma definitiva de 4B v2 verificada");
  assert.equal((await row(db,"select obj_description('private.admin_restore_faq(bigint,integer)'::regprocedure,'pg_proc') value")).value,"cubica_stage_c:20261018171256");
  assert.equal((await row(db,"select obj_description('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,'pg_proc') value")).value,null);
  pass(18,"centinela correcto de 5A v2 verificado");
  assert.equal((await row(db,"select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and obj_description(p.oid,'pg_proc') like 'cubica_stage_c:%'" )).n,11);
  pass(19,"todos los centinelas definitivos verificados");
  const before=await snapshot(db);await apply(db);assert.deepEqual(await snapshot(db),before);
  pass(20,"repetición idempotente sin cambios de filas o metadatos");
  const config=(await row(db,"select config from private.site_appearance_versions")).config;
  assert.equal(config.hero.title,"Objetos únicos, impresos en 3D.");assert.equal(config.colors.background,"#17172b");
  pass(21,"configuración JSON válida");
  const experience=(await row(db,"select private.get_site_experience(now()) value")).value;
  assert.deepEqual(experience.phrases,[]);assert.deepEqual(experience.pages,[]);assert.deepEqual(experience.faq,[]);assert.equal(experience.campaign,null);
  pass(22,"ausencia de publicaciones automáticas");
  await db.close();
}

{
  const {db}=await database();
  await db.exec(`insert into private.site_appearance_versions(state,version,config,published_at) values('published',3,'{"custom":"visible"}','2024-09-01'); insert into private.site_welcome_phrases(phrase,active,sort_order) values('Frase autorizada',true,1); insert into private.site_content_pages values('about','About','2024-09-01'); insert into private.site_content_versions(page_slug,state,version,title,content,published_at) values('about','published',1,'Publicado','{}','2024-09-01'); insert into private.site_faq_items(question,answer,active) values('FAQ autorizada','Respuesta autorizada',true)`);
  await apply(db);
  const experience=(await row(db,"select private.get_site_experience(now()) value")).value;
  assert.equal(experience.appearance.custom,"visible");assert.deepEqual(experience.phrases,["Frase autorizada"]);assert.deepEqual(experience.pages,["about"]);assert.deepEqual(experience.faq,["FAQ autorizada"]);
  pass(23,"compatibilidad con futuras lecturas 7A/7B");
  const acl=await db.query("select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'select') a,has_table_privilege('authenticated',c.oid,'select') u,has_table_privilege('service_role',c.oid,'select') s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r'");
  assert.equal(acl.rows.length,13);assert.ok(acl.rows.every(x=>x.relrowsecurity&&!x.a&&!x.u&&!x.s));
  assert.equal((await row(db,"select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'" )).n,0);
  pass(24,"RLS y ACL cerrados; sin wrappers públicos");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("insert into public.products(name) values('Comercial'); insert into public.orders(status) values('pending'); insert into public.inventory_movements(quantity) values(4)");
  const before=await row(db,"select (select count(*)::int from public.products) products,(select count(*)::int from public.orders) orders,(select count(*)::int from public.inventory_movements) movements");
  await apply(db);assert.deepEqual(await row(db,"select (select count(*)::int from public.products) products,(select count(*)::int from public.orders) orders,(select count(*)::int from public.inventory_movements) movements"),before);
  pass(25,"ausencia de modificaciones comerciales");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("comment on function private.admin_restore_faq(bigint,integer) is 'centinela-incorrecto'");
  let error;try{await apply(db);}catch(value){error=value;}
  assert.match(String(error?.message),/stage_c_171402_wrong_sentinel/);assert.equal(await count(db,"private.site_content_pages"),0);assert.equal(await count(db,"private.site_welcome_phrases"),0);
  pass(26,"ROLLBACK completo ante errores");
  await db.close();
}

{
  const {db}=await database();await apply(db);
  assert.equal((await row(db,"select count(*)::int n from private.site_content_pages where label ilike '%QA%' or label ilike '%test%'" )).n,0);
  assert.equal((await row(db,"select count(*)::int n from private.site_welcome_phrases where phrase ilike '%QA%' or phrase ilike '%test%'" )).n,0);
  pass(27,"ausencia de residuos QA");
  await db.close();
}

assert.equal(results.length,27);
console.log(JSON.stringify({result:"PASS_STAGE_C_6_V3_LOCAL",postgres:"17.x/PGlite",sha256:sha,scenarios:results.length},null,2));
