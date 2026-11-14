import fs from "node:fs";
import vm from "node:vm";
import {randomUUID} from "node:crypto";

const decode=s=>String(s).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const voidTags=new Set(["input","img","br","hr","meta","link"]);
class Element {
  constructor(tag="div",attrs={}){
    this.tagName=tag;this.attrs=attrs;this.children=[];this.dataset={};this.style={setProperty(name,value){this[name]=value;}};
    for(const [key,value] of Object.entries(attrs))if(key.startsWith("data-"))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    this.value=attrs.value||"";this.disabled="disabled" in attrs;this.required="required" in attrs;this.hidden="hidden" in attrs;
    this.className=attrs.class||"";this.textContent="";this.listeners={};
    this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(" ").filter(Boolean));on?set.add(name):set.delete(name);this.className=[...set].join(" ");},contains:name=>this.className.split(" ").includes(name)};
    this.classList.add=name=>this.classList.toggle(name,true);this.classList.remove=name=>this.classList.toggle(name,false);
  }
  set innerHTML(html){
    this.children=[];this.html=html;const stack=[this];
    for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){
      if(token.startsWith("</")){if(stack.length>1)stack.pop();continue;}
      if(token.startsWith("<")){
        const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;
        const attrs={};for(const match of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[match[1]]=decode(match[2]??"");
        const element=new Element(tag,attrs);stack.at(-1).children.push(element);element.parent=stack.at(-1);
        if(!voidTags.has(tag))stack.push(element);
      }else{const current=stack.at(-1);current.textContent+=decode(token);if(current.tagName==="textarea")current.value+=decode(token);}
    }
    for(const select of this.querySelectorAll("select")){
      const options=select.querySelectorAll("option"),option=options.find(o=>"selected" in o.attrs)||options[0];
      if(option)select.value=option.attrs.value??option.textContent;
    }
  }
  get innerHTML(){return this.html||"";}
  set value(value){this.inputValue=String(value);if(this.attrs.type==="datetime-local")this.inputValue=this.inputValue.replace(/(T\d{2}:\d{2}):00(?:\.000)?$/,"$1");}
  get value(){return this.inputValue||"";}
  matches(selector){
    if(selector.startsWith("#"))return this.attrs.id===selector.slice(1);
    const attr=selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if(attr)return attr[1] in this.attrs&&(attr[2]===undefined||this.attrs[attr[1]]===attr[2]);
    return this.tagName===selector;
  }
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(event,fn){this.listeners[event]=fn;}
  setAttribute(name,value){this.attrs[name]=value;if(name==="disabled")this.disabled=true;}
  removeAttribute(name){delete this.attrs[name];if(name==="src")this.src="";if(name==="disabled")this.disabled=false;}
  focus(){this.focused=true;}
}
export const clone=value=>JSON.parse(JSON.stringify(value));
export const event={preventDefault(){}};
export function harness({campaigns=[],occurrences=[],assets=[]}={}){
  const host=new Element("div",{id:"site-configuration-app"}),calls=[],messages=[],confirmations=[];
  const document={getElementById:id=>id==="site-configuration-app"?host:host.querySelector("#"+id),querySelector:s=>host.querySelector(s),querySelectorAll:s=>host.querySelectorAll(s),addEventListener(){},documentElement:{style:{setProperty(){}}},body:{style:{setProperty(){}}}};
  const context={document,console,crypto:{randomUUID},URL,URLSearchParams,Date,Intl,clearTimeout,setTimeout,clearInterval,setInterval,session:{role:"admin",supabaseUserId:"00000000-0000-0000-0000-000000000099",aal:"aal2"},toast:m=>messages.push(m),confirm:m=>{confirmations.push(m);return api.confirm;}};
  const listeners={};
  const window={__CUBICA_TEST__:true,CUBICA_CONFIG:{stageCMode:"admin"},crypto:{randomUUID},addEventListener:(name,fn)=>listeners[name]=fn,cubicaAdminMfaAccessAllowed:()=>context.session?.aal==="aal2",cubicaSupabase:{rpc:async(name,args)=>{calls.push({name,args:clone(args)});return api.rpc(name,args);},storage:{from:()=>({createSignedUrl:async path=>api.sign(path)})}}};
  context.window=window;
  const api={host,document,context,window,calls,messages,confirmations,listeners,confirm:false,rpc:async name=>{throw Error("Unexpected RPC: "+name);},sign:async path=>({data:{signedUrl:"https://assets.invalid/"+path},error:null}),get:id=>document.getElementById(id),all:s=>document.querySelectorAll(s)};
  vm.runInNewContext(fs.readFileSync(new URL("../js/site-experience.js",import.meta.url),"utf8"),context);
  api.i=window.cubicaSiteExperienceInternals;
  Object.assign(api.i.state,{admin:{campaigns,occurrences,assets},tab:"campaigns",calendarCursor:"2026-11"});
  api.i.renderAdmin();
  api.input=(key,value)=>{api.get("campaign-"+key).value=value;api.get("site-campaign-form").oninput();};
  api.submit=()=>api.get("site-campaign-form").onsubmit(event);
  return api;
}
export function validForm(h){
  for(const [key,value] of Object.entries({name:"Campaña local",description:"Prueba aislada",priority:"3",start:"2026-11-13T09:00",end:"2026-11-14T00:00"}))h.input(key,value);
}
export function responseFor(p,extra={}){
  return {id:p.p_id||"10000000-0000-0000-0000-000000000001",version:p.p_expected_version+1,state:"draft",...Object.fromEntries(Object.entries(p).filter(([key])=>!["p_id","p_expected_version","p_request_id","p_occurrences"].includes(key)).map(([key,value])=>[key.slice(2),value])),...extra};
}
