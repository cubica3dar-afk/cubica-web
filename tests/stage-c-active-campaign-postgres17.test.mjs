import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_3b1_isolated_bootstrap.sql").replace(/^\\set.*$/gm,"");
const original=read("supabase/archive/20261018171221_stage_c_active_campaign_private_function.invalid_return.sql");
const corrected=read("supabase/migrations/20261018171218_stage_c_active_campaign_private_function_v3.sql");
const nextChange=read("supabase/migrations/20261018171223_stage_c_next_change_private_function_v2.sql");
const siteExperience=read("supabase/migrations/20261018171231_stage_c_site_experience_private_function.sql");
const verification=read("supabase/verification/20261018171218_verify.sql");
const nextVerification=read("supabase/verification/20261018171223_verify.sql");

async function database(){
  const db=new PGlite();
  await db.waitReady;
  const [{server_version_num}]=await db.query("show server_version_num").then(r=>r.rows);
  assert.match(String(server_version_num),/^17/);
  await db.exec(bootstrap);
  return db;
}

async function active(db,at){
  const result=await db.query("select (private.stage_c_active_campaign($1::timestamptz)).*",[at]);
  return result.rows[0]??null;
}

async function clearCampaigns(db){
  await db.exec("truncate private.site_campaigns cascade");
}

function campaignSql({id,name,priority=0,mode="none",start=null,end=null,published="2026-01-01T00:00:00Z",annual=null,state="published"}){
  const q=value=>value===null?"null":`'${String(value).replaceAll("'","''")}'`;
  const annualValues=annual??[null,null,null,null,null,null];
  return `insert into private.site_campaigns(
    id,name,state,priority,recurrence_mode,starts_at,ends_at,published_at,
    annual_start_month,annual_start_day,annual_start_time,annual_end_month,annual_end_day,annual_end_time
  ) values(
    ${q(id)}::uuid,${q(name)},${q(state)},${priority},${q(mode)},${q(start)}::timestamptz,${q(end)}::timestamptz,${q(published)}::timestamptz,
    ${annualValues[0]??"null"},${annualValues[1]??"null"},${q(annualValues[2])}::time,
    ${annualValues[3]??"null"},${annualValues[4]??"null"},${q(annualValues[5])}::time
  );`;
}

const originalDb=await database();
let originalError;
try{await originalDb.exec(original);}catch(error){originalError=error;}
assert.ok(originalError,"La definición original debe fallar en PostgreSQL 17");
assert.equal(originalError.code,"XX000");
assert.equal(originalError.where,'SQL function "stage_c_active_campaign"');
assert.match(originalError.message,/nsitem not found/i);
assert.equal((await originalDb.query("select to_regprocedure('private.stage_c_active_campaign(timestamptz)') is null missing")).rows[0].missing,true);
console.log(`✓ PostgreSQL 17 reproduce el defecto original: ${originalError.message.split("\n")[0]}`);
await originalDb.close();

const db=await database();
await db.exec(corrected);
await db.exec(nextChange);
console.log("✓ PostgreSQL 17 crea la función corregida");

const shape=await db.query(`
  select p.prosecdef,p.provolatile,p.proconfig,pg_get_function_result(p.oid) result,
    (select count(*)::int from pg_attribute a where a.attrelid='private.site_campaigns'::regclass and a.attnum>0 and not a.attisdropped) fields,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
  from pg_proc p where p.oid='private.stage_c_active_campaign(timestamptz)'::regprocedure
`);
assert.deepEqual(shape.rows,[{
  prosecdef:true,provolatile:"s",proconfig:["search_path=\"\""],result:"private.site_campaigns",fields:26,public_execute:false
}]);
for(const role of ["anon","authenticated","service_role"]){
  const [{allowed}]=await db.query(`select has_function_privilege('${role}','private.stage_c_active_campaign(timestamptz)','execute') allowed`).then(r=>r.rows);
  assert.equal(allowed,false,role);
}
const verifyResult=await db.query(verification);
const report=verifyResult.rows[0].jsonb_build_object;
assert.equal(report.sentinel_ok,true);
assert.equal(report.return_type_ok,true);
assert.equal(report.column_count,26);
assert.equal(report.columns_exact,true);
assert.equal(report.security_definer,true);
assert.equal(report.stable,true);
assert.equal(report.public_execute,false);
assert.equal(report.anon_execute,false);
assert.equal(report.authenticated_execute,false);
assert.equal(report.service_role_execute,false);
const nextReport=(await db.query(nextVerification)).rows[0].jsonb_build_object;
assert.equal(nextReport.sentinel_ok,true);
assert.equal(nextReport.return_type_ok,true);
assert.equal(nextReport.security_definer,true);
assert.equal(nextReport.stable,true);
assert.equal(nextReport.public_execute,false);
assert.equal(nextReport.anon_execute,false);
assert.equal(nextReport.authenticated_execute,false);
assert.equal(nextReport.service_role_execute,false);
console.log("✓ firmas, 26 campos, tipos, search_path, SECURITY DEFINER y ACL verificados");

assert.equal((await active(db,"2026-06-01T12:00:00-03:00")).id,null);
assert.equal((await db.query("select private.stage_c_next_change('2026-06-01T12:00:00-03'::timestamptz) value")).rows[0].value,null);
console.log("✓ sin campañas devuelve el compuesto vacío esperado");

await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000001",name:"Única",start:"2026-06-01T00:00:00-03:00",end:"2026-06-10T00:00:00-03:00"}));
assert.equal((await active(db,"2026-06-01T00:00:00-03:00")).name,"Única");
assert.equal((await active(db,"2026-06-09T23:59:59-03:00")).name,"Única");
assert.equal((await active(db,"2026-06-10T00:00:00-03:00")).id,null);
console.log("✓ campaña única y límites [inicio, fin) verificados");

