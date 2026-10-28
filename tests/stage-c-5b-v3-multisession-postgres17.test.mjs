import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";

const {Client}=pg;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const migration=fs.readFileSync(path.join(root,"supabase/migrations/20261018171258_stage_c_suggestion_protection_private_functions_v3.sql"),"utf8");
const connection={host:"127.0.0.1",port:55432,user:"postgres",database:"stagec5b_v3_concurrency"};
const adminConnection={...connection,database:"postgres"};
const USER="00000000-0000-4000-8000-000000000055";
const hash=n=>Number(n).toString(16).padStart(64,"0");
const request=n=>`00000000-0000-4000-8000-${Number(n).toString().padStart(12,"0")}`;
const results=[];
const pass=(name,detail="")=>{results.push({name,status:"PASS",detail});console.log(`✓ ${name}${detail?`: ${detail}`:""}`);};

async function client(){
  const c=new Client(connection);await c.connect();
  await c.query("set statement_timeout='8s'; set lock_timeout='6s'; select set_config('app.test_role','service_role',false)");
  return c;
}
async function submit(c,{token,network,actor,kind="guest",category="otro",subject="Idea válida",description="Descripción suficientemente extensa",contact=null,requestId,userId=null}){
  const {rows}=await c.query("select private.submit_protected_suggestion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result",[token,network,actor,kind,category,subject,description,contact,requestId,userId]);
  return rows[0].result;
}
async function reset(c){await c.query("truncate private.suggestion_token_uses,private.suggestion_rate_limits,private.site_suggestions restart identity cascade");}

const admin=new Client(adminConnection);await admin.connect();
await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname='stagec5b_v3_concurrency' and pid<>pg_backend_pid()");
await admin.query("drop database if exists stagec5b_v3_concurrency");
await admin.query("create database stagec5b_v3_concurrency");
await admin.end();

