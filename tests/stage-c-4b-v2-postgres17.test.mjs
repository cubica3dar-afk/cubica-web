import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql");
const activeCampaign=read("supabase/migrations/20261018171218_stage_c_active_campaign_private_function_v3.sql");
const appearanceV2=read("supabase/migrations/20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql");
const campaignV2=read("supabase/migrations/20261018171254_stage_c_campaign_admin_private_functions_v2.sql");
const verification=read("supabase/verification/20261018171254_verify.sql");
const rollbackSql=read("supabase/rollback/20261018171254_stage_c_campaign_admin_private_functions_v2.sql");

const ADMIN="00000000-0000-0000-0000-000000000099";
const ADMIN2="00000000-0000-0000-0000-000000000098";
const uuid=n=>`10000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(r=>r.rows);
assert.match(String(server_version),/^17[.]/);
await db.exec(bootstrap);
await db.exec(`
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${ADMIN}'),('${ADMIN2}');
  create table private.site_campaign_occurrences(
    id bigint generated always as identity primary key,
    campaign_id uuid not null references private.site_campaigns(id) on delete cascade,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    created_at timestamptz not null default now(),
    created_by uuid,
    check(starts_at<ends_at),
    unique(campaign_id,starts_at,ends_at)
  );
  create table private.site_welcome_phrases(
    id bigint generated always as identity primary key,
    campaign_id uuid references private.site_campaigns(id) on delete cascade,
    phrase text not null,
    active boolean not null default true,
    sort_order integer not null default 0,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    created_by uuid,
    updated_at timestamptz not null default now(),
    updated_by uuid,
    deleted_at timestamptz
  );
  select set_config('app.test_uid','${ADMIN}',false);
  select set_config('app.test_admin','true',false);
  select set_config('app.test_aal','aal2',false);
`);
await db.exec(activeCampaign);
await db.exec(appearanceV2);
await db.exec(campaignV2);

const results=[];
const pass=name=>{results.push({name,status:"APROBADA"});console.log(`✓ ${name}`);};
const noRun=(name,reason)=>{results.push({name,status:"NO EJECUTADA",reason});console.log(`○ ${name}: NO EJECUTADA — ${reason}`);};
let savepoint=0;
async function rejected(sql,params=[],pattern,code){
  const name=`expected_${++savepoint}`;
  await db.exec(`savepoint ${name}`);
  let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  await db.exec(`rollback to savepoint ${name}; release savepoint ${name}`);
  assert.ok(error,"La operación debía ser rechazada");
  if(pattern)assert.match(String(error.message),pattern);
  if(code)assert.equal(error.code,code);
  return error;
}
const baseTheme=assets=>({
  colors:{background:"#17172b",panel:"#20213a",panelAlt:"#282a46",text:"#f7f7fb",muted:"#a7a9c0",accent:"#ffffff"},
  hero:{title:"Campaña QA",subtitle:"Prueba aislada"},
  assets:assets||{logo:null,banner:null,background:null}
});
async function upsert({id=null,name="Campaña QA",description="",priority=0,mode="none",start="2028-01-01T00:00:00-03:00",end="2028-01-02T00:00:00-03:00",annual=null,theme=baseTheme(),occurrences=[],expected=0,request=null}={}){
  const a=annual||[null,null,null,null,null,null];
  const q=`select private.admin_upsert_site_campaign(
    $1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,
    $8,$9,$10::time,$11,$12,$13::time,$14::jsonb,$15::jsonb,$16,$17::uuid
  ) value`;
  const p=[id,name,description,priority,mode,mode==="none"?start:null,mode==="none"?end:null,...a,JSON.stringify(theme),JSON.stringify(occurrences),expected,request];
  return (await db.query(q,p)).rows[0].value;
}
async function setState(id,state,expected,request){
  return (await db.query("select private.admin_set_site_campaign_state($1::uuid,$2,$3,$4::uuid) value",[id,state,expected,request])).rows[0].value;
}
async function duplicate(id,expected,request){
  return (await db.query("select private.admin_duplicate_site_campaign($1::uuid,$2,$3::uuid) value",[id,expected,request])).rows[0].value;
}

const shape=await db.query(`
  select p.oid::regprocedure::text identity,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') service_role_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in(
    'stage_c_begin_campaign_operation','stage_c_complete_campaign_operation',
    'admin_upsert_site_campaign','admin_set_site_campaign_state',
    'admin_duplicate_site_campaign','admin_delete_site_campaign'
  ) order by identity
