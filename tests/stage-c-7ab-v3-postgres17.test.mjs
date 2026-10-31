import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const migrations=[
  "20261018171000_stage_c_visual_schema.sql",
  "20261018171100_stage_c_content_suggestion_schema.sql",
  "20261018171210_stage_c_visual_validators_private_functions.sql",
  "20261018171218_stage_c_active_campaign_private_function_v3.sql",
  "20261018171223_stage_c_next_change_private_function_v2.sql",
  "20261018171231_stage_c_site_experience_private_function.sql",
  "20261018171232_stage_c_admin_configuration_private_function.sql",
  "20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql",
  "20261018171254_stage_c_campaign_admin_private_functions_v2.sql",
  "20261018171255_stage_c_phrase_admin_private_function_v2.sql",
  "20261018171256_stage_c_content_faq_private_functions_v2.sql",
  "20261018171258_stage_c_suggestion_protection_private_functions_v3.sql",
  "20261024233029_stage_c_suggestion_admin_private_functions_v3.sql",
  "20261018171402_stage_c_safe_defaults_v3.sql",
  "20261025120000_stage_c_public_appearance_wrappers_closed_v3.sql",
  "20261025120100_stage_c_campaign_content_wrappers_closed_v3.sql",
  "20261025120200_stage_c_suggestion_wrappers_closed_v3.sql",
  "20261025120300_stage_c_api_storage_activation_v3.sql"
];
const sql=name=>fs.readFileSync(path.join(root,"supabase/migrations",name),"utf8")
  .replace(/^create extension if not exists pgcrypto with schema extensions;\s*$/mi,"");
const verification=version=>fs.readFileSync(path.join(root,"supabase/verification",`${version}_verify.sql`),"utf8");
const sha=name=>crypto.createHash("sha256").update(sql(name)).digest("hex").toUpperCase();
const db=new PGlite();
await db.waitReady;
const version=(await db.query("show server_version")).rows[0].server_version;
assert.match(String(version),/^17[.]/);

await db.exec(`
  create schema private;
  create schema auth;
  create schema storage;
  create schema extensions;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public,private,auth,storage to anon,authenticated,service_role;

  -- PGlite no incluye el archivo de control de pgcrypto. PostgreSQL 17 sí
  -- expone gen_random_uuid() en pg_catalog; este alias conserva la firma usada
  -- por producción sin falsear la lógica que se audita.
  create function extensions.gen_random_uuid() returns uuid language sql volatile set search_path='' as $$
    select pg_catalog.gen_random_uuid()
  $$;
  create function extensions.digest(p_data bytea,p_algorithm text) returns bytea
  language sql immutable set search_path='' as $$
    select decode(md5(convert_from(p_data,'UTF8'))||md5('stage-c-7ab-test:'||convert_from(p_data,'UTF8')),'hex')
  $$;

  create table auth.users(id uuid primary key);
  create table public.profiles(id uuid primary key references auth.users(id),role text not null);
  create table storage.buckets(
    id text primary key,name text not null,public boolean not null default false,
    file_size_limit bigint,allowed_mime_types text[]
  );
  create table storage.objects(
    id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,
    metadata jsonb not null default '{}',archived_at timestamptz,is_delete_marker boolean not null default false,
    unique(bucket_id,name)
  );
  alter table storage.objects enable row level security;
  grant select on storage.objects to anon,authenticated;

  create function auth.uid() returns uuid language sql stable set search_path='' as $$
    select nullif(current_setting('app.test_uid',true),'')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
    select jsonb_build_object('aal',coalesce(nullif(current_setting('app.test_aal',true),''),'aal1'))
  $$;
  create function auth.role() returns text language sql stable set search_path='' as $$
    select coalesce(nullif(current_setting('app.test_role',true),''),current_user)
  $$;
  grant execute on function auth.uid(),auth.jwt(),auth.role() to anon,authenticated,service_role;

  create function private.is_admin_role() returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
  $$;
  create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
    select private.is_admin_role() and coalesce(auth.jwt()->>'aal','aal1')='aal2'
  $$;
  revoke all on function private.is_admin_role(),private.is_admin() from public;
  grant execute on function private.is_admin() to anon,authenticated;
`);

