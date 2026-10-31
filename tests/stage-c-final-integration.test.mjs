import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {createHandler as createAssetHandler} from "../supabase/functions/site-assets/worker.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const REQUEST_ID="018f0c2d-0ec4-7f88-8c8a-cd20274bb20a";
const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SECRET_KEYS:JSON.stringify({default:"service-secret"})})[name];
const png=()=>{const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10],0);new DataView(bytes.buffer).setUint32(16,1);new DataView(bytes.buffer).setUint32(20,1);return bytes;};
function uploadRequest(){const form=new FormData();form.set("request_id",REQUEST_ID);form.set("kind","logo");form.set("label","Logo principal");form.set("file",new File([png()],"logo.png",{type:"image/png"}));return new Request("https://edge.example/functions/v1/site-assets",{method:"POST",headers:{origin:"https://cubica3d.ar",authorization:"Bearer admin-aal2"},body:form});}

{
  const calls=[];let storagePath="";
  const fetchImpl=async(url,options={})=>{
    const value=String(url);calls.push({url:value,options});
    if(value.includes("/auth/v1/user"))return Response.json({id:REQUEST_ID});
    if(value.includes("admin_get_site_configuration"))return Response.json({assets:[]});
    if(value.includes("/storage/v1/object/site-assets/")&&options.method==="POST"){
      storagePath=decodeURIComponent(value.split("/site-assets/")[1]);
      assert.equal(options.headers["x-upsert"],"true");
      return Response.json({ok:true});
    }
    if(value.includes("admin_register_site_asset"))return Response.json({id:REQUEST_ID,storage_path:storagePath,label:"Logo principal",kind:"logo"});
    throw new Error(`Llamada inesperada: ${value}`);
  };
  const response=await createAssetHandler({env,fetchImpl})(uploadRequest()),body=await response.json();
  assert.equal(response.status,201);assert.equal(body.asset.storage_path,storagePath);
  assert.match(storagePath,new RegExp(`^${REQUEST_ID}/[0-9a-f-]{36}\\.png$`));
  assert.equal(calls.some(call=>call.options.method==="DELETE"),false);

  const retryCalls=[],asset=body.asset;
  const retryFetch=async(url,options={})=>{const value=String(url);retryCalls.push({url:value,options});if(value.includes("/auth/v1/user"))return Response.json({id:REQUEST_ID});if(value.includes("admin_get_site_configuration"))return Response.json({assets:[asset]});throw new Error(`El reintento no debía llegar a ${value}`);};
  const retried=await createAssetHandler({env,fetchImpl:retryFetch})(uploadRequest());
  assert.equal(retried.status,200);assert.equal((await retried.json()).idempotent,true);
  assert.equal(retryCalls.some(call=>call.url.includes("/storage/v1/object/")),false);
}

{
  const calls=[];
  const fetchImpl=async(url,options={})=>{const value=String(url);calls.push({url:value,options});if(value.includes("/auth/v1/user"))return Response.json({id:REQUEST_ID});if(value.includes("admin_get_site_configuration"))return Response.json({assets:[]});if(value.includes("/storage/v1/object/site-assets/")&&options.method==="POST")return Response.json({ok:true});if(value.includes("admin_register_site_asset"))throw new Error("respuesta perdida");throw new Error(`Llamada inesperada: ${value}`);};
  const response=await createAssetHandler({env,fetchImpl})(uploadRequest());
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:"registration_pending"});
  assert.equal(calls.some(call=>call.options.method==="DELETE"),false,"una respuesta ambigua nunca debe borrar el objeto");
}