const setup=await client();
await setup.query(`
  create schema private;
  create schema auth;
  create schema extensions;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create extension pgcrypto with schema extensions;
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${USER}');
  create function auth.uid() returns uuid language sql stable set search_path='' as $$
    select nullif(current_setting('app.test_uid',true),'')::uuid;
  $$;
  create function auth.role() returns text language sql stable set search_path='' as $$
    select coalesce(current_setting('app.test_role',true),'anon');
  $$;
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
  revoke all on function private.stage_c_assert_admin() from public,anon,authenticated,service_role;
  revoke all on function private.stage_c_safe_text(text,integer,boolean) from public,anon,authenticated,service_role;
  comment on function private.stage_c_assert_admin() is 'cubica_stage_c:20261018171210';
  create table private.site_suggestions(
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
await setup.query(migration);
await setup.end();

const a=await client(),b=await client();
try{
  await reset(a);
  const actor=hash(10);
  const init=await Promise.all([
    submit(a,{token:hash(11),network:hash(12),actor,subject:"Inicio A",requestId:request(11)}),
    submit(b,{token:hash(13),network:hash(14),actor,subject:"Inicio B",requestId:request(13)})
  ]);
  assert.deepEqual(init.map(x=>x.status).sort(),["accepted","accepted"]);
  let row=(await a.query("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[actor])).rows[0];
  assert.equal(row.attempts,2);assert.equal(row.blocked_until,null);
  pass("inicialización simultánea del mismo contador","2 aceptadas, contador final 2");

  await reset(a);
  const shared=hash(100);
  const increments=await Promise.all(Array.from({length:10},(_,i)=>{
    const c=i%2?a:b;
    return submit(c,{token:hash(200+i),network:shared,actor:hash(300+i),subject:`Incremento ${i}`,requestId:request(200+i)});
  }));
  assert.equal(increments.filter(x=>x.status==="accepted").length,10);
  row=(await a.query("select attempts from private.suggestion_rate_limits where identity_hash=$1",[shared])).rows[0];
  assert.equal(row.attempts,10);
  pass("incrementos concurrentes sin pérdida","10 aceptadas, contador de red final 10");

  await reset(a);
  const lastActor=hash(400);
  for(let i=0;i<4;i++)await submit(a,{token:hash(410+i),network:hash(420+i),actor:lastActor,kind:"user",subject:`Precarga ${i}`,requestId:request(410+i),userId:USER});
  const last=await Promise.all([
    submit(a,{token:hash(430),network:hash(431),actor:lastActor,kind:"user",subject:"Último cupo A",requestId:request(430),userId:USER}),
    submit(b,{token:hash(432),network:hash(433),actor:lastActor,kind:"user",subject:"Último cupo B",requestId:request(432),userId:USER})
  ]);
  assert.equal(last.filter(x=>x.status==="accepted").length,1);
  assert.equal(last.filter(x=>x.status==="rate_limited").length,1);
  row=(await a.query("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[lastActor])).rows[0];
  assert.equal(row.attempts,5);assert.ok(row.blocked_until);
  pass("dos solicitudes con un solo cupo","exactamente 1 aceptada y 1 bloqueada");

  const blockedAt=String(row.blocked_until);
  const blocked=await Promise.all([
    submit(a,{token:hash(440),network:hash(441),actor:lastActor,kind:"user",subject:"Bloqueo A",requestId:request(440),userId:USER}),
    submit(b,{token:hash(442),network:hash(443),actor:lastActor,kind:"user",subject:"Bloqueo B",requestId:request(442),userId:USER})
  ]);
  assert.ok(blocked.every(x=>x.status==="rate_limited"));
  row=(await a.query("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[lastActor])).rows[0];
  assert.equal(row.attempts,5);assert.equal(String(row.blocked_until),blockedAt);
  pass("bloqueos simultáneos y persistencia","bloqueo fijo, sin extensión ni incremento");

  await reset(a);
  const idem={network:hash(500),actor:hash(501),subject:"Idempotencia concurrente",requestId:request(500)};
  const idemResults=await Promise.all([
    submit(a,{...idem,token:hash(502)}),
    submit(b,{...idem,token:hash(503)})
  ]);
  assert.ok(idemResults.every(x=>x.status==="accepted"));
  assert.equal(new Set(idemResults.map(x=>x.suggestion_id)).size,1);
  const idemCounts=(await a.query("select (select count(*)::int from private.site_suggestions) suggestions,(select count(*)::int from private.suggestion_token_uses) ledger")).rows[0];
  assert.deepEqual(idemCounts,{suggestions:1,ledger:1});
  const semantic=idemResults.map(x=>({idempotent:x.idempotent??false,duplicate:x.duplicate??false}));
  assert.equal(semantic.filter(x=>x.idempotent).length,1);
  assert.equal(semantic.filter(x=>x.duplicate).length,0);
  const idemLimits=(await a.query("select identity_hash,attempts from private.suggestion_rate_limits where identity_hash=any($1::text[]) order by identity_hash",[[idem.actor,idem.network]])).rows;
  assert.equal(idemLimits.length,2);assert.ok(idemLimits.every(x=>x.attempts===1));
  pass("reintentos concurrentes con la misma clave","resultado original idempotente, una sugerencia, un ledger y un solo incremento");

  await reset(a);
  const conflictBase={network:hash(510),actor:hash(511),requestId:request(510)};
  const contentConflict=await Promise.all([
    submit(a,{...conflictBase,token:hash(512),subject:"Conflicto A"}),
    submit(b,{...conflictBase,token:hash(513),subject:"Conflicto B"})
  ]);
  assert.equal(contentConflict.filter(x=>x.status==="accepted").length,1);
  assert.equal(contentConflict.filter(x=>x.status==="idempotency_conflict").length,1);
  let conflictCounts=(await a.query("select (select count(*)::int from private.site_suggestions) suggestions,(select count(*)::int from private.suggestion_token_uses) ledger")).rows[0];
  assert.deepEqual(conflictCounts,{suggestions:1,ledger:1});
  pass("misma clave concurrente con contenido diferente","una aceptada y un conflicto explícito");

  await reset(a);
  const identityRequest=request(520),identityNetwork=hash(520);
  const identityConflict=await Promise.all([
    submit(a,{token:hash(521),network:identityNetwork,actor:hash(522),subject:"Identidad concurrente",requestId:identityRequest}),
    submit(b,{token:hash(523),network:identityNetwork,actor:hash(524),subject:"Identidad concurrente",requestId:identityRequest})
  ]);
  assert.equal(identityConflict.filter(x=>x.status==="accepted").length,1);
  assert.equal(identityConflict.filter(x=>x.status==="idempotency_conflict").length,1);
  conflictCounts=(await a.query("select (select count(*)::int from private.site_suggestions) suggestions,(select count(*)::int from private.suggestion_token_uses) ledger")).rows[0];
  assert.deepEqual(conflictCounts,{suggestions:1,ledger:1});
  pass("misma clave concurrente con identidad diferente","una aceptada y un conflicto explícito");

  await reset(a);
  const duplicateBase={network:hash(530),actor:hash(531),subject:"Contenido concurrente duplicado"};
  const duplicates=await Promise.all([
    submit(a,{...duplicateBase,token:hash(532),requestId:request(532)}),
    submit(b,{...duplicateBase,token:hash(533),requestId:request(533)})
  ]);
  assert.ok(duplicates.every(x=>x.status==="accepted"));
  assert.equal(new Set(duplicates.map(x=>x.suggestion_id)).size,1);
  assert.equal(duplicates.filter(x=>x.duplicate===true).length,1);
  assert.equal(duplicates.filter(x=>x.duplicate===false).length,1);
  const duplicateCounts=(await a.query("select (select count(*)::int from private.site_suggestions) suggestions,(select count(*)::int from private.suggestion_token_uses) ledger")).rows[0];
  assert.deepEqual(duplicateCounts,{suggestions:1,ledger:2});
  const duplicateLimits=(await a.query("select identity_hash,attempts from private.suggestion_rate_limits where identity_hash=any($1::text[]) order by identity_hash",[[duplicateBase.actor,duplicateBase.network]])).rows;
  assert.equal(duplicateLimits.length,2);assert.ok(duplicateLimits.every(x=>x.attempts===1));
  const duplicateRetry=await submit(a,{...duplicateBase,token:hash(534),requestId:request(533)});
  assert.equal(duplicateRetry.status,"accepted");assert.equal(duplicateRetry.idempotent,true);assert.equal(duplicateRetry.duplicate,true);
  const replayAfterDuplicate=await submit(b,{...duplicateBase,token:hash(532),requestId:request(535)});
  assert.equal(replayAfterDuplicate.status,"token_replayed");
  pass("deduplicación concurrente y precedencia de replay","una sugerencia, dos tokens auditados, reintento idempotente y replay rechazado");

  await reset(a);
  const sharedToken=hash(540),sharedTokenBase={network:hash(541),actor:hash(542),subject:"Replay concurrente"};
  const tokenRace=await Promise.all([
    submit(a,{...sharedTokenBase,token:sharedToken,requestId:request(540)}),
    submit(b,{...sharedTokenBase,token:sharedToken,requestId:request(541)})
  ]);
  assert.equal(tokenRace.filter(x=>x.status==="accepted").length,1);
  assert.equal(tokenRace.filter(x=>x.status==="token_replayed").length,1);
  pass("mismo token en requests concurrentes","una aceptada y un replay, sin ocultarse por contenido duplicado");

  await reset(a);
  await a.query(`create function private.qa_fail() returns trigger language plpgsql set search_path='' as $$begin raise exception 'qa_forced_failure';end$$;
    create trigger qa_fail before insert on private.site_suggestions for each row execute function private.qa_fail()`);
  const failed=await Promise.allSettled([
    submit(a,{token:hash(600),network:hash(601),actor:hash(602),subject:"Fallo A",requestId:request(600)}),
    submit(b,{token:hash(603),network:hash(604),actor:hash(605),subject:"Fallo B",requestId:request(603)})
  ]);
  assert.ok(failed.every(x=>x.status==="rejected"&&/qa_forced_failure/.test(String(x.reason?.message))));
  const atomic=(await a.query("select (select count(*)::int from private.site_suggestions) suggestions,(select count(*)::int from private.suggestion_token_uses) ledger,(select count(*)::int from private.suggestion_rate_limits) limits")).rows[0];
  assert.deepEqual(atomic,{suggestions:0,ledger:0,limits:0});
  await a.query("drop trigger qa_fail on private.site_suggestions;drop function private.qa_fail()");
  pass("atomicidad ante errores concurrentes","sin sugerencias, ledger ni contadores parciales");

  pass("ausencia de deadlocks o esperas indefinidas","todas las carreras finalizaron bajo statement_timeout=8s y lock_timeout=6s");
}finally{
  await a.end();await b.end();
}

console.log(JSON.stringify({postgres:"17.11",sessions:2,results,passed:results.length,failed:0},null,2));