await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000002",name:"Mayor prioridad",priority:5,start:"2026-06-02T00:00:00-03:00",end:"2026-06-09T00:00:00-03:00",published:"2026-01-02T00:00:00Z"}));
assert.equal((await active(db,"2026-06-05T12:00:00-03:00")).name,"Mayor prioridad");
await db.exec("update private.site_campaigns set priority=0 where id='00000000-0000-0000-0000-000000000002'");
assert.equal((await active(db,"2026-06-05T12:00:00-03:00")).name,"Mayor prioridad");
await db.exec("update private.site_campaigns set starts_at='2026-06-01 00:00:00-03',published_at='2026-01-01 00:00:00+00' where id='00000000-0000-0000-0000-000000000002'");
assert.equal((await active(db,"2026-06-05T12:00:00-03:00")).id,"00000000-0000-0000-0000-000000000001");
console.log("✓ superposición y desempates por prioridad, inicio efectivo, publicación e id verificados");

await clearCampaigns(db);
await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000003",name:"Anual",mode:"annual",annual:[7,1,"09:00:00",7,10,"18:00:00"]}));
assert.equal((await active(db,"2026-07-01T08:59:59-03:00")).id,null);
assert.equal((await active(db,"2026-07-01T09:00:00-03:00")).name,"Anual");
assert.equal((await active(db,"2027-07-05T12:00:00-03:00")).name,"Anual");
assert.equal((await active(db,"2027-07-10T18:00:00-03:00")).id,null);
console.log("✓ recurrencia anual, cambio de año y límites horarios verificados");

await clearCampaigns(db);
await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000004",name:"Fin de año",mode:"annual",annual:[12,20,"00:00:00",1,10,"00:00:00"]}));
assert.equal((await active(db,"2026-12-25T12:00:00-03:00")).name,"Fin de año");
assert.equal((await active(db,"2027-01-05T12:00:00-03:00")).name,"Fin de año");
assert.equal((await active(db,"2027-01-10T00:00:00-03:00")).id,null);
console.log("✓ campaña anual que cruza diciembre y enero verificada");

await clearCampaigns(db);
await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000005",name:"Personalizada",mode:"custom"}));
await db.exec("insert into private.site_campaign_occurrences(campaign_id,starts_at,ends_at) values('00000000-0000-0000-0000-000000000005','2026-08-01 00:00:00-03','2026-08-03 00:00:00-03')");
assert.equal((await active(db,"2026-08-02T12:00:00-03:00")).name,"Personalizada");
assert.equal((await active(db,"2026-08-03T00:00:00-03:00")).id,null);
console.log("✓ ocurrencias personalizadas verificadas");

await clearCampaigns(db);
await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000006",name:"Bisiesta",mode:"annual",annual:[2,29,"00:00:00",3,1,"00:00:00"]}));
assert.equal((await active(db,"2028-02-29T12:00:00-03:00")).name,"Bisiesta");
assert.equal((await active(db,"2027-02-28T12:00:00-03:00")).id,null);
let [{value:nextLeap}]=await db.query("select private.stage_c_next_change('2027-02-28T12:00:00-03'::timestamptz) value").then(r=>r.rows);
assert.equal(nextLeap.toISOString(),"2028-02-29T03:00:00.000Z");
assert.equal((await active(db,"2100-02-28T12:00:00-03:00")).id,null);
[{value:nextLeap}]=await db.query("select private.stage_c_next_change('2100-02-28T12:00:00-03'::timestamptz) value").then(r=>r.rows);
assert.equal(nextLeap.toISOString(),"2104-02-29T03:00:00.000Z");
console.log("✓ 29 de febrero se ejecuta solo en años bisiestos y next_change encuentra 2028/2104 sin errores");

await clearCampaigns(db);
await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000008",name:"Fin bisiesto",mode:"annual",annual:[12,20,"00:00:00",2,29,"00:00:00"]}));
assert.equal((await active(db,"2027-01-15T12:00:00-03:00")).id,null);
assert.equal((await active(db,"2028-01-15T12:00:00-03:00")).name,"Fin bisiesto");
[{value:nextLeap}]=await db.query("select private.stage_c_next_change('2026-12-01T00:00:00-03'::timestamptz) value").then(r=>r.rows);
assert.equal(nextLeap.toISOString(),"2027-12-20T03:00:00.000Z");
console.log("✓ una ocurrencia con fin 29/02 inexistente se omite completa");

await clearCampaigns(db);
await db.exec(campaignSql({id:"00000000-0000-0000-0000-000000000007",name:"Consumidora",priority:2,start:"2026-09-01T00:00:00-03:00",end:"2026-09-10T00:00:00-03:00"}));
await db.exec("insert into private.site_appearance_versions(state,config,published_at) values('published','{\"hero\":{\"title\":\"Base\"}}','2026-01-01T00:00:00Z'); insert into private.site_welcome_phrases(campaign_id,phrase,sort_order) values('00000000-0000-0000-0000-000000000007','Hola',1)");
await db.exec(siteExperience);
const [{next_change}]=await db.query("select private.stage_c_next_change('2026-09-05T12:00:00-03'::timestamptz) next_change").then(r=>r.rows);
assert.ok(next_change);
const [{experience}]=await db.query("select private.get_site_experience('2026-09-05T12:00:00-03'::timestamptz) experience").then(r=>r.rows);
assert.equal(experience.campaign.id,"00000000-0000-0000-0000-000000000007");
assert.equal(experience.campaign.name,"Consumidora");
assert.deepEqual(experience.welcome_phrases,["Hola"]);
console.log("✓ stage_c_next_change y get_site_experience consumen la función corregida");

await db.close();
console.log("✓ validación aislada completada en PostgreSQL 17.5");
