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
  const source=fs.readFileSync(path.join(root,"js/site-experience.js"),"utf8"),listeners={};
  const makeElement=()=>({innerHTML:"",classList:{hidden:false,toggle(_name,value){this.hidden=value;},add(){},remove(){}},style:{setProperty(){}},addEventListener(){}});
  const admin=makeElement(),publicSurface=makeElement(),host=makeElement();let rpcCalls=0;
  const document={documentElement:{style:{setProperty(){}}},body:{style:{setProperty(){}}},head:{appendChild(){}},getElementById:id=>id==="site-configuration-app"?host:null,querySelectorAll:selector=>selector==='[data-stage-c="admin"]'?[admin]:selector==='[data-stage-c="public"]'?[publicSurface]:[],querySelector:()=>null,addEventListener:(name,callback)=>{listeners[name]=callback;},createElement:()=>makeElement()};
  const window={CUBICA_CONFIG:{stageCMode:"off"},cubicaSupabase:{rpc:async()=>{rpcCalls++;return {data:{},error:null};}},addEventListener(){}};window.window=window;
  const context={window,document,console,crypto,URL,URLSearchParams,location:{href:"https://cubica3d.ar/",search:""},history:{pushState(){}},clearTimeout,setTimeout,clearInterval,setInterval,FormData,confirm:()=>false};
  vm.runInNewContext(source,context,{filename:"site-experience.js"});listeners.DOMContentLoaded();
  await window.cubicaSiteExperience.loadPublicExperience();await window.cubicaSiteExperience.loadAdmin();
  assert.equal(rpcCalls,0,"stageCMode=off no debe llamar wrappers cerrados");
  assert.equal(admin.classList.hidden,true);assert.equal(publicSurface.classList.hidden,true);
  assert.match(host.innerHTML,/Configuración no habilitada/);
  window.CUBICA_CONFIG.stageCMode="admin";window.cubicaSiteExperience.applyStageCSurfaces();
  assert.equal(admin.classList.hidden,false);assert.equal(publicSurface.classList.hidden,true);
  window.CUBICA_CONFIG.stageCMode="full";window.cubicaSiteExperience.applyStageCSurfaces();
  assert.equal(admin.classList.hidden,false);assert.equal(publicSurface.classList.hidden,false);
}

const config=fs.readFileSync(path.join(root,"github-config.js"),"utf8");
assert.match(config,/stageCMode:\s*"off"/);
const functionConfig=fs.readFileSync(path.join(root,"supabase/config.toml"),"utf8");
assert.match(functionConfig,/\[functions\.site-assets\][\s\S]*?verify_jwt\s*=\s*true[\s\S]*?entrypoint\s*=\s*"\.\/functions\/site-assets\/index\.ts"/);
assert.match(functionConfig,/\[functions\.submit-suggestion\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/submit-suggestion\/index\.ts"/);
console.log("Integración final Etapa C: uploads idempotentes, recuperación ambigua y gate sin RPC verificados.");
