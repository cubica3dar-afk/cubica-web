import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const protection=read("supabase/migrations/20261018171258_stage_c_suggestion_protection_private_functions_v3.sql");
const migration=read("supabase/migrations/20261024233029_stage_c_suggestion_admin_private_functions_v3.sql");
const ADMIN_A="00000000-0000-4000-8000-000000000051";
const ADMIN_B="00000000-0000-4000-8000-000000000052";
const USER="00000000-0000-4000-8000-000000000055";
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash=n=>Number(n).toString(16).padStart(64,"0");

const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(result=>result.rows);
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
  create function extensions.digest(p_data bytea,p_algorithm text) returns bytea
  language sql immutable set search_path='' as $$
    select decode(md5(convert_from(p_data,'UTF8'))||md5('stage-c-5c-test:'||convert_from(p_data,'UTF8')),'hex');
  $$;
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

await db.exec(protection);
await db.exec(migration);
await db.exec(`
  select set_config('app.test_uid','${ADMIN_A}',false);
  select set_config('app.test_admin','true',false);
  select set_config('app.test_aal','aal2',false);
  select set_config('app.test_role','authenticated',false);
`);

const results=[];
const record=(name,status="PASS",detail="")=>{
  results.push({name,status,detail});
  console.log(`${status==="PASS"?"✓":"○"} ${name}${detail?`: ${detail}`:""}`);
};
const row=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
async function rejected(sql,params=[],pattern,code){
  let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  assert.ok(error,"La operación debía rechazarse");
  if(pattern)assert.match(String(error.message),pattern);
  if(code)assert.equal(error.code,code);
  return error;
}
async function insertSuggestion(n,{status="new",subject=`Sugerencia ${n}`,description=`Descripción suficientemente extensa para ${n}`,contact=`persona${n}@example.com`}={}){
  const id=uuid(1000+n),requestId=uuid(2000+n);
  await db.query(`insert into private.site_suggestions(id,category,subject,description,contact,user_id,status,private_notes,request_id)
    values($1,'otro',$2,$3,$4,$5,$6,'',$7)`,[id,subject,description,contact,USER,status,requestId]);
  return id;
}
const list=async(args=[1,25,null,"all","all","recent","active"])=>(await row(
  "select private.admin_list_suggestions($1,$2,$3,$4,$5,$6,$7) result",args
)).result;
const detail=async id=>(await row("select private.admin_get_suggestion($1) result",[id])).result;
const update=async(id,status,notes,revision,reason=null)=>(await row(
  "select private.admin_update_suggestion($1,$2,$3,$4,$5) result",[id,status,notes,revision,reason]
)).result;
const lifecycle=async(id,action,revision,reason)=>(await row(
  "select private.admin_set_suggestion_lifecycle($1,$2,$3,$4) result",[id,action,revision,reason]
)).result;

const first=await insertSuggestion(1,{subject:"Mejora privada",description:"Detalle privado que solo debe aparecer al abrir una sugerencia"});
let page=await list();
assert.equal(page.total,1);
assert.deepEqual(Object.keys(page.items[0]).sort(),[
  "archived_at","category","created_at","deleted_at","id","recent_duplicate_count","revision","status","subject","updated_at"
].sort());
record("1. listado administrativo mínimo");

let full=await detail(first);
assert.equal(full.description,"Detalle privado que solo debe aparecer al abrir una sugerencia");
assert.equal(full.contact,"persona1@example.com");
assert.equal(full.revision,1);
record("2. consulta detallada autorizada");

await db.exec("select set_config('app.test_aal','aal1',false)");
await rejected("select private.admin_get_suggestion($1)",[first],/MFA AAL2/,"42501");
record("3. AAL1 rechazado");
await db.exec("select set_config('app.test_aal','aal2',false); select set_config('app.test_admin','false',false)");
await rejected("select private.admin_list_suggestions()",[],/MFA AAL2/,"42501");
record("4. usuario no administrador rechazado");
await db.exec("select set_config('app.test_admin','true',false)");

assert.equal((await list([1,10,"Mejora","new","otro","oldest","active"])).total,1);
record("5. filtros válidos");
await rejected("select private.admin_list_suggestions(1,25,$1,'all','all','recent','active')",["x".repeat(121)],/demasiado extensa/);
await rejected("select private.admin_list_suggestions(1,25,null,'desconocido','all','recent','active')",[],/Filtro inválido/);
record("6. búsquedas inválidas o excesivas rechazadas");
await rejected("select private.admin_list_suggestions(0,25,null,'all','all','recent','active')",[],/Página inválida/);
await rejected("select private.admin_list_suggestions(1,100,null,'all','all','recent','active')",[],/Tamaño de página inválido/);
record("7. límites de paginación");

