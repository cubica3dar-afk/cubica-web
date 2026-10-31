import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {PGlite} from "@electric-sql/pglite";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migration=read("supabase/migrations/20261031164756_welcome_screen_preference.sql");
const ui=read("js/site-experience.js");
const html=read("index.html");
const css=read("styles.css");

const db=new PGlite();
await db.waitReady;
assert.match(String((await db.query("show server_version")).rows[0].server_version),/^17[.]/);
await db.exec(`
  create schema private;
  create schema auth;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public,private,auth to anon,authenticated,service_role;

  create function auth.uid() returns uuid language sql stable set search_path='' as $$
    select nullif(current_setting('app.test_uid',true),'')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
    select jsonb_build_object('aal',coalesce(nullif(current_setting('app.test_aal',true),''),'aal1'))
  $$;
  grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;

  create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
    select auth.uid()='00000000-0000-0000-0000-000000000001'::uuid
      and coalesce(auth.jwt()->>'aal','aal1')='aal2'
  $$;
  create function private.stage_c_assert_admin() returns void language plpgsql stable security definer set search_path='' as $$
  begin
    if auth.uid() is null or not private.is_admin() then
      raise exception 'Solo administradores con MFA AAL2' using errcode='42501';
    end if;
  end
  $$;
  revoke all on function private.is_admin(),private.stage_c_assert_admin() from public,anon,authenticated,service_role;
  comment on function private.stage_c_assert_admin() is 'cubica_stage_c:20261018171210';

  create function public.get_site_experience() returns jsonb language sql stable set search_path='' as $$ select '{}'::jsonb $$;
  comment on function public.get_site_experience() is 'cubica_stage_c:20261025120300';
`);
await db.exec(migration);

const setIdentity=async(role,uid="",aal="aal1")=>{
  await db.exec("reset role");
  await db.query("select set_config('app.test_uid',$1,false),set_config('app.test_aal',$2,false)",[uid,aal]);
  await db.exec(`set role ${role}`);
};
const value=async sql=>(await db.query(sql)).rows[0].value;
const denied=async(sql,label)=>{let error;try{await db.query(sql);}catch(reason){error=reason;}assert.ok(error,`${label}: debía rechazarse`);return error;};

await setIdentity("anon");
assert.equal(await value("select public.get_welcome_screen_preference() value"),false,"el valor inicial público es desactivado");
await denied("select public.admin_get_welcome_screen_preference()","visitante");
await denied("select * from private.site_runtime_settings","tabla privada");

await setIdentity("authenticated","00000000-0000-0000-0000-000000000001","aal1");
assert.equal((await denied("select public.admin_get_welcome_screen_preference()","admin AAL1")).code,"42501");
await setIdentity("authenticated","00000000-0000-0000-0000-000000000002","aal2");
assert.equal((await denied("select public.admin_set_welcome_screen_preference(true,1)","cliente AAL2")).code,"42501");

await setIdentity("authenticated","00000000-0000-0000-0000-000000000001","aal2");
const initial=await value("select public.admin_get_welcome_screen_preference() value");
assert.deepEqual({enabled:initial.enabled,version:initial.version},{enabled:false,version:1});
const enabled=await value("select public.admin_set_welcome_screen_preference(true,1) value");
assert.deepEqual({enabled:enabled.enabled,version:enabled.version},{enabled:true,version:2});
await denied("select public.admin_set_welcome_screen_preference(false,1)","versión obsoleta");
await setIdentity("anon");
assert.equal(await value("select public.get_welcome_screen_preference() value"),true,"todos los navegadores leen el mismo valor global");
await db.exec("reset role");
assert.equal((await db.query("select count(*)::int n from private.site_runtime_settings")).rows[0].n,1);

function element(hidden=true){
  const classes=new Set(hidden?["hidden"]:[]);
  return {id:"",innerHTML:"",textContent:"",classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name),toggle(name,force){if(force)classes.add(name);else classes.delete(name);}},style:{setProperty(){}},setAttribute(name,value){this[name]=value;},addEventListener(){},querySelectorAll(){return [];}};
}
async function browserCase({href="https://cubica3d.ar/",preference=false,error=null,authBlocked=false,recovery=false}={}){
  const url=new URL(href),listeners={},welcome=element(true),store=element(false);store.id="section-store";let calls=0;
  const document={documentElement:{style:{setProperty(){}}},body:{style:{setProperty(){}}},head:{appendChild(){}},getElementById:id=>id==="welcome-view"?welcome:null,querySelector:selector=>selector===".page-section:not(.hidden)"?store:null,querySelectorAll:()=>[],createElement:()=>element(),addEventListener:(name,callback)=>{listeners[name]=callback;}};
  const window={CUBICA_CONFIG:{stageCMode:"admin"},cubicaAuthCallbackBlocked:authBlocked,cubicaPasswordRecoveryActive:recovery,cubicaSupabase:{rpc:async name=>{calls++;assert.equal(name,"get_welcome_screen_preference");return error?{data:null,error}:{data:preference,error:null};}},addEventListener(){}};window.window=window;
  const context={window,document,session:null,console:{warn(){},log(){},error(){}},crypto,URL,URLSearchParams,location:{href:url.href,search:url.search,hash:url.hash},history:{pushState(){}},clearTimeout,setTimeout,clearInterval,setInterval,FormData,confirm:()=>false};
  vm.runInNewContext(ui,context,{filename:"site-experience.js"});
  listeners.DOMContentLoaded();
  await new Promise(resolve=>setTimeout(resolve,0));
  return {visible:!welcome.classList.contains("hidden"),calls,api:window.cubicaSiteExperience};
}

const disabled=await browserCase({preference:false});assert.equal(disabled.visible,false);assert.equal(disabled.calls,1);
const active=await browserCase({preference:true});assert.equal(active.visible,true);assert.equal(active.calls,1);
for(const href of [
  "https://cubica3d.ar/?product=abc",
  "https://cubica3d.ar/?view=checkout",
  "https://cubica3d.ar/?view=orders",
  "https://cubica3d.ar/?view=reset",
  "https://cubica3d.ar/?code=oauth-callback",
  "https://cubica3d.ar/#type=recovery"
]){
  const direct=await browserCase({href,preference:true});assert.equal(direct.visible,false,href);assert.equal(direct.calls,0,href);
}
assert.equal((await browserCase({preference:true,authBlocked:true})).visible,false);
assert.equal((await browserCase({preference:true,recovery:true})).visible,false);
assert.equal((await browserCase({error:{message:"offline"}})).visible,false,"un error abre directamente la tienda");

assert.match(html,/id="welcome-view" class="welcome-screen hidden" aria-hidden="true"/);
assert.match(ui,/admin_set_welcome_screen_preference/);
assert.match(ui,/p_expected_version/);
assert.match(ui,/Este ajuste no publica el borrador visual/);
assert.doesNotMatch(ui,/localStorage[\s\S]{0,120}welcome/i);
assert.match(css,/\.site-welcome-setting/);
assert.match(css,/@media\(max-width:600px\)[^{]*\{\.site-welcome-setting/);
assert.match(migration,/enable row level security/);
assert.match(migration,/perform private\.stage_c_assert_admin\(\)/);
assert.match(migration,/grant execute on function public\.get_welcome_screen_preference\(\) to anon,authenticated/);
assert.doesNotMatch(migration,/grant (?:select|insert|update|delete) on (?:table )?private\.site_runtime_settings/i);

console.log("Preferencia de bienvenida: persistencia global, MFA, fail-open y enlaces directos aprobados.");

