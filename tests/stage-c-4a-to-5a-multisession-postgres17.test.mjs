import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";

const {Client}=pg;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const dbName="stagec_accumulated_concurrency_2";
const base={host:"127.0.0.1",port:55433,user:"postgres",database:dbName};
const ADMIN="00000000-0000-0000-0000-000000000099";
const uuid=n=>`30000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const results=[];
const pass=(block,name,detail="")=>{results.push({block,name,status:"PASS",detail});console.log(`✓ ${block} — ${name}${detail?`: ${detail}`:""}`);};
async function session(){
  const c=new Client(base);await c.connect();
  await c.query("set statement_timeout='8s';set lock_timeout='6s'");
  await c.query("select set_config('app.test_uid',$1,false),set_config('app.test_admin','true',false),set_config('app.test_aal','aal2',false)",[ADMIN]);
  return c;
}
const value=async(c,sql,args=[])=>(await c.query(sql,args)).rows[0]?.value;
const settledPair=async(a,b)=>Promise.allSettled([a,b]);

const admin=new Client({...base,database:"postgres"});await admin.connect();
await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",[dbName]);
await admin.query(`drop database if exists ${dbName}`);await admin.query(`create database ${dbName}`);await admin.end();

const setup=await session();
await setup.query(read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql"));
await setup.query(`
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${ADMIN}');
  create table private.site_campaign_occurrences(
    id bigint generated always as identity primary key,
    campaign_id uuid not null references private.site_campaigns(id) on delete cascade,
    starts_at timestamptz not null,ends_at timestamptz not null,
    created_at timestamptz not null default now(),created_by uuid,
    check(starts_at<ends_at),unique(campaign_id,starts_at,ends_at)
  );
  create table private.site_welcome_phrases(
    id bigint generated always as identity primary key,
    campaign_id uuid references private.site_campaigns(id) on delete cascade,
    phrase text not null check(char_length(btrim(phrase)) between 1 and 500),
    active boolean not null default true,sort_order integer not null default 0,
    version integer not null default 1,deleted_at timestamptz,
    created_at timestamptz not null default now(),created_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
  );
  create index site_welcome_active on private.site_welcome_phrases(campaign_id,sort_order,id) where active and deleted_at is null;
  create unique index site_welcome_unique_active_text on private.site_welcome_phrases(coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(phrase)) where deleted_at is null;
  alter table private.site_welcome_phrases enable row level security;
  revoke all on private.site_welcome_phrases from public,anon,authenticated,service_role;
  create table private.site_content_pages(slug text primary key check(slug in ('about','contact','terms','community')),label text not null,created_at timestamptz not null default now());
  create table private.site_content_versions(
    id bigint generated always as identity primary key,page_slug text not null references private.site_content_pages(slug) on delete restrict,
    state text not null check(state in ('draft','published','archived')),version integer not null check(version>0),
    title text not null check(char_length(btrim(title)) between 1 and 140),content jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),created_by uuid references auth.users(id) on delete set null,
    published_at timestamptz,published_by uuid references auth.users(id) on delete set null,unique(page_slug,state,version)
  );
  create unique index site_content_one_draft on private.site_content_versions(page_slug) where state='draft';
  create index site_content_published on private.site_content_versions(page_slug,published_at desc,id desc) where state='published';
  create table private.site_faq_items(
    id bigint generated always as identity primary key,question text not null check(char_length(btrim(question)) between 3 and 240),
    answer text not null check(char_length(btrim(answer)) between 3 and 3000),active boolean not null default true,
    sort_order integer not null default 0,version integer not null default 1,deleted_at timestamptz,
    created_at timestamptz not null default now(),created_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),updated_by uuid references auth.users(id) on delete set null
  );
  create index site_faq_public on private.site_faq_items(sort_order,id) where active and deleted_at is null;
  create table private.site_suggestions(id bigint primary key);
  alter table private.site_content_pages enable row level security;
  alter table private.site_content_versions enable row level security;
  alter table private.site_faq_items enable row level security;
  revoke all on private.site_content_pages,private.site_content_versions,private.site_faq_items from public,anon,authenticated,service_role;
  comment on table private.site_suggestions is 'cubica_stage_c:20261018171100';
  insert into private.site_content_pages(slug,label) values ('about','Sobre Cúbica'),('contact','Contacto'),('terms','Términos'),('community','Comunidad');
