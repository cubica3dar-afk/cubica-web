import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql");
const migration=read("supabase/archive/20261018171302_stage_c_suggestion_protection_private_functions.pre_atomic.sql");
const verification=read("supabase/archive/20261018171302_verify.pre_full_signatures.sql");
const USER="00000000-0000-4000-8000-000000000055";
const hash=n=>n.toString(16).padStart(64,"0");
const request=n=>`00000000-0000-4000-8000-${n.toString().padStart(12,"0")}`;

const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(x=>x.rows);
assert.match(String(server_version),/^17[.]/);
await db.exec(bootstrap);
await db.exec(`
  create function auth.role() returns text language sql stable set search_path='' as $$
    select coalesce(current_setting('app.test_role',true),'anon');
  $$;
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${USER}');
  create table private.site_suggestions(
    id uuid primary key default pg_catalog.gen_random_uuid(),
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
  create index site_suggestions_admin on private.site_suggestions(status,created_at desc,id);
  create table private.suggestion_token_uses(
    token_hash text primary key,
    used_at timestamptz not null default now(),
    expires_at timestamptz not null,
    check(expires_at>used_at)
  );
  create table private.suggestion_rate_limits(
    identity_hash text primary key,
    window_started_at timestamptz not null,
    attempts integer not null default 1 check(attempts>0),
    blocked_until timestamptz
  );
  alter table private.site_suggestions enable row level security;
  alter table private.suggestion_token_uses enable row level security;
  alter table private.suggestion_rate_limits enable row level security;
  revoke all on private.site_suggestions,private.suggestion_token_uses,private.suggestion_rate_limits from public,anon,authenticated,service_role;
  comment on table private.site_suggestions is 'cubica_stage_c:20261018171100';
`);
await db.exec(migration);

const results=[];
const record=(name,status,detail="")=>{results.push({name,status,detail});console.log(`${status==="PASS"?"✓":status==="FAIL"?"✗":"○"} ${name}${detail?`: ${detail}`:""}`);};
let savepoint=0;
async function rejected(sql,params=[],pattern,code){
  const sp=`s${++savepoint}`;await db.exec(`savepoint ${sp}`);let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  await db.exec(`rollback to savepoint ${sp}; release savepoint ${sp}`);
  assert.ok(error,"La operación debía rechazarse");
  if(pattern)assert.match(String(error.message),pattern);
  if(code)assert.equal(error.code,code);
  return error;
}
const scalar=async(sql,params=[])=>(await db.query(sql,params)).rows[0];

const identities=[
  "private.consume_suggestion_protection(text,text,uuid)",
  "private.submit_public_suggestion(text,text,text,text,uuid,uuid)"
];
for(const identity of identities){
  const [{prosecdef,proconfig,public_exec,anon_exec,authenticated_exec,service_exec}]=await db.query(`
    select p.prosecdef,p.proconfig,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_exec,
      has_function_privilege('anon',p.oid,'execute') anon_exec,
      has_function_privilege('authenticated',p.oid,'execute') authenticated_exec,
      has_function_privilege('service_role',p.oid,'execute') service_exec
    from pg_proc p where p.oid=$1::regprocedure
  `,[identity]).then(x=>x.rows);
  assert.equal(prosecdef,true);assert.deepEqual(proconfig,["search_path=\"\""]);
  assert.equal(public_exec,false);assert.equal(anon_exec,false);assert.equal(authenticated_exec,false);assert.equal(service_exec,false);
}
record("firmas privadas, SECURITY DEFINER, search_path y ACL cerradas","PASS");