const second=await insertSuggestion(2,{subject:"Orden estable"});
await db.query("update private.site_suggestions set created_at='2026-01-01T00:00:00Z' where id in($1,$2)",[first,second]);
page=await list([1,25,null,"all","all","recent","active"]);
assert.deepEqual(page.items.map(item=>item.id),[first,second].sort());
record("8. orden determinista con desempate por id");

let changed=await update(first,"reviewing","Analizando",1);
assert.equal(changed.status,"updated");
assert.equal(changed.suggestion.revision,2);
record("9. cambio de estado válido");
await rejected("select private.admin_update_suggestion($1,'new','Analizando',2,null)",[first],/Transición de estado no permitida/);
record("10. transición prohibida");

const stale=await update(first,"accepted","Aceptada",1);
assert.equal(stale.status,"conflict");
assert.equal(stale.current.revision,2);
record("11. revisión obsoleta devuelve conflicto explícito");
const winner=await update(first,"accepted","Aceptada",2);
const loser=await update(first,"resolved","Resolución competidora",2,"Cierre");
assert.equal(winner.suggestion.revision,3);
assert.equal(loser.status,"conflict");
record("12. dos modificaciones sobre la misma revisión: una sola gana");

full=await detail(first);
const beforeNoop={revision:full.revision,updated_at:full.updated_at,history_total:full.history_total};
const noop=await update(first,full.status,full.private_notes,full.revision);
full=await detail(first);
assert.equal(noop.status,"unchanged");
record("13. actualización repetida se distingue como no-op");
assert.equal(full.updated_at,beforeNoop.updated_at);
record("14. updated_at estable ante no-op");
assert.equal(full.revision,beforeNoop.revision);
record("15. revisión estable ante no-op");
assert.equal(full.history_total,beforeNoop.history_total);
assert.equal(full.history[0].operation,"update");
record("16. historial creado solo para cambios efectivos");

const historyBefore=full.history_total;
await rejected("select private.admin_update_suggestion($1,'resolved','cierre',3,null)",[first],/motivo es obligatorio/);
assert.equal((await detail(first)).history_total,historyBefore);
record("17. operaciones fallidas no crean historial");

await rejected("update private.suggestion_moderation_history set reason='alterado' where suggestion_id=$1",[first],/inmutable/);
await db.exec("set role authenticated");
await rejected("select * from private.suggestion_moderation_history",[],/permission denied|does not exist/);
await db.exec("reset role");
record("18. historial inmutable y cerrado a roles de API");

let life=await lifecycle(second,"archive",1,"Archivado administrativo");
assert.equal(life.suggestion.revision,2);
assert.ok(life.suggestion.archived_at);
assert.equal((await list([1,25,null,"all","all","recent","archived"])).total,1);
record("19. archivo y consulta de archivados");
life=await lifecycle(second,"soft_delete",2,"Eliminación lógica solicitada");
assert.ok(life.suggestion.deleted_at);
assert.equal((await list([1,25,null,"all","all","recent","deleted"])).total,1);
record("20. eliminación lógica");
life=await lifecycle(second,"restore",3,"Restauración autorizada");
assert.equal(life.suggestion.deleted_at,null);
assert.ok(life.suggestion.archived_at,"Restaurar no debe desarchivar ni cambiar el estado");
record("21. restauración conserva estado y archivo");
const staleRestore=await lifecycle(second,"restore",3,"Reintento obsoleto");
assert.equal(staleRestore.status,"conflict");
record("22. restauración conflictiva rechazada");

page=await list([1,25,null,"all","all","recent","archived"]);
assert.equal(Object.hasOwn(page.items[0],"contact"),false);
assert.equal(Object.hasOwn(page.items[0],"description"),false);
assert.equal(Object.hasOwn(page.items[0],"private_notes"),false);
assert.equal((await detail(second)).contact,"persona2@example.com");
record("23. datos privados separados entre listado y detalle");

await db.exec("select set_config('app.test_role','service_role',false)");
const submitted=(await row(
  "select private.submit_protected_suggestion($1,$2,$3,'guest','otro','Nueva idea','Descripción suficientemente extensa',null,$4,null) result",
  [hash(100),hash(101),hash(102),uuid(3001)]
)).result;
assert.equal(submitted.status,"accepted");
assert.equal((await detail(submitted.suggestion_id)).revision,1);
record("24. compatibilidad con inserciones de 5B v3");

const duplicate=(await row(
  "select private.submit_protected_suggestion($1,$2,$3,'guest','otro','Nueva idea','Descripción suficientemente extensa',null,$4,null) result",
  [hash(103),hash(104),hash(102),uuid(3002)]
)).result;
assert.equal(duplicate.duplicate,true);
assert.equal((await detail(submitted.suggestion_id)).recent_duplicate_count,1);
assert.equal((await list()).items.find(item=>item.id===submitted.suggestion_id).recent_duplicate_count,1);
record("25. duplicados aceptados por 5B visibles sin exponer hashes");