const apply=async name=>{
  await db.exec("begin");
  try{await db.exec(sql(name));await db.exec("commit");}
  catch(error){await db.exec("rollback");error.message=`${name}: ${error.message}`;throw error;}
};
const one=async(q,params=[])=>{const result=await db.query(q,params);return result.rows[0];};
const scalar=async(q,params=[])=>Object.values(await one(q,params))[0];
const setIdentity=async(role,uid="",aal="aal1")=>{
  await db.exec("reset role");
  await db.query("select set_config('app.test_uid',$1,false),set_config('app.test_aal',$2,false),set_config('app.test_role',$3,false)",[uid,aal,role]);
  await db.exec(`set role ${role}`);
};
const expectDenied=async(q,label)=>{
  let error;try{await db.query(q);}catch(value){error=value;}
  assert.ok(error,`${label}: debía ser rechazado`);
  assert.ok(["42501","P0001"].includes(error.code),`${label}: SQLSTATE ${error.code}`);
};

for(const name of migrations.slice(0,14))await apply(name);
assert.equal(await scalar("select count(*)::int from private.site_content_pages"),4);
assert.equal(await scalar("select count(*)::int from private.site_appearance_versions"),1);
assert.equal(await scalar("select count(*)::int from private.site_welcome_phrases"),12);

const before=await one(`select
  (select count(*)::int from private.site_content_pages) pages,
  (select count(*)::int from private.site_appearance_versions) appearances,
  (select count(*)::int from private.site_welcome_phrases) phrases,
  (select count(*)::int from private.site_campaigns) campaigns,
  (select count(*)::int from private.site_faq_items) faq,
  (select count(*)::int from private.site_suggestions) suggestions`);

for(const name of migrations.slice(14,17)){
  await apply(name);
  const version=name.slice(0,14);
  const verificationResult=await scalar(verification(version));
  assert.equal(verificationResult.sentinel_ok,true,`${name}: verificación de centinela`);
  assert.ok(verificationResult.objects.every(object=>object.exists&&!object.anon_execute&&!object.authenticated_execute&&!object.service_role_execute),`${name}: verificación de wrappers cerrados`);
  const wrapperCount=await scalar("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['get_site_experience','get_public_content_page','get_public_faq','admin_get_site_configuration','admin_save_site_appearance_draft','admin_publish_site_appearance','admin_reset_site_appearance_draft','admin_restore_original_appearance_draft','admin_register_site_asset','admin_retire_site_asset','admin_upsert_site_campaign','admin_set_site_campaign_state','admin_duplicate_site_campaign','admin_delete_site_campaign','admin_upsert_welcome_phrase','admin_save_content_draft','admin_publish_content_page','admin_restore_content_version','admin_upsert_faq','admin_list_faq','admin_restore_faq','submit_protected_suggestion','admin_list_suggestions','admin_get_suggestion','admin_update_suggestion','admin_set_suggestion_lifecycle','cleanup_suggestion_protection'])");
  const expected=migrations.indexOf(name)===14?10:migrations.indexOf(name)===15?21:27;
  assert.equal(wrapperCount,expected,`${name}: cantidad acumulada de wrappers`);
  assert.equal(await scalar("select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='public' and p.proname=any(array['get_site_experience','get_public_content_page','get_public_faq','admin_get_site_configuration','admin_save_site_appearance_draft','admin_publish_site_appearance','admin_reset_site_appearance_draft','admin_restore_original_appearance_draft','admin_register_site_asset','admin_retire_site_asset','admin_upsert_site_campaign','admin_set_site_campaign_state','admin_duplicate_site_campaign','admin_delete_site_campaign','admin_upsert_welcome_phrase','admin_save_content_draft','admin_publish_content_page','admin_restore_content_version','admin_upsert_faq','admin_list_faq','admin_restore_faq','submit_protected_suggestion','admin_list_suggestions','admin_get_suggestion','admin_update_suggestion','admin_set_suggestion_lifecycle','cleanup_suggestion_protection']) and (a.grantee=0 or pg_get_userbyid(a.grantee)=any(array['anon','authenticated','service_role'])) and a.privilege_type='EXECUTE'"),0,`${name}: wrappers cerrados`);
}

assert.deepEqual(await one(`select
  (select count(*)::int from private.site_content_pages) pages,
  (select count(*)::int from private.site_appearance_versions) appearances,
  (select count(*)::int from private.site_welcome_phrases) phrases,
  (select count(*)::int from private.site_campaigns) campaigns,
  (select count(*)::int from private.site_faq_items) faq,
  (select count(*)::int from private.site_suggestions) suggestions`),before);