`);
for(const file of [
  "supabase/migrations/20261018171218_stage_c_active_campaign_private_function_v3.sql",
  "supabase/migrations/20261018171223_stage_c_next_change_private_function_v2.sql",
  "supabase/migrations/20261018171231_stage_c_site_experience_private_function.sql",
  "supabase/migrations/20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql",
  "supabase/migrations/20261018171254_stage_c_campaign_admin_private_functions_v2.sql",
  "supabase/migrations/20261018171255_stage_c_phrase_admin_private_function_v2.sql",
  "supabase/migrations/20261018171256_stage_c_content_faq_private_functions_v2.sql"
]) await setup.query(read(file));
await setup.end();

const a=await session(),b=await session();
const theme={colors:{background:"#17172b",panel:"#20213a",panelAlt:"#282a46",text:"#f7f7fb",muted:"#a7a9c0",accent:"#ffffff"},hero:{title:"Cúbica QA",subtitle:"Concurrencia"},assets:{logo:null,banner:null,background:null}};
try{
  // 4A: publicación idempotente y retiro seguro frente a publicación.
  await a.query("truncate private.site_appearance_versions,private.site_assets,storage.objects restart identity cascade");
  const draft=await value(a,"select private.admin_save_site_appearance_draft($1::jsonb,null) value",[JSON.stringify(theme)]);
  const pubs=await settledPair(
    value(a,"select private.admin_publish_site_appearance($1) value",[draft.version]),
    value(b,"select private.admin_publish_site_appearance($1) value",[draft.version])
  );
  assert.ok(pubs.every(x=>x.status==="fulfilled"));
  assert.equal(new Set(pubs.map(x=>x.value.id)).size,1);
  assert.equal((await a.query("select count(*)::int n from private.site_appearance_versions where state='published'")).rows[0].n,1);
  pass("4A v2","dos publicaciones simultáneas","un único publicado y mismo resultado");

  await a.query("truncate private.site_appearance_versions,private.site_assets,storage.objects restart identity cascade");
  const assetPath="11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png";
  await a.query("insert into storage.objects(bucket_id,name,metadata) values('site-assets',$1,jsonb_build_object('mimetype','image/png','size',128))",[assetPath]);
  const asset=await value(a,"select private.admin_register_site_asset('logo','QA',$1,'image/png',128,64,64) value",[assetPath]);
  const withAsset={...theme,assets:{logo:asset.id,banner:null,background:null}};
  const assetDraft=await value(a,"select private.admin_save_site_appearance_draft($1::jsonb,null) value",[JSON.stringify(withAsset)]);
  const retireRace=await settledPair(
    value(a,"select private.admin_publish_site_appearance($1) value",[assetDraft.version]),
    b.query("select private.admin_retire_site_asset($1)",[asset.id])
  );
  assert.equal(retireRace.filter(x=>x.status==="fulfilled").length,1);
  assert.match(String(retireRace.find(x=>x.status==="rejected")?.reason?.message),/uso|utilizado|apariencia/i);
  assert.equal((await a.query("select retired_at is null active from private.site_assets where id=$1",[asset.id])).rows[0].active,true);
  pass("4A v2","retiro y publicación simultáneos","publicación consistente; retiro del recurso en uso rechazado");

  // 4B: idempotencia de creación y control optimista de estado.
  await a.query("truncate private.site_campaign_idempotency,private.site_campaign_occurrences,private.site_welcome_phrases,private.site_campaigns restart identity cascade");
  const createSql=`select private.admin_upsert_site_campaign(null,$1,'',0,'none',$2::timestamptz,$3::timestamptz,null,null,null,null,null,null,$4::jsonb,'[]'::jsonb,0,$5::uuid) value`;
  const createArgs=["Campaña concurrente","2030-01-01T00:00:00-03:00","2030-01-02T00:00:00-03:00",JSON.stringify(theme),uuid(100)];
  const creates=await settledPair(value(a,createSql,createArgs),value(b,createSql,createArgs));
  assert.ok(creates.every(x=>x.status==="fulfilled"));
  assert.equal(new Set(creates.map(x=>x.value.id)).size,1);
  assert.equal((await a.query("select count(*)::int n from private.site_campaigns")).rows[0].n,1);
  const campaignId=creates[0].value.id;
  pass("4B v2","creación idempotente simultánea","una campaña y un resultado compartido");
  const states=await settledPair(
    value(a,"select private.admin_set_site_campaign_state($1,'published',1,$2) value",[campaignId,uuid(101)]),
    value(b,"select private.admin_set_site_campaign_state($1,'disabled',1,$2) value",[campaignId,uuid(102)])
  );
  assert.equal(states.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(states.filter(x=>x.status==="rejected").length,1);
  assert.equal(states.find(x=>x.status==="rejected")?.reason?.code,"40001");
  pass("4B v2","dos cambios de estado con la misma versión","uno confirmado y uno rechazado por versión");

  // 4C: eliminación de campaña contra asociación de frase.
  await a.query("truncate private.site_campaign_idempotency,private.site_campaign_occurrences,private.site_welcome_phrases,private.site_campaigns restart identity cascade");
  const c=await value(a,createSql,["Campaña frase","2031-01-01T00:00:00-03:00","2031-01-02T00:00:00-03:00",JSON.stringify(theme),uuid(110)]);
  const phraseRace=await settledPair(
    a.query("select private.admin_delete_site_campaign($1,1)",[c.id]),
    value(b,"select private.admin_upsert_welcome_phrase(null,$1,'Frase concurrente',true,0,0,false) value",[c.id])
  );
  const finalCampaign=(await a.query("select deleted_at is not null deleted from private.site_campaigns where id=$1",[c.id])).rows[0];
  const activePhrases=(await a.query("select count(*)::int n from private.site_welcome_phrases where campaign_id=$1 and deleted_at is null",[c.id])).rows[0].n;
  assert.equal(finalCampaign.deleted,true);assert.equal(activePhrases,0);
  assert.ok(phraseRace.some(x=>x.status==="fulfilled"));
  pass("4C v2","eliminación de campaña y asociación simultánea","campaña retirada sin frases activas huérfanas");

  // 5A: publicación, unicidad y restauraciones concurrentes.
  await a.query("truncate private.site_content_versions,private.site_faq_items restart identity cascade");
  const contentDraft=await value(a,"select private.admin_save_content_draft('about','Título',$1::jsonb,0) value",[JSON.stringify({body:"Contenido QA"})]);
  const contentPubs=await settledPair(
    value(a,"select private.admin_publish_content_page('about',$1) value",[contentDraft.version]),
    value(b,"select private.admin_publish_content_page('about',$1) value",[contentDraft.version])
  );
  assert.ok(contentPubs.every(x=>x.status==="fulfilled"));assert.equal(new Set(contentPubs.map(x=>x.value.id)).size,1);
  pass("5A v2","dos publicaciones simultáneas","un único publicado por versión de borrador");

  const faqSql="select private.admin_upsert_faq(null,$1,$2,true,0,0,false) value";
  const faqCreates=await settledPair(value(a,faqSql,["¿Pregunta duplicada?","Respuesta A"]),value(b,faqSql,["¿Pregunta duplicada?","Respuesta B"]));
  assert.equal(faqCreates.filter(x=>x.status==="fulfilled").length,1);assert.equal(faqCreates.filter(x=>x.status==="rejected").length,1);
  assert.equal((await a.query("select count(*)::int n from private.site_faq_items where deleted_at is null")).rows[0].n,1);
  pass("5A v2","creación simultánea de FAQ duplicada","una aceptada y una rechazada por unicidad");

  const created=faqCreates.find(x=>x.status==="fulfilled").value;
  const deleted=await value(a,"select private.admin_upsert_faq($1,$2,$3,true,0,$4,true) value",[created.id,created.question,created.answer,created.version]);
  const restoreEdit=await settledPair(
    value(a,"select private.admin_restore_faq($1,$2) value",[deleted.id,deleted.version]),
    value(b,"select private.admin_upsert_faq($1,$2,$3,true,1,$4,false) value",[deleted.id,"¿Pregunta editada?","Respuesta editada",deleted.version])
  );
  assert.equal(restoreEdit.filter(x=>x.status==="fulfilled").length,1);assert.equal(restoreEdit.filter(x=>x.status==="rejected").length,1);
  assert.equal((await a.query("select deleted_at is null restored from private.site_faq_items where id=$1",[deleted.id])).rows[0].restored,true);
  pass("5A v2","restauración contra edición simultánea","restauración confirmada; edición obsoleta rechazada");

  const live=(await a.query("select * from private.site_faq_items where id=$1",[deleted.id])).rows[0];
  const deletedAgain=await value(a,"select private.admin_upsert_faq($1,$2,$3,$4,$5,$6,true) value",[live.id,live.question,live.answer,live.active,live.sort_order,live.version]);
  const restoreDelete=await settledPair(
    value(a,"select private.admin_restore_faq($1,$2) value",[deletedAgain.id,deletedAgain.version]),
    value(b,"select private.admin_upsert_faq($1,$2,$3,$4,$5,$6,true) value",[deletedAgain.id,deletedAgain.question,deletedAgain.answer,deletedAgain.active,deletedAgain.sort_order,deletedAgain.version])
  );
  assert.ok(restoreDelete.some(x=>x.status==="fulfilled"));
  assert.equal((await a.query("select deleted_at is null restored from private.site_faq_items where id=$1",[deletedAgain.id])).rows[0].restored,true);
  pass("5A v2","eliminación repetida contra restauración","estado final restaurado, sin pérdida ni deadlock");

  pass("4A–5A","ausencia de deadlocks","todas las sesiones finalizaron bajo límites de 8s/6s");
}finally{await a.end();await b.end();}

console.log(JSON.stringify({postgres:"17.11",sessions:2,results,passed:results.length,failed:0},null,2));
