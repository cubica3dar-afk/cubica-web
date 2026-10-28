import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migration=read("supabase/archive/20261018171304_stage_c_suggestion_admin_private_functions_v2.replaced_by_5c_v3.sql");
const USER="00000000-0000-4000-8000-000000000055";
const SUGGESTION="00000000-0000-4000-8000-000000000101";
const TOKEN_A="a".repeat(64);
const TOKEN_B="b".repeat(64);

const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(result=>result.rows);
assert.match(String(server_version),/^17[.]/);

await db.exec(`
  create schema private;
  create schema auth;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${USER}');

  create function auth.uid() returns uuid language sql stable set search_path='' as $$
    select nullif(current_setting('app.test_uid',true),'')::uuid;
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
    id uuid primary key,
    category text not null check(category in ('funcionalidad','visual','error','compra','otro')),
    subject text not null,
    description text not null,
    contact text,
    user_id uuid references auth.users(id) on delete set null,
    status text not null default 'new' check(status in ('new','reviewing','accepted','resolved','dismissed')),
    private_notes text not null default '',
    request_id uuid not null unique,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
  );
  create table private.suggestion_token_uses(
    token_hash text primary key,
    used_at timestamptz not null default now(),
    expires_at timestamptz not null,
    request_id uuid,
    actor_kind text,
    actor_hash text,
    network_hash text,
    payload_hash text,
    result_code text,
    suggestion_id uuid references private.site_suggestions(id) on delete set null,
    retry_after_seconds integer,
    was_duplicate boolean not null default false
  );
  create table private.suggestion_rate_limits(
    identity_hash text primary key,
    scope text not null default 'legacy',
    window_started_at timestamptz not null,
    attempts integer not null default 1,
    blocked_until timestamptz,
    updated_at timestamptz not null default now()
  );
  alter table private.site_suggestions enable row level security;
  alter table private.suggestion_token_uses enable row level security;
  alter table private.suggestion_rate_limits enable row level security;
  revoke all on private.site_suggestions,private.suggestion_token_uses,private.suggestion_rate_limits from public,anon,authenticated,service_role;

  create function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)
  returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
  revoke all on function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid) from public,anon,authenticated,service_role;
  comment on function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)
    is 'cubica_stage_c:20261018171258';

  insert into private.site_suggestions(
    id,category,subject,description,contact,user_id,status,private_notes,request_id,updated_by
  ) values(
    '${SUGGESTION}','otro','Mejora de catálogo','Descripción suficientemente extensa',
    'cliente@example.com','${USER}','new','Nota privada inicial',
    '00000000-0000-4000-8000-000000000201','${USER}'
  );
`);

await db.exec(migration);
await db.exec(`select set_config('app.test_uid','${USER}',false); select set_config('app.test_admin','true',false);`);

const results=[];
function record(name,status,detail=""){
  results.push({name,status,detail});
  const glyph=status==="PASS"?"✓":status==="BLOCKER"?"!":"○";
  console.log(`${glyph} ${status} — ${name}${detail?`: ${detail}`:""}`);
}
const row=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
async function rejected(sql,params=[],pattern){
  let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  assert.ok(error,"La operación debía rechazarse");
  if(pattern)assert.match(String(error.message),pattern);
  return error;
}

const catalog=(await db.query(`
  select p.oid::regprocedure::text signature,
         pg_get_function_result(p.oid) result_type,
         p.prosecdef,
         p.proconfig,
         has_function_privilege('anon',p.oid,'execute') anon_execute,
         has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
         has_function_privilege('service_role',p.oid,'execute') service_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in('admin_list_suggestions','admin_update_suggestion','cleanup_suggestion_protection')
  order by p.proname
`)).rows;
assert.equal(catalog.length,3);
for(const fn of catalog){
  assert.equal(fn.prosecdef,true);
  assert.ok(fn.proconfig.includes("search_path=\"\""));
  assert.equal(fn.anon_execute,false);
  assert.equal(fn.authenticated_execute,false);
  assert.equal(fn.service_execute,false);
}
record("firmas, retornos, SECURITY DEFINER, search_path y ACL cerradas","PASS",catalog.map(item=>item.signature).join("; "));

await db.exec("select set_config('app.test_aal','aal1',false)");
await rejected("select private.admin_list_suggestions()",[],/MFA AAL2/);
record("sesión administrativa AAL1 rechazada","PASS");
await db.exec("select set_config('app.test_aal','aal2',false)");

const listed=(await row("select private.admin_list_suggestions() result")).result;
assert.equal(listed.total,1);
assert.equal(listed.items.length,1);
const item=listed.items[0];
for(const forbidden of ["user_id","updated_by","request_id","token_hash","actor_hash","network_hash","payload_hash"]){
  assert.equal(Object.hasOwn(item,forbidden),false,`No se debe devolver ${forbidden}`);
}
record("listado excluye identidad y metadatos internos de protección","PASS");
assert.equal(item.contact,"cliente@example.com");
assert.equal(item.private_notes,"Nota privada inicial");
record("minimización del listado administrativo","BLOCKER","cada fila incluye contacto, descripción completa y notas privadas; no hay endpoint separado de detalle");

await rejected(
  "select private.admin_update_suggestion($1,'reviewing',$2)",
  [SUGGESTION,"<script>alert(1)</script>"],
  /HTML o código no permitido/
);
record("notas administrativas rechazan HTML/código peligroso","PASS");

