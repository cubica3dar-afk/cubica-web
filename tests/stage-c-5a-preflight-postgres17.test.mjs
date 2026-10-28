import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql");
const migration=read("supabase/archive/20261018171301_stage_c_content_faq_private_functions.pre_idempotency.sql");
const verification=read("supabase/archive/20261018171301_verify.pre_idempotency.sql");

const ADMIN="00000000-0000-0000-0000-000000000099";
const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(r=>r.rows);
assert.match(String(server_version),/^17[.]/);
await db.exec(bootstrap);
await db.exec(`
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${ADMIN}');
  create table private.site_content_pages(
    slug text primary key check(slug in ('about','contact','terms','community')),
    label text not null,
    created_at timestamptz not null default now()
  );
  create table private.site_content_versions(
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
  create unique index site_content_one_draft on private.site_content_versions(page_slug) where state='draft';
  create index site_content_published on private.site_content_versions(page_slug,published_at desc,id desc) where state='published';
  create table private.site_faq_items(
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
  create index site_faq_public on private.site_faq_items(sort_order,id) where active and deleted_at is null;
  alter table private.site_content_pages enable row level security;
  alter table private.site_content_versions enable row level security;
  alter table private.site_faq_items enable row level security;
  revoke all on private.site_content_pages,private.site_content_versions,private.site_faq_items from public,anon,authenticated,service_role;
  insert into private.site_content_pages(slug,label) values
    ('about','Sobre Cúbica'),('contact','Contacto'),('terms','Términos y condiciones'),('community','Normas de Comunidad');
`);
await db.exec(migration);

const results=[];
const pass=name=>{results.push({name,status:"APROBADA"});console.log(`✓ ${name}`);};
const fail=(name,detail)=>{results.push({name,status:"FALLIDA",detail});console.log(`✗ ${name}: ${detail}`);};
const noRun=(name,detail)=>{results.push({name,status:"NO EJECUTADA",detail});console.log(`○ ${name}: ${detail}`);};
let sp=0;
async function rejected(sql,params=[],pattern,code){
  const name=`sp_${++sp}`;await db.exec(`savepoint ${name}`);let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  await db.exec(`rollback to savepoint ${name}; release savepoint ${name}`);
  assert.ok(error,"La operación debía ser rechazada");
  if(pattern)assert.match(String(error.message),pattern);if(code)assert.equal(error.code,code);return error;
}
const call=async(sql,params=[])=>(await db.query(sql,params)).rows[0]?.value;

const shapes=await db.query(`
  select p.oid::regprocedure::text identity,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') service_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['get_public_content_page','get_public_faq','stage_c_validate_content','admin_save_content_draft','admin_publish_content_page','admin_restore_content_version','admin_upsert_faq'])
`);
assert.equal(shapes.rows.length,7);
for(const row of shapes.rows){
  assert.deepEqual(row.proconfig,["search_path=\"\""]);assert.equal(row.public_execute,false);
  assert.equal(row.anon_execute,false);assert.equal(row.authenticated_execute,false);assert.equal(row.service_execute,false);
  assert.equal(row.prosecdef,!row.identity.endsWith("stage_c_validate_content(jsonb)"));
}
pass("funciones cerradas, search_path restringido y modos de seguridad correctos");