{
  const source=fs.readFileSync(path.join(root,"js/site-experience.js"),"utf8"),documentListeners={},windowListeners={};
  const makeElement=(hidden=true)=>({innerHTML:"",classList:{hidden,contains(name){return name==="hidden"&&this.hidden;},toggle(name,value){if(name==="hidden")this.hidden=value;},add(name){if(name==="hidden")this.hidden=true;},remove(name){if(name==="hidden")this.hidden=false;}},style:{setProperty(){}},addEventListener(){},querySelectorAll(){return [];}});
  const admin=makeElement(),publicSurface=makeElement(),host=makeElement(false),section=makeElement();
  let rpcCalls=0,rpcMode="error",resolvePending;
  const document={documentElement:{style:{setProperty(){}}},body:{style:{setProperty(){}}},head:{appendChild(){}},getElementById:id=>id==="site-configuration-app"?host:id==="section-configuration"?section:null,querySelectorAll:selector=>selector==='[data-stage-c="admin"]'?[admin,section]:selector==='[data-stage-c="public"]'?[publicSurface]:[],querySelector:()=>null,addEventListener:(name,callback)=>{documentListeners[name]=callback;},createElement:()=>makeElement()};
  const window={CUBICA_CONFIG:{stageCMode:"off"},cubicaSupabase:{rpc:async()=>{rpcCalls++;if(rpcMode==="pending")return new Promise(resolve=>{resolvePending=resolve;});return {data:null,error:{message:"rechazo simulado"}};}},addEventListener(name,callback){windowListeners[name]=callback;}};window.window=window;
  const context={window,document,session:null,console,crypto,URL,URLSearchParams,location:{href:"https://cubica3d.ar/",search:""},history:{pushState(){}},clearTimeout,setTimeout,clearInterval,setInterval,FormData,confirm:()=>false};
  window.cubicaAdminMfaAccessAllowed=()=>context.session?.role!=="admin"||context.session?.adminMfaAccessAllowed===true;
  vm.runInNewContext(source,context,{filename:"site-experience.js"});documentListeners.DOMContentLoaded();

  await window.cubicaSiteExperience.loadPublicExperience();await window.cubicaSiteExperience.loadAdmin();
  assert.equal(rpcCalls,0,"stageCMode=off no debe llamar wrappers cerrados");
  assert.equal(admin.classList.hidden,true);assert.equal(section.classList.hidden,true);assert.equal(publicSurface.classList.hidden,true);

  window.CUBICA_CONFIG.stageCMode="admin";
  for(const identity of [null,{role:"customer",adminMfaAccessAllowed:true},{role:"admin",adminMfaAccessAllowed:false}]){
    context.session=identity;admin.classList.remove("hidden");section.classList.remove("hidden");
    window.cubicaSiteExperience.applyStageCSurfaces();await window.cubicaSiteExperience.loadAdmin();
    assert.equal(admin.classList.hidden,true);assert.equal(section.classList.hidden,true);assert.equal(rpcCalls,0,"visitante, cliente y AAL1 no llaman RPC administrativo");
  }

  context.session={role:"admin",supabaseUserId:"admin-1",adminMfaAccessAllowed:true};
  admin.classList.add("hidden");section.classList.add("hidden");documentListeners.DOMContentLoaded();
  assert.equal(admin.classList.hidden,true,"la carga inicial nunca desoculta superficies administrativas");
  assert.equal(section.classList.hidden,true,"la sección queda cerrada hasta navegar desde renderApp");
  admin.classList.remove("hidden");
  assert.equal(window.cubicaSiteExperience.adminAccessAllowed(),true);
  await window.cubicaSiteExperience.loadAdmin();
  assert.equal(rpcCalls,1,"el administrador AAL2 puede iniciar la carga protegida");
  assert.equal(publicSurface.classList.hidden,true,"admin no habilita superficies públicas");

  rpcMode="pending";section.classList.remove("hidden");const staleLoad=window.cubicaSiteExperience.loadAdmin();
  assert.equal(rpcCalls,2);context.session={role:"admin",supabaseUserId:"admin-1",adminMfaAccessAllowed:false};windowListeners["cubica:auth-ready"]({detail:{role:"admin",mfa:{accessAllowed:false}}});
  assert.equal(admin.classList.hidden,true);assert.equal(section.classList.hidden,true);assert.match(host.innerHTML,/protegida/);
  resolvePending({data:{private_marker:"no debe mostrarse"},error:null});assert.equal(await staleLoad,false);assert.doesNotMatch(host.innerHTML,/private_marker|no debe mostrarse/);

  context.session=null;windowListeners["cubica:auth-ready"]({detail:{role:null}});
  assert.equal(window.cubicaSiteExperience.adminAccessAllowed(),false);assert.equal(section.classList.hidden,true);assert.match(host.innerHTML,/protegida/);

  window.CUBICA_CONFIG.stageCMode="full";context.session={role:"admin",adminMfaAccessAllowed:false};admin.classList.remove("hidden");window.cubicaSiteExperience.applyStageCSurfaces();
  assert.equal(admin.classList.hidden,true,"full tampoco omite AAL2");assert.equal(publicSurface.classList.hidden,false);
}

const config=fs.readFileSync(path.join(root,"github-config.js"),"utf8");
assert.match(config,/stageCMode:\s*"off"/);
const functionConfig=fs.readFileSync(path.join(root,"supabase/config.toml"),"utf8");
assert.match(functionConfig,/\[functions\.site-assets\][\s\S]*?verify_jwt\s*=\s*true[\s\S]*?entrypoint\s*=\s*"\.\/functions\/site-assets\/index\.ts"/);
assert.match(functionConfig,/\[functions\.submit-suggestion\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/submit-suggestion\/index\.ts"/);
console.log("Integración final Etapa C: uploads idempotentes, recuperación ambigua y gate sin RPC verificados.");