`);
assert.equal(shape.rows.length,6);
for(const row of shape.rows){
  assert.equal(row.prosecdef,true,row.identity);
  assert.deepEqual(row.proconfig,["search_path=\"\""],row.identity);
  assert.equal(row.public_execute,false,row.identity);
  assert.equal(row.anon_execute,false,row.identity);
  assert.equal(row.authenticated_execute,false,row.identity);
  assert.equal(row.service_role_execute,false,row.identity);
}
const tableSecurity=(await db.query(`select c.relrowsecurity,
  has_table_privilege('anon','private.site_campaign_idempotency','select') anon_select,
  has_table_privilege('authenticated','private.site_campaign_idempotency','select') authenticated_select,
  has_table_privilege('service_role','private.site_campaign_idempotency','select') service_select
  from pg_class c where c.oid='private.site_campaign_idempotency'::regclass`)).rows[0];
assert.deepEqual(tableSecurity,{relrowsecurity:true,anon_select:false,authenticated_select:false,service_select:false});
const verificationReport=(await db.query(verification)).rows[0].jsonb_build_object;
assert.equal(verificationReport.sentinel_ok,true);
assert.equal(verificationReport.idempotency_table_present,true);
assert.equal(verificationReport.result_campaign_index_present,true);
assert.equal(verificationReport.old_signatures_absent,true);
for(const fn of verificationReport.functions){
  assert.equal(fn.present,true,fn.signature);
  assert.equal(fn.security_definer,true,fn.signature);
  assert.equal(fn.search_path_restricted,true,fn.signature);
  assert.equal(fn.public_execute,false,fn.signature);
  assert.equal(fn.anon_execute,false,fn.signature);
  assert.equal(fn.authenticated_execute,false,fn.signature);
  assert.equal(fn.service_role_execute,false,fn.signature);
}
pass("seguridad: seis funciones cerradas y tabla privada con RLS");

await db.exec("begin");
try{
  const createKey=uuid(1);
  const first=await upsert({name:"Única",request:createKey});
  assert.ok(first.id);
  pass("1. creación inicial");

  const replay=await upsert({name:"Única",request:createKey});
  assert.equal(replay.id,first.id);
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns where name='Única'")).rows[0].n,1);
  pass("2. repetición de creación devuelve la campaña original");

  await db.exec(`select set_config('app.test_uid','${ADMIN2}',false)`);
  const otherAdmin=await upsert({name:"Única",request:createKey});
  assert.notEqual(otherAdmin.id,first.id);
  await db.exec(`select set_config('app.test_uid','${ADMIN}',false)`);
  pass("aislamiento: otro administrador no recibe el resultado de la primera identidad");

  await rejected(`select private.admin_upsert_site_campaign(
    null,'Contenido distinto','',0,'none','2028-01-01T00:00:00-03','2028-01-02T00:00:00-03',
    null,null,null,null,null,null,$1::jsonb,'[]'::jsonb,0,$2::uuid
  )`,[JSON.stringify(baseTheme()),createKey],/otros datos/,"22023");
  pass("3. reutilización de clave con parámetros diferentes rechazada");

  const intentional=await upsert({name:"Única",request:uuid(2)});
  assert.notEqual(intentional.id,first.id);
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns where name='Única'")).rows[0].n,3);
  pass("4. claves distintas permiten campañas intencionalmente idénticas");

  const assetPath=`${ADMIN}/${uuid(20)}.png`;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('site-assets',$1,jsonb_build_object('mimetype','image/png','size',128))",[assetPath]);
  const asset=(await db.query("select private.admin_register_site_asset('campaign','Campaña QA',$1,'image/png',128,64,64) value",[assetPath])).rows[0].value;
  const source=await upsert({
    name:"Fuente",mode:"custom",start:null,end:null,request:uuid(3),
    theme:baseTheme({logo:asset.id,banner:null,background:null}),
    occurrences:[
      {starts_at:"2028-02-01T00:00:00-03:00",ends_at:"2028-02-02T00:00:00-03:00"},
      {starts_at:"2028-03-01T00:00:00-03:00",ends_at:"2028-03-02T00:00:00-03:00"}
    ]
  });
  await db.query("insert into private.site_welcome_phrases(campaign_id,phrase,sort_order,created_by,updated_by) values($1,'Frase A',1,$2,$2),($1,'Frase B',2,$2,$2)",[source.id,ADMIN]);

  const duplicateKey=uuid(4);
  const copy=await duplicate(source.id,source.version,duplicateKey);
  assert.notEqual(copy.id,source.id);
  pass("5. duplicación inicial");

  const copyReplay=await duplicate(source.id,source.version,duplicateKey);
  assert.equal(copyReplay.id,copy.id);
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns where name='Fuente — copia'")).rows[0].n,1);
  pass("6. repetición de duplicación devuelve la misma copia");

  const secondCopy=await duplicate(source.id,source.version,uuid(5));
  assert.notEqual(secondCopy.id,copy.id);
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns where name='Fuente — copia'")).rows[0].n,2);
  pass("7. solicitudes distintas permiten duplicaciones intencionales");

  for(const duplicateId of [copy.id,secondCopy.id]){
    assert.equal((await db.query("select count(*)::int n from private.site_campaign_occurrences where campaign_id=$1",[duplicateId])).rows[0].n,2);
    assert.equal((await db.query("select count(*)::int n from private.site_welcome_phrases where campaign_id=$1",[duplicateId])).rows[0].n,2);
    assert.equal((await db.query("select theme#>>'{assets,logo}' asset from private.site_campaigns where id=$1",[duplicateId])).rows[0].asset,asset.id);
  }
  pass("14. copia coherente de múltiples fechas, frases y recursos");

  const publishKey=uuid(6);
  const published=await setState(first.id,"published",first.version,publishKey);
  assert.equal(published.version,first.version+1);
  const publishedAt=published.published_at;
  pass("8. publicación inicial");

  const publishReplay=await setState(first.id,"published",first.version,publishKey);
  assert.equal(publishReplay.version,published.version);
  assert.equal(publishReplay.published_at,publishedAt);
  const sameState=await setState(first.id,"published",published.version,uuid(7));
  assert.equal(sameState.version,published.version);
  assert.equal(sameState.published_at,publishedAt);
  pass("9. republicación sin cambios es idempotente");

  const disabled=await setState(first.id,"disabled",published.version,uuid(8));
  const edited=await upsert({id:first.id,name:"Única editada",expected:disabled.version,request:null});
  const republished=await setState(first.id,"published",edited.version,uuid(9));
  assert.equal(republished.version,edited.version+1);
  assert.equal(republished.state,"published");
  pass("10. edición y nueva publicación legítima");

  await rejected("select private.admin_set_site_campaign_state($1::uuid,'published',$2,$3::uuid)",[first.id,edited.version,uuid(10)],/cambió o no existe/,"40001");
  pass("11. publicación con revisión obsoleta rechazada");

  await rejected("select private.admin_duplicate_site_campaign($1::uuid,$2,$3::uuid)",[source.id,source.version-1,uuid(11)],/cambió o no existe/,"40001");
  pass("12. duplicación con revisión obsoleta rechazada");

  await db.query("select private.admin_delete_site_campaign($1::uuid,$2)",[source.id,source.version]);
  await rejected("select private.admin_duplicate_site_campaign($1::uuid,$2,$3::uuid)",[source.id,source.version+1,uuid(12)],/cambió o no existe/,"40001");
  pass("13. duplicación de campaña eliminada rechazada");

  const failureSource=await upsert({name:"Fallo atómico",request:uuid(13)});
  await db.query("insert into private.site_welcome_phrases(campaign_id,phrase,created_by,updated_by) values($1,'PROVOCAR_FALLO',$2,$2)",[failureSource.id,ADMIN]);
  await db.exec(`
    create function private.old_campaign() returns uuid language sql stable set search_path='' as $$
      select id from private.site_campaigns where name='Fallo atómico' limit 1;
    $$;
    create function private.qa_fail_phrase_copy() returns trigger language plpgsql set search_path='' as $$
    begin
      if new.phrase='PROVOCAR_FALLO' and new.campaign_id<>private.old_campaign() then
        raise exception 'fallo intermedio QA';
      end if;
      return new;
    end; $$;
    create trigger qa_fail_phrase before insert on private.site_welcome_phrases
      for each row execute function private.qa_fail_phrase_copy();
  `);
  const failureKey=uuid(14);
  await rejected("select private.admin_duplicate_site_campaign($1::uuid,$2,$3::uuid)",[failureSource.id,failureSource.version,failureKey],/fallo intermedio QA/);
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns where name='Fallo atómico — copia'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from private.site_campaign_idempotency where request_id=$1",[failureKey])).rows[0].n,0);
  await db.exec("drop trigger qa_fail_phrase on private.site_welcome_phrases; drop function private.qa_fail_phrase_copy(); drop function private.old_campaign();");
  const recoveredCopy=await duplicate(failureSource.id,failureSource.version,failureKey);
  assert.ok(recoveredCopy.id);
  pass("15. fallo intermedio revierte copia y reserva idempotente");

  const annual=await upsert({name:"Bisiesta",mode:"annual",start:null,end:null,annual:[2,29,"00:00:00",3,1,"00:00:00"],request:uuid(15)});
  await setState(annual.id,"published",annual.version,uuid(16));
  assert.equal((await db.query("select (private.stage_c_active_campaign('2028-02-29T12:00:00-03')).name name")).rows[0].name,"Bisiesta");
  assert.equal((await db.query("select (private.stage_c_active_campaign('2027-02-28T12:00:00-03')).id id")).rows[0].id,null);
  pass("16. recurrencia, límites y 29 de febrero preservados");

  const low=await upsert({name:"Prioridad baja",priority:1,start:"2029-01-01T00:00:00-03",end:"2029-01-10T00:00:00-03",request:uuid(17)});
  const high=await upsert({name:"Prioridad alta",priority:9,start:"2029-01-01T00:00:00-03",end:"2029-01-10T00:00:00-03",request:uuid(18)});
  await setState(low.id,"published",low.version,uuid(19));
  await setState(high.id,"published",high.version,uuid(20));
  assert.equal((await db.query("select (private.stage_c_active_campaign('2029-01-05T12:00:00-03')).name name")).rows[0].name,"Prioridad alta");
  pass("17. superposición conserva prioridad determinista");

  await db.exec("select set_config('app.test_aal','aal1',false)");
  await rejected(`select private.admin_upsert_site_campaign(
    null,'Sin AAL2','',0,'none','2028-01-01T00:00:00-03','2028-01-02T00:00:00-03',
    null,null,null,null,null,null,$1::jsonb,'[]'::jsonb,0,$2::uuid
  )`,[JSON.stringify(baseTheme()),uuid(21)],/MFA AAL2/,"42501");
  await db.exec("select set_config('app.test_aal','aal2',false)");
  pass("18. acceso administrativo sin AAL2 rechazado");

  const missingAsset=uuid(999);
  const invalidKey=uuid(22);
  await rejected(`select private.admin_upsert_site_campaign(
    null,'Recurso inexistente','',0,'none','2028-01-01T00:00:00-03','2028-01-02T00:00:00-03',
    null,null,null,null,null,null,$1::jsonb,'[]'::jsonb,0,$2::uuid
  )`,[JSON.stringify(baseTheme({logo:missingAsset,banner:null,background:null})),invalidKey],/Recurso visual inexistente/);
  assert.equal((await db.query("select count(*)::int n from private.site_campaign_idempotency where request_id=$1",[invalidKey])).rows[0].n,0);
  pass("19. recurso inexistente rechazado sin reserva residual");

  await rejected("select private.admin_retire_site_asset($1::uuid)",[asset.id],/está en uso/);
  pass("20. referencias con 4A v2 impiden retirar recursos utilizados");
} finally {
  await db.exec("rollback");
}

const residue=(await db.query(`select jsonb_build_object(
  'campaigns',(select count(*) from private.site_campaigns),
  'occurrences',(select count(*) from private.site_campaign_occurrences),
  'phrases',(select count(*) from private.site_welcome_phrases),
  'idempotency',(select count(*) from private.site_campaign_idempotency),
  'assets',(select count(*) from private.site_assets),
  'storage',(select count(*) from storage.objects)
) value`)).rows[0].value;
assert.deepEqual(residue,{campaigns:0,occurrences:0,phrases:0,idempotency:0,assets:0,storage:0});
pass("ROLLBACK sin residuos QA");
noRun("concurrencia real entre dos sesiones PostgreSQL","PGlite 17.5 ofrece una sola sesión; los locks y el orden de adquisición se inspeccionaron, pero no se presenta una secuencia de llamadas como prueba multisesión");

await db.exec(rollbackSql);
assert.equal((await db.query("select to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)') is null absent")).rows[0].absent,true);
assert.equal((await db.query("select to_regclass('private.site_campaign_idempotency') is not null retained")).rows[0].retained,true);
assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.site_campaign_idempotency'::regclass")).rows[0].relrowsecurity,true);
pass("recuperación elimina superficies ejecutables y conserva auditoría privada");

console.log(`\nPostgreSQL aislado: ${server_version}`);
console.log(JSON.stringify({results,residue},null,2));
await db.close();