await db.exec("begin");
try{
  const draft=await call("select private.admin_save_content_draft('about','Sobre Cúbica',$1::jsonb,0) value",[JSON.stringify({body:"**Hola**\n\n[Web](https://cubica3d.ar)",email:"contacto@cubica3d.ar"})]);
  assert.equal(draft.state,"draft");assert.equal(await call("select private.get_public_content_page('about') value"),null);
  pass("crear borrador no lo expone públicamente");

  const published=await call("select private.admin_publish_content_page('about',$1) value",[draft.version]);
  assert.equal(published.state,"published");assert.equal((await call("select private.get_public_content_page('about') value")).title,"Sobre Cúbica");
  pass("publicación explícita crea una versión pública");

  const edited=await call("select private.admin_save_content_draft('about','Sobre Cúbica editado',$1::jsonb,$2) value",[JSON.stringify({body:"Cambio aún privado"}),draft.version]);
  assert.equal((await call("select private.get_public_content_page('about') value")).title,"Sobre Cúbica");
  await rejected("select private.admin_save_content_draft('about','Obsoleto',$1::jsonb,$2)",[JSON.stringify({body:"No"}),draft.version],/borrador cambió/i,"40001");
  pass("edición posterior no altera lo público y revisión obsoleta se rechaza");

  const beforeRepeat=(await db.query("select count(*)::int n from private.site_content_versions where page_slug='about' and state in ('published','archived')")).rows[0].n;
  await call("select private.admin_publish_content_page('about',$1) value",[edited.version]);
  await call("select private.admin_publish_content_page('about',$1) value",[edited.version]);
  const afterRepeat=(await db.query("select count(*)::int n from private.site_content_versions where page_slug='about' and state in ('published','archived')")).rows[0].n;
  if(afterRepeat===beforeRepeat+1)pass("publicación repetida es idempotente");
  else fail("publicación repetida es idempotente",`el mismo borrador creó ${afterRepeat-beforeRepeat} versiones en vez de 1`);

  for(const payload of ["<script>alert(1)</script>","<img src=x onerror=alert(1)>","[x](javascript:alert(1))","<iframe src=https://evil.test>"]){
    await rejected("select private.stage_c_validate_content($1::jsonb)",[JSON.stringify({body:payload})],/HTML o código no permitido/i);
  }
  await rejected("select private.stage_c_validate_content($1::jsonb)",[JSON.stringify({body:"ok",instagram:"http://instagram.com/cubica"})],/Instagram inválido/i);
  await rejected("select private.stage_c_validate_content($1::jsonb)",[JSON.stringify({body:"ok",unknown:"x"})],/Contenido inválido/i);
  pass("payloads ejecutables, protocolos no admitidos y campos desconocidos rechazados");

  const faq1=await call("select private.admin_upsert_faq(null,'¿Cómo retiro?','Coordinamos **día y horario**.',true,20,0,false) value");
  const faq2=await call("select private.admin_upsert_faq(null,'¿Cuánto demora?','Depende del producto.',true,10,0,false) value");
  assert.deepEqual((await call("select private.get_public_faq() value")).map(x=>x.id),[faq2.id,faq1.id]);
  const deleted=await call("select private.admin_upsert_faq($1,$2,$3,$4,$5,$6,true) value",[faq1.id,faq1.question,faq1.answer,faq1.active,faq1.sort_order,faq1.version]);
  assert.deepEqual((await call("select private.get_public_faq() value")).map(x=>x.id),[faq2.id]);
  const restored=await call("select private.admin_upsert_faq($1,$2,$3,true,$4,$5,false) value",[deleted.id,deleted.question,deleted.answer,deleted.sort_order,deleted.version]);
  assert.equal(restored.deleted_at,null);
  await rejected("select private.admin_upsert_faq($1,$2,$3,true,$4,$5,false)",[restored.id,restored.question,restored.answer,restored.sort_order,restored.version-1],/pregunta cambió/i,"40001");
  pass("FAQ ordena, elimina lógicamente, restaura y rechaza revisión obsoleta");

  const duplicate=await call("select private.admin_upsert_faq(null,$1,$2,true,20,0,false) value",[restored.question,restored.answer]);
  if(!duplicate)pass("FAQ duplicada rechazada");else fail("FAQ duplicada rechazada","se creó una segunda pregunta idéntica activa");

  await db.exec("select set_config('app.test_aal','aal1',false)");
  await rejected("select private.admin_save_content_draft('contact','Contacto',$1::jsonb,0)",[JSON.stringify({body:"Privado"})],/MFA AAL2/i,"42501");
  await db.exec("select set_config('app.test_aal','aal2',false)");
  pass("administrador AAL1 rechazado por el guard central");
} finally {await db.exec("rollback");}

assert.equal((await db.query("select count(*)::int n from private.site_content_versions")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from private.site_faq_items")).rows[0].n,0);
pass("ROLLBACK sin residuos QA");

let verificationError;
try{await db.query(verification);}catch(error){verificationError=error;}
if(verificationError)fail("script de verificación posterior ejecutable",String(verificationError.message));else pass("script de verificación posterior ejecutable");

const source=read("js/site-experience.js");
const events=[];
const context={console,URL,URLSearchParams,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},location:{href:"https://cubica3d.ar/",search:""},history:{pushState(){}},confirm:()=>false,
  document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener:(name,fn)=>events.push([name,fn])},
  window:{addEventListener(){}}};context.window.window=context.window;context.window.document=context.document;context.window.location=context.location;context.window.history=context.history;
vm.runInNewContext(source,context,{filename:"js/site-experience.js"});
const rendered=context.window.cubicaSiteExperience.renderMarkdown(`<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[ok](https://cubica3d.ar/?q=\"x\")`);
assert.doesNotMatch(rendered,/<img\b|href="javascript:/i);assert.match(rendered,/&lt;img[^<]*onerror=/);assert.match(rendered,/href="https:\/\/cubica3d\.ar\/\?q=&quot;x&quot;"/);
pass("frontend escapa HTML y solo convierte enlaces https/mailto");

noRun("concurrencia multisesión de publicación y edición","PGlite 17.5 ofrece una sola sesión independiente");
console.log(`\nPostgreSQL aislado: ${server_version}`);
console.log(JSON.stringify({results},null,2));
await db.close();