const wrappers=(await db.query(`
  select p.oid::regprocedure::text identity,p.proname,
    pg_get_function_result(p.oid) result,p.prosecdef,p.proconfig
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array[
    'get_site_experience','get_public_content_page','get_public_faq','admin_get_site_configuration',
    'admin_save_site_appearance_draft','admin_publish_site_appearance','admin_reset_site_appearance_draft',
    'admin_restore_original_appearance_draft','admin_register_site_asset','admin_retire_site_asset',
    'admin_upsert_site_campaign','admin_set_site_campaign_state','admin_duplicate_site_campaign',
    'admin_delete_site_campaign','admin_upsert_welcome_phrase','admin_save_content_draft',
    'admin_publish_content_page','admin_restore_content_version','admin_upsert_faq','admin_list_faq',
    'admin_restore_faq','submit_protected_suggestion','admin_list_suggestions','admin_get_suggestion',
    'admin_update_suggestion','admin_set_suggestion_lifecycle','cleanup_suggestion_protection'])
  order by identity
`)).rows;
assert.equal(wrappers.length,27);
assert.equal(wrappers.filter(x=>x.proname.startsWith("get_")).length,3);
assert.equal(wrappers.length-3,24);
for(const wrapper of wrappers)assert.deepEqual(wrapper.proconfig,["search_path=\"\""],wrapper.identity);
assert.equal(wrappers.filter(x=>x.prosecdef).length,2);

