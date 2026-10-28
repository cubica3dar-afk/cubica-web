import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql");
const activeCampaign=read("supabase/migrations/20261018171218_stage_c_active_campaign_private_function_v3.sql");
const nextChange=read("supabase/migrations/20261018171223_stage_c_next_change_private_function_v2.sql");
const siteExperience=read("supabase/migrations/20261018171231_stage_c_site_experience_private_function.sql");
const appearanceV2=read("supabase/migrations/20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql");
const campaignV2=read("supabase/migrations/20261018171254_stage_c_campaign_admin_private_functions_v2.sql");
const phraseV2=read("supabase/migrations/20261018171255_stage_c_phrase_admin_private_function_v2.sql");
const verification=read("supabase/verification/20261018171255_verify.sql");
const rollbackSql=read("supabase/rollback/20261018171255_stage_c_phrase_admin_private_function_v2.sql");

const ADMIN="00000000-0000-0000-0000-000000000099";
const uuid=n=>`20000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
let requestIdCounter=100;
const db=new PGlite();
await db.waitReady;
const [{server_version}]=await db.query("show server_version").then(r=>r.rows);
assert.match(String(server_version),/^17[.]/);
await db.exec(bootstrap);
await db.exec(`
  create table auth.users(id uuid primary key);
  insert into auth.users(id) values('${ADMIN}');
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
    phrase text not null check(char_length(btrim(phrase)) between 1 and 500),
    active boolean not null default true,
    sort_order integer not null default 0,
    version integer not null default 1,
    deleted_at timestamptz,
    created_at timestamptz not null default now(),
    created_by uuid,
    updated_at timestamptz not null default now(),
    updated_by uuid
  );
  create index site_welcome_active on private.site_welcome_phrases(campaign_id,sort_order,id)
    where active and deleted_at is null;
  create unique index site_welcome_unique_active_text
    on private.site_welcome_phrases(
      coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(phrase)
    ) where deleted_at is null;
  alter table private.site_welcome_phrases enable row level security;
  create policy stage_c_deny_site_welcome_phrases on private.site_welcome_phrases
    for all to anon,authenticated using(false) with check(false);
  revoke all on private.site_welcome_phrases from public,anon,authenticated,service_role;
  create function private.stage_c_asset_paths(jsonb)
  returns text[] language sql stable security definer set search_path='' as $$
    select array[]::text[];
  $$;
  revoke all on function private.stage_c_asset_paths(jsonb) from public,anon,authenticated,service_role;
  select set_config('app.test_uid','${ADMIN}',false);
  select set_config('app.test_admin','true',false);
  select set_config('app.test_aal','aal2',false);
`);
await db.exec(activeCampaign);
await db.exec(nextChange);
await db.exec(siteExperience);
await db.exec(appearanceV2);
await db.exec(campaignV2);
await db.exec(phraseV2);

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
const baseTheme={colors:{},hero:{},assets:{logo:null,banner:null,background:null}};
async function campaign(name,start="2030-01-01T00:00:00-03:00",end="2030-01-10T00:00:00-03:00"){
  const q=`select private.admin_upsert_site_campaign(
    null,$1,'',0,'none',$2::timestamptz,$3::timestamptz,
    null,null,null,null,null,null,$4::jsonb,'[]'::jsonb,0,$5::uuid
  ) value`;
  return (await db.query(q,[name,start,end,JSON.stringify(baseTheme),uuid(requestIdCounter++)])).rows[0].value;
}
async function phrase({id=null,campaignId=null,text="Frase QA",active=true,order=0,expected=0,remove=false}={}){
  return (await db.query(
    "select private.admin_upsert_welcome_phrase($1::bigint,$2::uuid,$3,$4,$5,$6,$7) value",
    [id,campaignId,text,active,order,expected,remove]
  )).rows[0].value;
}

const shape=(await db.query(`
  select p.oid::regprocedure::text identity,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') service_role_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='admin_upsert_welcome_phrase'
