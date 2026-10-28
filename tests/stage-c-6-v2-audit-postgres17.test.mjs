import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const migrationPath=path.join(root,"supabase/archive/20261018171401_stage_c_safe_defaults_v2.rejected.sql");
const migration=fs.readFileSync(migrationPath,"utf8");
assert.equal(crypto.createHash("sha256").update(migration).digest("hex").toUpperCase(),"7359EAF312C72F12A84C1FB607E4FFE1021B3C1C660A94D7900FBA3F43A8E813");

const dependencies=[
  ["get_site_experience(timestamptz)","20261018171231"],
  ["admin_get_site_configuration()","20261018171232"],
  ["admin_register_site_asset(text,text,text,text,bigint,integer,integer)","20261018171249"],
  ["admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)","20261018171254"],
  ["admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)","20261018171255"],
  ["admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)","20261018171256"],
  ["submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)","20261018171258"],
  ["admin_update_suggestion(uuid,text,text,integer,text)","20261024233029"]
];

async function database(){
  const db=new PGlite();
  await db.waitReady;
  const version=(await db.query("show server_version")).rows[0].server_version;
  assert.match(String(version),/^17[.]/);
  await db.exec(`
    create schema private;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table private.site_content_pages(
      slug text primary key check(slug in('about','contact','terms','community')),
      label text not null,
      created_at timestamptz not null default now()
    );
    create table private.site_content_versions(id bigint generated always as identity primary key);
    create table private.site_appearance_versions(
      id bigint generated always as identity primary key,
      state text not null check(state in('draft','published','archived')),
      version integer not null,
      config jsonb not null
    );
    create table private.site_campaigns(id uuid primary key);
    create table private.site_faq_items(id bigint generated always as identity primary key);
    create table private.site_suggestions(id uuid primary key);
    create table private.site_welcome_phrases(
      id bigint generated always as identity primary key,
      campaign_id uuid,
      phrase text not null,
      active boolean not null default true,
      sort_order integer not null default 0,
      deleted_at timestamptz
    );
    create unique index site_welcome_unique_active_text
      on private.site_welcome_phrases(coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(phrase))
      where deleted_at is null;
    alter table private.site_content_pages enable row level security;
    alter table private.site_content_versions enable row level security;
    alter table private.site_appearance_versions enable row level security;
    alter table private.site_campaigns enable row level security;
    alter table private.site_faq_items enable row level security;
    alter table private.site_suggestions enable row level security;
    alter table private.site_welcome_phrases enable row level security;
    revoke all on all tables in schema private from public,anon,authenticated,service_role;

    create function private.get_site_experience(timestamptz) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_get_site_configuration() returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    create function private.admin_update_suggestion(uuid,text,text,integer,text) returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
    revoke all on all functions in schema private from public,anon,authenticated,service_role;
  `);
  for(const [signature,sentinel] of dependencies){
    await db.exec(`comment on function private.${signature} is 'cubica_stage_c:${sentinel}'`);
  }
  return {db,version};
}

async function apply(db){
  await db.exec("begin");
  try{
    await db.exec(migration);
    await db.exec("commit");
  }catch(error){
    await db.exec("rollback");
    throw error;
  }
}

const row=async(db,sql)=>(await db.query(sql)).rows[0];
const results=[];
const record=(name,status,detail="")=>{
  results.push({name,status,detail});
  console.log(`${status==="PASS"?"✓":"!"} ${status} — ${name}${detail?`: ${detail}`:""}`);
};

{
  const {db,version}=await database();
  await apply(db);
  assert.deepEqual(await row(db,`select
    (select count(*)::int from private.site_content_pages) pages,
    (select count(*)::int from private.site_content_versions) content_versions,
    (select count(*)::int from private.site_appearance_versions where state='draft') drafts,
    (select count(*)::int from private.site_campaigns) campaigns,
    (select count(*)::int from private.site_faq_items) faq,
    (select count(*)::int from private.site_suggestions) suggestions,
    (select count(*)::int from private.site_welcome_phrases where active and deleted_at is null) phrases
  `),{pages:4,content_versions:0,drafts:1,campaigns:0,faq:0,suggestions:0,phrases:12});
  const config=(await row(db,"select config from private.site_appearance_versions where state='draft'")).config;
  assert.equal(config.hero.title,"Objetos únicos, impresos en 3D.");
  assert.deepEqual(config.assets,{logo:null,banner:null,background:null});
  assert.equal((await row(db,"select obj_description('private.site_content_pages'::regclass,'pg_class') sentinel")).sentinel,"cubica_stage_c:20261018171401");
  await apply(db);
  assert.equal((await row(db,"select count(*)::int n from private.site_welcome_phrases")).n,12);
  record("instalación vacía e idempotencia básica en PostgreSQL 17","PASS",`PGlite ${version}; 4 páginas, 1 borrador y 12 frases`);
  record("publicación diferida de frases predeterminadas","BLOCKER","las 12 frases nacen active=true y get_site_experience las entregará al habilitar 7B, sin una publicación administrativa separada");
  await db.close();
}