const adminPrivate=[
  "admin_get_site_configuration","admin_save_site_appearance_draft","admin_publish_site_appearance",
  "admin_reset_site_appearance_draft","admin_restore_original_appearance_draft","admin_register_site_asset",
  "admin_retire_site_asset","admin_upsert_site_campaign","admin_set_site_campaign_state",
  "admin_duplicate_site_campaign","admin_delete_site_campaign","admin_upsert_welcome_phrase",
  "admin_save_content_draft","admin_publish_content_page","admin_restore_content_version","admin_upsert_faq",
  "admin_list_faq","admin_restore_faq","admin_list_suggestions","admin_get_suggestion",
  "admin_update_suggestion","admin_set_suggestion_lifecycle"
];
const missingGuard=await scalar(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any($1::text[]) and position('stage_c_assert_admin' in p.prosrc)=0`,[adminPrivate]);
assert.equal(missingGuard,0,"todas las funciones administrativas deben exigir AAL2");

await apply(migrations[17]);
const activationVerification=await scalar(verification("20261025120300"));
assert.equal(activationVerification.sentinel_ok,true);
assert.equal(activationVerification.storage_helper_sentinel_ok,true);
assert.equal(activationVerification.storage_public_policy_uses_helper,true);
assert.equal(activationVerification.admin_wrappers_total,22);
assert.equal(activationVerification.admin_wrappers_acl_errors,0);
assert.equal(activationVerification.private_admin_target_errors,0);
assert.equal(activationVerification.stage_c_private_tables_rls,13);
assert.equal(activationVerification.stage_c_direct_table_grant_errors,0);
assert.deepEqual(await one(`select
  (select count(*)::int from private.site_content_pages) pages,
  (select count(*)::int from private.site_appearance_versions) appearances,
  (select count(*)::int from private.site_welcome_phrases) phrases,
  (select count(*)::int from private.site_campaigns) campaigns,
  (select count(*)::int from private.site_faq_items) faq,
  (select count(*)::int from private.site_suggestions) suggestions`),before);

const anonPublic=["public.get_site_experience()","public.get_public_content_page(text)","public.get_public_faq()"];
const adminPublic=wrappers.filter(x=>x.proname.startsWith("admin_")).map(x=>x.identity);
for(const sig of anonPublic){
  assert.equal(await scalar(`select has_function_privilege('anon',$1,'execute')`,[sig]),true,sig);
  assert.equal(await scalar(`select has_function_privilege('authenticated',$1,'execute')`,[sig]),true,sig);
  assert.equal(await scalar(`select has_function_privilege('service_role',$1,'execute')`,[sig]),false,sig);
}
for(const sig of adminPublic){
  assert.equal(await scalar(`select has_function_privilege('anon',$1,'execute')`,[sig]),false,sig);
  assert.equal(await scalar(`select has_function_privilege('authenticated',$1,'execute')`,[sig]),true,sig);
  assert.equal(await scalar(`select has_function_privilege('service_role',$1,'execute')`,[sig]),false,sig);
}
for(const sig of ["public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)","public.cleanup_suggestion_protection()"]){
  assert.equal(await scalar(`select has_function_privilege('anon',$1,'execute')`,[sig]),false,sig);
  assert.equal(await scalar(`select has_function_privilege('authenticated',$1,'execute')`,[sig]),false,sig);
  assert.equal(await scalar(`select has_function_privilege('service_role',$1,'execute')`,[sig]),true,sig);
}

const admin="00000000-0000-4000-8000-000000000001";
const client="00000000-0000-4000-8000-000000000002";
await db.exec("reset role");
await db.query("insert into auth.users(id) values($1),($2)",[admin,client]);
await db.query("insert into public.profiles(id,role) values($1,'admin'),($2,'customer')",[admin,client]);

await setIdentity("authenticated",admin,"aal1");
await expectDenied("select public.admin_get_site_configuration()","admin AAL1");
await setIdentity("authenticated",client,"aal2");
await expectDenied("select public.admin_get_site_configuration()","cliente AAL2");
await setIdentity("anon","","aal1");
await expectDenied("select public.admin_get_site_configuration()","visitante");
await setIdentity("authenticated",admin,"aal2");
const adminConfig=await scalar("select public.admin_get_site_configuration()");
assert.equal(adminConfig.appearance.state,"draft");
assert.equal(adminConfig.faqs.length,0);

await setIdentity("anon","","aal1");
const experience=await scalar("select public.get_site_experience()");
assert.equal(experience.campaign,null);
assert.deepEqual(experience.welcome_phrases,[]);
assert.equal(await scalar("select public.get_public_content_page('terms')"),null);
assert.deepEqual(await scalar("select public.get_public_faq()"),[]);
await expectDenied("select * from private.site_content_versions","lectura directa de borradores");

await db.exec("reset role");
const publicPath="00000000-0000-4000-8000-000000000010/00000000-0000-4000-8000-000000000011.png";
const privatePath="00000000-0000-4000-8000-000000000012/00000000-0000-4000-8000-000000000013.png";
await db.query("insert into storage.objects(bucket_id,name,metadata) values('site-assets',$1,'{\"mimetype\":\"image/png\",\"size\":\"10\"}'),('site-assets',$2,'{\"mimetype\":\"image/png\",\"size\":\"10\"}')",[publicPath,privatePath]);
await db.query("insert into private.site_assets(kind,label,storage_path,mime_type,byte_size,width,height,public_since) values('logo','Público',$1,'image/png',10,1,1,now()),('logo','Privado',$2,'image/png',10,1,1,null)",[publicPath,privatePath]);
await setIdentity("anon","","aal1");
assert.deepEqual((await db.query("select name from storage.objects order by name")).rows.map(x=>x.name),[publicPath]);
await setIdentity("authenticated",admin,"aal1");
assert.deepEqual((await db.query("select name from storage.objects order by name")).rows.map(x=>x.name),[publicPath]);
await setIdentity("authenticated",admin,"aal2");
assert.deepEqual((await db.query("select name from storage.objects order by name")).rows.map(x=>x.name),[publicPath,privatePath]);

await setIdentity("service_role","","aal1");
const accepted=await scalar(`select public.submit_protected_suggestion(
  repeat('a',64),repeat('b',64),repeat('c',64),'guest','visual','Tema de prueba',
  'Descripción de prueba suficientemente extensa',null,
  '00000000-0000-4000-8000-000000000020'::uuid,null
)`);
assert.equal(accepted.status,"accepted");
await db.exec("reset role");
assert.equal(await scalar("select count(*)::int from private.site_suggestions"),1);
await setIdentity("service_role","","aal1");
await db.query("select public.cleanup_suggestion_protection()");
await expectDenied("select public.admin_get_site_configuration()","service_role sin acceso administrativo");

await db.exec("reset role");
assert.equal(await scalar("select count(*)::int from pg_policies where schemaname='storage' and tablename='objects' and policyname in('site_assets_public_read','site_assets_admin_read')"),2);
assert.equal(await scalar("select public from storage.buckets where id='site-assets'"),false);
assert.equal(await scalar("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any(array['site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases','site_content_pages','site_content_versions','site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits','site_campaign_idempotency','suggestion_moderation_history']) and c.relrowsecurity"),13);
assert.equal(await scalar("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=any(array['site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences','site_welcome_phrases','site_content_pages','site_content_versions','site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits','site_campaign_idempotency','suggestion_moderation_history']) and (has_table_privilege('anon',c.oid,'select,insert,update,delete') or has_table_privilege('authenticated',c.oid,'select,insert,update,delete') or has_table_privilege('service_role',c.oid,'select,insert,update,delete'))"),0);

console.log(JSON.stringify({
  result:"PASS_STAGE_C_7A_7B_V3_LOCAL",
  postgres:version,
  wrappers_total:27,
  wrappers_audited:24,
  public_readers:3,
  hashes:Object.fromEntries(migrations.slice(14).map(name=>[name,sha(name)])),
  concurrency:"not_required_wrappers_and_grants_only",
  production_connections:0
},null,2));
await db.close();
