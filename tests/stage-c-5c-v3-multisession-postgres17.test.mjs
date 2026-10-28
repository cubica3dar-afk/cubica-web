import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";

const {Client}=pg;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const sha256=file=>crypto.createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex").toUpperCase();
const migrationPath="supabase/migrations/20261024233029_stage_c_suggestion_admin_private_functions_v3.sql";
const migration=read(migrationPath);
const protection=read("supabase/migrations/20261018171258_stage_c_suggestion_protection_private_functions_v3.sql");
const expectedHash="FA8174E1D05F24A90F15684132EF12801786282900049508B43EBB8B18CA9B8D";
const dbName="stagec5c_v3_concurrency";
const port=Number(process.env.CUBICA_PG_TEST_PORT||55434);
const base={host:"127.0.0.1",port,user:"postgres",database:dbName};
const ADMIN_A="00000000-0000-4000-8000-000000000051";
const ADMIN_B="00000000-0000-4000-8000-000000000052";
const USER="00000000-0000-4000-8000-000000000055";
const uuid=n=>`50000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const results=[];
const pass=(name,detail="")=>{results.push({name,status:"PASS",detail});console.log(`✓ ${name}${detail?`: ${detail}`:""}`);};

assert.equal(sha256(migrationPath),expectedHash,"El hash de 5C v3 cambió");
assert.equal(sha256("supabase/archive/20261018171304_stage_c_suggestion_admin_private_functions_v2.replaced_by_5c_v3.sql"),"5E7B13ADFDC2B9587FA86BEB4959F03426D2639515A97CE0992C8BFCF68F1EAF");
assert.ok(fs.existsSync(path.join(root,"supabase/verification/20261024233029_verify.sql")));
assert.ok(fs.existsSync(path.join(root,"supabase/rollback/20261024233029_stage_c_suggestion_admin_private_functions_v3_safe_state.sql")));
assert.equal(fs.readdirSync(path.join(root,"supabase/migrations")).filter(name=>name.startsWith("20261024233029_")).length,1);
assert.equal(fs.readdirSync(path.join(root,"supabase/migrations")).some(name=>name.startsWith("20261018171304_")),false);
pass("identidad local de 5C v3","hash, archivo histórico, verificador, contención y versión única");

async function connect(applicationName,{database=dbName,adminId=ADMIN_A}={}){
  const client=new Client({...base,database,application_name:applicationName});
  await client.connect();
  await client.query("set statement_timeout='8s'; set lock_timeout='6s'");
  if(database===dbName){
    await client.query("select set_config('app.test_uid',$1,false),set_config('app.test_admin','true',false),set_config('app.test_aal','aal2',false),set_config('app.test_role','authenticated',false)",[adminId]);
  }
  return client;
}
const value=async(client,sql,args=[])=>(await client.query(sql,args)).rows[0]?.value;
const update=(client,id,status,notes,revision,reason=null)=>value(client,"select private.admin_update_suggestion($1,$2,$3,$4,$5) value",[id,status,notes,revision,reason]);
const lifecycle=(client,id,action,revision,reason)=>value(client,"select private.admin_set_suggestion_lifecycle($1,$2,$3,$4) value",[id,action,revision,reason]);

const control=await connect("stagec5c-control",{database:"postgres"});
await control.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",[dbName]);
await control.query(`drop database if exists ${dbName}`);
await control.query(`create database ${dbName}`);
await control.end();

const setup=await connect("stagec5c-setup");
await setup.query(`
  create schema private;
  create schema auth;
  create schema extensions;
  do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
  do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
  do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
  create extension pgcrypto with schema extensions;
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${ADMIN_A}'),('${ADMIN_B}'),('${USER}');
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
    token_hash text primary key,used_at timestamptz not null default now(),expires_at timestamptz not null,
    check(expires_at>used_at)
  );
  create table private.suggestion_rate_limits(
    identity_hash text primary key,window_started_at timestamptz not null,
    attempts integer not null default 1 check(attempts>0),blocked_until timestamptz
  );
  alter table private.site_suggestions enable row level security;
  alter table private.suggestion_token_uses enable row level security;
  alter table private.suggestion_rate_limits enable row level security;
  revoke all on private.site_suggestions,private.suggestion_token_uses,private.suggestion_rate_limits from public,anon,authenticated,service_role;
  comment on table private.site_suggestions is 'cubica_stage_c:20261018171100';