await db.exec(`
  insert into private.suggestion_token_uses(token_hash,used_at,expires_at,was_duplicate)
  values('${hash(105)}',now()-interval '2 hours',now()-interval '1 hour',false);
  insert into private.suggestion_rate_limits(identity_hash,scope,window_started_at,attempts,blocked_until,updated_at)
  values('${hash(106)}','guest',now()-interval '3 days',1,null,now()-interval '3 days');
`);
const historyBeforeCleanup=(await row("select count(*)::integer n from private.suggestion_moderation_history")).n;
await row("select private.cleanup_suggestion_protection()");
assert.equal((await row("select count(*)::integer n from private.suggestion_token_uses where expires_at<now()")).n,0);
assert.equal((await row("select count(*)::integer n from private.suggestion_moderation_history")).n,historyBeforeCleanup);
record("26. limpieza segura no toca historial de moderación");

const atomic=await insertSuggestion(3);
await db.exec(`
  create function private.qa_fail_history() returns trigger language plpgsql set search_path='' as $$
  begin raise exception 'qa_history_failure'; end; $$;
  create trigger qa_fail_history before insert on private.suggestion_moderation_history
  for each row execute function private.qa_fail_history();
`);
await rejected("select private.admin_update_suggestion($1,'reviewing','No debe persistir',1,null)",[atomic],/qa_history_failure/);
assert.deepEqual(await row("select status,revision,private_notes from private.site_suggestions where id=$1",[atomic]),{status:"new",revision:1,private_notes:""});
await db.exec("drop trigger qa_fail_history on private.suggestion_moderation_history; drop function private.qa_fail_history()");
record("27. error de historial revierte atómicamente la sugerencia");

await db.exec("begin");
const rolled=await insertSuggestion(4);
await update(rolled,"reviewing","Temporal",1);
await db.exec("rollback");
assert.equal((await row("select count(*)::integer n from private.site_suggestions where id=$1",[rolled])).n,0);
assert.equal((await row("select count(*)::integer n from private.suggestion_moderation_history where suggestion_id=$1",[rolled])).n,0);
record("28. ROLLBACK sin residuos");

const expectedSignatures=[
  "private.stage_c_prevent_suggestion_history_mutation()",
  "private.stage_c_suggestion_transition_allowed(text,text)",
  "private.admin_list_suggestions(integer,integer,text,text,text,text,text)",
  "private.admin_get_suggestion(uuid)",
  "private.admin_update_suggestion(uuid,text,text,integer,text)",
  "private.admin_set_suggestion_lifecycle(uuid,text,integer,text)",
  "private.cleanup_suggestion_protection()"
];
for(const signature of expectedSignatures){
  const fn=await row("select p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon_exec,has_function_privilege('authenticated',p.oid,'execute') auth_exec,has_function_privilege('service_role',p.oid,'execute') service_exec from pg_proc p where p.oid=to_regprocedure($1)::oid",[signature]);
  assert.ok(fn);
  assert.ok(fn.proconfig.includes('search_path=""'));
  assert.equal(fn.anon_exec,false);assert.equal(fn.auth_exec,false);assert.equal(fn.service_exec,false);
}
assert.equal((await row("select obj_description(to_regprocedure('private.admin_update_suggestion(uuid,text,text,integer,text)')::oid,'pg_proc') value")).value,"cubica_stage_c:20261024233029");
record("29. funciones, firmas, search_path, ACL y centinela");

const security=await row(`
  select
    (select relrowsecurity and relforcerowsecurity from pg_class where oid='private.suggestion_moderation_history'::regclass) history_rls,
    (select count(*)::integer from information_schema.role_table_grants where table_schema='private' and table_name in('site_suggestions','suggestion_moderation_history') and grantee in('PUBLIC','anon','authenticated','service_role')) direct_grants,
    to_regprocedure('public.admin_get_suggestion(uuid)') is null no_public_detail
`);
assert.deepEqual(security,{history_rls:true,direct_grants:0,no_public_detail:true});
record("30. RLS, ACL y ausencia de wrappers públicos prematuros");

record("31. concurrencia multisesión real","NOT_EXECUTED","PGlite 17.5 ofrece una sola sesión; se requiere un servidor PostgreSQL 17 aislado con dos conexiones");

const summary={
  server_version,
  passed:results.filter(result=>result.status==="PASS").length,
  failed:results.filter(result=>result.status==="FAIL").length,
  not_executed:results.filter(result=>result.status==="NOT_EXECUTED").length
};
console.log(JSON.stringify(summary,null,2));
assert.equal(summary.failed,0);
assert.equal(summary.passed,30);
await db.close();
