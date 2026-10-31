import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql");
const migration=read("supabase/migrations/20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql");
const verification=read("supabase/verification/20261018171249_verify.sql");
const worker=read("supabase/functions/site-assets/worker.js");

const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(r=>r.rows);
assert.match(String(server_version),/^17[.]/);
await db.exec(bootstrap);
await db.exec(migration);

const results=[];
const pass=name=>{results.push({name,status:"APROBADA"});console.log(`✓ ${name}`);};
const noRun=(name,reason)=>{results.push({name,status:"NO EJECUTADA",reason});console.log(`○ ${name}: NO EJECUTADA — ${reason}`);};
let savepoint=0;
async function rejected(sql,params=[],pattern){
  const name=`expected_${++savepoint}`;
  await db.exec(`savepoint ${name}`);
  let error;
  try{await db.query(sql,params);}catch(value){error=value;}
  await db.exec(`rollback to savepoint ${name}; release savepoint ${name}`);
  assert.ok(error,"La operación debía ser rechazada");
  if(pattern)assert.match(String(error.message),pattern);
  return error;
}
async function transaction(fn){
  await db.exec("begin");
  try{await fn();}finally{await db.exec("rollback");}
}
function theme({title="Cúbica QA",subtitle="Vista segura",assets={logo:null,banner:null,background:null}}={}){
  return {colors:{background:"#17172b",panel:"#20213a",panelAlt:"#282a46",text:"#f7f7fb",muted:"#a7a9c0",accent:"#ffffff"},hero:{title,subtitle},assets};
}
async function addStorage({path,mime="image/png",size=128,bucket="site-assets"}){
  await db.query("insert into storage.objects(bucket_id,name,metadata) values($1::text,$2::text,jsonb_build_object('mimetype',$3::text,'size',$4::bigint))",[bucket,path,mime,size]);
}
async function register({kind="logo",label="QA",path,mime="image/png",size=128,width=64,height=64}){
  const result=await db.query("select private.admin_register_site_asset($1,$2,$3,$4,$5,$6,$7) value",[kind,label,path,mime,size,width,height]);
  return result.rows[0].value;
}
async function save(config,expected){
  return (await db.query("select private.admin_save_site_appearance_draft($1::jsonb,$2::integer) value",[JSON.stringify(config),expected])).rows[0].value;
}
async function publish(expected){
  return (await db.query("select private.admin_publish_site_appearance($1::integer) value",[expected])).rows[0].value;
}

const shape=await db.query(`
  select p.oid::regprocedure::text identity,p.prosecdef,p.provolatile,p.proconfig,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in(
    'stage_c_validate_theme','admin_save_site_appearance_draft','admin_publish_site_appearance',
    'admin_reset_site_appearance_draft','admin_restore_original_appearance_draft',
    'admin_register_site_asset','admin_retire_site_asset'
  ) order by identity
`);
assert.equal(shape.rows.length,7);
for(const row of shape.rows){
  assert.deepEqual(row.proconfig,["search_path=\"\""]);
  assert.equal(row.public_execute,false,row.identity);
  const validator=row.identity.includes("stage_c_validate_theme(");
  assert.equal(validator,!row.prosecdef,row.identity);
  if(!validator)assert.equal(row.prosecdef,true,row.identity);
}
for(const role of ["anon","authenticated","service_role"]){
  for(const row of shape.rows){
    const [{allowed}]=await db.query(`select has_function_privilege('${role}',$1::regprocedure,'execute') allowed`,[row.identity]).then(r=>r.rows);
    assert.equal(allowed,false,`${role}:${row.identity}`);
  }
}
pass("18. firmas, SECURITY DEFINER/INVOKER, search_path y permisos cerrados");
const verificationReport=(await db.query(verification)).rows[0].jsonb_build_object;
assert.equal(verificationReport.sentinel_ok,true);
assert.equal(verificationReport.source_draft_column,true);
assert.equal(verificationReport.idempotency_index,true);
for(const object of verificationReport.objects){
  assert.equal(object.exists,true,object.identity);
  assert.equal(object.security_mode_ok,true,object.identity);
  assert.equal(object.search_path_restricted,true,object.identity);
  assert.equal(object.public_execute,false,object.identity);
  assert.equal(object.anon_execute,false,object.identity);
  assert.equal(object.authenticated_execute,false,object.identity);
  assert.equal(object.service_role_execute,false,object.identity);
}