{
  const {db}=await database();
  await apply(db);
  await db.exec("update private.site_content_pages set label='Quiénes somos' where slug='about'");
  await apply(db);
  assert.equal((await row(db,"select label from private.site_content_pages where slug='about'")).label,"Sobre Cúbica");
  record("preservación de configuración administrativa existente","BLOCKER","un reintento reemplaza la etiqueta personalizada 'Quiénes somos' por el valor predeterminado");
  await db.close();
}

{
  const {db}=await database();
  await apply(db);
  await db.exec("update private.site_welcome_phrases set deleted_at=now(),active=false where sort_order=10");
  await apply(db);
  const counts=await row(db,"select count(*)::int total,count(*) filter(where active and deleted_at is null)::int active from private.site_welcome_phrases");
  assert.deepEqual(counts,{total:13,active:12});
  record("respeto de soft-delete en valores predeterminados","BLOCKER","una frase eliminada lógicamente se recrea activa al reejecutar el bloque");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("insert into private.site_appearance_versions(state,version,config) values('published',1,'{}')");
  let error;
  try{await apply(db);}catch(value){error=value;}
  assert.match(String(error?.message),/stage_c_171401_appearance/);
  assert.equal((await row(db,"select count(*)::int n from private.site_content_pages")).n,0);
  assert.equal((await row(db,"select count(*)::int n from private.site_appearance_versions")).n,1);
  record("estado legítimo con apariencia publicada","BLOCKER","el bloque revierte por completo si ya existe una apariencia publicada y no crea el borrador seguro");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("insert into private.site_content_versions default values");
  let error;
  try{await apply(db);}catch(value){error=value;}
  assert.match(String(error?.message),/stage_c_171401_content_published/);
  assert.equal((await row(db,"select count(*)::int n from private.site_content_versions")).n,1);
  assert.equal((await row(db,"select count(*)::int n from private.site_content_pages")).n,0);
  record("contenido legítimo preexistente","BLOCKER","el bloque exige que no exista ninguna versión de contenido y aborta, aunque la conserva por ROLLBACK");
  await db.close();
}

{
  const {db}=await database();
  await db.exec("comment on function private.admin_get_site_configuration() is 'cubica_stage_c:incorrecto'");
  let error;
  try{await apply(db);}catch(value){error=value;}
  assert.match(String(error?.message),/missing_prerequisite/);
  assert.equal((await row(db,"select count(*)::int n from private.site_content_pages")).n,0);
  record("dependencias y atomicidad ante error","PASS","un centinela incorrecto impide toda inserción");
  await db.close();
}

{
  const {db}=await database();
  await apply(db);
  const security=await db.query(`
    select c.relname,c.relrowsecurity,
      has_table_privilege('anon',c.oid,'select') anon_select,
      has_table_privilege('authenticated',c.oid,'select') authenticated_select,
      has_table_privilege('service_role',c.oid,'select') service_select
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relkind='r'
    order by c.relname
  `);
  assert.ok(security.rows.every(item=>item.relrowsecurity && !item.anon_select && !item.authenticated_select && !item.service_select));
  assert.equal((await row(db,"select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).n,0);
  record("RLS, ACL y superficie pública","PASS","el bloque no crea wrappers ni concede permisos y conserva las tablas cerradas");
  await db.close();
}

{
  const campaignSource=fs.readFileSync(path.join(root,"supabase/migrations/20261018171254_stage_c_campaign_admin_private_functions_v2.sql"),"utf8");
  assert.match(campaignSource,/comment on function private\.admin_upsert_site_campaign\(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid\)/);
  assert.doesNotMatch(migration,/admin_upsert_site_campaign\(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid\)/);
  record("dependencia de campañas instalada","BLOCKER","el bloque 6 busca la firma antigua de 16 argumentos, pero 4B v2 instaló la firma vigente de 17 argumentos con request_id");
}

{
  const faqSource=fs.readFileSync(path.join(root,"supabase/migrations/20261018171256_stage_c_content_faq_private_functions_v2.sql"),"utf8");
  assert.match(faqSource,/comment on function private\.admin_restore_faq\(bigint,integer\) is 'cubica_stage_c:20261018171256'/);
  assert.doesNotMatch(faqSource,/comment on function private\.admin_upsert_faq\(bigint,text,text,boolean,integer,integer,boolean\)/);
  record("centinela de contenidos y FAQ instalado","BLOCKER","5A v2 coloca el centinela en admin_restore_faq, pero el bloque 6 lo exige en admin_upsert_faq; en producción ese comentario es nulo");
}

const blockers=results.filter(item=>item.status==="BLOCKER");
assert.equal(blockers.length,7);
console.log(JSON.stringify({result:"BLOCKED_BEFORE_REMOTE_PREFLIGHT",tests:results.length,blockers:blockers.map(item=>item.name)},null,2));