`);
await setup.query(protection);
await setup.query(migration);
const [{server_version}]=await setup.query("show server_version").then(result=>result.rows);
assert.match(server_version,/^17\.11/);
pass("entorno PostgreSQL real",`${server_version}; escucha local; base ficticia descartable`);
await setup.end();

const a=await connect("stagec5c-a",{adminId:ADMIN_A});
const b=await connect("stagec5c-b",{adminId:ADMIN_B});
const observer=await connect("stagec5c-observer",{adminId:ADMIN_A});

let sequence=1000;
async function fresh({status="new",notes="",archived=false,deleted=false}={}){
  const id=uuid(sequence++),requestId=uuid(sequence++);
  await observer.query(`insert into private.site_suggestions(id,category,subject,description,contact,user_id,status,private_notes,request_id,archived_at,deleted_at)
    values($1,'otro',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,`Sugerencia ${sequence}`,`Descripción privada de concurrencia ${sequence}`,`persona${sequence}@example.com`,USER,status,notes,requestId,archived?new Date():null,deleted?new Date():null]);
  return id;
}
async function snapshot(id){
  const {rows}=await observer.query(`select s.status,s.private_notes,s.revision,s.archived_at,s.deleted_at,s.updated_at,
    (select count(*)::int from private.suggestion_moderation_history h where h.suggestion_id=s.id) history_count
    from private.site_suggestions s where s.id=$1`,[id]);
  return rows[0];
}
async function waitBlocked(applicationName){
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){
    const {rows}=await observer.query(`select state,wait_event_type,wait_event from pg_stat_activity
      where application_name=$1 and datname=current_database()`,[applicationName]);
    if(rows.some(row=>row.state==="active"&&row.wait_event_type==="Lock"))return rows[0];
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error(`La sesión ${applicationName} no quedó bloqueada en una carrera real`);
}
async function heldRace({holder,waiter,waiterName,id,holderOperation,waiterOperation}){
  await holder.query("begin");
  try{
    await holder.query("select id from private.site_suggestions where id=$1 for update",[id]);
    const waiting=waiterOperation(waiter);
    const blocked=await waitBlocked(waiterName);
    const winner=await holderOperation(holder);
    await holder.query("commit");
    const loser=await waiting;
    return {winner,loser,blocked};
  }catch(error){
    await holder.query("rollback").catch(()=>{});
    throw error;
  }
}
function assertUpdatedConflict(race){
  assert.equal(race.winner.status,"updated");
  assert.equal(race.loser.status,"conflict");
  assert.equal(race.loser.error,"stale_revision");
  assert.equal(race.blocked.wait_event_type,"Lock");
}