await db.exec("begin");
try{
  await db.query("select set_config('app.test_role','authenticated',true)");
  await rejected("select private.consume_suggestion_protection($1,$2,$3)",[hash(1),hash(100),request(1)],/Ruta interna/,"42501");
  await rejected("select private.submit_public_suggestion('otro','Asunto válido','Descripción suficientemente larga',null,$1,null)",[request(2)],/Ruta interna/,"42501");
  record("roles de cliente no pueden invocar funciones internas","PASS");

  await db.query("select set_config('app.test_role','service_role',true)");
  for(const [value,label] of [["bad","token"],["BAD","identidad"]]){
    const args=label==="token"?[value,hash(101),request(3)]:[hash(2),value,request(3)];
    await rejected("select private.consume_suggestion_protection($1,$2,$3)",args,/Protección inválida/);
  }
  record("hashes e identificadores malformados rechazados","PASS");

  await db.query("select private.consume_suggestion_protection($1,$2,$3)",[hash(3),hash(102),request(4)]);
  let row=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[hash(102)]);
  assert.equal(row.attempts,1);assert.equal(row.blocked_until,null);
  record("primer consumo válido registra token y ventana","PASS");

  await rejected("select private.consume_suggestion_protection($1,$2,$3)",[hash(3),hash(102),request(4)],/suggestion_turnstile_replayed/,"23505");
  row=await scalar("select attempts from private.suggestion_rate_limits where identity_hash=$1",[hash(102)]);
  assert.equal(row.attempts,1);
  record("replay de token rechazado sin incrementar contador","PASS");

  const first=await scalar("select private.submit_public_suggestion('otro','Idea Unicode ñ','Descripción válida con áéíóú',null,$1,null) id",[request(10)]);
  const second=await scalar("select private.submit_public_suggestion('error','Contenido cambiado','Otra descripción diferente','otro@example.com',$1,$2) id",[request(10),USER]);
  assert.equal(first.id,second.id);
  const stored=await scalar("select category,subject,description,contact,user_id from private.site_suggestions where id=$1",[first.id]);
  assert.equal(stored.category,"otro");assert.equal(stored.subject,"Idea Unicode ñ");assert.equal(stored.user_id,null);
  record("request_id repetido es idempotente y no reescribe contenido","PASS");

  const authenticated=await scalar("select private.submit_public_suggestion('visual','Mejora visual','Descripción válida para usuario','usuario@example.com',$1,$2) id",[request(11),USER]);
  assert.ok(authenticated.id);
  await rejected("select private.submit_public_suggestion('otro','Asunto','Descripción suficientemente larga',null,$1,$2)",[request(12),"00000000-0000-4000-8000-000000000099"],/foreign key/i,"23503");
  record("identidad nula o existente aceptada; UUID inexistente rechazado por FK","PASS");

  await rejected("select private.submit_public_suggestion('otro','  ','Descripción suficientemente larga',null,$1,null)",[request(13)],/Texto inválido|check constraint/i);
  await rejected("select private.submit_public_suggestion('otro','abc',$1,null,$2,null)",["x".repeat(3001),request(14)],/Texto inválido|check constraint/i);
  record("campos vacíos y demasiado largos rechazados","PASS");

  await rejected("select private.submit_public_suggestion('otro','<script>alert(1)</script>','Descripción suficientemente larga',null,$1,null)",[request(15)],/HTML o código no permitido/);
  await rejected("select private.submit_public_suggestion('otro','Asunto válido','javascript:alert(1)',null,$1,null)",[request(16)],/HTML o código no permitido/);
  record("XSS directo y protocolo javascript rechazados","PASS");

  const rateIdentity=hash(200);
  for(let n=20;n<25;n++)await db.query("select private.consume_suggestion_protection($1,$2,$3)",[hash(n),rateIdentity,request(n)]);
  row=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[rateIdentity]);
  assert.equal(row.attempts,5);
  await rejected("select private.consume_suggestion_protection($1,$2,$3)",[hash(25),rateIdentity,request(25)],/suggestion_rate_limit/);
  row=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[rateIdentity]);
  assert.equal(row.attempts,5);
  record("sexto intento en la hora es rechazado","PASS");
  if(row.blocked_until===null)record("blocked_until persiste después del rechazo","FAIL","la excepción revierte la actualización; queda NULL");
  else record("blocked_until persiste después del rechazo","PASS");

  await db.query("update private.suggestion_rate_limits set window_started_at=now()-interval '2 hours' where identity_hash=$1",[rateIdentity]);
  await db.query("select private.consume_suggestion_protection($1,$2,$3)",[hash(26),rateIdentity,request(26)]);
  row=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[rateIdentity]);
  assert.equal(row.attempts,1);assert.equal(row.blocked_until,null);
  record("ventana expirada reinicia el contador","PASS");

  const sameText1=await scalar("select private.submit_public_suggestion('otro','Texto repetido','Descripción repetida válida',null,$1,null) id",[request(30)]);
  const sameText2=await scalar("select private.submit_public_suggestion('otro','Texto repetido','Descripción repetida válida',null,$1,null) id",[request(31)]);
  assert.notEqual(sameText1.id,sameText2.id);
  record("detección de contenido repetido con request_id nuevo","FAIL","5B acepta duplicados; solo limita frecuencia e idempotencia por request_id");

  const verificationReport=(await db.query(verification)).rows[0]?.jsonb_build_object;
  if(verificationReport?.objects?.every(x=>x.exists===true)) record("sonda posterior identifica ambas funciones","PASS");
  else record("sonda posterior identifica ambas funciones","FAIL",JSON.stringify(verificationReport));

  const counts=await scalar("select (select count(*) from private.site_suggestions) suggestions,(select count(*) from private.suggestion_token_uses) tokens,(select count(*) from private.suggestion_rate_limits) limits");
  assert.ok(counts.suggestions>0&&counts.tokens>0&&counts.limits>0);
  record("fixtures aislados creados dentro de transacción","PASS");
}finally{
  await db.exec("rollback");
}

const residue=await scalar("select (select count(*) from private.site_suggestions) suggestions,(select count(*) from private.suggestion_token_uses) tokens,(select count(*) from private.suggestion_rate_limits) limits");
assert.deepEqual(residue,{suggestions:0,tokens:0,limits:0});
record("ROLLBACK sin residuos","PASS");
record("carreras simultáneas sobre identidad inexistente","NO EJECUTADA","PGlite no ofrece dos sesiones PostgreSQL independientes");
record("Turnstile real y Edge Function desplegada","NO EJECUTADA","la integración no está desplegada ni autorizada en este preflight");

console.log(JSON.stringify({server_version,results,passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,not_executed:results.filter(x=>x.status==="NO EJECUTADA").length},null,2));
if(results.some(x=>x.status==="FAIL"))process.exitCode=1;