await transaction(async()=>{
  const draft=await save(theme(),null);
  assert.equal(draft.version,1);
  const first=await publish(1);
  assert.equal(first.source_draft_version,1);
  assert.equal((await db.query("select count(*)::int n from private.site_appearance_versions where state='published'")).rows[0].n,1);
  pass("1. publicación inicial válida");

  const replay=await publish(1);
  assert.equal(replay.id,first.id);
  assert.equal((await db.query("select count(*)::int n from private.site_appearance_versions where state in('published','archived')")).rows[0].n,1);
  pass("2. publicación repetida idempotente");

  const updated=await save(theme({title:"Nueva revisión"}),1);
  assert.equal(updated.version,2);
  const second=await publish(2);
  assert.notEqual(second.id,first.id);
  assert.equal(second.source_draft_version,2);
  assert.equal((await db.query("select count(*)::int n from private.site_appearance_versions where state='published'")).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from private.site_appearance_versions where state='archived'")).rows[0].n,1);
  pass("4. publicación de borrador actualizado");

  const v3=await save(theme({title:"Solo borrador"}),2);
  assert.equal(v3.version,3);
  const publicTitle=(await db.query("select config#>>'{hero,title}' title from private.site_appearance_versions where state='published'")).rows[0].title;
  assert.equal(publicTitle,"Nueva revisión");
  pass("16. separación entre borrador y publicación");

  const stale=await rejected("select private.admin_save_site_appearance_draft($1::jsonb,2)",[JSON.stringify(theme({title:"Obsoleto"}))],/otra sesión/);
  assert.equal(stale.code,"40001");
  assert.equal((await db.query("select config#>>'{hero,title}' title from private.site_appearance_versions where state='draft'")).rows[0].title,"Solo borrador");
  pass("10. actualización con revisión obsoleta conserva el borrador");

  const resetConflict=await rejected("select private.admin_reset_site_appearance_draft(2)",[],/otra sesión/);
  assert.equal(resetConflict.code,"40001");
  pass("11. restablecimiento con conflicto de concurrencia");

  const reset=(await db.query("select private.admin_reset_site_appearance_draft(3) value")).rows[0].value;
  assert.equal(reset.version,4);
  assert.equal(reset.config.hero.title,"Nueva revisión");
  const restored=(await db.query("select private.admin_restore_original_appearance_draft(4) value")).rows[0].value;
  assert.equal(restored.version,5);
  pass("9. actualización, restablecimiento y recuperación con revisión vigente");
});

noRun("3. solicitudes de publicación en dos sesiones PostgreSQL simultáneas","PGlite 17.5 ofrece una sola sesión; se verificaron secuencialmente el bloqueo asesor y el índice único, pero no se presenta como prueba de concurrencia real");

await transaction(async()=>{
  const logoPath="11111111-1111-1111-1111-111111111111/21111111-1111-1111-1111-111111111111.png";
  await addStorage({path:logoPath});
  const logo=await register({path:logoPath});
  assert.equal(logo.storage_path,logoPath);
  pass("5. registro de recurso existente en site-assets");

  await rejected("select private.admin_register_site_asset('logo','Falta','31111111-1111-1111-1111-111111111111/41111111-1111-1111-1111-111111111111.png','image/png',128,64,64)",[],/no existe en Storage/);
  pass("6. rechazo de recurso inexistente");

  const wrongBucket="51111111-1111-1111-1111-111111111111/61111111-1111-1111-1111-111111111111.png";
  await addStorage({path:wrongBucket,bucket:"otro-bucket"});
  await rejected("select private.admin_register_site_asset('logo','Otro bucket',$1,'image/png',128,64,64)",[wrongBucket],/no existe en Storage/);

  const mimePath="71111111-1111-1111-1111-111111111111/81111111-1111-1111-1111-111111111111.jpg";
  await addStorage({path:mimePath,mime:"image/png"});
  await rejected("select private.admin_register_site_asset('logo','MIME',$1,'image/jpeg',128,64,64)",[mimePath],/MIME no coincide/);
  const extensionPath="91111111-1111-1111-1111-111111111111/a1111111-1111-1111-1111-111111111111.png";
  await addStorage({path:extensionPath,mime:"image/png"});
  await rejected("select private.admin_register_site_asset('logo','Extensión',$1,'image/jpeg',128,64,64)",[extensionPath],/extensión no coincide/);
  pass("7. rechazo de MIME, bucket o extensión incompatible");

  await rejected("select private.admin_register_site_asset('logo','Ruta','../escape.png','image/png',128,64,64)",[],/Ruta de recurso inválida/);
  pass("8. rechazo de rutas inválidas");

  const draft=await save(theme({assets:{logo:logo.id,banner:null,background:null}}),null);
  assert.equal(draft.version,1);
  await rejected("select private.admin_retire_site_asset($1::uuid)",[logo.id],/está en uso/);
  pass("12. recurso todavía referenciado");

  const textPath="b1111111-1111-1111-1111-111111111111/c1111111-1111-1111-1111-111111111111.webp";
  await addStorage({path:textPath,mime:"image/webp"});
  const textAsset=await register({kind:"background",path:textPath,mime:"image/webp"});
  await save(theme({subtitle:`Texto accidental ${textAsset.id}`,assets:{logo:logo.id,banner:null,background:null}}),1);
  await db.query("select private.admin_retire_site_asset($1::uuid)",[textAsset.id]);
  assert.equal((await db.query("select retired_at is not null retired from private.site_assets where id=$1",[textAsset.id])).rows[0].retired,true);
  pass("13. UUID presente solo en texto no produce falso positivo");

  await publish(2);
  await db.query("insert into private.site_campaigns(name,state,theme) values('QA compartida','disabled',$1::jsonb)",[JSON.stringify(theme({assets:{logo:logo.id,banner:null,background:null}}))]);
  await rejected("select private.admin_retire_site_asset($1::uuid)",[logo.id],/está en uso/);
  pass("14. recurso compartido entre configuraciones y campañas");

  const campaignPath="d1111111-1111-1111-1111-111111111111/e1111111-1111-1111-1111-111111111111.png";
  await addStorage({path:campaignPath});
  const campaignAsset=await register({kind:"campaign",path:campaignPath});
  const campaignTheme=(await db.query("select private.stage_c_validate_theme($1::jsonb) value",[JSON.stringify(theme({assets:{logo:campaignAsset.id,banner:null,background:null}}))])).rows[0].value;
  assert.equal(campaignTheme.assets.logo,campaignAsset.id);
  await rejected("select private.admin_save_site_appearance_draft($1::jsonb,2)",[JSON.stringify(theme({assets:{logo:campaignAsset.id,banner:null,background:null}}))],/apariencia permanente/);
});

noRun("15. retiro y publicación en dos sesiones PostgreSQL simultáneas","PGlite 17.5 no representa dos sesiones; se verificaron los bloqueos FOR SHARE/FOR UPDATE y la detección estructurada, pero la carrera real queda pendiente para un PostgreSQL servidor aislado");

await transaction(async()=>{
  await db.exec("select set_config('app.test_aal','aal1',false)");
  const aal1=await rejected("select private.admin_restore_original_appearance_draft(null)",[],/MFA AAL2/);
  assert.equal(aal1.code,"42501");
  await db.exec("select set_config('app.test_aal','aal2',false); select set_config('app.test_admin','false',false)");
  const customer=await rejected("select private.admin_restore_original_appearance_draft(null)",[],/MFA AAL2/);
  assert.equal(customer.code,"42501");
  pass("17. rechazo de AAL1 y clientes no administradores");
});

assert.match(migration,/source_draft_version/);
assert.match(migration,/site_appearance_source_draft_once/);
assert.match(migration,/pg_advisory_xact_lock\(1817124901\)/);
assert.match(migration,/from storage\.objects[\s\S]*bucket_id='site-assets'/);
assert.match(migration,/config#>>'\{assets,logo\}'/);
assert.doesNotMatch(migration,/config::text like|theme::text like/i);
assert.match(worker,/inspectImage\(bytes,file\.type\)/);
assert.match(worker,/bytes\[0\]===137/);
pass("garantías estructurales e inspección binaria separada en Edge Function");

const residue=(await db.query(`select jsonb_build_object(
  'assets',(select count(*) from private.site_assets),
  'appearance',(select count(*) from private.site_appearance_versions),
  'campaigns',(select count(*) from private.site_campaigns),
  'storage',(select count(*) from storage.objects)
) value`)).rows[0].value;
assert.deepEqual(residue,{assets:0,appearance:0,campaigns:0,storage:0});
pass("ROLLBACK sin residuos QA");

console.log(`\nPostgreSQL aislado: ${server_version}`);
console.log(JSON.stringify({results,residue},null,2));
await db.close();