try{
  // A — six real overlaps, alternating the lock holder and winning edit.
  for(let i=0;i<6;i++){
    const id=await fresh();
    const holder=i%2===0?a:b,waiter=i%2===0?b:a,waiterName=i%2===0?"stagec5c-b":"stagec5c-a";
    const race=await heldRace({holder,waiter,waiterName,id,
      holderOperation:c=>update(c,id,"reviewing",`ganador-${i}`,1),
      waiterOperation:c=>update(c,id,"accepted",`perdedor-${i}`,1)});
    assertUpdatedConflict(race);
    const final=await snapshot(id);
    assert.equal(final.status,"reviewing");assert.equal(final.private_notes,`ganador-${i}`);
    assert.equal(final.revision,2);assert.equal(final.history_count,1);
  }
  pass("A. dos administradores editan la misma revisión","6 carreras; una ganadora, una en conflicto y un evento por carrera");

  // B — stale revision cannot alter row, timestamp, revision, or history.
  for(let i=0;i<3;i++){
    const id=await fresh();
    const first=await update(a,id,"reviewing",`vigente-${i}`,1);
    assert.equal(first.status,"updated");
    const before=await snapshot(id);
    const stale=await update(b,id,"accepted",`obsoleto-${i}`,1);
    const after=await snapshot(id);
    assert.equal(stale.status,"conflict");
    assert.deepEqual(after,before);
  }
  pass("B. revisión obsoleta","3 repeticiones; sin sobrescritura, timestamp ni historial adicional");

  // C — archive versus edit, with both possible lock holders.
  for(let i=0;i<6;i++){
    const id=await fresh();
    const archiveWins=i%2===0;
    const holder=archiveWins?a:b,waiter=archiveWins?b:a,waiterName=archiveWins?"stagec5c-b":"stagec5c-a";
    const race=await heldRace({holder,waiter,waiterName,id,
      holderOperation:c=>archiveWins?lifecycle(c,id,"archive",1,"archivo concurrente"):update(c,id,"reviewing","edición concurrente",1),
      waiterOperation:c=>archiveWins?update(c,id,"reviewing","edición perdedora",1):lifecycle(c,id,"archive",1,"archivo perdedor")});
    assertUpdatedConflict(race);
    const final=await snapshot(id);
    assert.equal(final.revision,2);assert.equal(final.history_count,1);
    assert.equal(Boolean(final.archived_at),archiveWins);
    assert.equal(final.status,archiveWins?"new":"reviewing");
  }
  pass("C. archivo contra edición","6 carreras alternadas; estado final coherente y sin pérdida silenciosa");

  // D — delete/restore races from both meaningful starting states.
  for(let i=0;i<3;i++){
    const active=await fresh();
    const race=await heldRace({holder:a,waiter:b,waiterName:"stagec5c-b",id:active,
      holderOperation:c=>lifecycle(c,active,"soft_delete",1,"eliminación concurrente"),
      waiterOperation:c=>lifecycle(c,active,"restore",1,"restauración competidora")});
    assertUpdatedConflict(race);
    const final=await snapshot(active);
    assert.equal(Boolean(final.deleted_at),true);assert.equal(final.revision,2);assert.equal(final.history_count,1);

    const deleted=await fresh();
    const initialDelete=await lifecycle(a,deleted,"soft_delete",1,"preparar restauración");
    assert.equal(initialDelete.status,"updated");
    const reverse=await heldRace({holder:b,waiter:a,waiterName:"stagec5c-a",id:deleted,
      holderOperation:c=>lifecycle(c,deleted,"restore",2,"restauración concurrente"),
      waiterOperation:c=>lifecycle(c,deleted,"soft_delete",2,"eliminación competidora")});
    assertUpdatedConflict(reverse);
    const restored=await snapshot(deleted);
    assert.equal(restored.deleted_at,null);assert.equal(restored.revision,3);assert.equal(restored.history_count,2);
  }
  pass("D. eliminación lógica contra restauración","6 carreras; sin estado imposible, revisión duplicada ni evento duplicado");

  // E — true no-op pair and stale no-op hidden by a real concurrent change.
  for(let i=0;i<3;i++){
    const id=await fresh();
    const before=await snapshot(id);
    const race=await heldRace({holder:a,waiter:b,waiterName:"stagec5c-b",id,
      holderOperation:c=>update(c,id,"new","",1),
      waiterOperation:c=>update(c,id,"new","",1)});
    assert.equal(race.winner.status,"unchanged");assert.equal(race.loser.status,"unchanged");
    assert.deepEqual(await snapshot(id),before);

    const changed=await fresh();
    const staleNoop=await heldRace({holder:b,waiter:a,waiterName:"stagec5c-a",id:changed,
      holderOperation:c=>update(c,changed,"reviewing","cambio real",1),
      waiterOperation:c=>update(c,changed,"new","",1)});
    assertUpdatedConflict(staleNoop);
    const final=await snapshot(changed);
    assert.equal(final.revision,2);assert.equal(final.history_count,1);assert.equal(final.status,"reviewing");
  }
  pass("E. no-op concurrente","no-op estable; revisión obsoleta nunca se oculta como no-op");

  // F — force history insertion failure; primary update must roll back.
  await observer.query(`create function private.qa_fail_history() returns trigger language plpgsql set search_path='' as $$
    begin raise exception 'qa_forced_history_failure'; end $$;
    create trigger qa_fail_history before insert on private.suggestion_moderation_history
    for each row execute function private.qa_fail_history();`);
  for(let i=0;i<3;i++){
    const id=await fresh();
    const before=await snapshot(id);
    await assert.rejects(update(i%2===0?a:b,id,"reviewing","debe revertirse",1),/qa_forced_history_failure/);
    assert.deepEqual(await snapshot(id),before);
  }
  await observer.query("drop trigger qa_fail_history on private.suggestion_moderation_history; drop function private.qa_fail_history()");
  pass("F. historial atómico","3 fallos controlados revirtieron fila, revisión, timestamp e historial");

  // G — direct API-role access and history mutation are blocked.
  const protectedId=await fresh();
  assert.equal((await update(a,protectedId,"reviewing","evento legítimo",1)).status,"updated");
  const security=await observer.query(`select c.relrowsecurity rls,c.relforcerowsecurity force_rls,
    has_table_privilege('anon',c.oid,'select,insert,update,delete') anon_access,
    has_table_privilege('authenticated',c.oid,'select,insert,update,delete') auth_access,
    has_table_privilege('service_role',c.oid,'select,insert,update,delete') service_access
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='suggestion_moderation_history'`);
  assert.deepEqual(security.rows[0],{rls:true,force_rls:true,anon_access:false,auth_access:false,service_access:false});
  for(const role of ["anon","authenticated","service_role"]){
    await observer.query(`set role ${role}`);
    await assert.rejects(observer.query("select * from private.suggestion_moderation_history"),/permission denied/);
    await assert.rejects(observer.query("update private.suggestion_moderation_history set reason='alterado'"),/permission denied/);
    await assert.rejects(observer.query("delete from private.suggestion_moderation_history"),/permission denied/);
    await assert.rejects(observer.query("select private.admin_get_suggestion($1)",[protectedId]),/permission denied/);
    await observer.query("reset role");
  }
  await assert.rejects(observer.query("update private.suggestion_moderation_history set reason='alterado'"),/inmutable/);
  await assert.rejects(observer.query("delete from private.suggestion_moderation_history"),/inmutable/);
  assert.equal((await snapshot(protectedId)).history_count,1);
  pass("G. historial protegido","RLS + FORCE RLS + ACL bloquean API; trigger bloquea mantenimiento ordinario incluso del propietario");

  // Additional security, privacy, state-machine, and future-contract checks.
  const contractId=await fresh({notes:"nota privada"});
  const list=await value(a,"select private.admin_list_suggestions(1,25,null,'all','all','recent','active') value");
  const listed=list.items.find(item=>item.id===contractId);
  assert.ok(listed);assert.equal("description" in listed,false);assert.equal("contact" in listed,false);assert.equal("private_notes" in listed,false);
  const detail=await value(a,"select private.admin_get_suggestion($1) value",[contractId]);
  assert.equal(detail.contact.startsWith("persona"),true);assert.equal(detail.private_notes,"nota privada");
  for(const forbidden of ["request_id","user_id","updated_by","token_hash","network_hash","actor_hash"]){assert.equal(forbidden in detail,false);}
  await b.query("select set_config('app.test_aal','aal1',false)");
  await assert.rejects(value(b,"select private.admin_get_suggestion($1) value",[contractId]),/MFA AAL2/);
  await b.query("select set_config('app.test_aal','aal2',false)");
  await assert.rejects(value(a,"select private.admin_list_suggestions(0,25,null,'all','all','recent','active') value"),/Página inválida/);
  await assert.rejects(value(a,"select private.admin_list_suggestions(1,100,null,'all','all','recent','active') value"),/Tamaño de página inválido/);
  await assert.rejects(value(a,"select private.admin_list_suggestions(1,25,repeat('x',121),'all','all','recent','active') value"),/Búsqueda demasiado extensa/);
  const terminal=await fresh({status:"resolved"});
  await assert.rejects(update(a,terminal,"new","",1,"reabrir"),/Transición de estado no permitida/);

  const expectedPrivate=[
    "private.admin_list_suggestions(integer,integer,text,text,text,text,text)","private.admin_get_suggestion(uuid)",
    "private.admin_update_suggestion(uuid,text,text,integer,text)","private.admin_set_suggestion_lifecycle(uuid,text,integer,text)"
  ];
  for(const identity of expectedPrivate){
    const {rows}=await observer.query(`select p.prosecdef,coalesce(array_to_string(p.proconfig,','),'') settings,
      has_function_privilege('anon',p.oid,'execute') anon_exec,
      has_function_privilege('authenticated',p.oid,'execute') auth_exec,
      has_function_privilege('service_role',p.oid,'execute') service_exec
      from pg_proc p where p.oid=$1::regprocedure`,[identity]);
    assert.equal(rows[0].prosecdef,true);assert.match(rows[0].settings,/search_path=""/);
    assert.equal(rows[0].anon_exec,false);assert.equal(rows[0].auth_exec,false);assert.equal(rows[0].service_exec,false);
  }
  await a.query("select set_config('app.test_role','service_role',false)");
  const v5b=await value(a,"select private.submit_protected_suggestion($1,$2,$3,'guest','otro','Compatibilidad 5B v3','Descripción creada por el contrato real de 5B v3',null,$4,null) value",[
    "1".padStart(64,"0"),"2".padStart(64,"0"),"3".padStart(64,"0"),uuid(sequence++)
  ]);
  await a.query("select set_config('app.test_role','authenticated',false)");
  assert.equal(v5b.status,"accepted");
  for(const [file,pattern] of [
    ["supabase/migrations/20261018171402_stage_c_safe_defaults_v3.sql",/private\.admin_update_suggestion\(uuid,text,text,integer,text\)/],
    ["supabase/migrations/20261025120000_stage_c_public_appearance_wrappers_closed_v3.sql",/cubica_stage_c:20261024233029/],
    ["supabase/migrations/20261025120200_stage_c_suggestion_wrappers_closed_v3.sql",/public\.admin_get_suggestion\(p_id uuid\)/],
    ["supabase/migrations/20261025120300_stage_c_api_storage_activation_v3.sql",/public\.admin_set_suggestion_lifecycle\(uuid,text,integer,text\)/]
  ])assert.match(read(file),pattern,file);
  const ui=read("js/site-experience.js");
  assert.match(ui,/escapeHtml\(s\.description\)/);assert.match(ui,/escapeHtml\(s\.contact\)/);assert.match(ui,/escapeHtml\(s\.private_notes\)/);
  pass("validaciones adicionales","máquina de estados, privacidad, AAL2, límites, ACL, 5B v3, XSS y contratos futuros");

  const blockedEvidence=await observer.query(`select application_name,state,wait_event_type,wait_event
    from pg_stat_activity where application_name in('stagec5c-a','stagec5c-b') order by application_name`);
  pass("ausencia de deadlocks","todas las carreras finalizaron bajo statement_timeout=8s y lock_timeout=6s");
  console.log(JSON.stringify({postgres:server_version,connections:3,real_overlap:"pg_stat_activity.wait_event_type=Lock",iterations:{A:6,B:3,C:6,D:6,E:6,F:3,G:3},sessions:blockedEvidence.rows,results,passed:results.length,failed:0},null,2));
}finally{
  await a.end();await b.end();await observer.end();
}