`)).rows[0];
assert.equal(shape.prosecdef,true);
assert.deepEqual(shape.proconfig,["search_path=\"\""]);
assert.equal(shape.public_execute,false);
assert.equal(shape.anon_execute,false);
assert.equal(shape.authenticated_execute,false);
assert.equal(shape.service_role_execute,false);
const tableSecurity=(await db.query(`select c.relrowsecurity,
  has_table_privilege('anon','private.site_welcome_phrases','select') anon_select,
  has_table_privilege('authenticated','private.site_welcome_phrases','select') authenticated_select,
  has_table_privilege('service_role','private.site_welcome_phrases','select') service_select
  from pg_class c where c.oid='private.site_welcome_phrases'::regclass`)).rows[0];
assert.deepEqual(tableSecurity,{relrowsecurity:true,anon_select:false,authenticated_select:false,service_select:false});
const verificationReport=(await db.query(verification)).rows[0].jsonb_build_object;
assert.deepEqual({...verificationReport},{
  version:"20261018171255",sentinel:"cubica_stage_c:20261018171255",sentinel_ok:true,
  present:true,security_definer:true,search_path_restricted:true,public_execute:false,
  anon_execute:false,authenticated_execute:false,service_role_execute:false,old_sentinel_absent:true
});
pass("seguridad: MFA central, SECURITY DEFINER, search_path y ACL cerradas");

await db.exec("begin");
try{
  const general=await phrase({text:"Bienvenida general",order:10});
  assert.equal(general.campaign_id,null);
  pass("1. creación de frase general");

  const firstCampaign=await campaign("Campaña válida");
  const linked=await phrase({campaignId:firstCampaign.id,text:"Bienvenida de campaña",order:5});
  assert.equal(linked.campaign_id,firstCampaign.id);
  pass("2. creación para campaña válida");

  await rejected(
    "select private.admin_upsert_welcome_phrase(null,$1::uuid,'Inexistente',true,0,0,false)",
    [uuid(999)],/campaña no existe/i,"23503"
  );
  pass("3. campaña inexistente rechazada");

  const retired=await campaign("Campaña retirada","2031-01-01T00:00:00-03","2031-01-10T00:00:00-03");
  await db.query("select private.admin_delete_site_campaign($1::uuid,$2)",[retired.id,retired.version]);
  await rejected(
    "select private.admin_upsert_welcome_phrase(null,$1::uuid,'No asociar',true,0,0,false)",
    [retired.id],/campaña fue retirada/i,"55000"
  );
  pass("4. campaña eliminada rechazada al crear");

  const secondCampaign=await campaign("Campaña destino");
  const edited=await phrase({id:linked.id,campaignId:firstCampaign.id,text:"Frase editada",active:false,order:20,expected:linked.version});
  assert.equal(edited.version,linked.version+1);
  const reassigned=await phrase({id:edited.id,campaignId:secondCampaign.id,text:edited.phrase,active:true,order:30,expected:edited.version});
  assert.equal(reassigned.campaign_id,secondCampaign.id);
  pass("5. edición y reasignación válida");

  const removed=await phrase({id:reassigned.id,campaignId:secondCampaign.id,text:reassigned.phrase,active:reassigned.active,order:reassigned.sort_order,expected:reassigned.version,remove:true});
  assert.ok(removed.deleted_at);
  const restored=await phrase({id:removed.id,campaignId:secondCampaign.id,text:removed.phrase,active:true,order:removed.sort_order,expected:removed.version});
  assert.equal(restored.deleted_at,null);
  pass("6. eliminación lógica y restauración válida");

  const historical=await phrase({campaignId:firstCampaign.id,text:"Frase histórica"});
  const currentFirst=(await db.query("select version from private.site_campaigns where id=$1",[firstCampaign.id])).rows[0];
  await db.query("select private.admin_delete_site_campaign($1::uuid,$2)",[firstCampaign.id,currentFirst.version]);
  const historicalAfter=(await db.query("select * from private.site_welcome_phrases where id=$1",[historical.id])).rows[0];
  assert.ok(historicalAfter.deleted_at);
  await rejected(
    "select private.admin_upsert_welcome_phrase($1,$2::uuid,$3,true,0,$4,false)",
    [historical.id,firstCampaign.id,historical.phrase,historicalAfter.version],/campaña fue retirada/i,"55000"
  );
  const restoredGeneral=await phrase({id:historical.id,campaignId:null,text:historical.phrase,expected:historicalAfter.version});
  assert.equal(restoredGeneral.campaign_id,null);
  assert.equal(restoredGeneral.deleted_at,null);
  pass("7. histórico preservado; restauración en campaña retirada rechazada y recuperación general permitida");

  await rejected(
    "select private.admin_upsert_welcome_phrase($1,$2::uuid,$3,true,0,$4,false)",
    [restored.id,retired.id,restored.phrase,restored.version],/campaña fue retirada/i,"55000"
  );
  pass("8. reasignación a campaña retirada rechazada");

  await rejected(
    "select private.admin_upsert_welcome_phrase($1,$2::uuid,$3,true,0,$4,false)",
    [restored.id,secondCampaign.id,restored.phrase,restored.version-1],/frase cambió o no existe/i,"40001"
  );
  pass("9. revisión obsoleta rechazada");

  const noop=await phrase({id:restored.id,campaignId:restored.campaign_id,text:restored.phrase,active:restored.active,order:restored.sort_order,expected:restored.version});
  assert.equal(noop.version,restored.version);
  assert.equal(noop.updated_at,restored.updated_at);
  pass("10. repetición sin cambios no crea versión innecesaria");

  await rejected(
    "select private.admin_upsert_welcome_phrase(null,null,'Bienvenida general',true,10,0,false)",
    [],/Ya existe una frase igual/i,"23505"
  );
  assert.equal((await db.query("select count(*)::int n from private.site_welcome_phrases where phrase='Bienvenida general' and deleted_at is null")).rows[0].n,1);
  pass("11. creación repetida no introduce duplicados");

  await db.query("insert into private.site_appearance_versions(state,version,config,published_at) values('published',1,$1::jsonb,now())",[JSON.stringify(baseTheme)]);
  const draftExperience=(await db.query("select private.get_site_experience('2030-01-05T12:00:00-03') value")).rows[0].value;
  assert.equal(draftExperience.campaign,null);
  assert.ok(draftExperience.welcome_phrases.includes("Bienvenida general"));
  const currentSecond=(await db.query("select version from private.site_campaigns where id=$1",[secondCampaign.id])).rows[0];
  await db.query("select private.admin_set_site_campaign_state($1::uuid,'published',$2,$3::uuid)",[secondCampaign.id,currentSecond.version,uuid(800)]);
  const publishedExperience=(await db.query("select private.get_site_experience('2030-01-05T12:00:00-03') value")).rows[0].value;
  assert.equal(publishedExperience.campaign.id,secondCampaign.id);
  assert.ok(publishedExperience.welcome_phrases.includes(restored.phrase));
  const inactive=await phrase({id:restored.id,campaignId:secondCampaign.id,text:restored.phrase,active:false,order:restored.sort_order,expected:restored.version});
  const fallbackExperience=(await db.query("select private.get_site_experience('2030-01-05T12:00:00-03') value")).rows[0].value;
  assert.ok(fallbackExperience.welcome_phrases.includes("Bienvenida general"));
  assert.ok(!fallbackExperience.welcome_phrases.includes(inactive.phrase));
  pass("12. borrador, publicación, frase inactiva y fallback público correctos");

  const visibleBeforeDelete=await phrase({campaignId:secondCampaign.id,text:"No filtrar retirada"});
  const secondPublished=(await db.query("select version from private.site_campaigns where id=$1",[secondCampaign.id])).rows[0];
  const secondDisabled=(await db.query(
    "select private.admin_set_site_campaign_state($1::uuid,'disabled',$2,$3::uuid) value",
    [secondCampaign.id,secondPublished.version,uuid(801)]
  )).rows[0].value;
  await db.query("select private.admin_delete_site_campaign($1::uuid,$2)",[secondCampaign.id,secondDisabled.version]);
  const afterCampaignDelete=(await db.query("select private.get_site_experience('2030-01-05T12:00:00-03') value")).rows[0].value;
  assert.equal(afterCampaignDelete.campaign,null);
  assert.ok(afterCampaignDelete.welcome_phrases.includes("Bienvenida general"));
  assert.ok(!afterCampaignDelete.welcome_phrases.includes(visibleBeforeDelete.phrase));
  assert.ok((await db.query("select deleted_at from private.site_welcome_phrases where id=$1",[visibleBeforeDelete.id])).rows[0].deleted_at);
  pass("13. campaña retirada conserva la frase histórica sin filtrarla al público");

  const annual=(await db.query(`select private.admin_upsert_site_campaign(
    null,'Campaña anual','',5,'annual',null,null,2,29,'00:00:00',3,1,'00:00:00',
    $1::jsonb,'[]'::jsonb,0,$2::uuid
  ) value`,[JSON.stringify(baseTheme),uuid(810)])).rows[0].value;
  await db.query("select private.admin_set_site_campaign_state($1::uuid,'published',$2,$3::uuid)",[annual.id,annual.version,uuid(811)]);
  const annualPhrase=await phrase({campaignId:annual.id,text:"Bienvenida bisiesta"});
  const leapExperience=(await db.query("select private.get_site_experience('2032-02-29T12:00:00-03') value")).rows[0].value;
  const nonLeapExperience=(await db.query("select private.get_site_experience('2031-02-28T12:00:00-03') value")).rows[0].value;
  assert.equal(leapExperience.campaign.id,annual.id);
  assert.ok(leapExperience.welcome_phrases.includes(annualPhrase.phrase));
  assert.equal(nonLeapExperience.campaign,null);
  assert.ok(nonLeapExperience.welcome_phrases.includes("Bienvenida general"));
  pass("14. frases compatibles con recurrencia anual y omisión no bisiesta");

  await db.exec("select set_config('app.test_aal','aal1',false)");
  await rejected(
    "select private.admin_upsert_welcome_phrase(null,null,'Sin AAL2',true,0,0,false)",
    [],/MFA AAL2/,"42501"
  );
  await db.exec("select set_config('app.test_aal','aal2',false)");
  pass("15. administrador AAL1 rechazado");

  const beforeFailure=(await db.query("select count(*)::int n from private.site_welcome_phrases")).rows[0].n;
  await rejected(
    "select private.admin_upsert_welcome_phrase(null,$1::uuid,'Fallo atómico',true,0,0,false)",
    [uuid(998)],/campaña no existe/i,"23503"
  );
  assert.equal((await db.query("select count(*)::int n from private.site_welcome_phrases")).rows[0].n,beforeFailure);
  pass("16. error no deja escritura parcial");
} finally {
  await db.exec("rollback");
}

const residue=(await db.query(`select jsonb_build_object(
  'campaigns',(select count(*) from private.site_campaigns),
  'occurrences',(select count(*) from private.site_campaign_occurrences),
  'phrases',(select count(*) from private.site_welcome_phrases),
  'idempotency',(select count(*) from private.site_campaign_idempotency),
  'appearance',(select count(*) from private.site_appearance_versions)
) value`)).rows[0].value;
assert.deepEqual(residue,{campaigns:0,occurrences:0,phrases:0,idempotency:0,appearance:0});
pass("17. ROLLBACK sin residuos QA");
noRun("18. concurrencia real eliminación de campaña / asociación de frase","PGlite 17.5 ofrece una sola sesión; se inspeccionó el orden campaña → frase, pero no se presenta una simulación como prueba multisesión");

await db.exec(rollbackSql);
assert.equal((await db.query("select to_regprocedure('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)') is null absent")).rows[0].absent,true);
assert.equal((await db.query("select to_regclass('private.site_welcome_phrases') is not null retained")).rows[0].retained,true);
assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.site_welcome_phrases'::regclass")).rows[0].relrowsecurity,true);
pass("19. recuperación retira la función y conserva datos/RLS");

console.log(`\nPostgreSQL aislado: ${server_version}`);
console.log(JSON.stringify({results,residue},null,2));
await db.close();
