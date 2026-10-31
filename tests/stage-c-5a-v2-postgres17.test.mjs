import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql");
const migration=read("supabase/migrations/20261018171256_stage_c_content_faq_private_functions_v2.sql");
const verification=read("supabase/verification/20261018171256_verify.sql");
const recovery=read("supabase/rollback/20261018171256_stage_c_content_faq_private_functions_v2.sql");
const ADMIN="00000000-0000-0000-0000-000000000099";

const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(result=>result.rows);
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
  create table private.site_suggestions(id bigint primary key);
  alter table private.site_content_pages enable row level security;
  alter table private.site_content_versions enable row level security;
  alter table private.site_faq_items enable row level security;
  revoke all on private.site_content_pages,private.site_content_versions,private.site_faq_items from public,anon,authenticated,service_role;
  comment on table private.site_suggestions is 'cubica_stage_c:20261018171100';
  insert into private.site_content_pages(slug,label) values
    ('about','Sobre Cúbica'),('contact','Contacto'),('terms','Términos y condiciones'),('community','Normas de Comunidad');
`);
await db.exec(migration);

const results=[];
const pass=name=>{results.push({name,status:"APROBADA"});console.log(`✓ ${name}`);};
const noRun=(name,detail)=>{results.push({name,status:"NO EJECUTADA",detail});console.log(`○ ${name}: ${detail}`);};
let savepoint=0;
async function rejected(sql,params=[],pattern,code){
  const name=`expected_${++savepoint}`;await db.exec(`savepoint ${name}`);let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  await db.exec(`rollback to savepoint ${name}; release savepoint ${name}`);
  assert.ok(error,"La operación debía rechazarse");
  if(pattern)assert.match(String(error.message),pattern);if(code)assert.equal(error.code,code);return error;
}
const value=async(sql,params=[])=>(await db.query(sql,params)).rows[0]?.value;
const saveDraft=(slug,title,content,expected)=>value(
  "select private.admin_save_content_draft($1,$2,$3::jsonb,$4) value",
  [slug,title,JSON.stringify(content),expected]
);
const publish=(slug,expected)=>value("select private.admin_publish_content_page($1,$2) value",[slug,expected]);
const upsertFaq=({id=null,question="¿Cómo retiro?",answer="Coordinamos día y horario.",active=true,order=0,expected=0,remove=false}={})=>value(
  "select private.admin_upsert_faq($1,$2,$3,$4,$5,$6,$7) value",
  [id,question,answer,active,order,expected,remove]
);

const verificationReport=(await db.query(verification)).rows[0].jsonb_build_object;
assert.equal(verificationReport.sentinel_ok,true);
assert.equal(verificationReport.source_draft_version,true);
assert.equal(verificationReport.publish_idempotency_index,true);
assert.equal(verificationReport.faq_uniqueness_index,true);
assert.equal(verificationReport.objects.length,10);
for(const item of verificationReport.objects){
  assert.equal(item.exists,true);assert.equal(item.security_mode_ok,true);assert.equal(item.search_path_restricted,true);
  assert.equal(item.public_execute,false);assert.equal(item.anon_execute,false);assert.equal(item.authenticated_execute,false);assert.equal(item.service_role_execute,false);
}
pass("24. firmas, centinela, índices, SECURITY DEFINER/INVOKER, search_path y ACL correctos");

await db.exec("begin");
try{
  const first=await saveDraft("about","Sobre Cúbica",{body:"Primera versión"},0);
  assert.equal(first.version,1);assert.equal(await value("select private.get_public_content_page('about') value"),null);
  pass("1. creación de borrador privada");

  const edited=await saveDraft("about","Sobre Cúbica",{body:"Segunda versión"},first.version);
  assert.equal(edited.version,2);
  const noChange=await saveDraft("about","Sobre Cúbica",{body:"Segunda versión"},edited.version);
  assert.equal(noChange.version,edited.version);
  pass("2. edición incrementa; repetición idéntica no incrementa");

  const published=await publish("about",edited.version);
  assert.equal(published.version,1);assert.equal(published.source_draft_version,edited.version);
  pass("3. publicación inicial registra la revisión fuente");

  const repeated=await publish("about",edited.version);
  assert.equal(repeated.id,published.id);assert.equal(repeated.version,published.version);assert.equal(repeated.published_at,published.published_at);
  assert.equal((await db.query("select count(*)::int n from private.site_content_versions where page_slug='about' and state in('published','archived')")).rows[0].n,1);
  pass("4. publicación repetida es idempotente");

  const third=await saveDraft("about","Sobre Cúbica renovada",{body:"Tercera versión"},edited.version);
  const stillPublic=await value("select private.get_public_content_page('about') value");
  assert.equal(stillPublic.title,"Sobre Cúbica");assert.equal(stillPublic.content.body,"Segunda versión");
  const republished=await publish("about",third.version);
  assert.equal(republished.version,2);assert.equal(republished.source_draft_version,third.version);
  assert.deepEqual((await db.query("select state,version,source_draft_version from private.site_content_versions where page_slug='about' and state<>'draft' order by version")).rows,[
    {state:"archived",version:1,source_draft_version:2},{state:"published",version:2,source_draft_version:3}
  ]);
  pass("5 y 7. edición posterior publica una versión nueva sin filtrar el borrador");

  await rejected("select private.admin_save_content_draft('about','Obsoleto',$1::jsonb,$2)",[JSON.stringify({body:"No"}),edited.version],/borrador cambió/i,"40001");
  await rejected("select private.admin_publish_content_page('about',$1)",[edited.version],/borrador cambió/i,"40001");
  pass("6. revisiones obsoletas rechazadas");

  const faq=await upsertFaq({question:"¿Cómo retiro?",answer:"Coordinamos **día y horario**.",active:true,order:20});
  assert.equal(faq.version,1);assert.equal((await value("select private.get_public_faq() value")).length,1);
  pass("8. creación de FAQ válida");

  await rejected("select private.admin_upsert_faq(null,'  ¿CÓMO   RETIRO?  ','Otra respuesta',true,30,0,false)",[],/misma pregunta/i,"23505");
  pass("9. duplicado por espacios y mayúsculas rechazado");

  const similar=await upsertFaq({question:"¿Cómo retiro un pedido personalizado?",answer:"Coordinamos de forma individual.",active:true,order:10});
  assert.ok(similar.id!==faq.id);
  pass("10. pregunta similar pero distinta aceptada");

  const faqEdited=await upsertFaq({id:faq.id,question:faq.question,answer:"Nuevo horario coordinado.",active:true,order:5,expected:faq.version});
  assert.equal(faqEdited.version,2);assert.equal(faqEdited.sort_order,5);
  const faqNoop=await upsertFaq({id:faqEdited.id,question:faqEdited.question,answer:faqEdited.answer,active:faqEdited.active,order:faqEdited.sort_order,expected:faqEdited.version});
  assert.equal(faqNoop.version,faqEdited.version);
  pass("11 y 17. edición, ordenamiento y repetición sin cambios correctos");

  const removed=await upsertFaq({id:faqEdited.id,question:faqEdited.question,answer:faqEdited.answer,active:true,order:faqEdited.sort_order,expected:faqEdited.version,remove:true});
  assert.ok(removed.deleted_at);assert.equal(removed.active,false);
  assert.ok(!(await value("select private.get_public_faq() value")).some(item=>item.id===removed.id));
  pass("12. eliminación lógica oculta la FAQ pública");

  const currentOnly=await value("select private.admin_list_faq(false) value");
  const withDeleted=await value("select private.admin_list_faq(true) value");
  assert.ok(!currentOnly.some(item=>item.id===removed.id));assert.ok(withDeleted.find(item=>item.id===removed.id)?.deleted);
  pass("13. consulta administrativa diferencia eliminadas");

  const restored=await value("select private.admin_restore_faq($1,$2) value",[removed.id,removed.version]);
  assert.equal(restored.deleted_at,null);assert.equal(restored.active,false);
  assert.ok(!(await value("select private.get_public_faq() value")).some(item=>item.id===restored.id));
  pass("14 y 16. restauración conserva identidad y queda sin publicar");

  const conflictBase=await upsertFaq({question:"¿Hay envíos?",answer:"Próximamente.",active:false,order:40});
  const conflictDeleted=await upsertFaq({id:conflictBase.id,question:conflictBase.question,answer:conflictBase.answer,active:false,order:40,expected:conflictBase.version,remove:true});
  await upsertFaq({question:"  ¿HAY  ENVÍOS? ",answer:"Información actualizada.",active:false,order:41});
  await rejected("select private.admin_restore_faq($1,$2)",[conflictDeleted.id,conflictDeleted.version],/misma pregunta/i,"23505");
  assert.ok((await db.query("select deleted_at from private.site_faq_items where id=$1",[conflictDeleted.id])).rows[0].deleted_at);
  pass("15. restauración conflictiva se rechaza de forma atómica");

  await rejected("select private.stage_c_validate_content('{}'::jsonb)",[],/vacío/i);
  await rejected("select private.stage_c_validate_content($1::jsonb)",[JSON.stringify({body:"<script>alert(1)</script>"})],/HTML o código/i);
  await rejected("select private.stage_c_validate_content($1::jsonb)",[JSON.stringify({body:"ok",instagram:"javascript:alert(1)"})],/HTML o código|Instagram inválido/i);
  await rejected("select private.admin_upsert_faq(null,'x','respuesta',true,0,0,false)",[],/Texto inválido|violates check constraint/i);
  pass("18. contenido vacío, ejecutable y textos inválidos rechazados");

  const safeContent=await value("select private.stage_c_validate_content($1::jsonb) value",[JSON.stringify({body:"**Título**\n\n[Web](https://cubica3d.ar)\n\nÑandú & café",email:"contacto@cubica3d.ar",instagram:"https://instagram.com/cubica3d"})]);
  assert.match(safeContent.body,/Ñandú & café/);
  pass("19. Markdown limitado, URL HTTPS y caracteres especiales aceptados");

  await db.exec("select set_config('app.test_aal','aal1',false)");
  await rejected("select private.admin_list_faq(true)",[],/MFA AAL2/i,"42501");
  await db.exec("select set_config('app.test_aal','aal2',false); select set_config('app.test_admin','false',false)");
  await rejected("select private.admin_restore_faq($1,$2)",[removed.id,restored.version],/MFA AAL2/i,"42501");
  await db.exec("select set_config('app.test_admin','true',false)");
  pass("20. AAL1 y usuario común rechazados");

  assert.equal((await value("select private.get_public_content_page('about') value")).content.body,"Tercera versión");
  const publicFaq=await value("select private.get_public_faq() value");
  assert.deepEqual(publicFaq.map(item=>item.id),[similar.id]);
  pass("21. lectores públicos solo devuelven contenido publicado y FAQ activas");

  const before=(await db.query("select count(*)::int n from private.site_faq_items")).rows[0].n;
  await rejected("select private.admin_upsert_faq(null,'¿Cómo retiro?','Duplicada',true,0,0,false)",[],/misma pregunta/i,"23505");
  assert.equal((await db.query("select count(*)::int n from private.site_faq_items")).rows[0].n,before);
  pass("22. errores no dejan escrituras parciales");
} finally {await db.exec("rollback");}

assert.equal((await db.query("select count(*)::int n from private.site_content_versions")).rows[0].n,0);
assert.equal((await db.query("select count(*)::int n from private.site_faq_items")).rows[0].n,0);
pass("23. ROLLBACK sin residuos QA");

const source=read("js/site-experience.js");
const context={console,URL,URLSearchParams,setTimeout:()=>0,clearTimeout:()=>{},setInterval:()=>0,clearInterval:()=>{},location:{href:"https://cubica3d.ar/",search:""},history:{pushState(){}},confirm:()=>false,
  document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},window:{addEventListener(){}}};
context.window.window=context.window;context.window.document=context.document;context.window.location=context.location;context.window.history=context.history;
vm.runInNewContext(source,context,{filename:"js/site-experience.js"});
const rendered=context.window.cubicaSiteExperience.renderMarkdown(`<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[ok](https://cubica3d.ar)`);
assert.doesNotMatch(rendered,/<img\b|href="javascript:/i);assert.match(rendered,/&lt;img/);assert.match(rendered,/href="https:\/\/cubica3d\.ar"/);
pass("19b. representación prevista escapa HTML y no convierte javascript:");

await db.exec(recovery);
for(const identity of ["private.admin_restore_faq(bigint,integer)","private.admin_publish_content_page(text,integer)"]){
  assert.equal((await db.query("select has_function_privilege('anon',$1::regprocedure,'execute') value",[identity])).rows[0].value,false);
}
assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.site_faq_items'::regclass")).rows[0].relrowsecurity,true);
pass("recuperación no destructiva conserva RLS y funciones cerradas");

noRun("dos publicaciones simultáneas","no hay servidor PostgreSQL aislado con dos conexiones independientes");
noRun("creación simultánea de FAQ duplicadas","no hay servidor PostgreSQL aislado con dos conexiones independientes");
noRun("restauración concurrente con creación o edición","no hay servidor PostgreSQL aislado con dos conexiones independientes");
noRun("eliminación concurrente con restauración","no hay servidor PostgreSQL aislado con dos conexiones independientes");

console.log(`\nPostgreSQL aislado: ${server_version}`);
console.log(JSON.stringify({results},null,2));
await db.close();
