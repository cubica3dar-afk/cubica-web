import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migration=read("supabase/migrations/20261018171258_stage_c_suggestion_protection_private_functions_v3.sql");
const verification=read("supabase/verification/20261018171258_verify.sql");
const adminMigration=read("supabase/migrations/20261024233029_stage_c_suggestion_admin_private_functions_v3.sql");
const wrapper1Migration=read("supabase/migrations/20261025120000_stage_c_public_appearance_wrappers_closed_v3.sql");
const wrapper2Migration=read("supabase/migrations/20261025120100_stage_c_campaign_content_wrappers_closed_v3.sql");
const wrapperMigration=read("supabase/migrations/20261025120200_stage_c_suggestion_wrappers_closed_v3.sql");
const USER="00000000-0000-4000-8000-000000000055";
const hash=n=>Number(n).toString(16).padStart(64,"0");
const request=n=>`00000000-0000-4000-8000-${Number(n).toString().padStart(12,"0")}`;

const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(x=>x.rows);
assert.match(String(server_version),/^17[.]/);

await db.exec(`
  create schema private;
  create schema auth;
  create schema extensions;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create function extensions.gen_random_uuid() returns uuid language sql volatile set search_path='' as $$
    select pg_catalog.gen_random_uuid();
  $$;
  -- Sustituto local determinista de forma (32 bytes). Producción usa pgcrypto.
  create function extensions.digest(p_data bytea,p_algorithm text) returns bytea
  language sql immutable set search_path='' as $$
    select decode(md5(convert_from(p_data,'UTF8'))||md5('stage-c-5b-test:'||convert_from(p_data,'UTF8')),'hex');
  $$;
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
const rpcSql=`select private.submit_protected_suggestion($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result`;
async function submit({token,network,actor,kind="guest",category="otro",subject="Idea válida",description="Descripción suficientemente extensa",contact=null,requestId,userId=null}){
  return (await scalar(rpcSql,[token,network,actor,kind,category,subject,description,contact,requestId,userId])).result;
}

const identities=[
  ["private.stage_c_apply_suggestion_limit(text,text,integer,timestamp with time zone)",false],
  ["private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)",true]
];
for(const [identity,definer] of identities){
  const [row]=await db.query(`
    select p.prosecdef,p.provolatile,p.prorettype::regtype::text return_type,p.proconfig,
      exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_exec,
      has_function_privilege('anon',p.oid,'execute') anon_exec,
      has_function_privilege('authenticated',p.oid,'execute') authenticated_exec,
      has_function_privilege('service_role',p.oid,'execute') service_exec
    from pg_proc p where p.oid=$1::regprocedure
  `,[identity]).then(x=>x.rows);
  assert.equal(row.prosecdef,definer);assert.equal(row.provolatile,"v");assert.equal(row.return_type,"jsonb");
  assert.deepEqual(row.proconfig,["search_path=\"\""]);assert.equal(row.public_exec,false);
  assert.equal(row.anon_exec,false);assert.equal(row.authenticated_exec,false);assert.equal(row.service_exec,false);
}
record("firmas completas, retornos, volatilidad, seguridad, search_path y ACL cerradas","PASS");

await db.exec("begin");
try{
  await db.query("select set_config('app.test_role','authenticated',true)");
  await rejected(rpcSql,[hash(1),hash(2),hash(3),"guest","otro","Idea válida","Descripción suficientemente extensa",null,request(1),null],/Ruta interna/,"42501");
  record("acceso no autorizado rechazado","PASS");

  await db.query("select set_config('app.test_role','service_role',true)");
  const valid=await submit({token:hash(10),network:hash(11),actor:hash(12),kind:"user",subject:"Mejora ñandú 🚀",description:"Descripción con áéíóú y caracteres especiales.",contact:"persona@example.com",requestId:request(10),userId:USER});
  assert.equal(valid.status,"accepted");assert.equal(valid.idempotent,false);assert.ok(valid.suggestion_id);
  let stored=await scalar("select subject,description,contact,user_id from private.site_suggestions where id=$1",[valid.suggestion_id]);
  assert.equal(stored.subject,"Mejora ñandú 🚀");assert.equal(stored.user_id,USER);
  record("sugerencia autenticada válida, Unicode e identidad verificada","PASS");

  await rejected(rpcSql,[hash(13),hash(14),hash(15),"guest","otro","  ","Descripción suficientemente extensa",null,request(13),null],/Texto inválido/);
  await rejected(rpcSql,[hash(16),hash(17),hash(18),"guest","otro","abc","x".repeat(3001),null,request(16),null],/Texto inválido/);
  await rejected(rpcSql,[hash(19),hash(20),hash(21),"guest","otro","<img src=x>","Descripción suficientemente extensa",null,request(19),null],/HTML|enlace no permitido/);
  await rejected(rpcSql,[hash(22),hash(23),hash(24),"guest","otro","Idea válida","Visitá vbscript:alert(1) ahora",null,request(22),null],/HTML|enlace no permitido/);
  record("vacíos, longitudes, HTML y enlaces peligrosos rechazados","PASS");

  const idemBase={token:hash(30),network:hash(31),actor:hash(32),requestId:request(30)};
  const first=await submit(idemBase);
  const attemptsBeforeRetry=(await scalar("select attempts from private.suggestion_rate_limits where identity_hash=$1",[idemBase.actor])).attempts;
  const retry=await submit({...idemBase,token:hash(33)});
  assert.equal(retry.status,"accepted");assert.equal(retry.idempotent,true);assert.equal(retry.duplicate,false);assert.equal(retry.suggestion_id,first.suggestion_id);
  assert.equal((await scalar("select count(*)::integer n from private.site_suggestions where request_id=$1",[request(30)])).n,1);
  assert.equal((await scalar("select count(*)::integer n from private.suggestion_token_uses where token_hash=$1",[hash(33)])).n,0);
  assert.equal((await scalar("select attempts from private.suggestion_rate_limits where identity_hash=$1",[idemBase.actor])).attempts,attemptsBeforeRetry);
  const conflict=await submit({...idemBase,token:hash(34),subject:"Contenido alterado"});
  assert.equal(conflict.status,"idempotency_conflict");
  const identityConflict=await submit({...idemBase,token:hash(36),actor:hash(37)});
  assert.equal(identityConflict.status,"idempotency_conflict");
  const networkConflict=await submit({...idemBase,token:hash(38),network:hash(39)});
  assert.equal(networkConflict.status,"idempotency_conflict");
  const replay=await submit({token:hash(30),network:hash(40),actor:hash(41),requestId:request(40)});
  assert.equal(replay.status,"token_replayed");
  record("idempotencia consistente, sin nuevos contadores, y conflictos de identidad/red/contenido","PASS");

  const duplicate=await submit({...idemBase,token:hash(35),requestId:request(35)});
  assert.equal(duplicate.status,"accepted");assert.equal(duplicate.duplicate,true);assert.equal(duplicate.suggestion_id,first.suggestion_id);
  assert.equal((await scalar("select count(*)::integer n from private.site_suggestions where subject='Idea válida' and user_id is null")).n,1);
  const duplicateRetry=await submit({...idemBase,token:hash(42),requestId:request(35)});
  assert.equal(duplicateRetry.status,"accepted");assert.equal(duplicateRetry.idempotent,true);assert.equal(duplicateRetry.duplicate,true);assert.equal(duplicateRetry.suggestion_id,first.suggestion_id);
  assert.equal((await scalar("select count(*)::integer n from private.suggestion_token_uses where token_hash=$1",[hash(42)])).n,0);
  const replayDuplicate=await submit({...idemBase,token:hash(35),requestId:request(43)});
  assert.equal(replayDuplicate.status,"token_replayed");
  record("contenido repetido se deduplica, el reintento conserva el resultado y el replay prevalece","PASS");

  const userActor=hash(100),userNetwork=hash(101);
  for(let n=100;n<105;n++){
    const value=await submit({token:hash(n+1000),network:userNetwork,actor:userActor,kind:"user",subject:`Idea usuario ${n}`,requestId:request(n),userId:USER});
    assert.equal(value.status,"accepted");
  }
  const userBlocked=await submit({token:hash(1105),network:userNetwork,actor:userActor,kind:"user",subject:"Idea usuario bloqueada",requestId:request(105),userId:USER});
  assert.equal(userBlocked.status,"rate_limited");assert.ok(userBlocked.retry_after_seconds>0);
  let userLimit=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[userActor]);
  assert.equal(userLimit.attempts,5);assert.ok(userLimit.blocked_until);
  const firstBlockedUntil=String(userLimit.blocked_until);
  const stillBlocked=await submit({token:hash(1106),network:userNetwork,actor:userActor,kind:"user",subject:"Otra idea durante bloqueo",requestId:request(106),userId:USER});
  assert.equal(stillBlocked.status,"rate_limited");
  userLimit=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[userActor]);
  assert.equal(String(userLimit.blocked_until),firstBlockedUntil);
  record("límite por usuario, bloqueo persistente y rechazo sin extensión indefinida","PASS");

  const guestActor=hash(200),guestNetwork=hash(201);
  for(let n=200;n<203;n++)assert.equal((await submit({token:hash(n+1200),network:guestNetwork,actor:guestActor,subject:`Idea invitado ${n}`,requestId:request(n)})).status,"accepted");
  const guestBlocked=await submit({token:hash(1403),network:guestNetwork,actor:guestActor,subject:"Idea invitado bloqueada",requestId:request(203)});
  assert.equal(guestBlocked.status,"rate_limited");
  record("límite independiente para invitado","PASS");

  const sharedNetwork=hash(300);
  for(let n=300;n<320;n++){
    const value=await submit({token:hash(n+1500),network:sharedNetwork,actor:hash(n+2000),subject:`Idea red ${n}`,requestId:request(n)});
    assert.equal(value.status,"accepted");
  }
  const networkBlocked=await submit({token:hash(1820),network:sharedNetwork,actor:hash(2320),subject:"Idea red bloqueada",requestId:request(320)});
  assert.equal(networkBlocked.status,"rate_limited");
  const networkLimit=await scalar("select attempts,blocked_until,scope from private.suggestion_rate_limits where identity_hash=$1",[sharedNetwork]);
  assert.equal(networkLimit.attempts,20);assert.equal(networkLimit.scope,"network");assert.ok(networkLimit.blocked_until);
  record("límite agregado por origen de red","PASS");

  await db.query("update private.suggestion_rate_limits set window_started_at=now()-interval '2 hours',blocked_until=now()-interval '1 second' where identity_hash=$1",[guestActor]);
  const renewed=await submit({token:hash(1900),network:hash(1901),actor:guestActor,subject:"Idea después de expirar",requestId:request(400)});
  assert.equal(renewed.status,"accepted");
  const renewedLimit=await scalar("select attempts,blocked_until from private.suggestion_rate_limits where identity_hash=$1",[guestActor]);
  assert.equal(renewedLimit.attempts,1);assert.equal(renewedLimit.blocked_until,null);
  record("expiración de bloqueo y renovación de ventana","PASS");

  const isolatedA=await submit({token:hash(2000),network:hash(2001),actor:hash(2002),requestId:request(500)});
  const isolatedB=await submit({token:hash(2010),network:hash(2011),actor:hash(2012),requestId:request(501)});
  assert.notEqual(isolatedA.suggestion_id,isolatedB.suggestion_id);
  record("aislamiento entre identidades","PASS");

  await db.exec(`
    create function private.stage_c_5b_test_failure() returns trigger language plpgsql set search_path='' as $$
    begin if new.subject='Fallo técnico' then raise exception 'qa_forced_failure'; end if; return new; end $$;
    create trigger stage_c_5b_test_failure before insert on private.site_suggestions
      for each row execute function private.stage_c_5b_test_failure();
  `);
  const failToken=hash(2100),failActor=hash(2101),failNetwork=hash(2102),failRequest=request(600);
  await rejected(rpcSql,[failToken,failNetwork,failActor,"guest","otro","Fallo técnico","Descripción suficientemente extensa",null,failRequest,null],/qa_forced_failure/);
  assert.equal((await scalar("select count(*)::integer n from private.suggestion_token_uses where token_hash=$1",[failToken])).n,0);
  assert.equal((await scalar("select count(*)::integer n from private.suggestion_rate_limits where identity_hash in ($1,$2)",[failActor,failNetwork])).n,0);
  assert.equal((await scalar("select count(*)::integer n from private.site_suggestions where request_id=$1",[failRequest])).n,0);
  await db.exec("drop trigger stage_c_5b_test_failure on private.site_suggestions; drop function private.stage_c_5b_test_failure()");
  record("fallo técnico revierte token, contadores y sugerencia sin parciales","PASS");

  await db.query("select set_config('app.test_uid',$1,true),set_config('app.test_admin','true',true),set_config('app.test_aal','aal1',true)",[USER]);
  await rejected("select private.stage_c_assert_admin()",[],/MFA AAL2/,"42501");
  await db.query("select set_config('app.test_aal','aal2',true)");
  await db.query("select private.stage_c_assert_admin()");
  record("guard administrativo conserva exigencia AAL2","PASS");

  assert.equal((await scalar("select to_regprocedure('private.submit_protected_suggestion') is null value")).value,true);
  const verified=(await db.query(verification)).rows[0].stage_c_5b_v3_verification;
  assert.equal(verified.sentinel_ok,true);assert.equal(verified.schema_ok,true);
  assert.ok(verified.objects.every(item=>item.exists&&item.return_ok&&item.security_ok&&item.volatility_ok&&item.search_path_ok&&!item.public_execute&&!item.anon_execute&&!item.authenticated_execute&&!item.service_role_execute));
  record("sonda con firmas completas corrige el falso negativo anterior","PASS");

  const rows=await scalar("select (select count(*)::integer from private.site_suggestions) suggestions,(select count(*)::integer from private.suggestion_token_uses) requests,(select count(*)::integer from private.suggestion_rate_limits) limits");
  assert.ok(rows.suggestions>0&&rows.requests>0&&rows.limits>0);
  record("compatibilidad con esquema actual y fixtures transaccionales","PASS");
}finally{
  await db.exec("rollback");
}

const residue=await scalar("select (select count(*)::integer from private.site_suggestions) suggestions,(select count(*)::integer from private.suggestion_token_uses) requests,(select count(*)::integer from private.suggestion_rate_limits) limits");
assert.deepEqual(residue,{suggestions:0,requests:0,limits:0});
record("ROLLBACK sin residuos","PASS");

await db.exec("begin");
try{
  await db.exec(adminMigration);
  await db.query("select set_config('app.test_role','service_role',true)");
  const created=await submit({token:hash(3000),network:hash(3001),actor:hash(3002),requestId:request(700)});
  await db.query("select set_config('app.test_uid',$1,true),set_config('app.test_admin','true',true),set_config('app.test_aal','aal1',true)",[USER]);
  await rejected("select private.admin_list_suggestions(1,25,null,'all','all','recent','active')",[],/MFA AAL2/,"42501");
  await db.query("select set_config('app.test_aal','aal2',true)");
  const listed=(await scalar("select private.admin_list_suggestions(1,25,null,'all','all','recent','active') value")).value;
  assert.equal(listed.total,1);assert.equal(listed.items[0].id,created.suggestion_id);
  const updated=(await scalar("select private.admin_update_suggestion($1,'reviewing','Nota privada',1,null) value",[created.suggestion_id])).value;
  assert.equal(updated.suggestion.status,"reviewing");
  const updatedDetail=(await scalar("select private.admin_get_suggestion($1) value",[created.suggestion_id])).value;
  assert.equal(updatedDetail.private_notes,"Nota privada");
  record("5C v3 conserva administración AAL2 y rechaza AAL1","PASS");

  await db.exec(`
    insert into private.suggestion_token_uses(token_hash,used_at,expires_at,request_id,actor_kind,actor_hash,network_hash,payload_hash,result_code,suggestion_id,retry_after_seconds,was_duplicate)
      values('${hash(3100)}',now()-interval '2 days',now()-interval '1 second','${request(701)}','guest','${hash(3101)}','${hash(3102)}','${hash(3103)}','accepted','${created.suggestion_id}',null,false);
    insert into private.suggestion_rate_limits(identity_hash,scope,window_started_at,attempts,blocked_until,updated_at)
      values('${hash(3110)}','guest',now()-interval '3 days',1,null,now()-interval '3 days');
  `);
  await db.query("select private.cleanup_suggestion_protection()");
  assert.equal((await scalar("select count(*)::integer n from private.suggestion_token_uses where token_hash=$1",[hash(3100)])).n,0);
  assert.equal((await scalar("select count(*)::integer n from private.suggestion_rate_limits where identity_hash=$1",[hash(3110)])).n,0);
  record("5C v3 limpia protección expirada usando expires_at y updated_at","PASS");

  await db.exec(`
    create table private.site_content_pages(id integer);
    comment on table private.site_content_pages is 'cubica_stage_c:20261018171402';
    create function private.get_site_experience(timestamptz) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.get_public_content_page(text) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.get_public_faq() returns jsonb language sql set search_path='' as $$ select '[]'::jsonb $$;
    create function private.admin_get_site_configuration() returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_save_site_appearance_draft(jsonb,integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_publish_site_appearance(integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_reset_site_appearance_draft(integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_restore_original_appearance_draft(integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_retire_site_asset(uuid) returns void language plpgsql set search_path='' as $$ begin null; end $$;
    create function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_set_site_campaign_state(uuid,text,integer,uuid) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_duplicate_site_campaign(uuid,integer,uuid) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_delete_site_campaign(uuid,integer) returns void language plpgsql set search_path='' as $$ begin null; end $$;
    create function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_save_content_draft(text,text,jsonb,integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_publish_content_page(text,integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_restore_content_version(text,integer,integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    create function private.admin_list_faq(boolean) returns jsonb language sql set search_path='' as $$ select '[]'::jsonb $$;
    create function private.admin_restore_faq(bigint,integer) returns jsonb language sql set search_path='' as $$ select '{}'::jsonb $$;
    comment on function private.get_site_experience(timestamptz) is 'cubica_stage_c:20261018171231';
    comment on function private.admin_get_site_configuration() is 'cubica_stage_c:20261018171232';
    comment on function private.admin_register_site_asset(text,text,text,text,bigint,integer,integer) is 'cubica_stage_c:20261018171249';
    comment on function private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid) is 'cubica_stage_c:20261018171254';
    comment on function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) is 'cubica_stage_c:20261018171255';
    comment on function private.admin_restore_faq(bigint,integer) is 'cubica_stage_c:20261018171256';
  `);
  await db.exec(wrapper1Migration);
  await db.exec(wrapper2Migration);
  await db.exec(wrapperMigration);
  for(const identity of [
    "public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)",
    "public.admin_list_suggestions(integer,integer,text,text,text,text,text)",
    "public.admin_get_suggestion(uuid)",
    "public.admin_update_suggestion(uuid,text,text,integer,text)",
    "public.admin_set_suggestion_lifecycle(uuid,text,integer,text)","public.cleanup_suggestion_protection()"
  ]){
    const row=await scalar("select has_function_privilege('anon',$1::regprocedure,'execute') anon_exec,has_function_privilege('authenticated',$1::regprocedure,'execute') auth_exec,has_function_privilege('service_role',$1::regprocedure,'execute') service_exec",[identity]);
    assert.deepEqual(row,{anon_exec:false,auth_exec:false,service_exec:false});
  }
  assert.equal((await scalar("select to_regprocedure('public.submit_public_suggestion(text,text,text,text,uuid,uuid)') is null missing")).missing,true);
  await db.exec("grant execute on function public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid) to service_role");
  await db.query("select set_config('app.test_role','service_role',true)");
  const wrapped=(await scalar("select public.submit_protected_suggestion($1,$2,$3,'guest','otro','Wrapper válido','Descripción suficientemente extensa',null,$4,null) value",[hash(3200),hash(3201),hash(3202),request(702)])).value;
  assert.equal(wrapped.status,"accepted");
  assert.equal((await scalar("select count(*)::integer n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_site_experience','get_public_content_page','get_public_faq','admin_get_site_configuration','admin_save_site_appearance_draft','admin_publish_site_appearance','admin_reset_site_appearance_draft','admin_restore_original_appearance_draft','admin_register_site_asset','admin_retire_site_asset','admin_upsert_site_campaign','admin_set_site_campaign_state','admin_duplicate_site_campaign','admin_delete_site_campaign','admin_upsert_welcome_phrase','admin_save_content_draft','admin_publish_content_page','admin_restore_content_version','admin_upsert_faq','admin_list_faq','admin_restore_faq','submit_protected_suggestion','admin_list_suggestions','admin_get_suggestion','admin_update_suggestion','admin_set_suggestion_lifecycle','cleanup_suggestion_protection')")).n,27);
  record("7A-1/2/3 v3 crean 27 wrappers finales cerrados y el wrapper atómico funciona tras grant aislado","PASS");
}finally{
  await db.exec("rollback");
}
assert.deepEqual(await scalar("select (select count(*)::integer from private.site_suggestions) suggestions,(select count(*)::integer from private.suggestion_token_uses) requests,(select count(*)::integer from private.suggestion_rate_limits) limits"),{suggestions:0,requests:0,limits:0});
record("compatibilidad 5C/7A-3 termina en ROLLBACK sin residuos","PASS");
record("inicialización e incrementos simultáneos en sesiones independientes","NO EJECUTADA","PGlite 17.5 ofrece una sola sesión PostgreSQL");
record("último cupo, bloqueo e idempotencia simultáneos","NO EJECUTADA","requiere un servidor PostgreSQL 17 con al menos dos conexiones independientes");
record("Turnstile y Edge Function reales","NO EJECUTADA","no están desplegados ni autorizados en esta preparación local");

console.log(JSON.stringify({server_version,results,passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,not_executed:results.filter(x=>x.status==="NO EJECUTADA").length},null,2));
if(results.some(x=>x.status==="FAIL"))process.exitCode=1;

