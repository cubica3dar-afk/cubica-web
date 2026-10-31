import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const bootstrap=read("supabase/diagnostics/stage_c_3b1_isolated_bootstrap.sql").replace(/^\\set.*$/gm,"");
const activeCampaign=read("supabase/migrations/20261018171218_stage_c_active_campaign_private_function_v3.sql");
const campaignAdmin=read("supabase/archive/20261018171252_stage_c_campaign_admin_private_functions.pre_idempotency.sql");

const db=new PGlite();
await db.waitReady;
await db.exec(bootstrap);
await db.exec("alter table private.site_campaigns alter column id set default extensions.gen_random_uuid()");
await db.exec(`
  alter table private.site_welcome_phrases
    add column if not exists version integer not null default 1,
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists created_by uuid,
    add column if not exists updated_by uuid;
`);
await db.exec(activeCampaign);
await db.exec(campaignAdmin);

const emptyTheme=JSON.stringify({colors:{},hero:{},assets:{}});
const upsert=async(name)=>db.query(`select private.admin_upsert_site_campaign(
  null::uuid,$1,'',0,'none','2027-01-01T00:00:00-03'::timestamptz,
  '2027-01-02T00:00:00-03'::timestamptz,null,null,null,null,null,null,
  $2::jsonb,'[]'::jsonb,null
) saved`,[name,emptyTheme]);

await upsert("QA reintento idéntico");
await upsert("QA reintento idéntico");
let [{count}]=await db.query("select count(*)::int count from private.site_campaigns where name='QA reintento idéntico'").then(r=>r.rows);
assert.equal(count,2,"dos reintentos idénticos crean dos campañas");
console.log("✗ creación sin idempotencia: el mismo reintento produjo dos campañas");

const [{source}]=await db.query(`select private.admin_upsert_site_campaign(
  null::uuid,'QA fuente','',0,'custom',null,null,null,null,null,null,null,null,
  $1::jsonb,
  '[{"starts_at":"2027-02-01T00:00:00-03:00","ends_at":"2027-02-02T00:00:00-03:00"}]'::jsonb,
  null
) source`,[emptyTheme]).then(r=>r.rows);
await db.query("select private.admin_duplicate_site_campaign($1::uuid)",[source.id]);
await db.query("select private.admin_duplicate_site_campaign($1::uuid)",[source.id]);
[{count}]=await db.query("select count(*)::int count from private.site_campaigns where name='QA fuente — copia'").then(r=>r.rows);
assert.equal(count,2,"dos reintentos de duplicar crean dos copias");
console.log("✗ duplicación sin idempotencia: el mismo reintento produjo dos copias");

let [{version}]=await db.query("select version from private.site_campaigns where id=$1::uuid",[source.id]).then(r=>r.rows);
let [{published}]=await db.query("select private.admin_set_site_campaign_state($1::uuid,'published',$2) published",[source.id,version]).then(r=>r.rows);
let [{republished}]=await db.query("select private.admin_set_site_campaign_state($1::uuid,'published',$2) republished",[source.id,published.version]).then(r=>r.rows);
assert.equal(republished.version,published.version+1);
console.log("✗ publicar un estado ya publicado vuelve a incrementar la versión");

let staleRejected=false;
try{
  await db.query("select private.admin_set_site_campaign_state($1::uuid,'disabled',$2)",[source.id,published.version]);
}catch(error){staleRejected=error.code==="40001";}
assert.equal(staleRejected,true);
console.log("✓ una revisión obsoleta es rechazada con SQLSTATE 40001");

const acl=await db.query(`
  select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,
    has_function_privilege('anon',p.oid,'execute') anon_execute,
    has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
    has_function_privilege('service_role',p.oid,'execute') service_role_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute,
    position('private.stage_c_assert_admin()' in pg_get_functiondef(p.oid))>0 has_guard
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in(
    'admin_upsert_site_campaign','admin_set_site_campaign_state',
    'admin_duplicate_site_campaign','admin_delete_site_campaign'
  ) order by 1
`);
assert.equal(acl.rows.length,4);
for(const fn of acl.rows){
  assert.equal(fn.prosecdef,true,fn.signature);
  assert.deepEqual(fn.proconfig,["search_path=\"\""],fn.signature);
  assert.equal(fn.has_guard,true,fn.signature);
  assert.equal(fn.anon_execute,false,fn.signature);
  assert.equal(fn.authenticated_execute,false,fn.signature);
  assert.equal(fn.service_role_execute,false,fn.signature);
  assert.equal(fn.public_execute,false,fn.signature);
}
console.log("✓ cuatro funciones cerradas, SECURITY DEFINER, search_path vacío y guard administrativo");

await db.close();
