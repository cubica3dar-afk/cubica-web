import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"js/site-experience.js"),"utf8");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const config=fs.readFileSync(path.join(root,"github-config.js"),"utf8");

assert.doesNotMatch(source,/admin_reset_site_appearance_draft/,"Cancelar no debe persistir");
assert.doesNotMatch(source,/admin_restore_original_appearance_draft/,"Valores originales no debe persistir");
assert.match(source,/site-reset-appearance"\)\.onclick=\(\)=>fillAppearanceForm\(state\.admin\.appearance\?\.config/);
assert.match(source,/site-original-appearance"\)\.onclick=\(\)=>fillAppearanceForm\(DEFAULT_APPEARANCE/);
assert.match(source,/confirm\("\u00bfPublicar este borrador visual\?/);
assert.match(source,/rpc\("admin_save_site_appearance_draft"/);
assert.match(source,/rpc\("admin_publish_site_appearance"/);
assert.match(html,/js\/site-experience\.js\?v=site-stage-c3/);
assert.match(config,/stageCMode:\s*"admin"/);

const colors=["background","panel","panelAlt","text","muted","accent"];
const colorInputs=colors.map(key=>({dataset:{themeColor:key},value:"",classList:{toggle(){}}}));
const hexInputs=colors.map(key=>({dataset:{themeHex:key},value:"",classList:{toggle(){}}}));
const assetInputs=["logo","banner","background"].map(key=>({dataset:{themeAsset:key},value:""}));
const title={value:""},subtitle={value:""},contrastStatus={textContent:"",className:""},appearanceStatus={textContent:""};
const previewTitle={textContent:""},previewSubtitle={textContent:""},previewStyles={};
const preview={
  style:{setProperty(name,value){previewStyles[name]=value;}},
  querySelector(selector){return selector==="h2"?previewTitle:selector==="p"?previewSubtitle:null;},
  classList:{toggle(){}}
};
const byId={"site-hero-title-input":title,"site-hero-subtitle-input":subtitle,"site-contrast-status":contrastStatus,"site-appearance-status":appearanceStatus,"site-preview":preview};
const documentListeners={};
const document={
  documentElement:{style:{setProperty(){}}},body:{style:{setProperty(){}}},head:{appendChild(){}},
  getElementById:id=>byId[id]||null,
  querySelectorAll(selector){
    if(selector==="[data-theme-hex]")return hexInputs;
    if(selector==="[data-theme-color]")return colorInputs;
    if(selector==="[data-theme-asset]")return assetInputs;
    return [];
  },
  querySelector(selector){
    const color=selector.match(/^\[data-theme-color="(.+)"\]$/);if(color)return colorInputs.find(input=>input.dataset.themeColor===color[1])||null;
    return null;
  },
  addEventListener(name,callback){documentListeners[name]=callback;},createElement(){return {classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},addEventListener(){}};}
};
let rpcCalls=0;
const window={__CUBICA_TEST__:true,CUBICA_CONFIG:{stageCMode:"admin"},cubicaSupabase:{rpc:async()=>{rpcCalls++;return {data:null,error:null};}},addEventListener(){}};window.window=window;
const context={window,document,session:null,console,crypto,URL,URLSearchParams,location:{href:"https://cubica3d.ar/",search:"",hash:""},history:{pushState(){}},clearTimeout,setTimeout,clearInterval,setInterval,FormData,confirm:()=>false};
vm.runInNewContext(source,context,{filename:"site-experience.js"});

const internals=window.cubicaSiteExperienceInternals;
const saved={
  colors:{background:"#101020",panel:"#202030",panelAlt:"#303040",text:"#ffffff",muted:"#b0b0c0",accent:"#ffcc00"},
  hero:{title:"Borrador preservado",subtitle:"Texto guardado previamente"},
  assets:{logo:"logo-1",banner:"banner-1",background:null}
};
internals.fillAppearanceForm(saved,"restaurado");
assert.equal(title.value,"Borrador preservado");
assert.equal(subtitle.value,"Texto guardado previamente");
assert.deepEqual(hexInputs.map(input=>input.value),Object.values(saved.colors));
assert.deepEqual(colorInputs.map(input=>input.value),Object.values(saved.colors));
assert.deepEqual(assetInputs.map(input=>input.value),["logo-1","banner-1",""]);
assert.equal(appearanceStatus.textContent,"restaurado");
assert.equal(previewTitle.textContent,"Borrador preservado");
assert.equal(rpcCalls,0,"rellenar, cancelar o cargar originales no debe llamar RPC");

internals.fillAppearanceForm(internals.defaultAppearance,"originales locales");
assert.equal(title.value,"Objetos hechos para vos.");
assert.equal(subtitle.value,"Explorá los productos disponibles, elegí cantidades y armá tu pedido.");
assert.deepEqual(assetInputs.map(input=>input.value),["","",""]);
assert.equal(appearanceStatus.textContent,"originales locales");
assert.equal(rpcCalls,0);

hexInputs.find(input=>input.dataset.themeHex==="background").value="#fff";
internals.updatePreview();
assert.match(contrastStatus.textContent,/HEX #RRGGBB/);
assert.equal(contrastStatus.className,"site-contrast-status danger");
assert.doesNotMatch(contrastStatus.textContent,/NaN/);

internals.fillAppearanceForm(internals.defaultAppearance);
hexInputs.find(input=>input.dataset.themeHex==="background").value="#ffffff";
hexInputs.find(input=>input.dataset.themeHex==="text").value="#ffffff";
assert.throws(()=>window.cubicaSiteExperience.validateAppearance(internals.collectAppearance()),/4,5:1/);
assert.equal(rpcCalls,0);

console.log("Controles locales de Estética: cancelación, originales, HEX, contraste y confirmación aprobados.");