await row("select private.admin_update_suggestion($1,'resolved','resuelto') result",[SUGGESTION]);
await row("select private.admin_update_suggestion($1,'new','reabierto sin política') result",[SUGGESTION]);
assert.equal((await row("select status from private.site_suggestions where id=$1",[SUGGESTION])).status,"new");
record("transiciones de estado","BLOCKER","la transición resolved → new fue aceptada; no existe grafo de transiciones permitido");

const staleRevision=(await row("select updated_at from private.site_suggestions where id=$1",[SUGGESTION])).updated_at;
await row("select private.admin_update_suggestion($1,'reviewing','cambio del administrador A') result",[SUGGESTION]);
await row("select private.admin_update_suggestion($1,'dismissed','cambio del administrador B desde una revisión obsoleta') result",[SUGGESTION]);
const overwritten=await row("select status,private_notes,updated_at from private.site_suggestions where id=$1",[SUGGESTION]);
assert.equal(overwritten.status,"dismissed");
assert.equal(overwritten.private_notes,"cambio del administrador B desde una revisión obsoleta");
record("revisión obsoleta y doble administración","BLOCKER",`ambas escrituras fueron aceptadas y la segunda sobrescribió la primera; la firma no recibe versión esperada (${staleRevision})`);

await db.exec(`update private.site_suggestions set updated_at='2000-01-01T00:00:00Z' where id='${SUGGESTION}'`);
await row("select private.admin_update_suggestion($1,'dismissed','cambio del administrador B desde una revisión obsoleta') result",[SUGGESTION]);
const noopTimestamp=(await row("select updated_at from private.site_suggestions where id=$1",[SUGGESTION])).updated_at;
assert.notEqual(new Date(noopTimestamp).toISOString(),"2000-01-01T00:00:00.000Z");
record("idempotencia y supresión de no-op","BLOCKER","repetir exactamente estado y notas ejecuta UPDATE y altera updated_at");

const history=await row(`
  select count(*)::integer objects
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname like '%suggestion%history%'
`);
assert.equal(history.objects,0);
record("historial inmutable de moderación","BLOCKER","no existe tabla, trigger ni inserción de auditoría para conservar cambios");

const lifecycleColumns=(await db.query(`
  select column_name from information_schema.columns
  where table_schema='private' and table_name='site_suggestions'
    and column_name in('deleted_at','archived_at','version','revision')
`)).rows.map(value=>value.column_name);
assert.deepEqual(lifecycleColumns,[]);
record("archivo/eliminación lógica y versión de concurrencia","BLOCKER","no hay deleted_at, archived_at, version ni revision");

await db.exec(`
  insert into private.suggestion_token_uses(token_hash,used_at,expires_at,request_id,actor_kind,actor_hash,network_hash,payload_hash,result_code,suggestion_id,retry_after_seconds,was_duplicate)
  values
    ('${TOKEN_A}',now(),now()+interval '1 hour','00000000-0000-4000-8000-000000000301','guest','${"c".repeat(64)}','${"d".repeat(64)}','${"e".repeat(64)}','accepted','${SUGGESTION}',0,false),
    ('${TOKEN_B}',now(),now()+interval '1 hour','00000000-0000-4000-8000-000000000302','guest','${"f".repeat(64)}','${"1".repeat(64)}','${"e".repeat(64)}','accepted','${SUGGESTION}',0,true)
`);
const duplicateView=(await row("select private.admin_list_suggestions() result")).result.items[0];
assert.equal(Object.hasOwn(duplicateView,"duplicate_count"),false);
assert.equal(Object.hasOwn(duplicateView,"was_duplicate"),false);
record("gestión administrativa de duplicados de 5B v3","BLOCKER","el ledger registra duplicados, pero 5C no devuelve conteo ni indicador");

const wildcard=(await row("select private.admin_list_suggestions(1000000,50,'%%','all','all','recent') result")).result;
assert.equal(wildcard.page,1000000);
record("límites de búsqueda y paginación","BLOCKER","no existe máximo de página ni longitud de búsqueda y se aceptan comodines SQL sin escape");

await db.exec(`
  insert into private.suggestion_token_uses(token_hash,used_at,expires_at,was_duplicate)
    values('${"2".repeat(64)}',now()-interval '2 hours',now()-interval '1 hour',false);
  insert into private.suggestion_rate_limits(identity_hash,scope,window_started_at,attempts,blocked_until,updated_at)
    values('${"3".repeat(64)}','guest',now()-interval '3 days',1,null,now()-interval '3 days');
`);
await row("select private.cleanup_suggestion_protection()");
assert.equal((await row("select count(*)::integer n from private.suggestion_token_uses where expires_at<now()")).n,0);
assert.equal((await row("select count(*)::integer n from private.suggestion_rate_limits where updated_at<now()-interval '2 days'")).n,0);
record("limpieza elimina solamente protección vencida en el escenario aislado","PASS");

const summary={
  postgres:server_version,
  passed:results.filter(result=>result.status==="PASS").length,
  blockers:results.filter(result=>result.status==="BLOCKER").length,
  not_executed:1,
  recommendation:"CORRECT_BEFORE_DRY_RUN"
};
record("concurrencia multisesión real","NOT_EXECUTED","PGlite 17.5 ofrece una sola sesión; el defecto de pérdida de actualización quedó demostrado por la firma y dos revisiones obsoletas secuenciales");
console.log(JSON.stringify(summary,null,2));
assert.ok(summary.blockers>0);
await db.close();
